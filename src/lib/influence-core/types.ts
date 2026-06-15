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

/**
 * RFC-003 default: an influence ranking whose top-1 vs top-2 score margin is
 * below this has NO clear winner — a shortlist, not a verdict. Escalate to
 * ablation.
 *
 * UNCALIBRATED proxy starting point, chosen for interpretability. `margin`
 * is an ABSOLUTE difference on the same scale as `scoreInfluence`'s composite
 * (S ∈ ≈[−0.7, 1]), so this threshold is EMBEDDER-RELATIVE — recalibrate by
 * sweeping clear-winner vs flat rankings on your embedder. The numeric
 * coincidence with `DEFAULT_MARGIN_THRESHOLD` is NOT a shared derivation: that
 * one measures `scoreMargin`'s chosen-vs-not-chosen distribution, a different
 * statistic.
 */
export const DEFAULT_CLEAR_WINNER_MARGIN = 0.05;

/**
 * RFC-003 default: when there is no clear winner, suspects scoring within this
 * band of the top form the shortlist ablation should COVER (the culprit may be
 * any of them — or, for absence bugs, none). UNCALIBRATED proxy; embedder-
 * relative (see `DEFAULT_CLEAR_WINNER_MARGIN`).
 */
export const DEFAULT_SHORTLIST_BAND = 0.1;

/**
 * RFC-003 default for `ratioStrategy`: the top-2 gap as a FRACTION of the top
 * score `(s0 − s1) / |s0|`. Unlike the absolute margin this is scale-invariant,
 * so it transfers across embedders / answer lengths. UNCALIBRATED proxy.
 */
export const DEFAULT_CLEAR_WINNER_RATIO = 0.05;

/**
 * Pluggable rule for "does one source clearly win this ranking?" — the
 * decisiveness test inside `rankingConfidence`. The library ships
 * `marginStrategy` (default, absolute gap) and `ratioStrategy` (scale-
 * invariant); consumers may bring their own (e.g. entropy / dispersion). The
 * framework around it — always shortlisting the lead, covering the runner-up
 * when there is no clear winner, malformed-score robustness — is NOT the
 * strategy's concern; the strategy only judges the clean, all-finite case.
 */
export interface ConfidenceStrategy {
  /** Identifies the rule — shown in `reason`, and the key on a benchmark
   *  leaderboard of strategies. */
  readonly name: string;
  /**
   * Given the FINITE scores sorted DESCENDING (length >= 2), decide whether
   * one source clearly dominates. Pure and deterministic.
   */
  isClearWinner(rankedScores: readonly number[]): boolean;
}

/**
 * Confidence in an influence ranking (`scoreInfluence` output) — the honesty
 * companion to the scorer.
 *
 * Output-similarity influence is a PROXY: it ranks sources by how much they
 * resemble the final answer. It is structurally BLIND to absence/crowding bugs
 * — a culprit that caused the error by *displacing* context (history
 * truncation, context dilution) need not resemble the answer at all, so it can
 * rank low or off the top. This result makes that honesty explicit: when no
 * source clearly dominates, the ranking is a SHORTLIST to confirm by ablation,
 * never a verdict. Mirrors the causal slice's incompleteness markers — the
 * library says what its proxy cannot see.
 */
export interface RankingConfidence {
  /**
   * True when one source clearly dominates (`margin >= clearWinnerMargin`),
   * so the ranking can be trusted as a LEAD. False = treat as shortlist +
   * ablate. (A single suspect is trivially a clear winner — by absence of
   * alternatives, not strength of signal.) NOTE: this is the inverse of the
   * sibling `MarginResult.flags.narrow`. Honesty: a clear winner means the
   * proxy has a clear top, NOT that the top is the cause — a high-similarity
   * innocent the answer rationalizes over can win; ablation is the only causal
   * confirmation in either branch.
   */
  readonly clearWinner: boolean;
  /**
   * `score(#1) − score(#2)`, an ABSOLUTE difference on the composite-score
   * scale (embedder-relative). `undefined` when fewer than 2 suspects, when
   * all scores are malformed, or when the runner-up score is unavailable
   * (a clean top over a malformed #2). Read `clearWinner` to disambiguate.
   */
  readonly margin: number | undefined;
  /** Id of the top-ranked suspect (the lead). `undefined` only when there are
   *  none. Under an exact top tie this is the input-order first and not
   *  meaningful (there is no clear winner anyway). */
  readonly lead: string | undefined;
  /**
   * Suspects within the band of the top score — the set ablation should COVER.
   * CONSUME ONLY WHEN `clearWinner` IS FALSE; when there is a clear winner this
   * is informational (the band near the top), not an ablation worklist. Always
   * includes `lead` when present, and — when no clear winner with ≥2 suspects —
   * the runner-up too. De-duplicated.
   */
  readonly shortlist: readonly string[];
  /** Human-readable explanation for narratives / reports. PRESENTATION ONLY —
   *  read `clearWinner` / `margin` / `shortlist` as data, never parse this
   *  string. */
  readonly reason: string;
}

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
