/**
 * context-bisect — RFC-003 Part B: the contextual-bug LOCALIZER,
 * "git bisect for context".
 *
 * Assembly over shipped pieces: footprintjs 9.8.0's complete causal DAG
 * (control edges, honesty markers, `EdgeWeigher` hook) × influence-core
 * scoring (D6) × consumer-run counterfactual ablation.
 *
 *   D7 — `llmEdgeWeigher`     influence-weighted LLM-call slice edges
 *
 * §B2 claim tiers (spelled out on every type): weights/scores are
 * embedding-geometry PROXIES; ablation verdicts are the ONLY causal
 * claims; slice completeness is bounded by tracking — and says so.
 */

export {
  llmEdgeWeigher,
  stepOutputText,
  type LlmEdgeWeigherHandle,
  type LlmEdgeWeigherOptions,
  type RankedParentEdge,
} from './llmEdgeWeigher.js';

export {
  CONTEXT_BISECT_DEFAULTS,
  type AblationRerun,
  type AblationRunner,
  type AblationRunStats,
  type AblationSpec,
  type AblationVerdict,
  type AblationVerdictKind,
  type CapturedEventLike,
  type ContextBugArtifacts,
  type ContextBugReport,
  type EdgePathStep,
  type HonestyFlag,
  type HonestyFlagKind,
  type OutcomeComparator,
  type QualityTriggerLookup,
  type SimilarityStats,
  type SliceStats,
  type Suspect,
  type SuspectDetail,
  type SuspectKind,
} from './types.js';
