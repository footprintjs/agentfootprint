import { type AgentRunValues } from '../../runValues.js';
import { readDisplayName } from '../../../../lib/displayName.js';
import type { LLMToolSchema } from '../../../../provider-contract/types.js';
import {
  buildSystemPromptSlot,
  type SystemPromptSlotArgs,
} from '../../../slots/buildSystemPromptSlot.js';
import { buildMessagesSlot } from '../../../slots/buildMessagesSlot.js';
import { buildToolsSlot } from '../../../slots/buildToolsSlot.js';
import { toolWantsOf } from '../../stagedRefs.js';
import { notServedResult } from '../../stages/toolCalls/index.js';
import { buildToolResolver } from '../../stages/toolResolver.js';
import { memberIdentityIn } from '../../../memberRun.js';
import { buildToolRegistry } from '../../buildToolRegistry.js';
import type { AgentContext } from '../contracts.js';

import type { AgentConfiguration } from '../configuration/types.js';

import type { StepPlanFor } from '../../../../injection-engine/skillSteps.js';

export interface SlotsEnvironment {
  readonly systemPromptValue: string;
  readonly toolClaimants: ReturnType<typeof buildToolRegistry>['toolClaimants'];
  readonly stepPlanFor: StepPlanFor | undefined;
  readonly registryByName: ReturnType<typeof buildToolRegistry>['registryByName'];
  readonly registry: AgentConfiguration['registry'];
  readonly toolSchemas: readonly LLMToolSchema[];
  readonly inputsArmed: boolean;
  readonly argumentSources: boolean;
  readonly resultsArmed: boolean;
  seededToolWants: Readonly<Record<string, readonly string[]>> | undefined;
}

