/**
 * writeMessages — write-side stage that persists new turn messages as
 * `MemoryEntry`s.
 *
 * Reads from scope:  `identity`, `turnNumber`, `newMessages`
 * Writes to store:   one entry per message, id = `msg-{turnNumber}-{index}`
 *
 * Every written entry carries `source.turn` + `source.identity` so
 * retrieval stages can later show "recalled from turn 5" with correct
 * cross-session provenance. A content-hash signature is also registered
 * via `store.recordSignature` so subsequent `seen()` calls recognize
 * near-duplicate content without loading the full entries.
 *
 * Why a deterministic `id` format?
 *   `msg-{turn}-{index}` lets write-then-re-write be idempotent: a stage
 *   that re-runs in the same turn (retries, resumable turns) overwrites
 *   the same id instead of growing history. For non-turn-scoped writes,
 *   pass a custom `idFrom` that produces whatever shape your app needs.
 *
 * PII / redaction:
 *   Message content is stored VERBATIM. If your messages contain PII
 *   (names, addresses, secrets), redact BEFORE writing — either by
 *   mutating `scope.newMessages` upstream or by wrapping the call site
 *   with a redaction helper. The storage layer does NOT scrub for you.
 *   Pair with footprintjs's `RedactionPolicy` for end-to-end coverage.
 *
 * Extended thinking blocks (Anthropic) / reasoning tokens (OpenAI):
 *   Persisting reasoning blocks is expensive — they can be 10-100× the
 *   size of the final message. Strip them from `scope.newMessages` before
 *   calling this stage UNLESS you plan to recall them (e.g. for debugging
 *   replay). A common pattern: write reasoning to `tier: 'cold'` with a
 *   short `ttlMs` so they age out quickly.
 */
import type { TypedScope } from 'footprintjs';
import type { MemoryEntry } from '../entry';
import type { MemoryStore } from '../store';
import type { LLMMessage as Message } from '../../adapters/types';
import type { MemoryState } from './types';

export interface WriteMessagesConfig {
  /** The store to persist to. */
  readonly store: MemoryStore;
  /**
   * Optional id producer — receives (turn, index, message) and returns
   * the `MemoryEntry.id`. Defaults to `msg-{turn}-{index}` which makes
   * re-runs of the same turn idempotent. Override for app-level ids
   * (e.g. use a message's server-side id).
   */
  readonly idFrom?: (turn: number, index: number, message: Message) => string;
  /**
   * Optional signature producer for the recognition set. When present,
   * each message produces a signature that is registered via
   * `store.recordSignature`; `seen()` later returns `true` for the same
   * content. Default: skip (many apps don't need recognition).
   */
  readonly signatureFrom?: (message: Message) => string;
  /**
   * Optional TTL in milliseconds from `Date.now()`. When set, written
   * entries expire this long after they were stored. Useful for
   * compliance retention windows ("delete chat history after 30 days").
   */
  readonly ttlMs?: number;
  /**
   * Optional tier for the entries. Typical pattern:
   *   - `'hot'`  for the last few turns
   *   - `'warm'` for older turns
   *   - `'cold'` for archived
   * Stages in Layer 3+ can filter on tier. Omitting leaves entries
   * untiered (read stages still see them; tier-filtered reads skip them).
   */
  readonly tier?: 'hot' | 'warm' | 'cold';
}

const defaultIdFrom = (turn: number, index: number): string => `msg-${turn}-${index}`;

export function writeMessages(config: WriteMessagesConfig) {
  const idFrom = config.idFrom ?? defaultIdFrom;

  return async (scope: TypedScope<MemoryState>): Promise<void> => {
    const identity = scope.identity;
    const turn = scope.turnNumber;
    const messages = scope.newMessages ?? [];
    if (messages.length === 0) return;

    // Optional: embedMessages may have run earlier and written
    // per-message vectors to scope. Attach them to the entries so
    // vector-capable stores index on `embedding`.
    const embeddings = (
      scope as unknown as {
        newMessageEmbeddings?: readonly (readonly number[])[];
        newMessageEmbeddingModel?: string;
      }
    ).newMessageEmbeddings;
    const embeddingModel = (
      scope as unknown as {
        newMessageEmbeddingModel?: string;
      }
    ).newMessageEmbeddingModel;

    const now = Date.now();
    const ttl = config.ttlMs ? now + config.ttlMs : undefined;

    // Build all entries first, then batch-write. For N messages this
    // turns N sequential store round-trips into 1 (real backends:
    // Redis pipeline, DynamoDB BatchWriteItem, Postgres multi-row
    // INSERT). InMemoryStore resolves the slot once.
    const entries: MemoryEntry<Message>[] = [];
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const embedding = embeddings?.[i];
      entries.push({
        id: idFrom(turn, i, message),
        value: message,
        version: 1,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        ...(ttl !== undefined && { ttl }),
        ...(config.tier && { tier: config.tier }),
        ...(embedding && embedding.length > 0 && { embedding: [...embedding] }),
        ...(embeddingModel && { embeddingModel }),
        source: { turn, identity },
      });
    }

    await config.store.putMany(identity, entries);

    // Signatures still written individually — the recognition set is
    // an orthogonal index that adapters rarely batch (signatures get
    // hashed into a set, not a k-v store).
    if (config.signatureFrom) {
      for (const message of messages) {
        await config.store.recordSignature(identity, config.signatureFrom(message));
      }
    }
  };
}
