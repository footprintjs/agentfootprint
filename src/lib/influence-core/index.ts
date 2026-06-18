/**
 * influence-core — the ONE embedding-based scoring engine
 * (RFC-002/003 block D6).
 *
 * Extracted from the Visible Reasoning paper's FDL influence pipeline
 * (Eq. 1–6: four signals + adaptive weighted composite) so that three
 * consumers share one engine and one embedding cache:
 *
 *   a) RFC-002 — tool-catalog lint (C1 ← `pairwiseSimilarity`) and the
 *      margin recorder (C4/C5 ← `scoreMargin`),
 *   b) RFC-003 Part B — the LLM-edge weigher (D7 ← `scoreInfluence` /
 *      the signal scorers),
 *   c) the FDL paper pipeline itself (stages 4–6 ← `EmbeddingCache` +
 *      `scoreInfluence`).
 *
 * Leaf module: zero agent/runtime imports — the only dependency is the
 * `Embedder` interface (re-exported from memory/embedding, the one
 * existing contract) and the shared `cosineSimilarity`.
 *
 * Plug-and-play: the frame and formulas are the library's; the
 * embedder, weights, and thresholds are consumer-injected.
 *
 * Honest claim (RFC-002 §2): every score here is a deterministic
 * embedding-geometry PROXY — semantic alignment, never model internals
 * and never causal attribution.
 */

export type {
  CandidateScore,
  ConfidenceStrategy,
  EmbedArgs,
  EmbedBatchArgs,
  Embedder,
  EvidenceInput,
  InfluenceScore,
  InfluenceWeights,
  MarginCandidate,
  MarginResult,
  PairwiseSimilarityResult,
  RankingConfidence,
  SignalScores,
  SimilarityItem,
  SimilarityPair,
} from './types.js';
export {
  DEFAULT_CLEAR_WINNER_MARGIN,
  DEFAULT_CLEAR_WINNER_RATIO,
  DEFAULT_INFLUENCE_WEIGHTS,
  DEFAULT_MARGIN_THRESHOLD,
  DEFAULT_PERSISTENCE_THRESHOLD,
  DEFAULT_SHORTLIST_BAND,
} from './types.js';

export {
  marginStrategy,
  rankingConfidence,
  ratioStrategy,
  type RankingConfidenceOptions,
} from './attributability.js';

export { scoreContrastiveInfluence, type ScoreContrastiveInfluenceArgs } from './contrastive.js';

export {
  contentHash,
  EmbeddingCache,
  embeddingCache,
  type EmbeddingCacheOptions,
  type EmbeddingCacheStats,
} from './cache.js';

export {
  adaptWeights,
  averageRelevancy,
  compositeScore,
  finalAnswerSimilarity,
  persistence,
  scoreInfluence,
  structuralProximity,
  type InfluenceScorer,
  type ScoreInfluenceArgs,
} from './signals.js';

export { pairwiseSimilarity, type PairwiseSimilarityArgs } from './similarity.js';

export { scoreMargin, type ScoreMarginArgs } from './margin.js';
