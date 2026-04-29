/**
 * writeSnapshot — write-side stage for Causal memory.
 *
 * Captures the current run's `(query, finalContent)` pair from
 * `scope.newMessages` (populated by the Agent's PrepareFinal stage),
 * embeds the query for retrieval, and persists a `SnapshotEntry` to
 * the store. Future turns can match new questions against past
 * queries via cosine similarity to replay decision evidence.
 *
 * Reads from scope:  `identity`, `turnNumber`, `newMessages`
 * Writes to store:   one `SnapshotEntry` per call, id = `snap-{turn}`
 *
 * Why per-turn (not per-iteration)?
 *   Causal memory captures TURN outcomes — "user asked X, agent said Y."
 *   Mid-iteration state isn't useful for cross-run replay.
 *
 * Empty-newMessages handling:
 *   When `newMessages` is empty (no final answer produced — e.g.
 *   pause-resume mid-flight), the stage no-ops. Re-runs after resume
 *   capture the snapshot then.
 *
 * @see ./types.ts          for the SnapshotEntry shape this writes
 * @see ./loadSnapshot.ts   for the read-side counterpart
 */

import type { TypedScope } from 'footprintjs';
import type { LLMMessage } from '../../adapters/types.js';
import type { MemoryEntry } from '../entry/index.js';
import type { MemoryStore } from '../store/index.js';
import type { Embedder } from '../embedding/index.js';
import type { MemoryState } from '../stages/index.js';
import type { SnapshotEntry } from './types.js';

export interface WriteSnapshotConfig {
  /** The store to persist the snapshot to. */
  readonly store: MemoryStore;

  /**
   * Embedder used to vectorize the query for later cosine-search.
   * Required — Causal memory's value comes from semantic retrieval
   * across past runs.
   */
  readonly embedder: Embedder;

  /**
   * Stable id for the embedder. Stored on the entry so a later
   * embedder swap doesn't cross-pollute similarity scores.
   * Default: `'unknown-embedder'` — pass an explicit id when you
   * may swap embedder instances over time.
   */
  readonly embedderId?: string;

  /**
   * TTL in milliseconds — drop snapshots after this duration. Useful
   * for compliance ("delete causal trace after 30 days").
   */
  readonly ttlMs?: number;

  /**
   * Tier to tag the snapshot with — typical: `'hot'` for current,
   * `'warm'`/`'cold'` for archived. Read stages can filter by tier.
   */
  readonly tier?: 'hot' | 'warm' | 'cold';
}

export function writeSnapshot(config: WriteSnapshotConfig) {
  const { store, embedder } = config;
  const embedderId = config.embedderId ?? 'unknown-embedder';

  return async (scope: TypedScope<MemoryState>): Promise<void> => {
    const identity = scope.identity;
    const turn = scope.turnNumber;
    const newMessages = (scope.newMessages ?? []) as readonly LLMMessage[];
    if (newMessages.length === 0) return;

    // Extract the (query, finalContent) pair from newMessages —
    // populated by Agent's PrepareFinal stage as [user, assistant].
    const userMsg = newMessages.find((m) => m.role === 'user');
    const assistantMsg = newMessages.find((m) => m.role === 'assistant');
    const query = (userMsg?.content as string | undefined) ?? '';
    const finalContent = (assistantMsg?.content as string | undefined) ?? '';

    if (query.length === 0) return; // No query → no useful snapshot.

    const signal = scope.$getEnv?.()?.signal;
    const queryVec = (await embedder.embed({
      text: query,
      ...(signal ? { signal } : {}),
    })) as number[];

    const now = Date.now();
    const ttl = config.ttlMs ? now + config.ttlMs : undefined;

    const snapshot: SnapshotEntry = {
      query,
      finalContent,
      iterations: 0, // TODO: capture from scope when wire helper exposes it
      decisions: [], // Populated by a follow-up FlowRecorder integration
      toolCalls: [], // Populated by a follow-up FlowRecorder integration
      durationMs: 0,
      tokenUsage: { input: 0, output: 0 },
    };

    const entry: MemoryEntry<SnapshotEntry> = {
      id: `snap-${turn}`,
      value: snapshot,
      version: 1,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      embedding: [...queryVec],
      embeddingModel: embedderId,
      ...(ttl !== undefined && { ttl }),
      ...(config.tier && { tier: config.tier }),
      source: { turn, identity },
    };

    await store.put(identity, entry);
  };
}
