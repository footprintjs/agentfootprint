/**
 * writeFacts — persist extracted facts to the memory store.
 *
 * Reads from scope:  `newFacts`, `identity`
 * Writes to store:   MemoryEntry<Fact> per fact via `store.putMany`
 *
 * Ids are `fact:${key}` (set by `extractFacts` via `factId`). Because
 * `putMany` overwrites on id collision, a second turn writing the same
 * key REPLACES the prior entry. This is the contract for facts — they
 * dedup by key, unlike beats and messages which are append-only.
 */
import type { TypedScope } from 'footprintjs';
import type { MemoryStore } from '../store';
import type { MemoryEntry } from '../entry';
import type { Fact } from './types';
import type { FactPipelineState } from './extractFacts';

export interface WriteFactsConfig {
  /** The store to persist to. Typically the same store as the pipeline's read side. */
  readonly store: MemoryStore;
}

export function writeFacts(config: WriteFactsConfig) {
  return async (scope: TypedScope<FactPipelineState>): Promise<void> => {
    const facts = (scope.newFacts ?? []) as readonly MemoryEntry<Fact>[];
    if (facts.length === 0) return;
    await config.store.putMany(scope.identity, facts);
  };
}
