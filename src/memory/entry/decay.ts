/**
 * Decay computation — pure function.
 *
 * Applied by retrieval stages to compute an entry's effective relevance at
 * read time. Never mutates the entry; only returns a scaling factor in
 * `[0, +∞)` that stages apply to their existing score.
 *
 * Model:
 *   factor = exp(-ln2 · Δt / halfLife) · min(accessBoost^accessCount, MAX_BOOST)
 *
 * The time term is exponential decay (half after one half-life). The access
 * term is multiplicative — each read of an entry boosts its future
 * relevance. `MAX_BOOST_MULTIPLIER` caps runaway boosting so a frequently-
 * read but old entry doesn't crowd out newer relevant entries indefinitely.
 */
import type { DecayPolicy, MemoryEntry } from './types';

/**
 * Maximum compounding boost from `accessCount`. Caps the access term at
 * ~10×; tuned against the intuition that "a heavily used memory is important
 * but not more important than an exact-match recent memory."
 */
const MAX_BOOST_MULTIPLIER = 10;

/**
 * Compute the decay factor for an entry at a given moment.
 *
 * @param entry   The memory entry to score. Must have `lastAccessedAt` and
 *                `accessCount` set (storage adapters populate these).
 * @param now     The reference time (unix ms). Defaults to `Date.now()`.
 * @param policy  Optional override — when omitted, uses `entry.decayPolicy`.
 *                Stages can pass a stage-wide default so entries without a
 *                per-entry policy still decay consistently. If neither is
 *                set, returns 1.0 (no decay applied).
 *
 * @returns Scaling factor in `[0, MAX_BOOST_MULTIPLIER]` — stages multiply
 *          this against their existing relevance score.
 */
export function computeDecayFactor(
  entry: Pick<MemoryEntry, 'lastAccessedAt' | 'accessCount' | 'decayPolicy'>,
  now: number = Date.now(),
  policy?: DecayPolicy,
): number {
  const effective = policy ?? entry.decayPolicy;
  if (!effective) return 1;

  const ageMs = Math.max(0, now - entry.lastAccessedAt);

  // Time factor: 2^(-age / halfLife).
  //   - halfLifeMs === 0 models "instant decay" — any age > 0 ⇒ 0.
  //     Without this guard, 0/0 → NaN poisons the result.
  //   - halfLifeMs > 0 uses the standard exponential.
  let timeFactor: number;
  if (effective.halfLifeMs === 0) {
    timeFactor = ageMs === 0 ? 1 : 0;
  } else {
    timeFactor = Math.pow(2, -ageMs / effective.halfLifeMs);
  }

  // Access factor: clamp `accessBoost` to a positive value before
  // exponentiating. A negative or zero boost would either produce NaN
  // (fractional powers of negatives) or collapse relevance to 0 for any
  // accessCount > 0 — neither is the intended semantic. The documented
  // contract is accessBoost > 0; this clamp hardens against misconfigs.
  const safeBoost = Math.max(Number.EPSILON, effective.accessBoost);
  const rawBoost = Math.pow(safeBoost, entry.accessCount);
  const accessFactor = Math.min(rawBoost, MAX_BOOST_MULTIPLIER);

  return timeFactor * accessFactor;
}

/**
 * Compute decay for multiple entries in one call. Order-preserving; returns
 * one factor per entry. Convenience for stages that rank whole batches.
 */
export function computeDecayFactors(
  entries: readonly Pick<MemoryEntry, 'lastAccessedAt' | 'accessCount' | 'decayPolicy'>[],
  now: number = Date.now(),
  policy?: DecayPolicy,
): number[] {
  return entries.map((e) => computeDecayFactor(e, now, policy));
}
