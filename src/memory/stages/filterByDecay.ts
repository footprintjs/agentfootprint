/**
 * filterByDecay — read-side stage that lets old memory fade.
 *
 * Reads from scope:  `loaded`
 * Writes to scope:   `loaded` (the survivors, order preserved)
 *
 * Where it sits:
 *
 *   loadRecent → filterByDecay → pickByBudget → formatDefault
 *
 * BEFORE the picker on purpose. The picker spends a token budget on what it
 * is given; deciding what has faded is not a budget question, and a stale
 * entry that fits should still not be injected. Dropping first also means
 * the budget is spent on entries that are still worth something.
 *
 * ## The score
 *
 * `computeDecayFactor` (memory/entry/decay.ts) is the model, unchanged:
 *
 *     factor = 2^(-age / halfLife) · min(accessBoost^accessCount, 10)
 *
 * This stage passes `accessBoost: 1`, which makes the access term exactly
 * `1` and the score purely age-based — and that is a truthful default rather
 * than a timid one. `accessCount` is incremented by `store.get()`, and no
 * shipped read path calls `get()`: they all `list()` or `search()`. So an
 * access-weighted knob here would be a dial wired to a counter that never
 * moves. When a read path starts bumping it, the term is already in the
 * model and the knob can arrive with something real behind it.
 *
 * ## What is never dropped
 *
 * An entry whose `lastAccessedAt` is missing or not a finite number is KEPT.
 * A store that does not date its entries has not told us they are old, and
 * "I cannot date this" must not read as "this is ancient" — the arithmetic
 * would produce `NaN`, and `NaN >= minScore` is false, which would silently
 * drop every entry from such a store.
 */
import type { TypedScope } from 'footprintjs';
import { computeDecayFactor } from '../entry/decay.js';
import type { DecayPolicy } from '../entry/types.js';
import type { MemoryState } from './types.js';

export interface FilterByDecayConfig {
  /**
   * How long, in milliseconds, before an untouched entry is worth half as
   * much. `0` means "anything not written this instant is gone".
   */
  readonly halfLifeMs: number;

  /**
   * Drop entries scoring below this. Default `0.1` — roughly "older than
   * three-and-a-bit half-lives". `0` keeps everything, which is a coherent
   * request (score, don't drop) and is honoured as written.
   */
  readonly minScore?: number;

  /**
   * Clock seam. Defaults to `Date.now`; tests pass a fixed clock so a decay
   * assertion is arithmetic rather than a race.
   */
  readonly now?: () => number;
}

/** See {@link FilterByDecayConfig.minScore}. */
export const DEFAULT_DECAY_MIN_SCORE = 0.1;

/**
 * The access term is deliberately neutral — see the header. Not a default a
 * caller can change: there is nothing behind it to change yet.
 */
const NEUTRAL_ACCESS_BOOST = 1;

/**
 * Build a stage that drops faded entries from `scope.loaded`.
 *
 * Pure arithmetic over what is already in scope: no store call, no LLM, no
 * embedding, and no mutation of anything stored — an entry that decays out
 * of one turn is still in the store, and a later turn scores it again.
 */
export function filterByDecay(config: FilterByDecayConfig) {
  const minScore = config.minScore ?? DEFAULT_DECAY_MIN_SCORE;
  const policy: DecayPolicy = {
    halfLifeMs: config.halfLifeMs,
    accessBoost: NEUTRAL_ACCESS_BOOST,
  };
  const clock = config.now ?? Date.now;

  return async (scope: TypedScope<MemoryState>): Promise<void> => {
    const loaded = scope.loaded ?? [];
    if (loaded.length === 0) return;

    // One clock read for the whole batch: two entries of the same age must
    // score the same, whatever the loop costs.
    const now = clock();

    scope.loaded = loaded.filter((entry) => {
      if (!Number.isFinite(entry.lastAccessedAt)) return true;
      // `accessCount` is normalised for the same reason `lastAccessedAt` is
      // guarded: a store that never set it would make the exponent `NaN`,
      // and a `NaN` score fails every comparison — silently dropping the lot.
      const scored = {
        lastAccessedAt: entry.lastAccessedAt,
        accessCount: Number.isFinite(entry.accessCount) ? entry.accessCount : 0,
      };
      return computeDecayFactor(scored, now, policy) >= minScore;
    });
  };
}
