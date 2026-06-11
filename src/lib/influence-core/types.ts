/**
 * influence-core types — the ONE embedding-based scoring contract.
 *
 * Pattern: Strategy seam (plug-and-play meta-pattern) — the frame and
 *          rule engine are the library's; the `Embedder` is consumer-
 *          injected, exactly like NarrativeFormatter / reliability /
 *          permission / commentary strategies.
 * Role:    `src/lib/` leaf module. Shared by the FDL paper pipeline
 *          (Visible Reasoning, Eq. 1–6), RFC-002's tool-catalog lint +
 *          margin recorder (C1/C4/C5), and RFC-003 Part B's LLM-edge
 *          weigher (D7). Extracted as RFC-003 block D6 so all three
 *          consumers share one scoring engine and one embedding cache.
 *
 * ## Honest claim (RFC-002 §2, the FDL discipline)
 *
 * Every score produced under these types is a PROXY computed from
 * embedding geometry — cosine similarity over consumer-injected
 * embeddings. None of it reads model internals. Scores mean "high
 * semantic alignment", never "the model chose/answered BECAUSE".
 * Scores are not additive across items and are not causal attribution
 * — counterfactual ablation (RFC-003 stage 4) is where causal claims
 * live.
 */

// The ONE embedder contract — re-exported from memory/embedding, NOT a
// second interface. `mockEmbedder()` and production adapters already
// implement it; influence-core consumes it unchanged.
export type { Embedder, EmbedArgs, EmbedBatchArgs } from '../../memory/embedding/types.js';

/**
 * Weights for the four-signal composite (paper Eq. 5).
 *
 * Configurable PRIORS, not learned parameters (paper §8). Defaults
 * encode: direct semantic similarity (fa) strongest, then consistency
 * across reasoning (avg), breadth of reference (persist), structural
 * proximity (depth).
 */
export interface InfluenceWeights {
  /** α — Final Answer Similarity weight. */
  readonly fa: number;
  /** β — Average Relevancy weight. */
  readonly avg: number;
  /** γ — Persistence weight. */
  readonly persist: number;
  /** δ — Structural Proximity weight. */
  readonly depth: number;
}

/** Paper defaults: α=0.40, β=0.30, γ=0.20, δ=0.10 (sum to 1.0). */
export const DEFAULT_INFLUENCE_WEIGHTS: InfluenceWeights = Object.freeze({
  fa: 0.4,
  avg: 0.3,
  persist: 0.2,
  depth: 0.1,
});

/** Paper default for the PERSIST threshold T (Eq. 3). */
export const DEFAULT_PERSISTENCE_THRESHOLD = 0.3;

/** RFC-002 §4 default: margins below this flag the choice as `narrow`. */
export const DEFAULT_MARGIN_THRESHOLD = 0.05;

/** The four signal values for one evidence item (paper Eq. 1–4). */
export interface SignalScores {
  /** FA — cosine(evidence, finalAnswer). Range [-1, 1]. */
  readonly fa: number;
  /** AVG — mean cosine(evidence, ancestor_i); 0 when no ancestors. */
  readonly avg: number;
  /** PERSIST — fraction of ancestors with similarity > T; 0 when none. */
  readonly persist: number;
  /** DEPTH — 1 / (1 + ancestorCount). Range (0, 1]. */
  readonly depth: number;
}

/** One evidence item to score: a tool result (or any context source)
 *  plus the texts of the LLM reasoning steps that referenced it. */
export interface EvidenceInput {
  /** Stable identifier — e.g. a runtimeStageId or tool-call id. */
  readonly id: string;
  /** The evidence text (tool result content). */
  readonly text: string;
  /**
   * Texts of the item's LLM reasoning ANCESTORS — only stages with
   * model text output, not pipeline plumbing (paper §5.1, DEPTH).
   * Empty array = direct evidence with no intermediaries.
   */
  readonly ancestorTexts: readonly string[];
}

/** Scored evidence item — the per-item output of `scoreInfluence`. */
export interface InfluenceScore {
  readonly id: string;
  /** The four raw signals (proxies — see module honest claim). */
  readonly signals: SignalScores;
  /**
   * The EFFECTIVE weights used for this item — equals the configured
   * weights normally; the Eq. 6 redistribution when `adapted` is true.
   */
  readonly weights: InfluenceWeights;
  /**
   * True when adaptive weight redistribution (paper Eq. 6) applied —
   * the item had no LLM ancestors, so AVG/PERSIST were structurally
   * zero and their weight mass moved onto FA/DEPTH. Per-item: a
   * multi-tool pipeline may mix adapted and standard items.
   */
  readonly adapted: boolean;
  /** Composite S(d) (Eq. 5) under the effective weights. */
  readonly score: number;
}

// ── Pairwise similarity (RFC-002 C1 core) ───────────────────────────

/** A text item for pairwise comparison (e.g. a tool description). */
export interface SimilarityItem {
  /** Stable identifier — e.g. the tool name. Must be unique. */
  readonly id: string;
  readonly text: string;
}

/** One ranked pair from `pairwiseSimilarity`. */
export interface SimilarityPair {
  /** id of the first item (lower input index). */
  readonly a: string;
  /** id of the second item (higher input index). */
  readonly b: string;
  /** cosine(embed(a.text), embed(b.text)). */
  readonly similarity: number;
}

export interface PairwiseSimilarityResult {
  /** Item ids in input order — the matrix axes. */
  readonly ids: readonly string[];
  /**
   * Full similarity matrix, `matrix[i][j] = cosine(item_i, item_j)`.
   * Symmetric by construction; the diagonal is EXACTLY 1 by definition
   * (self-similarity is an invariant, not a float approximation).
   */
  readonly matrix: ReadonlyArray<readonly number[]>;
  /** Upper-triangle pairs ranked by similarity, descending. */
  readonly pairs: readonly SimilarityPair[];
}

// ── Margin scoring (RFC-002 C4 core) ────────────────────────────────

/** A candidate in a choice competition (e.g. an offered tool). */
export interface MarginCandidate {
  /** Unique name — the identifier the chooser used. */
  readonly name: string;
  /** The text the chooser saw (the tool description). */
  readonly text: string;
}

/** One candidate's proximity to the choice context, ranked. */
export interface CandidateScore {
  readonly name: string;
  /** cosine(embed(contextText), embed(candidate.text)). */
  readonly score: number;
}

export interface MarginResult {
  /** All candidates ranked by score, descending. */
  readonly scores: readonly CandidateScore[];
  /** The chosen candidate names, echoed from the input. */
  readonly chosen: readonly string[];
  /** Name of the highest-scoring candidate (by the proxy). */
  readonly topScored: string;
  /**
   * score(best chosen) − score(best non-chosen). Small margin =
   * fragile choice. `undefined` when every candidate was chosen
   * (no competition to measure).
   */
  readonly margin: number | undefined;
  readonly flags: {
    /** margin < marginThreshold — the choice was a close call. */
    readonly narrow: boolean;
    /**
     * The top-scored candidate was NOT among the chosen. Either a
     * proxy miss or a genuinely surprising choice — both are exactly
     * what a debugger wants surfaced (RFC-002 §4).
     */
    readonly proxyDisagreement: boolean;
  };
}
