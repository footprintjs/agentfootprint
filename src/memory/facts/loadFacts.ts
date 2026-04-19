/**
 * loadFacts — read-side stage that loads stored `Fact` entries into
 * `scope.loadedFacts`.
 *
 * Reads from scope:  `identity`
 * Writes to scope:   `loadedFacts` (appends — does not replace)
 *
 * Unlike `loadRecent` (which returns ALL entries and lets downstream
 * stages filter), `loadFacts` queries the store and keeps only entries
 * whose id matches the `fact:` prefix. Facts are typically few dozen
 * at most per identity — a linear scan after a bounded `list` call is
 * cheap.
 *
 * Why append, not replace?
 *   Same contract as `loadRecent` — pipelines may combine multiple
 *   load stages (e.g. facts + recent messages + beats). Appending lets
 *   each contribute without coordination.
 *
 * Note: this stage writes `loadedFacts` (a separate field from
 * `loaded`) because fact entries have a different payload type
 * (`MemoryEntry<Fact>`) than message entries (`MemoryEntry<Message>`).
 * Keeping them separate prevents format stages from misrouting entries.
 */
import type { TypedScope } from 'footprintjs';
import type { MemoryStore } from '../store';
import type { MemoryEntry } from '../entry';
import type { Fact } from './types';
import { isFactId } from './types';
import type { FactPipelineState } from './extractFacts';

export interface LoadFactsConfig {
  /** The store to read from. */
  readonly store: MemoryStore;

  /**
   * Upper bound on the `list` call's page size. Adapters may cap this
   * lower. Defaults to 100 — enough for typical identity/preference
   * inventories. Fact pipelines that accumulate task statuses or
   * commitments should raise this.
   */
  readonly limit?: number;

  /**
   * Optional tier filter. When set, only loads facts tagged with one
   * of these tiers. Matches the `loadRecent` / `loadRelevant` API.
   */
  readonly tiers?: ReadonlyArray<'hot' | 'warm' | 'cold'>;
}

const DEFAULT_LIMIT = 100;

export function loadFacts(config: LoadFactsConfig) {
  const limit = config.limit ?? DEFAULT_LIMIT;

  return async (scope: TypedScope<FactPipelineState>): Promise<void> => {
    const { entries } = await config.store.list<Fact>(scope.identity, {
      limit,
      ...(config.tiers && { tiers: config.tiers }),
    });

    // Filter by fact-id prefix. `list` may return mixed payloads
    // (messages + beats + facts) if the store is shared. Prefix filter
    // keeps only the fact-shaped entries.
    const facts: MemoryEntry<Fact>[] = [];
    for (const entry of entries) {
      if (isFactId(entry.id)) facts.push(entry);
    }

    const existing = scope.loadedFacts ?? [];
    scope.loadedFacts = [...existing, ...facts];
  };
}
