/**
 * writeBeats — persist extracted beats to the memory store.
 *
 * Reads from scope:  `newBeats`, `identity`
 * Writes to store:   one MemoryEntry<NarrativeBeat> per beat via `putMany`
 *
 * Parallels `writeMessages` — same shape, but the payload is beats
 * rather than raw messages. Uses `store.putMany` so N beats from a
 * single turn become 1 round-trip on network-backed adapters
 * (Redis / DynamoDB / Postgres).
 */
import type { TypedScope } from 'footprintjs';
import type { MemoryStore } from '../store/index.js';
import type { MemoryEntry } from '../entry/index.js';
import type { ExtractBeatsState } from './extractBeats.js';
import type { NarrativeBeat } from './types.js';

export interface WriteBeatsConfig {
  /** The store to persist to. Typically the same store as the pipeline's read side. */
  readonly store: MemoryStore;
}

/**
 * Build the `writeBeats` stage function.
 */
export function writeBeats(config: WriteBeatsConfig) {
  return async (scope: TypedScope<ExtractBeatsState>): Promise<void> => {
    const beats = (scope.newBeats ?? []) as readonly MemoryEntry<NarrativeBeat>[];
    if (beats.length === 0) return;
    const identity = scope.identity;
    // `putMany` MUST be a no-op on an empty batch per the interface
    // contract, but we short-circuit above anyway to skip the adapter
    // call entirely when there's nothing to persist.
    await config.store.putMany(identity, beats);
  };
}
