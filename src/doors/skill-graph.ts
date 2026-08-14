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
 * @example routing a turn from a host that is not our agent
 * ```ts
 * import { skillGraph, readSkillDescriptor } from 'agentfootprint/skill-graph';
 *
 * const graph = skillGraph({ skills, entry: 'triage' })
 *   .route('triage', 'billing', { when: (ctx) => /invoice/i.test(ctx.userMessage) })
 *   .build();
 *
 * // per iteration — ONE ctx, built once (obligation 1)
 * const move = graph.explainNextSkill(ctx);
 * const offered = graph.reachableSkills(ctx.currentSkillId);   // obligation 2
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

// ─── The graph ─────────────────────────────────────────────────────────
export {
  decideSkill,
  formatCheckup,
  skillGraph,
  SKILL_GRAPH_DEFERRED_CONTRACT_KEY,
  SKILL_GRAPH_METADATA_KEY,
  type BuildOptions,
  type CheckupOptions,
  type CursorMove,
  type CursorMoveCause,
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
