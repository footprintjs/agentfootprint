/**
 * FDL influence signals — the four-signal composite from the Visible
 * Reasoning paper (Eq. 1–6), extracted verbatim as RFC-003 block D6.
 *
 * Pattern: pure scorer functions + one async orchestrator. Vector-level
 *          functions are deterministic and embedder-free; only
 *          `scoreInfluence` touches the injected `Embedder`.
 * Role:    `src/lib/influence-core/` leaf. Consumers: the FDL paper
 *          pipeline (stage 5, computeInfluenceScores), RFC-003 D7's
 *          LLM-edge weigher, and — one level up — RFC-002's margin
 *          scoring shares the same geometry via `margin.ts`.
 *
 * ## Honest claim per signal (RFC-002 §2 discipline)
 *
 * Every signal is embedding GEOMETRY — a deterministic proxy, not a
 * window into the model:
 *
 *  - FA      "the tool's output is semantically close to the final
 *            answer" — NOT "the answer was derived from it".
 *  - AVG     "the tool's output stayed semantically close to the
 *            reasoning steps" — NOT "the model kept consulting it".
 *  - PERSIST "many reasoning steps are similar to it above T" — breadth
 *            of apparent reference, NOT counted citations.
 *  - DEPTH   pure structure (1/(1+ancestors)) — directness of position
 *            in the trace, knows nothing about content at all.
 *
 * The composite S(d) means "high semantic alignment with the answer",
 * never "this source contributed X% of the answer" (paper §5.2: scores
 * are per-item, not additive, not causal attribution). Same inputs →
 * same scores, unlike LLM-as-judge.
 */
import { cosineSimilarity } from '../../memory/embedding/cosine.js';
import type {
  Embedder,
  EvidenceInput,
  InfluenceScore,
  InfluenceWeights,
  SignalScores,
} from './types.js';
import { DEFAULT_INFLUENCE_WEIGHTS, DEFAULT_PERSISTENCE_THRESHOLD } from './types.js';

/**
 * FA — Final Answer Similarity (paper Eq. 1).
 *
 * `FA(d) = sim(e_d, e_f)` — cosine between the evidence embedding and
 * the final-answer embedding. The strongest prior: verbatim or
 * paraphrased reuse of a tool result scores high. Proxy: semantic
 * overlap, not provenance.
 */
export function finalAnswerSimilarity(
  evidenceVec: readonly number[],
  finalAnswerVec: readonly number[],
): number {
  return cosineSimilarity(evidenceVec, finalAnswerVec);
}

/**
 * AVG — Average Relevancy (paper Eq. 2).
 *
 * Mean cosine between the evidence and each LLM reasoning ancestor;
 * 0 when there are no ancestors (structurally zero — see
 * `adaptWeights`). Proxy: consistent semantic closeness across the
 * chain, not actual consultation.
 */
export function averageRelevancy(
  evidenceVec: readonly number[],
  ancestorVecs: ReadonlyArray<readonly number[]>,
): number {
  const n = ancestorVecs.length;
  if (n === 0) return 0;
  let sum = 0;
  for (const ancestorVec of ancestorVecs) {
    sum += cosineSimilarity(evidenceVec, ancestorVec);
  }
  return sum / n;
}

/**
 * PERSIST — Persistence (paper Eq. 3).
 *
 * Fraction of ancestors whose similarity to the evidence EXCEEDS the
 * threshold T (strict `>`, default 0.30); 0 when there are no
 * ancestors. Unlike AVG it measures BREADTH: referenced in 4 of 5
 * steps (0.8) beats referenced intensely in 1. Proxy: similarity
 * above a tunable bar, not counted citations.
 */
export function persistence(
  evidenceVec: readonly number[],
  ancestorVecs: ReadonlyArray<readonly number[]>,
  threshold: number = DEFAULT_PERSISTENCE_THRESHOLD,
): number {
  const n = ancestorVecs.length;
  if (n === 0) return 0;
  let above = 0;
  for (const ancestorVec of ancestorVecs) {
    if (cosineSimilarity(evidenceVec, ancestorVec) > threshold) above += 1;
  }
  return above / n;
}

