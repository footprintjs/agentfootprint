/**
 * agentfootprint Injection Engine — public barrel.
 *
 * The unifying primitive of agentfootprint context engineering.
 * One `Injection` type. One `InjectionEngine` subflow. N typed sugar
 * factories. See `README.md` in this folder for the full concept.
 */

// Bind the pure core's dev-warn seam to footprintjs's `isDevMode` (9.34.0).
// Side-effect import, on purpose: the skill-graph core no longer imports the
// engine, so SOMEONE has to hand it the dev flag, and this barrel is on every
// path inside this package that can reach `skillGraph()`. Without it,
// `enableDevMode()` would stop switching skill-graph warnings on — the one
// behavior the fence refactor must not change. `agentfootprint/skill-graph`
// deliberately skips it; see `devWarn.ts`.
import './devWarnHost.js';

// Primitive types
export type {
  Injection,
  InjectionTrigger,
  InjectionContent,
  InjectionContext,
  InjectionEvaluation,
  ActiveInjection,
} from './types.js';

// POJO projection — used by slot subflows + advanced consumers
export { projectActiveInjection } from './types.js';

// The iteration's tool-result batch with the singular fallback applied
// (9.16.0) — the one reader `rule` predicates should use to see every call of
// a parallel batch, not only the last (`ctx.toolResults ?? [ctx.lastToolResult]`).
export { toolResultsOf } from './types.js';

// Engine
export { evaluateInjections } from './evaluator.js';
export {
  buildInjectionEngineSubflow,
  type InjectionEngineConfig,
} from './buildInjectionEngineSubflow.js';

// Sugar factories — Ships four; more flavors planned (RAG / Memory / Guardrail)
export { defineInstruction, type DefineInstructionOptions } from './factories/defineInstruction.js';
export {
  defineRelevanceHint,
  READS_ENTRY_SCORES_METADATA_KEY,
  type RelevanceHintOptions,
} from './factories/defineRelevanceHint.js';
export {
  defineMenuHint,
  MENU_HINT_METADATA_KEY,
  type MenuHintOptions,
} from './factories/defineMenuHint.js';

export {
  defineSkill,
  resolveSurfaceMode,
  type DefineSkillOptions,
  type SurfaceMode,
  type RefreshPolicy,
  type AutoActivateMode,
} from './factories/defineSkill.js';

// Steps-as-data (9.18.0) — the procedure grammar. `skillSteps.ts` is the ONE
// owner of the types, the pointer's shape and every sentence the model reads;
// the public slice here is what a consumer needs to DECLARE steps, READ the
// pointer off a snapshot (`pointerOf(sharedState.stepPointer)`), and compose
// the integrity tool into custom wiring (the buildReadSkillTool precedent).
export {
  pointerOf,
  SKIP_STEP_TOOL_NAME,
  skipStepDescriptor,
  type OnSkipPolicy,
  type SkillStep,
  type StepPlan,
  type StepPointer,
  type StepPointerCarrier,
} from './skillSteps.js';
export {
  defineStepsHint,
  STEPS_HINT_METADATA_KEY,
  type StepsHintOptions,
} from './factories/defineStepsHint.js';

// Artifact vocabularies (9.25.0) — `produces`/`consumes` on a skill or a step.
// The public slice is what a consumer needs to READ a skill's declared data
// legs off its metadata (`vocabularyOf`, for a lens or an inventory) and to run
// the satisfiability check itself over a list of skills the library did not
// assemble. `assertArtifactVocabulary` stays private: it is the authoring-time
// refusal `defineSkill` already applies.
export {
  checkArtifactVocabularies,
  vocabularyOf,
  type ArtifactVocabulary,
} from './skillVocabulary.js';

export { SkillRegistry, type SkillRegistryOptions } from './SkillRegistry.js';

// File-authored skills — a loader over `defineSkill`, not a second mechanism.
// Node-only (reads the filesystem); node:fs is imported lazily inside the call
// so this barrel stays safe to import from a browser bundle.
export { skillsFromDir, type SkillsFromDirOptions } from './skillsFromDir.js';

// Skill-tool builders — used by SkillRegistry.toTools() and the Agent's
// auto-attach path. Exported so consumers building custom tool wiring
// (e.g., gatedTools chains) can compose the same `list_skills` /
// `read_skill` tools directly.
export {
  buildListSkillsTool,
  buildReadSkillTool,
  buildSkipStepTool,
  type ReadSkillOffer,
  type SkillToolPair,
} from './skillTools.js';

// The graph's own DESCRIPTIONS of the tools it needs (9.34.0) — the POJOs the
// builders above wrap. Exported because a host composing its own tool objects
// (another framework, a custom ToolProvider) should read `read_skill`'s enum,
// reachability offer and result sentences from the library rather than
// re-writing them. Also the whole surface of `agentfootprint/skill-graph`.
export { listSkillsDescriptor, readSkillDescriptor } from './skillToolDescriptors.js';
export type {
  SkillCachePolicy,
  SkillCachePolicyContext,
  SkillGraphHost,
  SkillGraphIterationContext,
  SkillTool,
  SkillToolDescriptor,
  SkillToolSchema,
} from './hostContract.js';
export { TOOL_RESULT_STATUSES, type ToolResultStatus } from './toolOutcome.js';
export { useSkillGraphDevMode, type DevModeReader } from './devWarn.js';

