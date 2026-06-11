/**
 * pairwiseSimilarity — pairwise cosine over a set of texts
 * (RFC-002 C1's core: tool descriptions → matrix + ranked pairs).
 *
 * Pattern: pure async function, embedder-injected. No thresholds, no
 *          verdicts, no lint rules — those are C1's `analyzeToolCatalog`
 *          policy layer ON TOP of this geometry. The core stays
 *          reusable for any "how confusable are these texts" question.
 * Role:    `src/lib/influence-core/` leaf. No agent/runtime imports.
 *
 * Honest claim: similarity is embedding geometry over the DESCRIPTIONS
 * — a confusability HEURISTIC, not a measurement of the model's actual
 * selection function (RFC-002 §2; tier 3 validates the proxy via
 * choice-entropy sampling).
 */
import { cosineSimilarity } from '../../memory/embedding/cosine.js';
import type {
  Embedder,
  PairwiseSimilarityResult,
  SimilarityItem,
  SimilarityPair,
} from './types.js';

export interface PairwiseSimilarityArgs {
  /** The texts to compare — e.g. `{ id: toolName, text: description }`. */
  readonly items: readonly SimilarityItem[];
  /**
   * Injected embedder. Wrap in an `EmbeddingCache` so catalog
   * descriptions embed once across lint runs (RFC-002 §3).
   */
  readonly embedder: Embedder;
  /** Abort signal threaded to the embedder (network backends). */
  readonly signal?: AbortSignal;
}

/**
 * Embed every item once (deduplicated batch) and compute the full
 * cosine matrix plus ranked upper-triangle pairs (descending; ties
 * keep input pair order).
 *
 * Invariants (pinned by property tests):
 *  - `matrix[i][j] === matrix[j][i]` — computed once, mirrored.
 *  - `matrix[i][i] === 1` EXACTLY — set by definition, so
 *    self-similarity is an invariant rather than a float artifact
 *    (and duplicate texts at different ids still compare via cosine).
 *  - N items → N·(N−1)/2 pairs.
 */
export async function pairwiseSimilarity(
  args: PairwiseSimilarityArgs,
): Promise<PairwiseSimilarityResult> {
  const { items, embedder } = args;
  assertUniqueIds(items);

  const ids = items.map((item) => item.id);
  if (items.length === 0) return { ids, matrix: [], pairs: [] };

  // Deduplicated embedding pass (identical descriptions embed once).
  const distinct = [...new Set(items.map((item) => item.text))];
  const vectors = embedder.embedBatch
    ? await embedder.embedBatch({
        texts: distinct,
        ...(args.signal ? { signal: args.signal } : {}),
      })
    : await sequentialEmbed(embedder, distinct, args.signal);
  const vectorByText = new Map<string, readonly number[]>();
  for (let i = 0; i < distinct.length; i++) vectorByText.set(distinct[i], vectors[i]);
  const itemVecs = items.map((item) => vectorByText.get(item.text) as readonly number[]);

  // Upper triangle once, mirrored; diagonal exactly 1 by definition.
  const matrix: number[][] = items.map(() => new Array<number>(items.length).fill(0));
  const pairs: SimilarityPair[] = [];
  for (let i = 0; i < items.length; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < items.length; j++) {
      const similarity = cosineSimilarity(itemVecs[i], itemVecs[j]);
      matrix[i][j] = similarity;
      matrix[j][i] = similarity;
      pairs.push({ a: ids[i], b: ids[j], similarity });
    }
  }

  // Stable sort — ties keep (i, j) input order.
  pairs.sort((p, q) => q.similarity - p.similarity);

  return { ids, matrix, pairs };
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

function assertUniqueIds(items: readonly SimilarityItem[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new Error(`pairwiseSimilarity: duplicate item id '${item.id}' — ids must be unique`);
    }
    seen.add(item.id);
  }
}
