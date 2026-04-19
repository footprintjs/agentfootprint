/**
 * loadRecent — read-side stage that injects the N most recent stored
 * messages into scope.loaded.
 *
 * Simplest possible retrieval: "what did we say last?" — no scoring,
 * no ranking, no decay, just chronological tail. Appropriate for small
 * conversations or as the warm-tier component of a hybrid pipeline.
 *
 * Reads from scope:  `identity`
 * Writes to scope:   `loaded` (appends — does not replace)
 *
 * Why append, not replace?
 *   Pipelines typically run multiple load stages (recent + semantic +
 *   facts). Appending lets each contribute without coordination. The
 *   picker stage (Layer 3) deduplicates + ranks the combined set.
 *
 * Why `count` primary, tokens secondary?
 *   Token counting needs a tokenizer — adds a dependency. `count` is
 *   universally available and "most recent N" is the most common ask.
 *   Token-budget enforcement happens in the picker stage where it
 *   naturally composes with other signals.
 */
import type { TypedScope } from 'footprintjs';
import type { MemoryStore } from '../store';
import type { Message } from '../../types/messages';
import type { MemoryState } from './types';

export interface LoadRecentConfig {
  /** The store to read from. */
  readonly store: MemoryStore;
  /**
   * Maximum number of entries to return. Defaults to 20 — large enough
   * for typical chat recency, small enough to fit most context windows.
   * Stores may cap this lower; in that case you get whatever fits.
   */
  readonly count?: number;
  /**
   * Optional tier filter. When set, only loads entries marked with one
   * of these tiers (e.g. `['hot']` for aggressive context management).
   * Omitted filter = all tiers, consistent with MemoryStore.list default.
   */
  readonly tiers?: ReadonlyArray<'hot' | 'warm' | 'cold'>;
}

const DEFAULT_COUNT = 20;

/**
 * Build a stage function that loads recent entries into `scope.loaded`.
 *
 * The returned stage is async and side-effect-free on failure: if the
 * store throws, the stage re-throws (fail-loud) — callers wrap with
 * `withRetry` / `withFallback` if they want degrade-to-empty behavior.
 */
export function loadRecent(config: LoadRecentConfig) {
  const count = config.count ?? DEFAULT_COUNT;

  return async (scope: TypedScope<MemoryState>): Promise<void> => {
    const identity = scope.identity;
    const { entries } = await config.store.list<Message>(identity, {
      limit: count,
      ...(config.tiers && { tiers: config.tiers }),
    });

    // Store returns most-recently-updated first (see InMemoryStore.list).
    // Chat consumers want oldest-first for natural reading order, so
    // reverse before append. Allocates one array; acceptable for N ≤ a few
    // hundred (the only realistic scale for "recent messages").
    const chronological = [...entries].reverse();

    // Append rather than replace — lets multiple load stages compose.
    const existing = scope.loaded ?? [];
    scope.loaded = [...existing, ...chronological];
  };
}
