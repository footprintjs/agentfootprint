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
 *   no context. Aligns with the LLM-systems panel verdict in the design.
 *
 * Empty-query handling:
 *   No user message → no embedding → no search → empty result.
 */

import type { TypedScope } from 'footprintjs';
import type { LLMMessage } from '../../adapters/types.js';
import type { MemoryEntry } from '../entry/index.js';
import type { MemoryStore } from '../store/index.js';
import type { Embedder } from '../embedding/index.js';
import type { MemoryState } from '../stages/index.js';
import type { SnapshotEntry } from './types.js';
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
  const source = incoming.length > 0 ? incoming : (scope.newMessages ?? []);
  for (let i = source.length - 1; i >= 0; i--) {
    const m = source[i];
    if (m.role === 'user' && m.content) return String(m.content);
  }
  return '';
}

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

    const messages: LLMMessage[] = results.map((r) =>
      formatProjection(r.entry as MemoryEntry<SnapshotEntry>, projection, r.score),
    );
    scope.formatted = messages;
  };
}

/**
 * Render one snapshot into a `system` message per the chosen
 * projection. The shape is intentionally compact so multiple
 * snapshots fit comfortably in context.
 */
function formatProjection(
  entry: MemoryEntry<SnapshotEntry>,
  projection: SnapshotProjection,
  score: number,
): LLMMessage {
  const snap = entry.value;
  const header = `[Past run · query: "${truncate(snap.query, 80)}" · score: ${score.toFixed(2)}]`;

  let body: string;
  switch (projection) {
    case SNAPSHOT_PROJECTIONS.DECISIONS:
      body =
        snap.decisions.length === 0
          ? `(no decision evidence captured)\nFinal answer: ${snap.finalContent}`
          : snap.decisions
              .map(
                (d) =>
                  `- ${d.stageId} → "${d.chosen}"${d.rule ? ` (rule: ${d.rule})` : ''}` +
                  (d.evidence ? `; evidence: ${JSON.stringify(d.evidence)}` : ''),
              )
              .join('\n');
      break;

    case SNAPSHOT_PROJECTIONS.NARRATIVE:
      body = snap.narrative ?? `(no narrative captured)\nFinal answer: ${snap.finalContent}`;
      break;

    case SNAPSHOT_PROJECTIONS.COMMITS:
      // commitLog isn't yet captured in SnapshotEntry; project the
      // decisions list as a stand-in for now.
      body =
        snap.decisions.length === 0
          ? `(no commit log captured)\nFinal answer: ${snap.finalContent}`
          : snap.decisions
              .map((d) => `${d.stageId}: chose "${d.chosen}"`)
              .join('\n');
      break;

    case SNAPSHOT_PROJECTIONS.FULL:
      body = JSON.stringify(snap, null, 2);
      break;

    default:
      body = `Final answer: ${snap.finalContent}`;
  }

  return {
    role: 'system',
    content: `${header}\n${body}`,
  } as LLMMessage;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
