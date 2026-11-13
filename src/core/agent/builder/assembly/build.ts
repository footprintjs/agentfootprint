import { findingsInstruction } from '../../findings/instruction.js';
import { isDevMode } from 'footprintjs';
import type { SkillGraphOptions } from '../graph/options.js';
import { assertNoCollidingObserverIds } from '../observers/check.js';
import { assertCheckInHasADeclaringTool } from '../consent/check.js';
import { collectInnerRuns } from '../tools/innerRuns.js';
import { warnInertRelevanceHint } from '../skills/relevance.js';
import { warnRedundantSkillScopedTools } from '../skills/tools.js';
import { type OutputSchemaParser } from '../../../../answer-validation/outputSchema.js';
import {
  assertNegativeClaimsTools,
  negativeClaimsInstruction,
} from '../../negativeClaims/config.js';
import { scopeToolsToActiveSkill } from '../../toolsFromActiveSkill.js';
import type { ResolvedEvidenceGate } from '../../evidence/types.js';
import type { EngagementPlan } from '../../../../maps/engagement/types.js';
import type { Injection, InjectionContext } from '../../../../injection-engine/types.js';
import {
  type EntryScoring,
  type TurnRoutingPlan,
} from '../../../../injection-engine/skillGraph.js';
import { foldSkillBrains, type FoldedSkillBrains } from '../../skillBrains.js';
import { checkThinkingSupport } from '../../thinkingSupport.js';
import {
  defineMenuHint,
  MENU_HINT_METADATA_KEY,
} from '../../../../injection-engine/factories/defineMenuHint.js';
import { formatCheckup } from '../../../../injection-engine/skillGraphCheckup.js';
import { checkArtifactVocabularies } from '../../../../injection-engine/skillVocabulary.js';
import { toolOnlyDeliveryRefusal } from '../../../../injection-engine/skillBodyDelivery.js';
import { defineInstruction } from '../../../../injection-engine/factories/defineInstruction.js';
import type { ReliabilityConfig } from '../../../../reliability/types.js';
import type { ToolRegistryEntry } from '../../../../tools/tools.js';
import type { CheckInBuilderOptions } from '../../../checkin.js';
import type { ToolProvider } from '../../../../tools/toolProvider.js';
import type { Watcher } from '../../watch.js';
import { defaultCommentaryTemplates } from '../../../../recorders/observability/commentary/commentaryTemplates.js';
import { defaultStatusTemplates } from '../../../../recorders/observability/status/statusTemplates.js';
import type { SelfExplainExtension } from '../../selfExplainPort.js';
import { requireSelfExplain } from '../../selfExplainPort.js';
import { servingConversationOf } from '../../servingConversation.js';
import { TRACE_TOOL_NAMES } from '../../../../lib/traceToolNames.js';
import type { AgentOptions } from '../../types.js';
import { FINDINGS_INSTRUCTION_ID } from '../../findings/reserved.js';
import { readInputsLayerOption } from '../../honesty/armed.js';
import { type TimeOptions } from '../../../../time/clock.js';
import type { ResolvedScriptTravel } from '../../scripts/types.js';
import { scriptOf } from '../../../../tools/script.js';
import { checkContracts, type ContractsPort } from './contracts.js';
import { checkSteps, type StepsPort } from './steps.js';
import { checkDeferredContracts, type DeferredPort } from './deferred.js';
import type { BuildParts, ConstructedAgent } from './types.js';