/**
 * DEPTH — Structural Proximity (paper Eq. 4).
 *
 * `DEPTH(d) = 1 / (1 + n)` where n counts LLM reasoning ancestors
 * ONLY (not pipeline plumbing — callers decide what counts as an
 * ancestor when building `EvidenceInput.ancestorTexts`). Direct
 * evidence with no intermediaries gets exactly 1.0. The only
 * content-blind signal: pure trace structure.
 */
export function structuralProximity(ancestorCount: number): number {
  if (!Number.isInteger(ancestorCount) || ancestorCount < 0) {
    throw new Error(
      `structuralProximity: ancestorCount must be a non-negative integer (got ${ancestorCount})`,
    );
  }
  return 1 / (1 + ancestorCount);
}

/**
 * Adaptive weight redistribution (paper Eq. 6, §5.3).
 *
 * When an item has NO LLM ancestors, AVG and PERSIST are structurally
 * zero — not because the evidence was uninfluential, but because there
 * is nothing to measure against. Without adaptation its score is
 * capped at α+δ (≈0.50 under defaults). Eq. 6 moves the β+γ mass onto
 * FA and DEPTH preserving their ratio:
 *
 *   α′ = α + (β+γ)·α/(α+δ),  δ′ = δ + (β+γ)·δ/(α+δ),  β′ = γ′ = 0
 *
 * Defaults → α′=0.80, δ′=0.20 (the 4:1 FA:DEPTH ratio kept).
 * Per-evidence-item: in a multi-tool pipeline some items adapt while
 * others keep standard weights; `adapted` says which (surface it — the
 * paper's UI marks adapted items).
 *
 * Degenerate guard: if α+δ = 0 there is no defined ratio to preserve —
 * weights return unchanged with `adapted: false`, and the composite is
 * honestly 0 for a no-ancestor item.
 */
export function adaptWeights(
  weights: InfluenceWeights,
  ancestorCount: number,
): { weights: InfluenceWeights; adapted: boolean } {
  if (ancestorCount > 0) return { weights, adapted: false };
  const base = weights.fa + weights.depth;
  if (base === 0) return { weights, adapted: false };
  const mass = weights.avg + weights.persist;
  return {
    weights: {
      fa: weights.fa + (mass * weights.fa) / base,
      avg: 0,
      persist: 0,
      depth: weights.depth + (mass * weights.depth) / base,
    },
    adapted: mass > 0,
  };
}

/**
 * Composite score S(d) (paper Eq. 5).
 *
 * `S = α·FA + β·AVG + γ·PERSIST + δ·DEPTH` under the given weights —
 * pass the EFFECTIVE weights from `adaptWeights` for no-ancestor
 * items. With weights summing to 1, S ∈ [−(α+β), 1] (FA/AVG are
 * cosines and may go negative; PERSIST/DEPTH are non-negative).
 */
export function compositeScore(signals: SignalScores, weights: InfluenceWeights): number {
  return (
    weights.fa * signals.fa +
    weights.avg * signals.avg +
    weights.persist * signals.persist +
    weights.depth * signals.depth
  );
}

export interface ScoreInfluenceArgs {
  /** Evidence items (tool results / context sources) with ancestors. */
  readonly evidence: readonly EvidenceInput[];
  /** The final answer text the evidence is scored against. */
  readonly finalAnswerText: string;
  /**
   * Injected embedder. Wrap in an `EmbeddingCache` to share embeddings
   * with the catalog lint / margin scorer (RFC-002 §3 — one cache
   * serves all three consumers).
   */
  readonly embedder: Embedder;
  /** Composite weights. Default: paper priors 0.40/0.30/0.20/0.10. */
  readonly weights?: InfluenceWeights;
  /** PERSIST threshold T. Default 0.30. */
  readonly persistenceThreshold?: number;
  /** Abort signal threaded to the embedder (network backends). */
  readonly signal?: AbortSignal;
}

