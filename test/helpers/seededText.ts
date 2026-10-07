/**
 * Seeded text for equivalence checks: the same strings on every run, so a
 * failure names a reproducible input instead of a lucky one.
 *
 * A scanner that replaced a regex is checked against that regex (kept in the
 * test as the oracle) on many short strings built from the few pieces that
 * matter to it — its delimiters, escapes and line breaks, plus filler. Short
 * strings keep the quadratic oracle cheap; the pieces make the hard cases
 * common instead of one-in-a-million.
 */

/** mulberry32 — a 32-bit PRNG; `next()` is uniform in [0, 1). */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` strings, each up to `maxPieces` pieces drawn from `pieces`. */
export function seededTexts(
  seed: number,
  pieces: readonly string[],
  count: number,
  maxPieces: number,
): string[] {
  const next = seeded(seed);
  const texts: string[] = [];
  for (let i = 0; i < count; i++) {
    const length = Math.floor(next() * (maxPieces + 1));
    let text = '';
    for (let j = 0; j < length; j++) text += pieces[Math.floor(next() * pieces.length)];
    texts.push(text);
  }
  return texts;
}
