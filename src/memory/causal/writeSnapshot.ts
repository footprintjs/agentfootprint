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
 * Turn derivation — collisions are impossible by construction:
 *   The effective turn is `max(scope.turnNumber, maxStoredTurn + 1)` where
 *   `maxStoredTurn` is the highest `snap-{n}` already live in THIS
 *   conversation's namespace (`identityNamespace(identity)` — the durable
 *   conversation anchor across `run()` calls, Agent instances, and
 *   processes). Rationale:
 *     - Hosts that track `turnNumber` correctly keep their numbering
 *       (`turnNumber: 5` → `snap-5`, gaps preserved).
 *     - Hosts with a stale counter (the Agent seeds `turnNumber = 1` on
 *       every run) still get a fresh, ordered id — turn 2 of the same
 *       conversation lands `snap-2` instead of silently replacing
 *       `snap-1`.
 *   Causal snapshots are decision evidence (audit/replay data): when
 *   "stale counter" and "deliberate same-turn rewrite" are
 *   indistinguishable, never destroying a prior turn's evidence wins.
 *   TTL-expired snapshots are ignored by the scan (same as every read).
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
import type { MemoryIdentity } from '../identity/index.js';
import type { MemoryState } from '../stages/index.js';
import type { SnapshotEntry } from './types.js';

/** Ids written by this stage: `snap-{turn}`. Used to find the highest
 *  turn already persisted for a conversation (other entry kinds sharing
 *  the store — `msg-{turn}-{idx}`, beats, facts — never match). */
const SNAPSHOT_ID_PATTERN = /^snap-(\d+)$/;

/**
 * Highest turn number among the LIVE snapshots already stored for this
 * conversation. 0 when none. One paged `list()` scan per turn-write —
 * snapshot writes happen once per turn, and the namespace is a single
 * conversation, so the scan stays small.
 */
async function maxStoredSnapshotTurn(
  store: MemoryStore,
  identity: MemoryIdentity,
): Promise<number> {
  let max = 0;
  let cursor: string | undefined;
  do {
    const page = await store.list(identity, {
      limit: 1000,
      ...(cursor !== undefined && { cursor }),
    });
    for (const entry of page.entries) {
      const match = SNAPSHOT_ID_PATTERN.exec(entry.id);
      if (match) {
        const turn = Number(match[1]);
        if (turn > max) max = turn;
      }
    }
    cursor = page.cursor;
  } while (cursor !== undefined);
  return max;
}

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
    const newMessages = (scope.newMessages ?? []) as readonly LLMMessage[];
    if (newMessages.length === 0) return;

    // Extract the (query, finalContent) pair from newMessages —
    // populated by Agent's PrepareFinal stage as [user, assistant].
    const userMsg = newMessages.find((m) => m.role === 'user');
    const assistantMsg = newMessages.find((m) => m.role === 'assistant');
    const query = (userMsg?.content as string | undefined) ?? '';
    const finalContent = (assistantMsg?.content as string | undefined) ?? '';

    if (query.length === 0) return; // No query → no useful snapshot.

    // Effective turn — anchored on the store, not the host's counter
    // (see header: "Turn derivation"). Guarantees distinct, ordered ids
    // for consecutive turns of one conversation even when the host
    // re-seeds `turnNumber = 1` on every run.
    const hostTurn =
      typeof scope.turnNumber === 'number' && Number.isFinite(scope.turnNumber)
        ? Math.max(1, Math.floor(scope.turnNumber))
        : 1;
    const storedMax = await maxStoredSnapshotTurn(store, identity);
    const turn = Math.max(hostTurn, storedMax + 1);

    const signal = scope.$getEnv?.()?.signal;
    const queryVec = (await embedder.embed({
      text: query,
      ...(signal ? { signal } : {}),
    })) as number[];

    const now = Date.now();
    const ttl = config.ttlMs ? now + config.ttlMs : undefined;

    // Evidence bridge (#5): the wire layer delivers run evidence harvested by
    // `causalEvidenceRecorder` via the write mount's `evidenceSource`. Absent
    // (non-agent hosts, no recorder attached) → zeros, as before.
    const evidence = scope.runEvidence;
    const snapshot: SnapshotEntry = {
      query,
      finalContent,
      iterations: evidence?.iterations ?? 0,
      decisions: evidence?.decisions ?? [],
      toolCalls: evidence?.toolCalls ?? [],
      durationMs: evidence?.durationMs ?? 0,
      tokenUsage: evidence?.tokenUsage ?? { input: 0, output: 0 },
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
