import { buildCatalog } from '../catalog/buildCatalog.js';
import { buildSlots } from '../slots/buildSlots.js';
import { routeFactory } from '../routing/routeFactory.js';
import { chartDependencies } from '../chart/chartDependencies.js';
import { seedFactory } from '../seed/factory.js';
import { requestFactory } from '../request/factory.js';
import { toolCallsFactory } from '../toolCalls/factory.js';
import type { TypedScope } from 'footprintjs';

import { type AgentRunValues } from '../../runValues.js';
import { bindRunnerStage, type RunnerScopeValues } from '../../../runnerExecution.js';
import { type FlowChart } from 'footprintjs';

import type { LLMToolSchema } from '../../../../provider-contract/types.js';

import { buildWindowStage } from '../../stages/window.js';

import type { MemoryStore } from '../../../../memory/store/index.js';

import { foldStepPlans } from '../../../../injection-engine/skillSteps.js';

import { buildInjectionEngineSubflow } from '../../../../injection-engine/buildInjectionEngineSubflow.js';
import { makePickEntryStage } from '../../stages/pickEntry.js';
import { makeRouteTurnStage } from '../../stages/routeTurn.js';

import type { Tool } from '../../../../tools/tools.js';
import type { AgentInput, AgentState } from '../../types.js';

import { hasOutputMiddleware } from '../../middleware/messagePhase.js';

import { buildToolCallsHandler } from '../../stages/toolCalls/index.js';

import { type HonestyLayers } from '../../honesty/armed.js';

import { buildAgentChart } from '../../buildAgentChart.js';
import { buildDynamicAgentChart } from '../../buildDynamicAgentChart.js';

import { buildThinkingSubflow } from '../../../slots/buildThinkingSubflow.js';
import type { AgentContext } from '../contracts.js';

// ─── Chart assembly ────────────────────────────────────────────