/**
 * Score every evidence item on the four FDL signals and rank by
 * composite, descending (paper pipeline stages 4–6 in one call:
 * embed → score → rank). Ties keep input order (stable sort).
 *
 * Deterministic for a deterministic embedder: same inputs → same
 * scores. All texts are embedded in ONE deduplicated batch — with an
 * `EmbeddingCache` injected, repeat calls embed nothing.
 *
 * Honest claim: ranked semantic-alignment proxies. NOT causal
 * attribution — see module docs.
 */
export async function scoreInfluence(args: ScoreInfluenceArgs): Promise<InfluenceScore[]> {
  const weights = args.weights ?? DEFAULT_INFLUENCE_WEIGHTS;
  assertValidWeights(weights);
  const threshold = args.persistenceThreshold ?? DEFAULT_PERSISTENCE_THRESHOLD;
  assertUniqueIds(args.evidence);

  // ONE deduplicated embedding pass over every distinct text.
  const texts = new Set<string>([args.finalAnswerText]);
  for (const item of args.evidence) {
    texts.add(item.text);
    for (const ancestor of item.ancestorTexts) texts.add(ancestor);
  }
  const vectorByText = await embedAll(args.embedder, [...texts], args.signal);

  const finalVec = vectorByText.get(args.finalAnswerText) as readonly number[];

  const scored = args.evidence.map((item): InfluenceScore => {
    const evidenceVec = vectorByText.get(item.text) as readonly number[];
    const ancestorVecs = item.ancestorTexts.map((t) => vectorByText.get(t) as readonly number[]);

    const signals: SignalScores = {
      fa: finalAnswerSimilarity(evidenceVec, finalVec),
      avg: averageRelevancy(evidenceVec, ancestorVecs),
      persist: persistence(evidenceVec, ancestorVecs, threshold),
      depth: structuralProximity(ancestorVecs.length),
    };
    const effective = adaptWeights(weights, ancestorVecs.length);

    return {
      id: item.id,
      signals,
      weights: effective.weights,
      adapted: effective.adapted,
      score: compositeScore(signals, effective.weights),
    };
  });

  // Stable sort — equal scores keep evidence input order.
  return scored.sort((a, b) => b.score - a.score);
}

/** Embed distinct texts via batch API when available, else sequentially. */
export async function embedAll(
  embedder: Embedder,
  texts: readonly string[],
  signal?: AbortSignal,
): Promise<Map<string, readonly number[]>> {
  const vectors = embedder.embedBatch
    ? await embedder.embedBatch({ texts, ...(signal ? { signal } : {}) })
    : await sequentialEmbed(embedder, texts, signal);
  const byText = new Map<string, readonly number[]>();
  for (let i = 0; i < texts.length; i++) byText.set(texts[i], vectors[i]);
  return byText;
}

async function sequentialEmbed(
  embedder: Embedder,
  texts: readonly string[],
  signal?: AbortSignal,
): Promise<number[][]> {
  const out: number[][] = [];
  for (const text of texts) {
    out.push(await embedder.embed({ text, ...(signal ? { signal } : {}) }));
  }
  return out;
}

/**
 * Validate composite weights: every weight finite & non-negative, and not all
 * zero. Shared by `scoreInfluence` and `scoreContrastiveInfluence` — `fnName`
 * attributes the error to the actual caller.
 */
export function assertValidWeights(weights: InfluenceWeights, fnName = 'scoreInfluence'): void {
  for (const [name, value] of Object.entries(weights)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(
        `${fnName}: weight '${name}' must be a finite non-negative number (got ${value})`,
      );
    }
  }
  if (weights.fa + weights.avg + weights.persist + weights.depth === 0) {
    throw new Error(`${fnName}: all weights are zero — the composite would always be 0`);
  }
}

function assertUniqueIds(evidence: readonly EvidenceInput[]): void {
  const seen = new Set<string>();
  for (const item of evidence) {
    if (seen.has(item.id)) {
      throw new Error(`scoreInfluence: duplicate evidence id '${item.id}' — ids must be unique`);
    }
    seen.add(item.id);
  }
}
