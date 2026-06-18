/**
 * softmax — numerically-stable softmax over raw scores.
 *
 * Used by `skillGraph().entryByRelevance(embedder)` to turn per-entry cosine
 * similarities into a relevance distribution (the surfaced `relevance` %): the
 * shares sum to 1, so they read as "how much of the match each entry owns".
 * Internal helper — not a public export (the public surface is `relevance`).
 *
 * `temperature > 0` sharpens (<1) or flattens (>1) the distribution; default 1.
 */
export function softmax(scores: readonly number[], temperature = 1): number[] {
  if (scores.length === 0) return [];
  const t = temperature > 0 ? temperature : 1;
  // Subtract the max for numerical stability (exp of large numbers overflows).
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) / t));
  const sum = exps.reduce((a, b) => a + b, 0);
  // Degenerate guard (all -Infinity / NaN): fall back to a uniform distribution.
  return sum > 0 && Number.isFinite(sum)
    ? exps.map((e) => e / sum)
    : scores.map(() => 1 / scores.length);
}