export function buildSlots(
  this: Pick<
    AgentContext,
    | 'configuration'
    | 'integrityColumnsPresent'
    | 'integrityDanglingPresent'
    | 'native'
    | 'readSkillOfferFor'
  >,
  environment: SlotsEnvironment,
) {
  // With `.configure()` the base prompt becomes a function of the run: the
  // slot reads the instructions seed committed, falling back to `.system()`
  // when the resolver left it alone. `reason` follows the same fork so the
  // context record names whichever one actually supplied the text.
  // Per-slot budgets (8.11.0). Each key is forwarded only when the consumer
  // set it, so an unset slot keeps its own default rather than being pinned
  // to `undefined` at the call site.
  const budget = this.configuration.contextBudget;
  const systemPromptSubflow = buildSystemPromptSlot({
    ...(this.configuration.runConfigFn
      ? {
          prompt: (args: SystemPromptSlotArgs) =>
            args.instructions ?? environment.systemPromptValue,
          reason: (args: SystemPromptSlotArgs) =>
            args.instructions !== undefined ? 'Agent.configure()' : 'Agent.system()',
        }
      : {
          prompt: environment.systemPromptValue,
          reason: 'Agent.system()',
        }),
    ...(budget?.systemPrompt !== undefined && { budgetCap: budget.systemPrompt }),
  });
  const messagesSubflow = buildMessagesSlot({
    ...(budget?.messages !== undefined && { budgetCap: budget.messages }),
  });
  // Every reader binds the same native component's private catalog.
  const resolverForValues = (values: AgentRunValues) =>
    buildToolResolver({
      registryByName: environment.registryByName,
      ...(this.configuration.externalToolProvider && {
        externalToolProvider: this.configuration.externalToolProvider,
      }),
      ...(this.configuration.externalToolProvider && {
        providerToolCache: values.providerToolCache,
      }),
      servedTools: values.servedTools,
      toolClaimants: environment.toolClaimants,
      notServed: notServedResult,
    });
  const resolveForLayer = (scope: object) =>
    resolverForValues(this.native.runExecution().forScope(scope).value);
  const displayNameOfFor =
    this.configuration.externalToolProvider !== undefined ||
    [...environment.registryByName.values()].some((tool) => tool.displayName !== undefined)
      ? (scope: object) => {
          const resolve = resolveForLayer(scope);
          return (toolName: string): string | undefined =>
            readDisplayName(resolve(toolName).tool?.displayName);
        }
      : undefined;
  const readSkillFor = this.readSkillOfferFor();
  // Per-role skill visibility. The Injection Engine resolves the ids once per
  // iteration and publishes them on scope (`buildInjectionEngineSubflow.ts` ·
  // `hiddenSkillIdsOf`); the tools slot reads that published set through its
  // mount. Since 9.86.0 the description is NOT the only reader — the read_skill gate's refusals, the
  // `skill.rejected` payload, the propose-transition refusal and the dispatch
  // roster all filter through that published set
  // (`stages/toolCalls/routing/readSkillRoute.ts` · `applyReadSkillRoute` the gate, `toolCalls/routing/effectsOperations.ts` ·
  // "── THE REFUSAL SPEAKS WITH THE FILTERED SETS" the propose-transition refusal,
  // `toolCalls/execution/catalogOperations.ts` · `dispatchRoster`). Nothing is cached here: an
  // earlier draft of 9.84.0 cached the resolved ids so the gate could filter
  // the self-call notice's move offer through them; the notice no longer names
  // a destination at all (see `selfCallNotice`), so there is nothing left to
  // filter and the cache went with the clause that needed it.
  // Registration-time owner stamps (9.60.0) — the identity edges the
  // integrity checks read. Built once per chart from the registry.
  const toolOwners = new Map(
    environment.registry
      .filter((r) => r.tool.owner !== undefined)
      .map((r) => [r.name, r.tool.owner!] as const),
  );
  // The declared argument-ground edges (9.60.0; catalog-wide since 9.72.0)
  // — read by callLLM's dangling-reference and unsupported-argument checks.
  //
  // Harvested from `registryByName` — the FULL declared catalog (static
  // `.tool()` registrations PLUS every skill-carried tool, autoActivate/
  // scoped ones included) — and not from the static registry alone, which
  // was the field bug a consumer's MCP parity work surfaced: an app whose
  // `argumentsFrom` tools all ride skills (delivered when a skill
  // activates) never armed the choice-seam pair, and its disposition rows
  // read {checked: 0, notApplicable: 1} forever while the app's own
  // comments believed the checks ran.
  //
  // ARMING IS COMPUTABLE UP FRONT, and that is a build-time fact, not a
  // hope: a skill tool's DECLARATION is known at chart build (defineSkill
  // carries the Tool object into `buildToolRegistry`'s dispatch map) even
  // though the tool reaches the model only after its skill activates — so
  // this harvest, and the `dangling` flag `beginIntegrityRun` reads at run
  // start, may see the whole catalog before any skill has fired. The
  // runtime checks stay correctly scoped on their own: dangling-reference
  // intersects this map with the tools THIS call actually served, and
  // unsupported-argument with the calls the model actually made.
  //
  // CAVEAT, stated rather than papered over: ToolProvider-DELIVERED tools
  // remain invisible here. `ToolProvider.list(ctx)` is opaque and
  // per-iteration — there is no build-time list to harvest — so a provider
  // tool declaring `argumentsFrom` arms nothing. (MCP tools are NOT in that
  // hole: `mcpClient(...).tools()` registers them statically, and 9.71.0
  // carries their declarations across the wire.)
  const toolGrounding = new Map(
    [...environment.registryByName.entries()]
      .filter(([, tool]) => tool.argumentsFrom !== undefined)
      .map(([name, tool]) => [name, tool.argumentsFrom!] as const),
  );
  this.integrityDanglingPresent = toolGrounding.size > 0;
  // The column-type contract's declared half (9.78.0) — harvested from the
  // SAME catalog and with the same ToolProvider caveat, so an MCP-carried
  // `resultColumns` (which rides `_meta`) arms the check exactly as a
  // locally-defined one does.
  // `flatMap` rather than filter-then-assert: the narrowing is real here,
  // so the twin harvest above's non-null assertion is not inherited.
  const toolColumns = new Map(
    [...environment.registryByName.entries()].flatMap(([name, tool]) =>
      tool.resultColumns === undefined ? [] : [[name, tool.resultColumns] as const],
    ),
  );
  this.integrityColumnsPresent = toolColumns.size > 0;
  // The staged-refs join's other half (grounded numbers): `Tool.wants` by
  // tool name, harvested the same way and with the same ToolProvider caveat.
  // Consumed only by the evidence gate (the callLLM nudge and the recheck
  // correction), so an agent without the gate never reads it.
  const toolWants = toolWantsOf(environment.registryByName);
  // …and onto the record (9.88.0), under the SAME arming condition callLLM
  // uses below, so the rebuild composes the nudge exactly when the run could.
  // A plain record: a `Map` written to scope round-trips to `{}`.
  if (this.configuration.evidenceGate?.nudge === true && toolWants.size > 0) {
    environment.seededToolWants = Object.fromEntries(
      [...toolWants].map(([name, kinds]) => [name, kinds]),
    );
  }
  const toolsSubflow = buildToolsSlot({
    tools: environment.toolSchemas,
    ...(toolOwners.size > 0 && { toolOwners }),
    // The kernel's map cards, for the compose-seam integrity backstop.
    ...(this.configuration.mapsPlan !== undefined && {
      mountedMaps: this.configuration.mapsPlan.maps.map((m) => ({
        id: m.id,
        toolNames: m.toolNames,
      })),
    }),
    runtime: (scope) => {
      const value = this.native.runExecution().forScope(scope).value;
      return { ...value, integrityLedger: value.integrityLedger };
    },
    ...(this.configuration.externalToolProvider && {
      toolProvider: this.configuration.externalToolProvider,
    }),
    // The caller of THIS run, for `ToolDispatchContext.callerIdentity`: the
    // instance's caller on its own run, the member's run on a mount — never a
    // derived identity (the `hiddenSkillIdsNow` precedent).
    ...(this.configuration.externalToolProvider && {
      callerIdentity: (scope: object) =>
        this.native.runExecution().forScope(scope).own
          ? this.native.runExecution().forScope(scope).value.identity
          : memberIdentityIn(scope),
    }),
    toolClaimants: environment.toolClaimants,
    ...(readSkillFor && { readSkillFor }),
    ...(budget?.tools !== undefined && { budgetCap: budget.tools }),
    // Steps (9.18.0): per-step narrowing + banner + the skip_step offer.
    ...(environment.stepPlanFor !== undefined && { stepPlanFor: environment.stepPlanFor }),
    // The findings ledger (9.101.0): the ONE decoration site is inside this
    // slot; the gate rides in value-conditionally.
    ...(this.configuration.findingsOptions !== undefined && { findings: true as const }),
    // The inputs layer (honesty layer 2): the same site decorates a ruled
    // tool's schema first — value-conditional, the same grammar.
    ...(environment.inputsArmed && { inputsLayer: true as const }),
    // …and, under `.time()`, the ONE served time line: the windows the reader settled this turn
    // (`.time({ reader })`, step T6b) in each served period tool's form — and the window the
    // person set in the app's time control (`time.window`), a fact about the person's turn,
    // served on every request whether or not a served tool declares a period (G14), so it
    // needs no inputs layer. `reader` (write the line every composition) only beside the
    // inputs layer, the one place a reading is asked and served.
    ...(this.configuration.timeOptions !== undefined && {
      timeWindows: {
        ...(this.configuration.timeOptions.zone !== undefined && {
          appZone: this.configuration.timeOptions.zone,
        }),
        ...(environment.inputsArmed &&
          this.configuration.timeOptions.reader !== undefined && { reader: true as const }),
      },
    }),
    // …and, under `.time()` (step T8), the turn's time limits in the same line.
    ...(environment.inputsArmed &&
      this.configuration.timeOptions !== undefined && { timeLimits: true as const }),
    // …and, under declared sources, plants `_findings.from` on ruled tools only.
    ...(environment.argumentSources && { argumentSources: true as const }),
    // Tool choice by classifier (9.105.0): the pick and the narrowing live
    // inside this slot too, at the same site; value-conditional.
    ...(this.configuration.toolChoiceOptions !== undefined && {
      toolChoice: {
        classifier: this.configuration.toolChoiceOptions.classifier,
        ...(typeof this.configuration.toolChoiceOptions.serve === 'object' && {
          top: this.configuration.toolChoiceOptions.serve.top,
        }),
        ...(this.configuration.toolChoiceOptions.alwaysServe !== undefined && {
          alwaysServe: this.configuration.toolChoiceOptions.alwaysServe,
        }),
      },
    }),
  });
  return {
    systemPromptSubflow,
    messagesSubflow,
    resolverForValues,
    resolveForLayer,
    displayNameOfFor,
    toolGrounding,
    toolColumns,
    toolWants,
    toolsSubflow,
  };
}
