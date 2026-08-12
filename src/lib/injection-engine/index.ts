/**
 * agentfootprint Injection Engine — public barrel.
 *
 * The unifying primitive of agentfootprint context engineering.
 * One `Injection` type. One `InjectionEngine` subflow. N typed sugar
 * factories. See `README.md` in this folder for the full concept.
 */

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
  defineSkill,
  resolveSurfaceMode,
  type DefineSkillOptions,
  type SurfaceMode,
  type RefreshPolicy,
  type AutoActivateMode,
} from './factories/defineSkill.js';

export { SkillRegistry, type SkillRegistryOptions } from './SkillRegistry.js';

// File-authored skills — a loader over `defineSkill`, not a second mechanism.
// Node-only (reads the filesystem); node:fs is imported lazily inside the call
// so this barrel stays safe to import from a browser bundle.
export { skillsFromDir, type SkillsFromDirOptions } from './skillsFromDir.js';

// Skill-tool builders — used by SkillRegistry.toTools() and the Agent's
// auto-attach path. Exported so consumers building custom tool wiring
// (e.g., gatedTools chains) can compose the same `list_skills` /
// `read_skill` tools directly.
export { buildListSkillsTool, buildReadSkillTool, type SkillToolPair } from './skillTools.js';

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
export {
  checkSkillContract,
  checkSkillContracts,
  skillToolNames,
  type SkillContractOptions,
} from './skillContract.js';