export function buildChart(
  this: Pick<
    AgentContext,
    | 'configuration'
    | 'emitLateFact'
    | 'hiddenSkillIdsNow'
    | 'native'
    | 'ontologyTools'
    | 'openSkillIds'
    | 'revisionWithholdsTools'
    | 'runner'
    | 'seedClockDraft'
    | 'toolRunFacts'
  > &
    ThisParameterType<typeof buildCatalog> &
    ThisParameterType<typeof buildSlots> &
    ThisParameterType<typeof chartDependencies> &
    ThisParameterType<typeof routeFactory>,
): FlowChart {
  const readOntologyTools = () => this.ontologyTools;
  const governsOutput = hasOutputMiddleware(this.configuration.messageMiddleware);
  const provider = this.configuration.provider;
  const model = this.configuration.model;
  const temperature = this.configuration.temperature;
  const maxTokens = this.configuration.maxTokens;
  const systemPromptValue = this.configuration.systemPromptValue;
  const registry = this.configuration.registry;
  // (registryByName + toolSchemas redefined below using
  // `augmentedRegistry` which adds the auto-attached `read_skill`
  // tool when Skills are registered.)
  const _legacyRegistry = registry;
  void _legacyRegistry;
  const maxIterations = this.configuration.maxIterations;
  const pricingTable = this.configuration.pricingTable;
  const costBudget = this.configuration.costBudget;
  const permissionChecker = this.configuration.permissionChecker;
  const credentialProvider = this.configuration.credentialProvider;
  const artifactStore = this.configuration.artifactStore;
  // Cache layer (v2.6) — capture for the seed + chart-build closures.
  // `systemPromptCachePolicy` is fed into the CacheDecision subflow's
  // inputMapper. `cacheStrategy` is consulted by BuildLLMRequest at
  // run-time (Phase 7+ for the actual prepareRequest call). For
  // Phase 6b the chart mounts the stages but BuildLLMRequest is a
  // pass-through; Phase 7 lights up the strategy call.
  const systemPromptCachePolicy = this.configuration.systemPromptCachePolicy;
  const cachingDisabled = this.configuration.cachingDisabledValue;
  const cacheStrategy = this.configuration.cacheStrategy;

  // ── Steps-as-data (9.18.0): fold the declared procedures ONCE ──────
  // One frozen plan per stepped skill, threaded as closures into the four
  // seams that consult it (Evaluate re-key, tools-slot narrowing,
  // tool-calls advance/skip, the Route step judge + nudge). Empty →
  // `stepPlanFor` stays undefined and not one of those seams runs a new
  // line (zero-cost-when-unused).
  const stepPlans = foldStepPlans(this.configuration.injections);
  const stepPlanFor = stepPlans.size > 0 ? (skillId: string) => stepPlans.get(skillId) : undefined;

  // seed extracted to ./agent/stages/seed.ts (v2.11.2). Factory takes
  // chart-build-time constants + per-run mutable accessors so the
  // resume side-channel and current run id remain dynamic.
  // toolSchemas is finalized further down; pass a getter that reads
  // the eventual const at stage-execution time.
  let toolSchemasResolved: readonly LLMToolSchema[] = [];
  // The `Tool.wants` declarations seed puts on the record (9.88.0), late-bound
  // for the same reason `toolSchemasResolved` is: the registry is harvested
  // further down, and seed is built here. Stays `undefined` unless the
  // evidence gate arms the staged-refs nudge — the exact condition under
  // which request assembly can compose that line at all.
  let seededToolWants: Readonly<Record<string, readonly string[]>> | undefined;
  // The stores the conversation itself is kept in — the durable anchor seed
  // resolves the turn number against. Deduplicated (several memories over
  // one store is the common shape) and reference-stable, so the scan runs
  // once per store per run.
  const conversationStores = Array.from(
    new Set(
      this.configuration.memories
        .filter((m) => m.write !== undefined && m.corpus === undefined && m.store !== undefined)
        .map((m) => m.store as MemoryStore),
    ),
  );
  // The inputs layer (honesty layer 2) — late-bound like `toolSchemas`: the
  // registry that says whether a tool is ruled is harvested further down.
  let seededRuledTools: ReadonlyMap<string, Tool> | undefined;
  let seededHonestyLayers: HonestyLayers | undefined;
  // The findings ledger's restore (9.101.0), WIDENED (honesty layer 2): wired
  // whenever the ledger OR an honesty layer is armed — an agent without
  // `.findings()` files argument rows too, and a continued conversation must
  // keep them. Negative-claim observations also persist independently of those
  // layers. Still value-conditional inside seed (only when rows exist).
  let ledgerRestoreArmed =
    this.configuration.findingsOptions !== undefined ||
    this.configuration.negativeClaimsConfig !== undefined;
  const seedFor = seedFactory({
    configuration: this.configuration,
    maxIterations,
    cachingDisabled,
    costBudget,
    get toolSchemasResolved() {
      return toolSchemasResolved;
    },
    get seededToolWants() {
      return seededToolWants;
    },
    get seededRuledTools() {
      return seededRuledTools;
    },
    get seededHonestyLayers() {
      return seededHonestyLayers;
    },
    get ledgerRestoreArmed() {
      return ledgerRestoreArmed;
    },
    stepPlanFor,
    conversationStores,
    model,
    systemPromptValue,
    seedClockDraft: (value) => this.seedClockDraft(value),
    get ontologyTools() {
      return readOntologyTools();
    },
    revisionWithholdsTools: () => this.revisionWithholdsTools(),
  });
  const seed = bindRunnerStage(
    (scope: TypedScope<AgentState>) => this.native.runExecution().forScope(scope),
    (run) => (scope) => {
      run.value.resources?.seed(scope);
      // Mounted runs have no Agent.run() admission. Seed's actual input is
      // their original message; never read another run's selected values.
      run.value.checkpointTracker ??= {
        runId: run.context.runId,
        originalInput: { message: scope.$getArgs<AgentInput>().message },
        history: [],
        lastCompletedIteration: 0,
      };
      return (run.value.seed ??= seedFor(run))(scope);
    },
  );
  const {
    registryByName,
    toolSchemas,
    toolDeclaringSkills,
    toolClaimants,
    inputsArmed,
    argumentSources,
    resultsArmed,
    answerArmed,
    scriptRecordArmed,
  } = buildCatalog.call(this, {
    registry,
    artifactStore,
    get toolSchemasResolved() {
      return toolSchemasResolved;
    },
    set toolSchemasResolved(value) {
      toolSchemasResolved = value;
    },
    get seededRuledTools() {
      return seededRuledTools;
    },
    set seededRuledTools(value) {
      seededRuledTools = value;
    },
    get seededHonestyLayers() {
      return seededHonestyLayers;
    },
    set seededHonestyLayers(value) {
      seededHonestyLayers = value;
    },
    get ledgerRestoreArmed() {
      return ledgerRestoreArmed;
    },
    set ledgerRestoreArmed(value) {
      ledgerRestoreArmed = value;
    },
  });

  // The gate's admissible set, for the record (9.50.0): declared hops from
  // the cursor plus the open skills — the SAME two resolvers the read_skill
  // offer and the refusal messages are built from (`readSkillOfferFor`),
  // composed once here so `context.evaluated.cursorMove.reachable` can
  // never drift from the verdicts. Open ids are fixed after build, so they
  // are computed once, exactly as the offer builder does.
  const openForReachable = this.configuration.skillGraphReachable ? this.openSkillIds() : [];
  // Per-role skill visibility (9.11.0). The RESOLVER is handed to the
  // Injection Engine, the fact's one owner: its Gather stage resolves the
  // ids once per iteration, BEFORE anything decides, so the cursor and the
  // evaluator refuse a hidden skill on every activation path; the mount
  // publishes them on scope for every model-facing composer after it.
  const hiddenSkillIdsForEngine = this.hiddenSkillIdsNow();
  const injectionEngineSubflow = buildInjectionEngineSubflow({
    injections: this.configuration.injections,
    ...(hiddenSkillIdsForEngine && { hiddenSkillIds: hiddenSkillIdsForEngine }),
    ...(this.configuration.skillGraphNextSkill && {
      nextSkill: this.configuration.skillGraphNextSkill,
    }),
    ...(this.configuration.skillGraphExplainNextSkill && {
      explainNextSkill: this.configuration.skillGraphExplainNextSkill,
    }),
    ...(this.configuration.skillGraphReachable && {
      reachableSkills: (currentSkillId?: string) => [
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        ...new Set([
          ...this.configuration.skillGraphReachable!(currentSkillId),
          ...openForReachable,
        ]),
      ],
    }),
    ...(this.configuration.skillGraphSupersededEntries && {
      supersededEntries: this.configuration.skillGraphSupersededEntries,
    }),
    // Steps (9.18.0): the Evaluate stage owns the pointer's tenure re-key.
    ...(stepPlanFor !== undefined && { stepPlanFor }),
    // The maps kernel (9.58.0): the Evaluate stage owns the engagement
    // advance, with the same ctx the triggers gate on.
    ...(this.configuration.mapsPlan !== undefined && { engagement: this.configuration.mapsPlan }),
  });
  // The turn-start slot's occupant (SG-C). RouteTurn — the cascade — mounts
  // ONLY when the graph runs it: a classifier is configured, or the mount
  // declared `continuity: 'conversation'`. Every other graph keeps exactly
  // what it had: scorer graphs keep PickEntry byte-for-byte (no cascade, no
  // turn_routed — the zero-delta law), plain graphs keep no stage at all.
  const cascade = this.configuration.skillGraphCascade;
  const runsCascade =
    cascade !== undefined &&
    cascade.turnRouting !== undefined &&
    (cascade.turnRouting.scorer !== undefined || cascade.continuity === 'conversation');
  const hiddenSkillIdsForRouting = this.hiddenSkillIdsNow();
  const routeTurnStage = runsCascade
    ? makeRouteTurnStage({
        turnRouting: cascade.turnRouting!,
        ...(this.configuration.skillGraphScoreEntries && {
          scoreEntries: this.configuration.skillGraphScoreEntries,
        }),
        continuity: cascade.continuity,
        strictness: cascade.strictness,
        isNode: (id) => cascade.nodeIds.has(id),
        ...(hiddenSkillIdsForRouting && { hiddenSkillIds: hiddenSkillIdsForRouting }),
        // The tier-3 decider (9.19.0) — the out-of-band menu resolver.
        // `AgentBuilder.build()` already refused a decider on a mount
        // that never runs the cascade, so it always reaches its stage.
        ...(this.configuration.skillBrains?.decider !== undefined && {
          decider: {
            provider: this.configuration.skillBrains.decider.provider,
            ...(this.configuration.skillBrains.decider.model !== undefined && {
              model: this.configuration.skillBrains.decider.model,
            }),
            defaultModel: model,
            runConfigured: this.configuration.runConfigFn !== undefined,
          },
        }),
      })
    : undefined;
  // Relevance entry router — a once-per-turn stage (off the ReAct loop) that
  // picks the starting skill by embedding similarity. Only built (and mounted)
  // when the graph was created with `.entryByRelevance()` AND the cascade did
  // not subsume it.
  const pickEntryStage =
    !routeTurnStage && this.configuration.skillGraphScoreEntries
      ? makePickEntryStage(this.configuration.skillGraphScoreEntries)
      : undefined;
  const {
    systemPromptSubflow,
    messagesSubflow,
    resolverForValues,
    resolveForLayer,
    displayNameOfFor,
    toolGrounding,
    toolColumns,
    toolWants,
    toolsSubflow,
  } = buildSlots.call(this, {
    registryByName,
    registry,
    toolSchemas,
    inputsArmed,
    argumentSources,
    resultsArmed,
    get seededToolWants() {
      return seededToolWants;
    },
    set seededToolWants(value) {
      seededToolWants = value;
    },
    systemPromptValue,
    toolClaimants,
    stepPlanFor,
  });

  // callLLM extracted to ./agent/stages/callLLM.ts (v2.11.2). Same
  // late-binding pattern as seed for toolSchemas (computed below).
  const callLLMFor = requestFactory({
    configuration: this.configuration,
    argumentSources,
    governsOutput,
    provider,
    model,
    temperature,
    maxTokens,
    pricingTable,
    costBudget,
    maxIterations,
    cacheStrategy,
    get toolSchemasResolved() {
      return toolSchemasResolved;
    },
    toolGrounding,
    toolWants,
    toolColumns,
    revisionWithholdsTools: () => this.revisionWithholdsTools(),
  });

  // Window stage (7.16 as compaction; the strategy family since 7.17) —
  // built ONLY when `.window()` / `.compaction()` was called. When present
  // it becomes the ReAct loop target (see the chart builders), so it runs
  // once per iteration boundary with the previous call's adapter-reported
  // usage already measured by the meter.
  const callLLM = bindRunnerStage(
    (scope: TypedScope<AgentState>) => this.native.runExecution().forScope(scope),
    (run) => (run.value.callLLM ??= callLLMFor(run)),
  );

  const configuredWindow = this.configuration.windowStrategy;
  const windowStage = configuredWindow
    ? {
        strategyName: configuredWindow.name,
        run: bindRunnerStage(
          (scope: TypedScope<AgentState>) => this.native.runExecution().forScope(scope),
          (run) =>
            (run.value.window ??= buildWindowStage({
              strategy: configuredWindow,
              meter: run.value.compactionMeter!,
              ...(run.value.evictedTurnsHandle !== undefined && {
                evictedTurns: run.value.evictedTurnsHandle,
              }),
              agentModel: model,
              providerName: provider.name,
              getRunId: () => run.context.runId,
              // Value-conditional (the `repeatedCallNudge` precedent): an
              // agent on the default hands the stage exactly the deps object
              // it always did.
              ...(this.configuration.keepLastToolResults !== undefined && {
                keepLastToolResults: this.configuration.keepLastToolResults,
              }),
              // The findings ledger (9.102.0): the arm and the RESOLVED
              // ledger-fact ceiling, together or not at all. `keepLedgerFacts`
              // is set exactly when `.findings()` is on, so an unarmed agent
              // hands the stage exactly the deps object it always did; an
              // armed agent with no window strategy threads nothing, because
              // this whole stage does not exist for it.
              ...(this.configuration.keepLedgerFacts !== undefined && {
                hasFindingsLedger: true as const,
                keepLedgerFacts: this.configuration.keepLedgerFacts,
              }),
              ...(pricingTable !== undefined && { pricingTable }),
              ...(costBudget !== undefined && { costBudget }),
            })),
        ),
      }
    : undefined;

  // routeDecider extracted to ./agent/stages/route.ts (v2.11.2).
  // The Route decider carries the `'output'` half of the message chain when
  // one is configured — see buildRouteDeciderStage for why that seam and not
  // PrepareFinal. Without a chain this is the same function reference the
  // chart has always been handed.
  // 7.26 — the decider also judges the final answer against the schema when
  // the agent opted into enforcement, because it is the last stage that
  // still has a loop to send the answer back around. Without enforcement
  // this is the same function reference the chart has always been handed.
  // 9.18.0 — the decider also judges a would-be-final answer against the
  // active step procedure (nudge once / accept / cut-short) when a stepped
  // skill is registered. Without steps this is the same function reference
  // the chart has always been handed.
  // 9.35.0 — and the decider grounds the would-be-final answer in the
  // turn's own tool results when `.namesAndNumbersFromEvidence()` is
  // configured. Without it this is the same function reference the chart
  // has always been handed.
  // ── The out-of-budget wrap-up (9.56.0) — one build-time decision ───
  // Mounted when the agent can CALL a tool and did not opt out. The tool
  // test is not a nicety: a limit only cuts a turn short when tool calls
  // were pending (`decideBranch`'s `earlyStop`), so an agent with nothing to
  // call can never reach the branch — and mounting a node that can never run
  // would put a WrapUp box on every toolless agent's chart, in every
  // recording, forever. A `ToolProvider` counts even though its list is only
  // known per iteration: it might list one, and "might" is the whole
  // question a build-time mount can answer.
  const canCallTools =
    registryByName.size > 0 || this.configuration.externalToolProvider !== undefined;
  const hasWrapUp = canCallTools && this.configuration.wrapUpAtMaxIterations !== false;

  const limitsAsData =
    this.configuration.limitsTravelWithTheAnswerValue &&
    this.configuration.outputSchemaParser !== undefined;

  const routeFor = routeFactory.call(this, {
    resolverForValues,
    governsOutput,
    maxIterations,
    hasWrapUp,
    limitsAsData,
    inputsArmed,
    stepPlanFor,
    resultsArmed,
    answerArmed,
    artifactStore,
  });
  const terminalRouteDecider = bindRunnerStage(
    (scope: TypedScope<AgentState>) => this.native.runExecution().forScope(scope),
    (run) => (run.value.route ??= routeFor(run)),
  );
  const toolCallsFor = toolCallsFactory({
    configuration: this.configuration,
    runner: this.runner,
    registryByName,
    toolDeclaringSkills,
    scriptRecordArmed,
    inputsArmed,
    argumentSources,
    resultsArmed,
    answerArmed,
    toolGrounding,
    toolColumns,
    toolClaimants,
    permissionChecker,
    credentialProvider,
    artifactStore,
    stepPlanFor,
    provider,
    model,
    openSkillIds: () => this.openSkillIds(),
    toolRunFacts: (run) => this.toolRunFacts(run),
    emitLateFact: (type, payload, context) => this.emitLateFact(type, payload, context),
    resolverForValues,
  });

  // v2.14 — Build the NormalizeThinking sub-subflow only when a
  // ThinkingHandler resolved (declared by the provider OR
  // explicitly set via .thinkingHandler()). Conditional mount ensures
  // zero overhead for non-thinking agents — the chart has zero extra
  // stages when undefined.
  const handlerFor = (run: RunnerScopeValues<AgentRunValues>) =>
    (run.value.toolCalls ??= toolCallsFor(run));
  const toolCallsHandler: ReturnType<typeof buildToolCallsHandler> = {
    execute: bindRunnerStage(
      (scope: TypedScope<AgentState>) => this.native.runExecution().forScope(scope),
      (run) => (scope) => handlerFor(run).execute(scope),
    ),
    resume: bindRunnerStage(
      (scope: TypedScope<AgentState>) => this.native.runExecution().forScope(scope),
      (run) => (scope, input) => handlerFor(run).resume(scope, input),
    ),
  };
  const thinkingSubflow = this.configuration.thinkingHandler
    ? buildThinkingSubflow(this.configuration.thinkingHandler, this.configuration.provider.name)
    : undefined;

  // Chart composition extracted to ./agent/buildAgentChart.ts (v2.11.2).
  // The deps object is identical for both chart shapes — only the
  // wiring differs (flat call-llm stage vs sf-llm-call subflow).

  const chartDeps = chartDependencies.call(this, {
    systemPromptCachePolicy,
    maxIterations,
    seed,
    callLLM,
    terminalRouteDecider,
    toolCallsHandler,
    stepPlanFor,
    toolWants,
    get toolSchemasResolved() {
      return toolSchemasResolved;
    },
    set toolSchemasResolved(value) {
      toolSchemasResolved = value;
    },
    inputsArmed,
    resolveForLayer,
    argumentSources,
    registryByName,
    resultsArmed,
    canCallTools,
    displayNameOfFor,
    limitsAsData,
    governsOutput,
    hasWrapUp,
    injectionEngineSubflow,
    pickEntryStage,
    routeTurnStage,
    systemPromptSubflow,
    messagesSubflow,
    toolsSubflow,
    thinkingSubflow,
    windowStage,
  });

  // `'dynamic-grouped'` wraps the whole LLM turn in an `sf-llm-call` subflow —
  // the same boundary LLMCall produces — so Lens / explainable-ui render it as
  // an LLM group with its slots inside. `'classic'` and `'dynamic'` use the
  // flat chart; they differ only in `chartDeps.reactMode` (whether the Context
  // selector re-engineers the static slots each turn). Grouping is dynamic-only
  // (it re-seeds context every turn by design), so there is no classic-grouped.
  return this.configuration.reactMode === 'dynamic-grouped'
    ? buildDynamicAgentChart(chartDeps)
    : buildAgentChart(chartDeps);
}
