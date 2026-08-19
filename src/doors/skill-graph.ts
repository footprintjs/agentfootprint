/**
 * agentfootprint/skill-graph — the routing runtime, with no framework attached.
 *
 * A skill graph is a pure decision layer. You declare skills and the edges
 * between them; given one iteration's `InjectionContext` it answers three
 * questions — where is the cursor, what is reachable from there, which
 * injections are active — and it answers them with plain functions over plain
 * data. No model call, no loop, no scope, no flowchart.
 *
 * This door exposes exactly that layer, so a host that is NOT agentfootprint's
 * agent can run it: another agent framework, a server that routes prompts, a
 * test harness. The claim is CHECKED, not asserted —
 * `test/lib/injection-engine/skill-graph-fence.test.ts` walks the transitive
 * import graph of everything reachable from this file and fails if any of it
 * reaches `footprintjs`, `core/agent/*`, `core/tools.ts`, an adapter or a
 * recorder.
 *
 * WHAT A HOST OWES THE GRAPH is written down as a type:
 * {@link SkillGraphHost}. Five obligations, each naming the code in this
 * package that implements it. Read it before wiring anything.
 *
 * TWO HONEST COSTS.
 *
 *   1. `footprintjs` is still a REQUIRED peer dependency of this package. This
 *      door never loads it — that is the whole point of the fence — but npm
 *      will still install it beside you, because the rest of agentfootprint
 *      needs it and the package is not split. You pay the install, not the
 *      import.
 *   2. The PROVIDER LAYER is not here. `llmClassifier` and
 *      `constrainedEnumPick` need an `LLMProvider` to make a model call, so
 *      they genuinely depend on the adapter layer; pretending otherwise would
 *      be a fake abstraction. Import them from `agentfootprint/context` when
 *      you want the turn-start classifier cascade. Everything else about the
 *      graph — declared edges, entry rules, scorers, the tie policy, the
 *      check-up — is here.
 *
 * Also not here: the sugar factories (`defineSkill`, `defineInstruction`, …).
 * They resolve cache policies and validate against the framework's `Tool`, so
 * they live host-side, on `agentfootprint/context`. A foreign host builds
 * `Injection` objects directly — five fields, all data.
 *
 * THE EXAMPLE BELOW IS CHECKED, not typed out. Doc comments are emitted into
 * the `.d.ts`, so this block is what a consumer reads on hover — and the one
 * that shipped before 9.37.x could not compile three ways over (a config key
 * that does not exist, chaining the builder's methods off the finished graph
 * the object form returns, and passing ids to a `.route()` that takes skill
 * objects). It is now the `doc-example` region of
 * `examples/context-engineering/19-skill-graph-host.ts` — typechecked by
 * `npm run test:examples:typecheck`, RUN by `scripts/run-all-examples.sh`, and
 * pinned byte-for-byte to these lines by
 * `test/lib/injection-engine/skill-graph-doc-example.test.ts`. Edit it there;
 * the test will tell you to bring this copy along.
 *
 * @example routing a turn from a host that is not our agent
 * ```ts
 * import {
 *   readSkillDescriptor,
 *   skillGraph,
 *   type Injection,
 *   type InjectionContext,
 * } from 'agentfootprint/skill-graph';
 *
 * // A foreign host builds `Injection` objects directly — five fields, all data.
 * // (`defineSkill` and friends live host-side, on `agentfootprint/context`.)
 * const triage: Injection = {
 *   id: 'triage',
 *   flavor: 'skill',
 *   description: 'Find the order the customer is talking about.',
 *   trigger: { kind: 'llm-activated', viaToolName: 'read_skill' },
 *   inject: { systemPrompt: 'Ask for the order id, then call lookup_order.' },
 * };
 * const billing: Injection = {
 *   id: 'billing',
 *   flavor: 'skill',
 *   description: 'Refunds, double charges, invoices.',
 *   trigger: { kind: 'llm-activated', viaToolName: 'read_skill' },
 *   inject: { systemPrompt: 'Confirm the charge history before promising a refund.' },
 * };
 *
 * // The FLUENT builder takes the skill OBJECTS (not their ids) and ends in
 * // `.build()`. `skillGraph({ skills, start, steps })` is the OTHER door: it
 * // returns a finished `SkillGraph`, with nothing to chain.
 * const graph = skillGraph()
 *   .entry(triage)
 *   .route(triage, billing, { onToolReturn: 'lookup_order' })
 *   .build();
 *
 * // Per iteration — ONE ctx, built once and asked every question below: a
 * // cursor derived from a different ctx than the triggers can disagree with
 * // them (obligation 1 of `SkillGraphHost`).
 * const ctx: InjectionContext = {
 *   iteration: 2,
 *   userMessage: 'I was charged twice for order 4021',
 *   history: [{ role: 'user', content: 'I was charged twice for order 4021' }],
 *   activatedInjectionIds: [],
 *   currentSkillId: 'triage',
 *   toolResults: [{ toolName: 'lookup_order', result: 'order 4021 · charged twice' }],
 * };
 *
 * const move = graph.explainNextSkill(ctx); // where the cursor goes, and WHY
 * const offered = graph.reachableSkills(move.to); // obligation 2 — gate read_skill on this
 * const readSkill = readSkillDescriptor(graph.skills, { grantable: offered });
 * ```
 */

