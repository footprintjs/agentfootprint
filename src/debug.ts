/**
 * agentfootprint/debug — diagnosis tools for a BROKEN run.
 *
 * Where `agentfootprint/observe` watches a HEALTHY run (recorders), this
 * subpath is the autopsy kit for a wrong answer. Split out of `observe` in
 * the surface cleanup — same code, dedicated home, so the import path now
 * matches the Debug docs category. The honesty discipline is unchanged:
 * scores/weights are embedding-geometry PROXIES; ablation verdicts are the
 * ONLY causal claims; slice completeness is bounded by tracking — and says so.
 *
 * Four libraries:
 *   • influence-core   — embedding-based scoring (proxy, never causal)
 *   • trace-toolpack   — traceToolpack + traceDebugAgent + `.selfExplain()`
 *   • context-bisect   — localizeContextBug + ablation/restoration probes
 *   • tool-lint        — build-time tool-catalog confusability lint
 *
 * For backward compatibility these are ALSO re-exported (deprecated) from
 * `agentfootprint/observe` for one transition version.
 */

// influence-core — the ONE embedding-based scoring engine (RFC-002/003
// block D6). Not a recorder: pure, embedder-injected scoring functions
// + the shared bounded embedding cache. Honest claim: every score is an
// embedding-geometry PROXY — semantic alignment, never model internals,
// never causal attribution.
export {
  adaptWeights,
  averageRelevancy,
  compositeScore,
  contentHash,
  DEFAULT_CLEAR_WINNER_MARGIN,
  DEFAULT_CLEAR_WINNER_RATIO,
  DEFAULT_INFLUENCE_WEIGHTS,
  DEFAULT_MARGIN_THRESHOLD,
  DEFAULT_PERSISTENCE_THRESHOLD,
  DEFAULT_SHORTLIST_BAND,
  EmbeddingCache,
  embeddingCache,
  finalAnswerSimilarity,
  marginStrategy,
  pairwiseSimilarity,
  persistence,
  rankingConfidence,
  ratioStrategy,
  scoreContrastiveInfluence,
  scoreInfluence,
  scoreMargin,
  structuralProximity,
  type CandidateScore,
  type ConfidenceStrategy,
  type Embedder,
  type EmbeddingCacheOptions,
  type EmbeddingCacheStats,
  type EvidenceInput,
  type InfluenceScore,
  type InfluenceScorer,
  type InfluenceWeights,
  type MarginCandidate,
  type MarginResult,
  type PairwiseSimilarityArgs,
  type PairwiseSimilarityResult,
  type RankingConfidence,
  type RankingConfidenceOptions,
  type ScoreContrastiveInfluenceArgs,
  type ScoreInfluenceArgs,
  type ScoreMarginArgs,
  type SignalScores,
  type SimilarityItem,
  type SimilarityPair,
} from './lib/influence-core/index.js';
// Introspection toolpack (RFC-003 Part C) — footprintjs trace evidence
// exposed as TOOLS a debugging LLM calls over a COMPLETED run's artifacts.
// Bounded, honest (⚠ markers), redaction-respecting, id-navigable.
export {
  callTraceTool,
  lazyTraceToolpack,
  NO_COMPLETED_RUN_MESSAGE,
  TOOLPACK_HARD_CAPS,
  traceToolpack,
  type TraceToolpackArtifacts,
  type TraceToolpackOptions,
} from './lib/trace-toolpack/index.js';
// The two conversational doors over the toolpack: a DEDICATED debugger
// agent (separate session, any provider — cheap models welcome), and the
// in-conversation `.selfExplain()` builder option's types. Same evidence,
// same honesty discipline as the UI doors (BacktrackView / Lens).
export {
  buildSelfExplainSkill,
  buildSelfExplainToolProvider,
  SelfExplainBinding,
  traceDebugAgent,
  type SelfExplainOptions,
  type TraceDebugAgentOptions,
} from './lib/trace-toolpack/index.js';
// Contextual-bug localizer (RFC-003 Part B, D7–D9) — "git bisect for
// context". Assembly: footprintjs causal DAG (control edges + honesty
// markers + EdgeWeigher) × influence-core scoring (D6) × consumer-run
// counterfactual ablation. §B2 claim tiers: scores/weights are
// embedding-geometry PROXIES; ablation verdicts are the ONLY causal
// claims; slice completeness is bounded by tracking — and says so.
export {
  ablationForSuspect,
  applyAblations,
  assembleTrajectory,
  assignCostVerdicts,
  bisectCulprits,
  bucketByAnchors,
  shortlistEarlyCulprits,
  walkToRoot,
  walkTrajectory,
  buildWriterFrameIndex,
  DEFAULT_RECENCY_DECAY,
  classifySuspect,
  findLoopHeads,
  CONTEXT_BISECT_DEFAULTS,
  defaultOutcomeComparator,
  defaultSuspectClassifier,
  findDroppedContext,
  formatContextBugReport,
  llmCallIdsFromEvents,
  llmEdgeWeigher,
  localizeContextBug,
  probeFlipped,
  runAblationProbe,
  runRestorationProbe,
  stepOutputText,
  suspectLabel,
  verdictFor,
  type AblationRerun,
  type AblationRunner,
  type AblationRunStats,
  type AblationSpec,
  type AblationTargets,
  type AblationVerdict,
  type AblationVerdictKind,
  type AnchorBucket,
  type AssembleTrajectoryOptions,
  type LoopCandidate,
  type LoopRecallShortlist,
  type ShortlistEarlyCulpritsOptions,
  type RootCauseHop,
  type RootCauseNote,
  type RootCausePath,
  type WalkToRootOptions,
  type BisectCulpritsOptions,
  type BisectionProbe,
  type BisectionResult,
  type CapturedEventLike,
  type ClassifyContext,
  type ContextBugArtifacts,
  type ContextBugReport,
  type ContextSource,
  type ContextUnit,
  type CostRange,
  type CostStats,
  type CostVerdict,
  type DroppedUnit,
  type EdgePathStep,
  type LoopFrame,
  type HonestyFlag,
  type HonestyFlagKind,
  type LlmEdgeWeigherHandle,
  type LlmEdgeWeigherOptions,
  type LocalizeContextBugOptions,
  type MissingContextResult,
  type OutcomeComparator,
  type QualityTriggerLookup,
  type RankedParentEdge,
  type RestorationProbeConfig,
  type RestorationRerun,
  type RestorationRunner,
  type RestoredCandidate,
  type RunCost,
  type SimilarityStats,
  type SliceStats,
  type Suspect,
  type SuspectClass,
  type SuspectClassifier,
  type SuspectDetail,
  type SuspectKind,
  type SuspectSeed,
  type SyntheticQuestionNode,
  type Trajectory,
} from './lib/context-bisect/index.js';
// BacktrackTrace serializer — feeds agentThinkingUI's <BacktrackView>
// (the "why?" board) straight off a localizer report. Pure mapping, no
// UI dependency; the interfaces mirror agentthinkingui's contract.
export {
  toBacktrackTrace,
  type BacktrackCustodyHop,
  type BacktrackHop,
  type BacktrackSuspectCard,
  type BacktrackTrace,
  type BacktrackTrail,
  type ToBacktrackTraceOptions,
} from './lib/context-bisect/index.js';
// Tool-catalog confusability lint (RFC-002 tier 1, C1–C3) — build-time,
// CI-gateable, framework-agnostic: plain { name, description?, inputSchema? }
// tools in (OpenAI/Anthropic/MCP lists coerce via coerceCatalog; the
// library's Tool[] via catalogFromTools), a report with a gateable `ok`
// out. Pluggable structural rule pack; thresholds + embedder consumer-
// injected with our defaults. Bin: `agentfootprint-lint-tools`.
// Front door: docs/guides/tool-catalog-lint.md.
export {
  analyzeToolCatalog,
  catalogFromTools,
  coerceCatalog,
  confusabilityText,
  DEFAULT_CONFUSABILITY_THRESHOLD,
  DEFAULT_OMISSION_CUES,
  DEFAULT_WATCH_BAND,
  DEFAULT_WHEN_CUES,
  defaultStructuralRules,
  descriptionRule,
  differentiationHint,
  enumInProseRule,
  formatToolCatalogReport,
  MOCK_EMBEDDER_CALIBRATION,
  optionalParamRule,
  runToolLintCli,
  saysWhatNotWhenRule,
  type AnalyzeToolCatalogOptions,
  type CatalogTool,
  type ConfusablePairFinding,
  type DescriptionRuleOptions,
  type FormatReportOptions,
  type LintRule,
  type LintSeverity,
  type OptionalParamRuleOptions,
  type PairVerdict,
  type SaysWhatNotWhenRuleOptions,
  type SimilarityReport,
  type StructuralFinding,
  type ToolCatalogReport,
  type ToolLintCliIO,
} from './lib/tool-lint/index.js';
