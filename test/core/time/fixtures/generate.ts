/**
 * Seeded generators for the time layer's property tests. The repo carries no
 * property-testing library; a fixed seed keeps every case reproducible by its
 * index (the `test/core/agent/arguments/property.test.ts` precedent).
 */

/** mulberry32 — a tiny seeded PRNG. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rand = () => number;

export const int = (r: Rand, lo: number, hi: number): number =>
  lo + Math.floor(r() * (hi - lo + 1));
export const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
const pad = (n: number, w: number): string => String(n).padStart(w, '0');

/**
 * An instant-SHAPED string: mostly well formed, with every field drawn a
 * little past its legal range (month 13, day 32, hour 24, minute 60, second
 * 61, offset 24:60), lower-case `t`/`z`, a missing zone, a 10-digit fraction,
 * and an occasional one-character mutation — so both sides of every rule are
 * visited.
 */
export function instantish(r: Rand): string {
  const year = pick(r, [0, 1, 99, 1900, 1970, 2000, 2024, 2026, 2100, 9999, int(r, 0, 9999)]);
  const month = r() < 0.9 ? int(r, 1, 12) : pick(r, [0, 13, 99]);
  const day = r() < 0.7 ? int(r, 1, 28) : int(r, 0, 32);
  const hour = r() < 0.85 ? int(r, 0, 23) : pick(r, [24, 25, 99]);
  const minute = r() < 0.9 ? int(r, 0, 59) : pick(r, [60, 61]);
  let s = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}${
    r() < 0.9 ? 'T' : pick(r, ['t', ' '])
  }${pad(hour, 2)}:${pad(minute, 2)}`;
  if (r() < 0.7) {
    const second = r() < 0.85 ? int(r, 0, 59) : pick(r, [60, 61]);
    s += `:${pad(second, 2)}`;
    if (r() < 0.4) {
      const digits = int(r, 1, 10);
      let f = '';
      for (let i = 0; i < digits; i++) f += String(int(r, 0, 9));
      s += `.${f}`;
    }
  }
  const z = r();
  if (z < 0.4) s += 'Z';
  else if (z < 0.45) s += 'z';
  else if (z < 0.5) s += '';
  else {
    const oh = r() < 0.9 ? int(r, 0, 14) : pick(r, [23, 24, 99]);
    const om = r() < 0.9 ? pick(r, [0, 30, 45]) : pick(r, [59, 60]);
    s += `${r() < 0.5 ? '+' : '-'}${pad(oh, 2)}:${pad(om, 2)}`;
  }
  if (r() < 0.05) {
    const i = int(r, 0, s.length - 1);
    s = s.slice(0, i) + pick(r, ['x', '', '.', '-', ':', '0', 'T']) + s.slice(i + 1);
  }
  return s;
}