export { defineSteering, type DefineSteeringOptions } from './factories/defineSteering.js';

export { defineFact, type DefineFactOptions } from './factories/defineFact.js';

// Unified factory — a `type` discriminant routes to the four named factories
// above. Use when the flavor is chosen programmatically; prefer the named
// factories when you know the flavor at author time.
export {
  defineInjection,
  type DefineInjectionOptions,
  type InjectionFlavor,
} from './factories/defineInjection.js';

// Declarative skill graph (proposal 002) — declare skills + routing edges →
// graph-derived triggers + a drawable topology. Sugar over the trigger model.
export {
  skillGraph,
  decideSkill,
  // 8.7.0 — render a `graph.checkup()` for a log line or a CI failure. The formatter
  // the library itself uses; without it every consumer wrote their own. `checkupGraph`
  // stays private: its input is the graph's internal wiring shape, and `graph.checkup()`
  // is already the door to it.
  formatCheckup,
  SKILL_GRAPH_METADATA_KEY,
  type SkillGraph,
  type SkillGraphBuilder,
  type SkillRouteOptions,
  type SkillEntryOptions,
  type TreeOptions,
  type SkillEdge,
  type SkillEdgeKind,
  type SkillNode,
  type DecisionNode,
  type SkillRouting,
  type SkillRoutingStep,
  // 8.5.0 — the return type of `graph.explainNextSkill(ctx)`. On the barrel because
  // a public method returns it; without it a consumer cannot name what they receive.
  type CursorMove,
  type CursorMoveCause,
  // 9.16.0 — `CursorMove.conflict`: a parallel batch matched edges to different
  // targets; first in call order won, the suppressed hops are on the record.
  type RouteBatchConflict,
  type RouteBatchOutcome,
  type EntryScore,
  type EntryScoring,
  type SkillGraphConfig,
  type SkillGraphFlatConfig,
  type SkillGraphTreeConfig,
  type SkillGraphStart,
  type SkillGraphStep,
  // The rules front door — data matchers on start rules (`match:` beside `when`),
  // comparable by the check-up and captioned by toMermaid. `SkillMatchData` is the
  // serializable descriptor stored on provenance/edges.
  type SkillMatch,
  type SkillMatchData,
  type SkillStartRule,
  // The graph's note that its body-contract checks wait for Agent build (present
  // only when built without `knownTools`) — see SkillGraph.deferredBodyContract.
  // The note rides the graph AND each compiled skill's metadata (under
  // SKILL_GRAPH_DEFERRED_CONTRACT_KEY), so Agent build honors it whichever way
  // the skills arrive — `.skillGraph(graph)` or `.skills({ list: () => graph.skills })`.
  SKILL_GRAPH_DEFERRED_CONTRACT_KEY,
  type DeferredBodyContract,
  type BuildOptions,
  type CheckupOptions,
  type GraphCheckMode,
  type GraphCheckup,
  type GraphProblem,
  type GraphProblemCode,
} from './skillGraph.js';
export {
  keywordScorer,
  embeddingScorer,
  rankEntries,
  type EntryScorer,
  type EntryScorerInput,
  type EntryCandidate,
} from './entryScorer.js';
// The turn-start routing cascade (SG-C, 9.17.0) — the intent-scorer port +
// the built-in LLM classifier, the tie policy that judges tier 2, and the
// graph surfaces the agent consumes. keywordScorer/embeddingScorer above ARE
// IntentScorers too (same factories, a second arity).
export {
  validateIntentScores,
  type IntentScorer,
  type IntentCandidate,
  type IntentScore,
  type IntentScorerInput,
} from './intentScorer.js';
export { llmClassifier, type LlmClassifierOptions } from './llmClassifier.js';
// The constrained-enum machinery behind the classifier AND the tier-3
// decider (9.19.0) — one model call that can only answer from a fixed list.
export {
  constrainedEnumPick,
  type ConstrainedEnumPickRequest,
  type EnumPickTool,
} from './constrainedEnumPick.js';
export {
  NEAR_TIE_MARGIN,
  MENU_SIZE,
  DEFAULT_ROUTING_POLICY,
  decideTier2,
  menuOutstanding,
  type RoutingPolicy,
  type Tier2Verdict,
  type RankedIntentScore,
  type TurnRoute,
} from './routingPolicy.js';
export type { TurnRoutingPlan } from './skillIntent.js';
export {
  checkSkillContract,
  checkSkillContracts,
  skillToolNames,
  type SkillContractOptions,
} from './skillContract.js';