export interface AssemblyPort extends ContractsPort, StepsPort, DeferredPort {
  appNameValue: string;
  commentaryOverrides: Readonly<Record<string, string>>;
  thinkingOverrides: Readonly<Record<string, string>>;
  maxIterationsOverride?: number;
  findingsValue?: NonNullable<AgentOptions['findings']>;
  toolChoiceValue?: NonNullable<AgentOptions['toolChoice']>;
  ontologyValue?: NonNullable<AgentOptions['ontology']>;
  inputsLayerValue: boolean;
  resultsLayerValue: boolean;
  timeValue?: TimeOptions;
  readonly opts: AgentOptions;
  inputsLayerSourcesValue: boolean;
  selfExplainConfig?: Parameters<SelfExplainExtension['binding']>[0];
  readonly registry: ToolRegistryEntry[];
  evidenceGate?: ResolvedEvidenceGate;
  readonly injectionList: Injection[];
  skillGraphCascade?: {
    readonly turnRouting?: TurnRoutingPlan;
    readonly strictness: 'assist' | 'guard' | 'rails';
    readonly continuity: 'turn' | 'conversation';
    readonly nodeIds: ReadonlySet<string>;
  };
  toolsFromActiveSkillValue: boolean;
  toolProviderRef?: ToolProvider;
  readonly recorderList: Watcher[];
  checkInConfig?: CheckInBuilderOptions;
  skillGraphScoreEntries?: (ctx: InjectionContext, signal?: AbortSignal) => Promise<EntryScoring>;
  skillGraphBrainOptions?: Pick<SkillGraphOptions, 'providers' | 'escalation' | 'decider'>;
  skillGraphNextSkill?: (ctx: InjectionContext) => string | undefined;
  skillGraphNodeIds?: ReadonlySet<string>;
  thinkingBudgetValue?: number;
  reliabilityConfig?: ReliabilityConfig;
  resolveMapsPlan(injections: readonly Injection[]): EngagementPlan | undefined;
  scriptTravelValue?: ResolvedScriptTravel;
  claimsContract?: Readonly<Record<string, { entity: string; field: string }>>;
  outputSchemaParser?: OutputSchemaParser<unknown>;
}

