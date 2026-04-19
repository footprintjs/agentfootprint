/**
 * cosineSimilarity — the similarity metric used by `store.search()`.
 *
 *   cos(a, b) = dot(a, b) / (||a|| * ||b||)
 *
 * Range: [-1, 1]. Equal-direction vectors → 1. Orthogonal → 0.
 * Opposite → -1.
 *
 * Zero-magnitude handling: if either vector is all-zero (or the empty
 * vector), returns 0 — never NaN. NaN in a similarity score would
 * poison downstream picker comparisons (NaN < x is false for all x)
 * and silently demote the entry. Explicit 0 is safer.
 *
 * Length mismatch THROWS: comparing vectors of different dimensions
 * is almost always a bug (different embedders mixed in the same store).
 * Fail loud rather than silently truncate.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity: vector length mismatch — ${a.length} vs ${b.length}. ` +
        'Check that all entries in the store were produced by the SAME embedder instance.',
    );
  }
  if (a.length === 0) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
