/**
 * context-bisect — RFC-003 Part B: the contextual-bug LOCALIZER,
 * "git bisect for context".
 *
 * Assembly over shipped pieces: footprintjs 9.8.0's complete causal DAG
 * (control edges, honesty markers, `EdgeWeigher` hook) × influence-core
 * scoring (D6) × consumer-run counterfactual ablation.
 *
 *   D7 — `llmEdgeWeigher`     influence-weighted LLM-call slice edges
 *   D8 — `localizeContextBug` trigger → slice → ranked suspects → ablation
 *   D9 — `bisectCulprits`     seeded multi-culprit bisection + variance
 *
 * §B2 claim tiers (spelled out on every type): weights/scores are
 * embedding-geometry PROXIES; ablation verdicts are the ONLY causal
 * claims; slice completeness is bounded by tracking — and says so.
 *
 * @beta Beta feature (RFC-003 Part B). The API works and is tested, but
 * may change before GA.
 */

export {
  llmEdgeWeigher,
  stepOutputText,
  type LlmEdgeWeigherHandle,
  type LlmEdgeWeigherOptions,
  type RankedParentEdge,
} from './llmEdgeWeigher.js';

// Interface #3 — missing-context finder (available − sent; confirm by restoration).
export {
  findDroppedContext,
  type ContextUnit,
  type DroppedUnit,
  type MissingContextResult,
} from './missingContext.js';
export {
  runRestorationProbe,
  type RestorationProbeConfig,
  type RestorationRerun,
  type RestorationRunner,
} from './restoration.js';

export {
  defaultSuspectClassifier,
  formatContextBugReport,
  llmCallIdsFromEvents,
  localizeContextBug,
  suspectLabel,
  type ClassifyContext,
  type LocalizeContextBugOptions,
  type SuspectClassifier,
  type SuspectSeed,
} from './localize.js';

export {
  toBacktrackTrace,
  type BacktrackCustodyHop,
  type BacktrackHop,
  type BacktrackSuspectCard,
  type BacktrackTrace,
  type BacktrackTrail,
  type ToBacktrackTraceOptions,
} from './toBacktrackTrace.js';

export {
  ablationForSuspect,
  applyAblations,
  costStatsFrom,
  defaultOutcomeComparator,
  median,
  probeFlipped,
  runAblationProbe,
  verdictFor,
  type AblationTargets,
  type ProbeConfig,
} from './ablation.js';

// Two-score localization (proposal 004): the COST score + the 2×2 classifier.
export { assignCostVerdicts, classifySuspect, MIN_LOOPS_SAVED } from './cost.js';

// Per-loop recall shortlist (proposal 006, L3): rescue early culprits → narrow before ablation.
export {
  shortlistEarlyCulprits,
  DEFAULT_RECENCY_DECAY,
  type LoopCandidate,
  type LoopRecallShortlist,
  type ShortlistEarlyCulpritsOptions,
} from './loop-recall.js';

// Root-cause backtracking debugger (proposal 007, L4): walk symptom → root (narrow → hop → convict).
export {
  walkToRoot,
  walkTrajectory,
  buildWriterFrameIndex,
  type RootCauseHop,
  type RootCauseNote,
  type RootCausePath,
  type WalkToRootOptions,
} from './walk-to-root.js';

// Per-loop trajectory assembler (proposal 005): segmentation core (phase 1)
// + the agent-flavored projection (phase 2).
export {
  assembleTrajectory,
  bucketByAnchors,
  findLoopHeads,
  type AnchorBucket,
  type AssembleTrajectoryOptions,
  type ContextSource,
  type LoopFrame,
  type SyntheticQuestionNode,
  type Trajectory,
} from './trajectory.js';

export {
  bisectCulprits,
  type BisectCulpritsOptions,
  type BisectionProbe,
  type BisectionResult,
} from './bisect.js';

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
  type CostRange,
  type CostStats,
  type CostVerdict,
  type EdgePathStep,
  type HonestyFlag,
  type HonestyFlagKind,
  type OutcomeComparator,
  type QualityTriggerLookup,
  type RestoredCandidate,
  type RunCost,
  type SimilarityStats,
  type SliceStats,
  type Suspect,
  type SuspectClass,
  type SuspectDetail,
  type SuspectKind,
} from './types.js';