export function assembleAgent<TAgent extends ConstructedAgent>(
  self: AssemblyPort,
  construct: (parts: BuildParts) => TAgent,
): TAgent {
  const { negativeClaims, negativeSchema, answerLayer } = checkContracts(self);
  // Resolve the voice config: bundled defaults + consumer overrides.
  // Templates flow through the same barrel exports the rest of the
  // library uses, so a future locale-pack swap is a single import.
  const voice = {
    appName: self.appNameValue,
    commentaryTemplates: { ...defaultCommentaryTemplates, ...self.commentaryOverrides },
    thinkingTemplates: { ...defaultStatusTemplates, ...self.thinkingOverrides },
  };
  // The SAME options object the builder was given unless a door overrode
  // something — `maxIterations`, or the findings ledger (9.101.0), whose
  // normalised value lands as `AgentOptions.findings`. An agent with neither
  // hands `Agent` its options by reference, exactly as before.
  const opts =
    self.maxIterationsOverride !== undefined ||
    self.findingsValue !== undefined ||
    self.toolChoiceValue !== undefined ||
    self.ontologyValue !== undefined ||
    self.inputsLayerValue ||
    self.resultsLayerValue ||
    answerLayer !== undefined ||
    self.timeValue !== undefined
      ? {
          ...self.opts,
          ...(self.maxIterationsOverride !== undefined && {
            maxIterations: self.maxIterationsOverride,
          }),
          ...(self.findingsValue !== undefined && { findings: self.findingsValue }),
          // Tool choice by classifier (9.105.0), the same door grammar.
          ...(self.toolChoiceValue !== undefined && { toolChoice: self.toolChoiceValue }),
          // The declared ontology (9.106.0), the same door grammar.
          ...(self.ontologyValue !== undefined && { ontology: self.ontologyValue }),
          // The inputs layer (honesty layer 2), the same door grammar — its
          // object form only when it also arms declared sources. The door
          // MERGES with an `inputsLayer` option given to `Agent.create`: sources
          // armed by either stay armed, and a malformed option is still refused
          // by the one reader rather than silently replaced by the door's value.
          ...(self.inputsLayerValue && {
            inputsLayer:
              self.inputsLayerSourcesValue ||
              readInputsLayerOption(self.opts.inputsLayer)?.argumentSources === true
                ? { argumentSources: true }
                : true,
          }),
          // The results layer (honesty layer 3), the same door grammar.
          ...(self.resultsLayerValue && { resultsLayer: true }),
          // The answer layer (honesty layer 4), the same door grammar — the
          // value resolved above, whichever door set it.
          ...(answerLayer !== undefined && {
            answerLayer:
              answerLayer.standingLine === undefined
                ? true
                : answerLayer.standingLine === 'always'
                ? { standingLine: true }
                : { standingLine: { when: answerLayer.standingLine } },
          }),
          // The time layer, the same door grammar — the builder's value wins
          // over an `AgentOptions.time` given to `Agent.create`.
          ...(self.timeValue !== undefined && { time: self.timeValue }),
        }
      : self.opts;
  // .selfExplain(): a fresh binding per build() — two built agents never
  // share evidence. One mounted skill (methodology body only) + the trace
  // tools on a skill-scoped ToolProvider composed with the consumer's own,
  // so the catalog gains them ONLY on the activated iteration.
  //
  // Name reservation (mirrors the read_skill rule): the tools slot dedupes
  // by name with first-occurrence-wins and the static registry merges
  // FIRST — a consumer tool named like a trace tool would silently shadow
  // it, and the skill body would instruct the model into the wrong tool.
  //
  // The pieces come through the port (`selfExplainPort.ts`): the trace
  // toolpack sits above the agent, so it registers itself and this line
  // only asks — refusing with one sentence when nothing registered.
  const selfExplain = self.selfExplainConfig ? requireSelfExplain() : undefined;
  if (self.selfExplainConfig) {
    // Inline mode reserves whatever the pack can mount — read from
    // `TRACE_TOOL_NAMES` rather than retyped here, so a tool added to the
    // pack is reserved the same day it ships. Delegate mode mounts one
    // tool and reserves one name.
    const reserved: readonly string[] = self.selfExplainConfig.delegate
      ? ['explain_run']
      : TRACE_TOOL_NAMES;
    const clash = self.registry.find((entry) => reserved.includes(entry.name));
    if (clash) {
      throw new Error(
        `AgentBuilder.selfExplain: tool name '${clash.name}' is reserved by .selfExplain() ` +
          `(${self.selfExplainConfig.delegate ? 'delegate' : 'inline'} mode). The tools slot ` +
          `dedupes by name (first wins), so your tool would silently shadow the trace tool. ` +
          `Rename it, or reserved names: ${reserved.join(', ')}.`,
      );
    }
  }
  // THE CONTINGENT LINE (9.110.0) — the findings instruction gains one
  // line when the evidence gate is armed beside the ledger, and only then:
  // `findings/contingent.ts` runs under both doors, so the sentence that
  // names what it records is registered under both doors. Composed HERE
  // because the two doors may be called in either order; the injection
  // registered by `.findings()` is rebuilt in place, same id, same
  // activation, so an agent with the ledger alone keeps the exact bytes
  // `.findings()` registered.
  // Declared sources (honesty layer 2) add NO line: `from` is explained
  // once, in its own property on the ruled tools that carry it.
  if (self.findingsValue !== undefined && self.evidenceGate !== undefined) {
    const at = self.injectionList.findIndex((i) => i.id === FINDINGS_INSTRUCTION_ID);
    if (at >= 0) {
      self.injectionList[at] = findingsInstruction(
        true,
        self.findingsValue.answerAsk === 'quote-facts',
      );
    }
  }
  const selfExplainBinding =
    selfExplain && self.selfExplainConfig ? selfExplain.binding(self.selfExplainConfig) : undefined;
  let injections =
    selfExplain && selfExplainBinding
      ? [...self.injectionList, selfExplain.skill(self.selfExplainConfig!)]
      : self.injectionList;
  if (negativeClaims?.mode === 'typed' && negativeSchema !== undefined) {
    injections = [
      ...injections,
      defineInstruction({
        id: 'negative-claims',
        activeWhen: () => true,
        prompt: negativeClaimsInstruction(negativeClaims, negativeSchema),
      }),
    ];
  }
  // The tier-3 menu envelope's system-prompt half (SG-C): auto-registered
  // whenever the mounted graph can produce a MENU verdict — a menu with no
  // envelope would be a decision the model was never told about, the
  // accepted-and-silently-wrong kind. Not under `'rails'` (the model may
  // not act on a menu there), and not when the consumer registered their
  // own (the metadata marker, never the id — a renamed hint still counts).
  // Zero cost when the trigger is false: it reads `ctx.turnRoute`, which
  // only cascade graphs ever write.
  const cascadeForHint = self.skillGraphCascade;
  if (
    cascadeForHint !== undefined &&
    cascadeForHint.strictness !== 'rails' &&
    cascadeForHint.turnRouting !== undefined &&
    (cascadeForHint.turnRouting.scorer !== undefined ||
      cascadeForHint.continuity === 'conversation') &&
    !injections.some(
      (i) => (i.metadata as Record<string, unknown> | undefined)?.[MENU_HINT_METADATA_KEY],
    )
  ) {
    injections = [...injections, defineMenuHint()];
  }
  // ── The tool posture (9.36.0) — `.toolsFromActiveSkill()` ──────────
  // Applied to the FINAL injection list, for the reason every fold on this
  // line uses: skills arrive through `.skill()`, `.skills()`, `.injection()`,
  // `.skillGraph()` and `.selfExplain()`, and only here is the whole agent
  // visible. From this point on there is exactly ONE list, so the registry,
  // the slots, the projection and every recorder read the same stamp.
  // Untouched when the posture was never asked for — the `false` branch does
  // not even walk the list.
  if (self.toolsFromActiveSkillValue) {
    injections = scopeToolsToActiveSkill(injections);
  }
  injections = checkSteps(self, injections, opts);
  const toolProvider =
    selfExplain && selfExplainBinding
      ? selfExplain.toolProvider(selfExplainBinding, self.selfExplainConfig!, self.toolProviderRef)
      : self.toolProviderRef;
  // A skill may claim the `read_skill` delivery channel only if `read_skill` is
  // what activates it — otherwise its body reaches the model through no channel at
  // all (8.5.0). Checked HERE, on the final list, for the same reason
  // `resolveOutputEnforcement` lives here: the answer depends on the WHOLE agent.
  // `.skillGraph()` compiles the triggers, `.skill()` may add more after it, and
  // `.selfExplain()` adds one right above — only this line sees all of them.
  const deliveryRefusal = toolOnlyDeliveryRefusal(injections);
  if (deliveryRefusal) throw new Error(deliveryRefusal);
  // Two governance refusals that need the WHOLE agent (8.13.0), for the same
  // reason `resolveOutputEnforcement` and the delivery refusal live here:
  // observers arrive across many `.watch()` calls, and a `checkIn` demand can
  // come from `.tool()` OR from a skill's own tools, which only this line sees
  // assembled.
  assertNoCollidingObserverIds(self.recorderList);
  assertCheckInHasADeclaringTool(
    self.checkInConfig !== undefined,
    self.registry,
    injections,
    toolProvider,
  );
  // Two dev-mode warnings about wiring that is inert rather than wrong (8.7.0).
  // Both need the WHOLE agent — one asks whether a scorer exists, the other pairs a
  // provider against an injection — so both live here, beside the refusal above.
  warnInertRelevanceHint(injections, self.skillGraphScoreEntries !== undefined);
  warnRedundantSkillScopedTools(self.toolProviderRef, injections);
  checkDeferredContracts(self, injections);
  // ── The artifact vocabularies (SG-F, 9.25.0) ──────────────────────
  // Runs on the FINAL injection list, for the reason every check on this
  // line does: skills arrive through `.skill()`, `.skills()` AND
  // `.skillGraph()`, and only here is the whole agent visible — which is
  // exactly what the satisfiability rule needs ("does ANYTHING on this
  // agent declare it produces this kind?"). A graph that already ran its
  // own checkup re-reports here only if a producer outside the graph was
  // what silenced it, which is the answer the author wants either way.
  //
  // Always a dev-mode WARNING, never a throw, on ANY check mode: the rule
  // reads declarations only and cannot see a store seeded by another agent
  // or an earlier run (`skillVocabulary.ts` states the whole boundary), so
  // failing a build on it would be claiming more than it knows.
  const vocabularyProblems = checkArtifactVocabularies(injections);
  if (vocabularyProblems.length > 0 && isDevMode()) {
    // eslint-disable-next-line no-console
    console.warn(
      `agentfootprint Agent: artifact-vocabulary check-up:\n` +
        formatCheckup({ ok: true, problems: vocabularyProblems }),
    );
  }
  // ── The brains fold (9.19.0) — both declaration homes, one check-up ──
  // Runs on the FINAL injection list for the same reason the delivery
  // refusal does: `defineSkill({ provider })` can arrive through
  // `.skill()`, `.skills()` or `.skillGraph()`, and only this line sees
  // all of them. Undefined — nothing declared anywhere — and the Agent
  // wires nothing new.
  const skillBrains: FoldedSkillBrains | undefined = foldSkillBrains({
    injections,
    ...(self.skillGraphBrainOptions?.providers !== undefined && {
      providers: self.skillGraphBrainOptions.providers,
    }),
    ...(self.skillGraphBrainOptions?.escalation !== undefined && {
      escalation: self.skillGraphBrainOptions.escalation,
    }),
    ...(self.skillGraphBrainOptions?.decider !== undefined && {
      decider: self.skillGraphBrainOptions.decider,
    }),
    graphMounted: self.skillGraphNextSkill !== undefined,
    ...(self.skillGraphNodeIds !== undefined && { nodeIds: self.skillGraphNodeIds }),
    agentProviderName: opts.provider.name,
  });
  // ── Thinking, against what each provider DECLARES for its model ──
  // After the brains fold, because a brain's model is a model the thinking
  // request reaches too. A model that cannot think is refused HERE, by name
  // (`thinkingSupport.ts`), not as a vendor 400 on the first call.
  if (self.thinkingBudgetValue !== undefined) {
    checkThinkingSupport({
      budget: self.thinkingBudgetValue,
      provider: opts.provider,
      model: opts.model,
      ...(skillBrains !== undefined && { brains: skillBrains }),
      ...(self.reliabilityConfig?.providers !== undefined && {
        reliabilityProviders: self.reliabilityConfig.providers,
      }),
    });
  }
  // A decider with no menu to resolve: only a graph that RUNS the
  // turn-start cascade (a classifier, or `continuity: 'conversation'`)
  // ever produces an outstanding menu, so a decider on any other mount
  // would be config that never runs — refused rather than silently inert.
  if (skillBrains?.decider !== undefined) {
    const cascade = self.skillGraphCascade;
    const runsCascade =
      cascade !== undefined &&
      cascade.turnRouting !== undefined &&
      (cascade.turnRouting.scorer !== undefined || cascade.continuity === 'conversation');
    if (!runsCascade) {
      throw new Error(
        `Agent.build(): a routing decider is declared, but this mount never runs the ` +
          `turn-start cascade — no menu can ever be outstanding, so the decider would ` +
          `never be consulted. Give the graph a classifier (.classify(...) / start rules ` +
          `with intents) or mount with continuity: 'conversation', or drop \`decider\`.`,
      );
    }
  }
  // The maps kernel's plan (9.58.0) — resolved HERE because it needs both
  // the mounted graph (member ids) and the final injection list (each
  // member's contributed tool names). Refusals live in the resolver.
  const mapsPlan = self.resolveMapsPlan(injections);
  // The script record (`.scriptTravelsWithTheAnswer()`, `code: 'match'`) needs
  // a tool that DECLARES it runs a program — never inferred from a name.
  const declaresScript = [
    ...self.registry.map((entry) => entry.tool),
    ...injections.flatMap((injection) => injection.inject?.tools ?? []),
  ].some((tool) => scriptOf(tool) !== undefined);
  if (
    self.scriptTravelValue !== undefined &&
    !declaresScript &&
    self.toolProviderRef === undefined
  ) {
    throw new Error(
      'AgentBuilder.scriptTravelsWithTheAnswer: no registered tool declares `script`, so no ' +
        'call of this agent can ever file a program to attach. Register a code-running tool ' +
        "that declares one (`codeRunnerTool` does; a hand-built tool declares `script: { argument: 'code' }`), " +
        'or drop this option.',
    );
  }
  if (
    self.evidenceGate?.code === 'match' &&
    !declaresScript &&
    self.toolProviderRef === undefined &&
    isDevMode()
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      "agentfootprint: .namesAndNumbersFromEvidence({ code: 'match' }) on an agent where no " +
        'registered tool declares `script` — every fenced block the model shows is then a miss, ' +
        'read as prose. Register a code-running tool that declares `script` (codeRunnerTool ' +
        "does), or drop `code: 'match'`.",
    );
  }
  // The claim contract (9.61.0) — refused here rather than at `.claims()`,
  // because `.outputSchema()` may legitimately be declared after it.
  // A contract with no typed stratum to read would check nothing, and a
  // check that silently checks nothing is the decay this family exists
  // to prevent.
  if (self.claimsContract !== undefined && self.outputSchemaParser === undefined) {
    throw new Error(
      `Agent.claims(): a claim contract needs a validated answer to read — add ` +
        `.outputSchema(schema). The claim seam compares TYPED fields; prose is never ` +
        `checked, so without a schema this contract would check nothing.`,
    );
  }
  const claimContract =
    self.claimsContract === undefined
      ? undefined
      : Object.entries(self.claimsContract).map(([answerField, fact]) => ({
          answerField,
          entity: fact.entity,
          field: fact.field,
        }));
  if (negativeClaims?.mode === 'typed') {
    assertNegativeClaimsTools(negativeClaims, [
      ...self.registry.map((entry) => entry.tool),
      ...injections.flatMap((injection) => injection.inject?.tools ?? []),
    ]);
  }
  const agent = construct({
    opts,
    voice,
    injections,
    toolProvider,
    negativeSchema,
    skillBrains,
    mapsPlan,
    claimContract,
    negativeClaims,
  });
  // Attach the observers collected by `.watch()` so they receive events
  // from the very first run. Mirrors what consumers would do post-build
  // via `agent.attach(rec)`; the builder method is purely sugar over it,
  // which is what makes `.watch()` provably the same attachment.
  for (const observer of self.recorderList) {
    agent.attach(observer);
  }
  if (selfExplainBinding) {
    // Late binding: capture fires at each run's terminal flush, when
    // getLastSnapshot() IS the just-completed run (never in-flight).
    //
    // All THREE sources in one call, because a turn's evidence is three
    // things that a snapshot alone does not carry: what happened
    // (snapshot), how it read in English (narrative), and when each tool
    // call started and ended (events — the commit log has no clock).
    //
    // …plus a FOURTH when any mounted tool keeps a record of its own run
    // (`flowchartAsTool({ keepRecord: true })`). Collected here rather
    // than resolved per call because the store is a LIVE object owned by
    // the tool: the binding holds the lookup, and every record the tool
    // files after this point is visible through it.
    const innerRuns = collectInnerRuns(self.registry, injections);
    selfExplainBinding.bindTo({
      getSnapshot: () => agent.getLastSnapshot(),
      getNarrative: () => agent.getLastNarrativeEntries(),
      // Only the explained run's own events (`Agent.ownsEvent`): on an
      // instance serving several sessions the hosting door emits facts for
      // OTHER sessions while this run is in flight.
      on: (type, listener) =>
        agent.on(type, (event) => {
          if (agent.ownsEvent(event)) listener(event);
        }),
      ...(innerRuns !== undefined && { getInnerRuns: () => innerRuns }),
      // …and the evidence as a whole is kept PER CONVERSATION (R2-11): on a
      // shared `standingAgent({ agent })` the previous completed run of the
      // INSTANCE is whoever ran last, so the binding files each finished
      // turn under its conversation and serves the asking run's only —
      // snapshot, narrative, events and the tools' inner runs alike
      // (`agent/servingConversation.ts` says what the key is).
      getServing: () => servingConversationOf(agent),
    });
    agent.attach(selfExplainBinding.recorder());
    // …and the agent holds the binding, so `agent.canExplain()` answers
    // from the SAME fact the trace tools answer from rather than from a
    // second guess about whether a turn has completed.
    agent.bindSelfExplain(selfExplainBinding);
  }
  return agent;
}
