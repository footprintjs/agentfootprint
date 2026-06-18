/**
 * contrastive — influence scoring against a REFERENCE output (RFC-003).
 *
 * Pattern: a SEPARATE, opt-in second stage over the four-signal scorer — not a
 *          modification of `scoreInfluence`. Same `InfluenceScore[]` return, so
 *          `rankingConfidence` and the rest compose on it unchanged.
 * Role:    `src/lib/influence-core/` leaf, sibling to `scoreInfluence`.
 *
 * ## Why this exists (the topical-innocent confound)
 *
 * Plain output-similarity (`scoreInfluence`'s FA) ranks a source by how much it
 * resembles the actual answer. That is confounded by **topically-central
 * innocents**: the policy a refund decision is *about* resembles ANY refund
 * output — right or wrong — so it can out-rank the source that actually caused
 * the wrong one. The fix: score by CONTRAST against a reference output (a
 * known-good / expected / prior-good run). A topical innocent is similar to
 * BOTH outputs, so it cancels (~0 contrast); the real culprit is similar to the
 * WRONG output specifically, so it stands out.
 *
 *   contrastive FA(e) = sim(e, answer) − sim(e, reference)
 *
 * Everything else (the AVG / PERSIST / DEPTH reasoning-trace signals, the
 * composite, adaptive weights) is shared with `scoreInfluence` verbatim — only
 * the FA term is contrastive.
 *
 * Honest claim (RFC-002 §2): still an embedding-geometry PROXY, never causal —
 * the contrast removes a confound, it does not prove causation. Ablation is the
 * causal tier. And it is OPT-IN: it needs a reference output, so it is for
 * regression / eval debugging (you have a prior-good or expected output), not
 * cold localization — without a reference, use `scoreInfluence`.
 */
import { cosineSimilarity } from '../../memory/embedding/cosine.js';
import {
  adaptWeights,
  assertValidWeights,
  averageRelevancy,
  compositeScore,
  embedAll,
  persistence,
  structuralProximity,
} from './signals.js';
import type {
  Embedder,
  EvidenceInput,
  InfluenceScore,
  InfluenceWeights,
  SignalScores,
} from './types.js';
import { DEFAULT_INFLUENCE_WEIGHTS, DEFAULT_PERSISTENCE_THRESHOLD } from './types.js';

export interface ScoreContrastiveInfluenceArgs {
  /** Evidence items (context sources) with their reasoning ancestors. */
  readonly evidence: readonly EvidenceInput[];
  /** The ACTUAL (e.g. buggy) output the evidence is scored against. */
  readonly answerText: string;
  /** A REFERENCE output to contrast against — a known-good / expected / prior
   *  run. The shared-with-both similarity (topical innocents) cancels out. */
  readonly referenceText: string;
  /** Injected embedder. Wrap in an `EmbeddingCache` to share embeddings. */
  readonly embedder: Embedder;
  /** Composite weights. Default: paper priors 0.40/0.30/0.20/0.10. */
  readonly weights?: InfluenceWeights;
  /** PERSIST threshold T. Default 0.3. */
  readonly persistenceThreshold?: number;
  readonly signal?: AbortSignal;
}

/**
 * Score evidence by CONTRASTIVE influence: `sim(e, answer) − sim(e, reference)`
 * for the FA term, the four-signal composite otherwise. Returns `InfluenceScore[]`
 * sorted descending — drop-in compatible with `scoreInfluence` consumers
 * (`rankingConfidence`, etc.).
 *
 * @throws when an evidence id is duplicated (same contract as `scoreInfluence`).
 */
export async function scoreContrastiveInfluence(
  args: ScoreContrastiveInfluenceArgs,
): Promise<InfluenceScore[]> {
  const weights = args.weights ?? DEFAULT_INFLUENCE_WEIGHTS;
  const threshold = args.persistenceThreshold ?? DEFAULT_PERSISTENCE_THRESHOLD;
  assertUniqueIds(args.evidence);
  assertValidWeights(weights, 'scoreContrastiveInfluence');

  // ONE deduplicated embedding pass over every distinct text (answer + reference
  // + evidence + ancestors).
  const texts = new Set<string>([args.answerText, args.referenceText]);
  for (const item of args.evidence) {
    texts.add(item.text);
    for (const ancestor of item.ancestorTexts) texts.add(ancestor);
  }
  const vectorByText = await embedAll(args.embedder, [...texts], args.signal);
  const answerVec = vectorByText.get(args.answerText) as readonly number[];
  const referenceVec = vectorByText.get(args.referenceText) as readonly number[];

  const scored = args.evidence.map((item): InfluenceScore => {
    const evidenceVec = vectorByText.get(item.text) as readonly number[];
    const ancestorVecs = item.ancestorTexts.map((t) => vectorByText.get(t) as readonly number[]);

    // The only contrastive term: answer-similarity MINUS reference-similarity.
    const faContrast =
      cosineSimilarity(evidenceVec, answerVec) - cosineSimilarity(evidenceVec, referenceVec);
    const signals: SignalScores = {
      fa: faContrast,
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

  return scored.sort((a, b) => b.score - a.score);
}

function assertUniqueIds(evidence: readonly EvidenceInput[]): void {
  const seen = new Set<string>();
  for (const e of evidence) {
    if (seen.has(e.id))
      throw new Error(`scoreContrastiveInfluence: duplicate evidence id "${e.id}"`);
    seen.add(e.id);
  }
}