// ─── The primitive, and its evaluation ─────────────────────────────────
export type {
  ActiveInjection,
  Injection,
  InjectionContent,
  InjectionContext,
  InjectionEvaluation,
  InjectionTrigger,
} from '../lib/injection-engine/types.js';
export { projectActiveInjection, toolResultsOf } from '../lib/injection-engine/types.js';
export { evaluateInjections } from '../lib/injection-engine/evaluator.js';

// ─── The boundary contract ─────────────────────────────────────────────
export type {
  SkillCachePolicy,
  SkillCachePolicyContext,
  SkillGraphHost,
  SkillGraphIterationContext,
  SkillTool,
  SkillToolDescriptor,
  SkillToolSchema,
} from '../lib/injection-engine/hostContract.js';
export {
  TOOL_RESULT_STATUSES,
  type ToolResultStatus,
} from '../lib/injection-engine/toolOutcome.js';

// ─── The graph (the SkillMap — the agent that mounts it is the SkillWalker) ─
export {
  decideSkill,
  formatCheckup,
  skillGraph,
  // The official vocabulary (9.51.0): `defineSkillMap` is a permanent
  // reference-equal alias of `skillGraph`, `SkillMap` of `SkillGraph` — both
  // names ship forever. There is deliberately no `SkillWalker` export: the
  // walker is the host that mounts the map (inside agentfootprint, the agent).
  defineSkillMap,
  type SkillMap,
  SKILL_GRAPH_DEFERRED_CONTRACT_KEY,
  SKILL_GRAPH_METADATA_KEY,
  type BuildOptions,
  type CheckupOptions,
  type CursorMove,
  type CursorMoveCause,
  // Guards-as-data on route edges (9.51.0).
  GUARD_HOP_KEYS,
  plainGuardCaption,
  type GuardConditionData,
  type GuardConditionEvidence,
  type GuardEvaluation,
  type GuardOperator,
  type GuardValue,
  type SkillGuard,
  type SkillGuardData,
  type SkillGuardOps,
  type DecisionNode,
  type DeferredBodyContract,
  type EntryScore,
  type EntryScoring,
  type GraphCheckMode,
  type GraphCheckup,
  type GraphProblem,
  type GraphProblemCode,
  type RouteBatchConflict,
  type RouteBatchOutcome,
  type SkillEdge,
  type SkillEdgeKind,
  type SkillGraph,
  type SkillGraphBuilder,
  type SkillGraphConfig,
  type SkillGraphFlatConfig,
  type SkillGraphStart,
  type SkillGraphStep,
  type SkillGraphTreeConfig,
  type SkillMatch,
  type SkillMatchData,
  type SkillNode,
  type SkillRouteOptions,
  type SkillEntryOptions,
  type SkillRouting,
  type SkillRoutingStep,
  type SkillStartRule,
  type TreeOptions,
} from '../lib/injection-engine/skillGraph.js';
export type { TurnRoutingPlan } from '../lib/injection-engine/skillIntent.js';

// ─── Scoring + the tie policy ──────────────────────────────────────────
export {
  embeddingScorer,
  keywordScorer,
  rankEntries,
  type EntryCandidate,
  type EntryScorer,
  type EntryScorerInput,
} from '../lib/injection-engine/entryScorer.js';
export {
  validateIntentScores,
  type IntentCandidate,
  type IntentScore,
  type IntentScorer,
  type IntentScorerInput,
} from '../lib/injection-engine/intentScorer.js';
export {
  decideTier2,
  menuOutstanding,
  DEFAULT_ROUTING_POLICY,
  MENU_SIZE,
  NEAR_TIE_MARGIN,
  type RankedIntentScore,
  type RoutingPolicy,
  type Tier2Verdict,
  type TurnRoute,
} from '../lib/injection-engine/routingPolicy.js';

// ─── The tools the graph DESCRIBES (the host constructs them) ──────────
export {
  listSkillsDescriptor,
  readSkillDescriptor,
  type ReadSkillOffer,
} from '../lib/injection-engine/skillToolDescriptors.js';

// ─── Declared procedures (steps-as-data) ───────────────────────────────
export {
  pointerOf,
  skipStepDescriptor,
  SKIP_STEP_TOOL_NAME,
  type OnSkipPolicy,
  type SkillStep,
  type StepPlan,
  type StepPointer,
  type StepPointerCarrier,
} from '../lib/injection-engine/skillSteps.js';

// ─── Authoring checks ──────────────────────────────────────────────────
export {
  checkSkillContract,
  checkSkillContracts,
  skillToolNames,
  type SkillContractOptions,
} from '../lib/injection-engine/skillContract.js';
export {
  checkArtifactVocabularies,
  vocabularyOf,
  type ArtifactVocabulary,
} from '../lib/injection-engine/skillVocabulary.js';

// ─── Dev warnings, opt-in ──────────────────────────────────────────────
// The core prints nothing unless a host hands it a dev-mode reader — it has
// no engine to ask. Inside agentfootprint the binding is automatic; here it
// is one line. See `devWarn.ts`.
export { useSkillGraphDevMode, type DevModeReader } from '../lib/injection-engine/devWarn.js';
