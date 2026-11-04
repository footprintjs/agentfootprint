/**
 * loadSnapshot — read-side stage for Causal memory.
 *
 * Embeds the user's current question, searches the store for the most
 * similar past run, projects the snapshot per `SnapshotProjection`,
 * and writes the formatted result to `scope.formatted` so the
 * downstream slot subflow injects it as a system message.
 *
 * Reads from scope:   `identity`, `messages` (or `newMessages` fallback)
 * Writes to scope:    `formatted` — array of `LLMMessage` to inject
 *
 * Strict-threshold semantics:
 *   When `minScore` is set and no past snapshot meets it, returns an
 *   empty `formatted`. NO fallback — garbage past context is worse than
 *   no context.
 *
 * Empty-query handling:
 *   No user message → no embedding → no search → empty result.
 */

import type { TypedScope } from 'footprintjs';
import type { LLMMessage } from '../../provider-contract/types.js';
import type { MemoryStore } from '../store/index.js';
import type { Embedder } from '../embedding/index.js';
import type { MemoryState } from '../stages/index.js';
import { readSnapshot } from './snapshotSchema.js';
import { formatSnapshot } from './snapshotProjection.js';
import { SNAPSHOT_PROJECTIONS, type SnapshotProjection } from '../define.types.js';

export interface LoadSnapshotConfig {
  /** Vector-capable store. Must implement `search()`. */
  readonly store: MemoryStore;

  /** Embedder used to vectorize the current query. */
  readonly embedder: Embedder;

  /** Stable id of the embedder — filters cross-model results out. */
  readonly embedderId?: string;

  /** Top-k snapshots to retrieve. Default 1 (most-relevant past run). */
  readonly topK?: number;

  /**
   * Minimum cosine score [-1, 1]. Strict — entries below this are
   * dropped. When no entry meets the threshold, the stage emits no
   * messages (no fallback). Default 0.7.
   */
  readonly minScore?: number;

  /**
   * Slice of the snapshot to project. Default `'decisions'` —
   * decision evidence is the highest-signal field for "why" follow-ups.
   */
  readonly projection?: SnapshotProjection;

  /**
   * Optional override for query extraction. Default: last user
   * message in `scope.messages` (current turn's question).
   */
  readonly queryFrom?: (scope: TypedScope<MemoryState>) => string;
}

function defaultQueryFrom(scope: TypedScope<MemoryState>): string {
  const scopeAny = scope as unknown as { messages?: readonly LLMMessage[] };
  const incoming = scopeAny.messages ?? [];
  const source = incoming.length > 0 ? incoming : scope.newMessages ?? [];
  for (let i = source.length - 1; i >= 0; i--) {
    const m = source[i];
    if (m.role === 'user' && m.content) return String(m.content);
  }
  return '';
}

// LENS · system-text · request-ephemeral
// reads: the nearest past run ← store.search() under the run identity, projected per SnapshotProjection
// below minScore it returns EMPTY rather than a weaker match — an honest omission, not a degraded claim.
// law: may omit, never deny; every clause anchored to the call it was composed on.
export function loadSnapshot(config: LoadSnapshotConfig) {
  const { store, embedder } = config;
  if (!store.search) {
    throw new Error(
      'loadSnapshot: the configured store does not implement search(). ' +
        'Causal memory requires a vector-capable adapter (InMemoryStore, pgvector, ...).',
    );
  }
  const queryFrom = config.queryFrom ?? defaultQueryFrom;
  const topK = config.topK ?? 1;
  const projection = config.projection ?? SNAPSHOT_PROJECTIONS.DECISIONS;
  const minScore = config.minScore ?? 0.7;

  return async (scope: TypedScope<MemoryState>): Promise<void> => {
    const accounting = { returned: 0, accepted: 0, unsupported: 0, invalid: 0 };
    scope.snapshotRead = accounting;
    const identity = scope.identity;
    const text = queryFrom(scope).trim();
    if (text.length === 0) {
      scope.formatted = [];
      return;
    }

    const signal = scope.$getEnv?.()?.signal;
    const queryVec = (await embedder.embed({
      text,
      ...(signal ? { signal } : {}),
    })) as number[];

    // store.search optional on MemoryStore but required when an embedder
    // is configured (validated upstream by defineMemory).
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const results = await store.search!(identity, queryVec, {
      k: topK,
      minScore,
      ...(config.embedderId !== undefined && { embedderId: config.embedderId }),
    });

    if (results.length === 0) {
      // Strict threshold: no match → no injection. Garbage > none is wrong.
      scope.formatted = [];
      return;
    }

    accounting.returned = results.length;
    const messages: LLMMessage[] = [];
    for (const result of results) {
      const admitted = readSnapshot(result.entry.value);
      if (admitted.kind !== 'accepted') {
        accounting[admitted.kind] += 1;
        continue;
      }
      accounting.accepted += 1;
      messages.push(formatSnapshot(admitted.value, projection, result.score));
    }
    scope.snapshotRead = { ...accounting };
    scope.formatted = messages;
  };
}
