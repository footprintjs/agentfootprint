/**
 * AgentCoreStore — AWS Bedrock **AgentCore Memory** adapter
 * (peer-dep `@aws-sdk/client-bedrock-agentcore`).
 *
 *   import { AgentCoreStore } from 'agentfootprint/memory';
 *
 *   const store = new AgentCoreStore({
 *     memoryId: 'arn:aws:bedrock-agentcore:us-west-2:...:memory/my-mem',
 *     region: 'us-west-2',
 *   });
 *
 * Pattern: Adapter (GoF) — maps the `MemoryStore` interface onto AgentCore Memory's
 *          data-plane **event** model (`CreateEvent` / `GetEvent` / `ListEvents` /
 *          `DeleteEvent`, `@aws-sdk/client-bedrock-agentcore`):
 *            MemoryIdentity.{tenant,principal}  ↔  AgentCore `actorId`
 *            MemoryIdentity.conversationId      ↔  AgentCore `sessionId`
 *            MemoryEntry                        ↔  one event whose `payload` is a single
 *                                                  `blob` document holding the entry
 *
 * **AgentCore Memory is an append-only event log, not a key-value store.** The server
 * assigns each event's `eventId` on `CreateEvent` (you cannot choose it), and there is no
 * "delete the whole session" call. This shapes the adapter:
 *
 *   • `put`  → `CreateEvent` (append; `actorId` + `eventTimestamp` are required).  O(1)
 *   • `list` → `ListEvents` (paginated, `includePayloads`).  ← window / episodic memory.  O(page)
 *   • `get(id)` / `delete(id)` → list-then-find by the entry id stored in the blob, since
 *     AgentCore's ids are server-assigned.  **O(events in session)** — fine for typical
 *     window sizes; if you need O(1) keyed access at scale, use RedisStore.
 *   • `forget` → `ListEvents` + `DeleteEvent` per event (no `DeleteSession` on AgentCore).
 *   • `search` → `RetrieveMemoryRecords`, **text-in**. AgentCore embeds and ranks on its
 *     own side, so it takes a natural-language query; the port's `search()` takes a
 *     vector. Pass `options.text` and this store serves the query; omit it and it refuses
 *     by name rather than ranking an empty set. See `search()` below for the whole story.
 *   • `putIfVersion` / `seen` / `feedback` → in-process emulation (AgentCore has no native
 *     CAS / dedup / feedback primitive; these don't survive process restart).
 *   • no `stream()` — AgentCore Memory has no streaming data-plane operation, and the
 *     `MemoryStore` port has no streaming method to implement. Inventing one for a single
 *     backend is how a port stops being a port.
 *
 * Role:    Outer ring. Lazy-requires the AWS SDK; zero runtime cost when another adapter is
 *          in use.  Emits: N/A (storage adapters don't emit).
 */

import type {
  ListOptions,
  ListResult,
  MemoryStore,
  PutIfVersionResult,
  ScoredEntry,
  SearchOptions,
} from '../../memory/store/types.js';
import type { MemoryEntry } from '../../memory/entry/index.js';
import type { MemoryIdentity } from '../../memory/identity/index.js';
import { lazyRequire } from '../../lib/lazyRequire.js';
import { describeStoredShape } from '../../lib/storedPreview.js';

/** One event as the adapter cares about it: AgentCore's id + the decoded entry. */
export interface AgentCoreEvent {
  /** AgentCore server-assigned event id (needed to delete it). */
  readonly eventId: string;
  /**
   * The MemoryEntry decoded from the event's blob payload.
   *
   * `null` means the event carried **no blob at all** — nothing in it ever
   * claimed to be one of this store's entries (AgentCore writes events of its
   * own into the same log), so it is skipped as an absence.
   *
   * A blob that IS present and cannot be decoded never arrives here: it raises
   * {@link UnreadableMemoryEntryError} at the decode step instead. An unreadable
   * stored memory and an absent one are different facts, and only one of them is
   * safe to answer with silence.
   */
  readonly entry: MemoryEntry | null;
}

/**
 * Thrown when an event carries a blob that is **present but unreadable** where a
 * `MemoryEntry` should be.
 *
 * The same law the session store inherits from `hosting/envelope`, applied to
 * this port's own shape: an unreadable stored memory and an absent one are
 * different facts, and only one of them is safe to answer with silence. A
 * memory that exists and cannot be decoded, quietly skipped, is an agent that
 * answers as if it were never told — indistinguishable from working, until
 * somebody notices the assistant has forgotten a customer's address.
 *
 * ── Why the law lives HERE and not in a shared reader ────────────────────────
 * `MemoryStore` has no envelope and no shared reading path — nothing on this
 * port corresponds to `hosting`'s `readFormat`, the single choke point every
 * session adapter reads through — so the refusal belongs at the one place raw
 * bytes become an entry: this adapter's decode step. If a `MemoryStore` reading
 * path ever grows such a choke point, the law moves there and this becomes a
 * caller of it.
 *
 * ── Why this one QUOTES NOTHING, where the session refusal quotes a prefix ───
 * Same discipline — "never the stored content" — and the same shared helper, but
 * a different answer, because the two shapes differ in where content begins. A
 * `CheckpointEnvelope` opens `{ format, data, savedAt }`, so a capped prefix is
 * metadata. A `MemoryEntry` opens `{ id, value, … }`, so its SECOND field is the
 * thing somebody asked the agent to remember, and even a short prefix would
 * print it. `storedShape` therefore reports type, length, JSON-ness and the
 * opening character and nothing else — still enough to recognise "an object
 * stringified by something that was not JSON", which is the only diagnosis this
 * message needs to support.
 */
export class UnreadableMemoryEntryError extends TypeError {
  readonly code = 'ERR_UNREADABLE_MEMORY_ENTRY' as const;
  /** AgentCore's id for the event those bytes came from. */
  readonly eventId: string;
  /** The AgentCore session (this store's conversation) it was stored under. */
  readonly sessionId: string;
  /**
   * What came back, described by SHAPE — type, length, JSON-ness, opening
   * character. Never a quote: on this port the stored bytes are the memory.
   */
  readonly storedShape: string;

  constructor(input: { eventId: string; sessionId: string; stored: unknown }) {
    const shape = describeStoredShape(input.stored);
    super(
      `[memory] AgentCoreStore: event '${input.eventId}' in session '${input.sessionId}' holds ` +
        `a STORED memory this adapter cannot read. An unreadable stored memory and an absent ` +
        `one are different facts, and only one of them is safe to answer with silence — so ` +
        `this refuses rather than handing back a shorter list that reads as "nothing was ` +
        `remembered". What the store handed back is ${shape}; none of it is quoted here, ` +
        `because on this port those bytes ARE the memory. Entries written before 7.22.1 were ` +
        `stored as objects and come back as this service's own toString() rendering, which is ` +
        `lossy and cannot be decoded: delete them, or point this store at a fresh memory ` +
        `resource.`,
    );
    this.name = 'UnreadableMemoryEntryError';
    this.eventId = input.eventId;
    this.sessionId = input.sessionId;
    this.storedShape = shape;
  }
}

/**
 * Minimal, entry-semantic surface the store uses. The real implementation
 * (`createAgentCoreClient`) maps these onto `CreateEvent` / `ListEvents` /
 * `DeleteEvent`; tests inject a mock via `_client`.
 */
export interface AgentCoreLikeClient {
  /** Append one entry as an event (server assigns the eventId). */
  createEvent(input: {
    memoryId: string;
    actorId: string;
    sessionId: string;
    entry: MemoryEntry;
  }): Promise<void>;
  /** One page of the session's events (newest-first is AgentCore's default). */
  listEvents(input: {
    memoryId: string;
    actorId: string;
    sessionId: string;
    maxResults?: number;
    nextToken?: string;
  }): Promise<{ events: readonly AgentCoreEvent[]; nextToken?: string }>;
  /** Delete one event by its AgentCore eventId. */
  deleteEvent(input: {
    memoryId: string;
    actorId: string;
    sessionId: string;
    eventId: string;
  }): Promise<void>;
  /**
   * Server-side semantic retrieval (`RetrieveMemoryRecords`). Optional: a client
   * built before this existed still satisfies the interface, and `search()`
   * feature-detects it rather than assuming.
   */
  retrieveRecords?(input: {
    memoryId: string;
    namespace: string;
    searchQuery: string;
    maxResults?: number;
    memoryStrategyId?: string;
  }): Promise<{ records: readonly AgentCoreMemoryRecord[] }>;
}

/** One record as `RetrieveMemoryRecords` returns it. */
export interface AgentCoreMemoryRecord {
  /** AgentCore's own record id. */
  readonly memoryRecordId: string;
  /** The record's text content. */
  readonly content: string;
  /** Relevance as AgentCore scored it, when it reports one. */
  readonly score?: number;
  /** Which strategy produced the record (semantic, summary, user-preference, …). */
  readonly memoryStrategyId?: string;
  /** The namespace it was found in. */
  readonly namespace?: string;
  /** When AgentCore created it (unix ms), when reported. */
  readonly createdAt?: number;
}

export interface AgentCoreStoreOptions {
  /** AgentCore Memory ARN or id. Required. */
  readonly memoryId: string;
  /** AWS region. Required when constructing the SDK client internally. */
  readonly region?: string;
  /** Pre-built AgentCore client (shares one SDK config across the host app). */
  readonly client?: AgentCoreLikeClient;
  /** Page size for `listEvents`. Default 100. */
  readonly pageSize?: number;
  /**
   * Where `search()` looks. AgentCore organises extracted memory records into
   * namespaces configured on the Memory resource's strategies (commonly
   * something like `/strategies/{strategyId}/actors/{actorId}`).
   *
   * A function, because the namespace usually contains the actor: it is handed
   * the resolved AgentCore ids for the identity being searched. Default:
   * `/actors/{actorId}/sessions/{sessionId}` — the session's own records.
   */
  readonly searchNamespace?: (scope: {
    readonly actorId: string;
    readonly sessionId: string;
  }) => string;
  /**
   * Restrict `search()` to one extraction strategy (semantic, summary,
   * user-preference…). Omit to search across all of them.
   *
   * This is the metadata filter that reaches AgentCore's own side; `tiers` /
   * `minScore` / `k` from {@link SearchOptions} are applied to what comes back.
   */
  readonly searchStrategyId?: string;
  /** @internal Test injection — skips the SDK require entirely. */
  readonly _client?: AgentCoreLikeClient;
  /** @internal Test injection — the AWS SDK module (to exercise the real shim with a mock SDK). */
  readonly _sdk?: BedrockAgentCoreSdkModule;
}

const ID_MAX = 99;

/** Build an AgentCore-safe id from arbitrary identity parts (`[A-Za-z0-9_-]`, bounded). */
function safeId(prefix: string, raw: string): string {
  const slug = raw.replace(/[^A-Za-z0-9_-]/g, '-');
  if (slug.length <= ID_MAX - prefix.length) return `${prefix}${slug}`;
  // too long → keep a readable head + a stable hash tail so distinct inputs stay distinct
  const head = slug.slice(0, ID_MAX - prefix.length - 9);
  return `${prefix}${head}-${fnv1a(raw)}`;
}

/**
 * AgentCore Memory-backed `MemoryStore`. Implements every method except `search()`.
 *
 * @throws when `@aws-sdk/client-bedrock-agentcore` is not installed and no `_client`/`_sdk`
 *         is supplied.
 */
export class AgentCoreStore implements MemoryStore {
  /**
   * **No.** `search()` below exists, but it is `RetrieveMemoryRecords`:
   * AgentCore embeds and ranks on its own side, over the records its
   * extraction strategies derived, and never over the vectors written
   * through `put`/`putMany`. Embeddings handed to this store are stored
   * inside the event blob and are never ranked by anything.
   *
   * Declared (8.19.0) because a method's presence could not say that.
   * `indexCorpus` used to accept this store, embed a whole corpus, pay for
   * it and report success — and the chunks were unreachable forever. The
   * corpus builders read this bit and refuse, naming this store and what to
   * use instead; nothing else changes, and `defineMemory` over AgentCore's
   * own retrieval is untouched.
   */
  readonly supportsVectorSearch = false;

  /**
   * **Words, not a vector.** `search()` is `RetrieveMemoryRecords`, whose
   * query is natural-language text: it reads {@link SearchOptions.text} and
   * refuses by name without it.
   *
   * {@link supportsVectorSearch} already said this store cannot serve back the
   * embeddings written into it — the question a corpus BUILDER asks. This
   * answers the next one down, which is what a corpus READER needs: what query
   * form does `search()` take? Declaring it is what lets `defineRAG` know,
   * before the first turn rather than after the bill, that a retriever over
   * this store needs no `Embedder` at all — embedding the question anyway is
   * spend on a vector discarded on arrival.
   *
   * Added in the same batch as the Google column's Memory Bank store, which is
   * the second adapter of this shape. Two stores that behave identically and
   * declare it differently is how a capability check quietly stops meaning
   * anything.
   */
  readonly ranksBy = 'server-text' as const;

  private readonly client: AgentCoreLikeClient;
  private readonly memoryId: string;
  private readonly pageSize: number;
  private readonly searchNamespace: (scope: { actorId: string; sessionId: string }) => string;
  private readonly searchStrategyId: string | undefined;
  private closed = false;

  // In-process shadow state for things AgentCore doesn't surface natively.
  private readonly signatures = new Map<string, Set<string>>();
  private readonly feedbackBag = new Map<string, { sum: number; count: number }>();

  constructor(options: AgentCoreStoreOptions) {
    if (!options.memoryId) throw new Error('AgentCoreStore requires `memoryId`.');
    this.memoryId = options.memoryId;
    this.pageSize = options.pageSize ?? 100;
    this.searchNamespace =
      options.searchNamespace ??
      (({ actorId, sessionId }) => `/actors/${actorId}/sessions/${sessionId}`);
    this.searchStrategyId = options.searchStrategyId;

    if (options._client) this.client = options._client;
    else if (options.client) this.client = options.client;
    else this.client = createAgentCoreClient(options.region, options._sdk);
  }

  // MemoryIdentity → AgentCore (actorId, sessionId). The actor is the user/tenant; the
  // session is the conversation. Both are derived deterministically + id-safe.
  private actorId(identity: MemoryIdentity): string {
    return safeId('afp-', `${identity.tenant || '_'}_${identity.principal || '_'}`);
  }
  private sessionId(identity: MemoryIdentity): string {
    return safeId('afp-', identity.conversationId);
  }
  private scope(identity: MemoryIdentity) {
    return {
      memoryId: this.memoryId,
      actorId: this.actorId(identity),
      sessionId: this.sessionId(identity),
    };
  }
  private shadowKey(identity: MemoryIdentity): string {
    return `${identity.tenant || '_'}/${identity.principal || '_'}/${identity.conversationId}`;
  }
  private feedbackKey(identity: MemoryIdentity, id: string): string {
    return `${this.shadowKey(identity)}::${id}`;
  }

  /** Walk every event in the session (paginated). */
  private async *eachEvent(identity: MemoryIdentity): AsyncGenerator<AgentCoreEvent> {
    let nextToken: string | undefined;
    do {
      const page = await this.client.listEvents({
        ...this.scope(identity),
        maxResults: this.pageSize,
        ...(nextToken !== undefined && { nextToken }),
      });
      for (const ev of page.events) yield ev;
      nextToken = page.nextToken;
    } while (nextToken);
  }

  // ── MemoryStore implementation ──────────────────────────────────

  async get<T = unknown>(identity: MemoryIdentity, id: string): Promise<MemoryEntry<T> | null> {
    this.ensureOpen('get');
    // Append-log: an id may have several events (each update appends one). Last write wins —
    // pick the highest version (ties → last seen), independent of AgentCore's list order.
    let found: MemoryEntry<T> | null = null;
    for await (const ev of this.eachEvent(identity)) {
      if (ev.entry?.id !== id) continue;
      const entry = ev.entry as MemoryEntry<T>;
      if (found === null || (entry.version ?? 0) >= (found.version ?? 0)) found = entry;
    }
    if (found && found.ttl !== undefined && found.ttl <= Date.now()) return null;
    return found;
  }

  async put<T = unknown>(identity: MemoryIdentity, entry: MemoryEntry<T>): Promise<void> {
    this.ensureOpen('put');
    if (entry.ttl !== undefined && entry.ttl <= Date.now()) return;
    await this.client.createEvent({ ...this.scope(identity), entry: entry as MemoryEntry });
  }

  async putMany<T = unknown>(
    identity: MemoryIdentity,
    entries: readonly MemoryEntry<T>[],
  ): Promise<void> {
    this.ensureOpen('putMany');
    // AgentCore has no batch-write API; per-session events are conceptually ordered, so
    // sequentialize and let the SDK retry policy handle backoff.
    for (const entry of entries) await this.put(identity, entry);
  }

  /**
   * Emulated optimistic concurrency. AgentCore appends unconditionally; we read-then-write
   * inside a JS critical section — adequate for single-writer-per-session deployments.
   */
  async putIfVersion<T = unknown>(
    identity: MemoryIdentity,
    entry: MemoryEntry<T>,
    expectedVersion: number,
  ): Promise<PutIfVersionResult> {
    this.ensureOpen('putIfVersion');
    const current = await this.get<T>(identity, entry.id);
    if (current === null) {
      if (expectedVersion !== 0) return { applied: false };
    } else if (current.version !== expectedVersion) {
      return { applied: false, currentVersion: current.version };
    }
    await this.put(identity, entry);
    return { applied: true };
  }

  async list<T = unknown>(
    identity: MemoryIdentity,
    options: ListOptions = {},
  ): Promise<ListResult<T>> {
    this.ensureOpen('list');
    const page = await this.client.listEvents({
      ...this.scope(identity),
      maxResults: options.limit ?? this.pageSize,
      ...(options.cursor !== undefined && { nextToken: options.cursor }),
    });
    const out: MemoryEntry<T>[] = [];
    for (const ev of page.events) {
      const entry = ev.entry as MemoryEntry<T> | null;
      if (!entry) continue;
      if (entry.ttl !== undefined && entry.ttl <= Date.now()) continue;
      if (options.tiers && (!entry.tier || !options.tiers.includes(entry.tier))) continue;
      out.push(entry);
    }
    return page.nextToken ? { entries: out, cursor: page.nextToken } : { entries: out };
  }

  async delete(identity: MemoryIdentity, id: string): Promise<void> {
    this.ensureOpen('delete');
    for await (const ev of this.eachEvent(identity)) {
      if (ev.entry?.id === id) {
        await this.client.deleteEvent({ ...this.scope(identity), eventId: ev.eventId });
      }
    }
    this.feedbackBag.delete(this.feedbackKey(identity, id));
  }

  async seen(identity: MemoryIdentity, signature: string): Promise<boolean> {
    this.ensureOpen('seen');
    return this.signatures.get(this.shadowKey(identity))?.has(signature) ?? false;
  }

  async recordSignature(identity: MemoryIdentity, signature: string): Promise<void> {
    this.ensureOpen('recordSignature');
    const key = this.shadowKey(identity);
    const set = this.signatures.get(key) ?? new Set<string>();
    set.add(signature);
    this.signatures.set(key, set);
  }

  async feedback(identity: MemoryIdentity, id: string, usefulness: number): Promise<void> {
    this.ensureOpen('feedback');
    if (!Number.isFinite(usefulness)) return;
    const clamped = Math.max(-1, Math.min(1, usefulness));
    const key = this.feedbackKey(identity, id);
    const cur = this.feedbackBag.get(key) ?? { sum: 0, count: 0 };
    this.feedbackBag.set(key, { sum: cur.sum + clamped, count: cur.count + 1 });
  }

  async getFeedback(
    identity: MemoryIdentity,
    id: string,
  ): Promise<{ average: number; count: number } | null> {
    this.ensureOpen('getFeedback');
    const cur = this.feedbackBag.get(this.feedbackKey(identity, id));
    if (!cur || cur.count === 0) return null;
    return { average: cur.sum / cur.count, count: cur.count };
  }

  /** GDPR "everything for this identity, gone." No DeleteSession on AgentCore → delete every event. */
  async forget(identity: MemoryIdentity): Promise<void> {
    this.ensureOpen('forget');
    const ids: string[] = [];
    for await (const ev of this.eachEvent(identity)) ids.push(ev.eventId);
    for (const eventId of ids) await this.client.deleteEvent({ ...this.scope(identity), eventId });
    const shadowKey = this.shadowKey(identity);
    this.signatures.delete(shadowKey);
    for (const key of [...this.feedbackBag.keys()]) {
      if (key.startsWith(`${shadowKey}::`)) this.feedbackBag.delete(key);
    }
  }

  /**
   * Server-side semantic retrieval over AgentCore's extracted memory records
   * (`RetrieveMemoryRecords`).
   *
   * ── Read this before you call it ─────────────────────────────────────────
   * **It takes TEXT, not the vector.** AgentCore embeds and ranks on its own
   * side, so `query` — the port's vector — is unusable here, and the query it
   * actually needs travels in `options.text`. Omit that and this method throws
   * a corrective error naming what is missing, because the alternative is
   * ranking nothing and handing back `[]`, which reads as "no matches" when it
   * really means "wrong query form". Pass both and every store can serve you:
   * local-ranking backends use the vector and ignore the text.
   *
   * **It searches a DIFFERENT population than `list()`.** `list` returns the
   * events this store wrote. This returns the records AgentCore's extraction
   * strategies derived FROM those events — summaries, semantic facts, user
   * preferences. The ids therefore belong to AgentCore, not to entries you
   * `put()`, and `store.get(entry.id)` will not find them. They arrive as
   * entries so ranking code needs no special case, with `metadata.source`
   * saying plainly where they came from.
   *
   * Filters: `searchStrategyId` and the namespace reach AgentCore's own side;
   * `k`, `minScore` and `tiers` are applied to what comes back.
   *
   * @throws when `options.text` is absent, or when the client cannot retrieve.
   */
  async search<T = unknown>(
    identity: MemoryIdentity,
    query: readonly number[],
    options: SearchOptions = {},
  ): Promise<readonly ScoredEntry<T>[]> {
    this.ensureOpen('search');
    const text = options.text?.trim();
    if (!text) {
      throw new Error(
        'AgentCoreStore.search() needs the query as TEXT, in `options.text`.\n' +
          `  AgentCore embeds and ranks server-side (RetrieveMemoryRecords), so the ${query.length}-dimension\n` +
          '  vector this method was handed cannot be sent anywhere — and returning [] would look\n' +
          '  like "no matches" rather than "wrong query form".\n' +
          '  Fix:  store.search(identity, vector, { text: theUserQuestion })\n' +
          '  Backends that rank locally ignore `text`, so passing both is always safe.',
      );
    }
    if (!this.client.retrieveRecords) {
      throw new Error(
        'AgentCoreStore.search() requires a client that implements `retrieveRecords`.\n' +
          '  The built-in client does; a custom or older injected `client` / `_client` may not.',
      );
    }

    const scope = this.scope(identity);
    const k = options.k ?? 10;
    const page = await this.client.retrieveRecords({
      memoryId: this.memoryId,
      namespace: this.searchNamespace({ actorId: scope.actorId, sessionId: scope.sessionId }),
      searchQuery: text,
      maxResults: k,
      ...(this.searchStrategyId !== undefined && { memoryStrategyId: this.searchStrategyId }),
    });

    const scored: ScoredEntry<T>[] = [];
    for (const record of page.records) {
      const score = record.score ?? 0;
      if (options.minScore !== undefined && score < options.minScore) continue;
      // AgentCore records carry no tier. A tier filter therefore excludes them
      // all rather than silently ignoring the filter the caller asked for.
      if (options.tiers && options.tiers.length > 0) continue;
      const createdAt = record.createdAt ?? Date.now();
      const entry: MemoryEntry<T> = {
        id: record.memoryRecordId,
        value: record.content as T,
        version: 1,
        createdAt,
        updatedAt: createdAt,
        lastAccessedAt: Date.now(),
        accessCount: 0,
        metadata: {
          // Says plainly that this did not come from an event this store wrote.
          source: 'agentcore-memory-record',
          ...(record.memoryStrategyId !== undefined && {
            memoryStrategyId: record.memoryStrategyId,
          }),
          ...(record.namespace !== undefined && { namespace: record.namespace }),
        },
      };
      scored.push({ entry, score });
    }
    // AgentCore returns its own ranking; re-sort anyway so the port's
    // "descending by score" holds even if a future API version reorders.
    scored.sort((a, b) =>
      b.score !== a.score ? b.score - a.score : a.entry.id < b.entry.id ? -1 : 1,
    );
    return scored.slice(0, k);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
  }

  private ensureOpen(op: string): void {
    if (this.closed) throw new Error(`AgentCoreStore.${op}() called after close().`);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The slice of `@aws-sdk/client-bedrock-agentcore` the shim touches. */
export interface BedrockAgentCoreSdkModule {
  readonly BedrockAgentCoreClient?: new (config: { region?: string }) => {
    send(cmd: unknown): Promise<unknown>;
  };
  readonly CreateEventCommand?: new (input: unknown) => unknown;
  readonly ListEventsCommand?: new (input: unknown) => unknown;
  readonly DeleteEventCommand?: new (input: unknown) => unknown;
  readonly RetrieveMemoryRecordsCommand?: new (input: unknown) => unknown;
}

/**
 * Pull the MemoryEntry out of an AgentCore event's `payload` (a single `blob`
 * document) — this adapter's ONE decode step, and therefore the only place that
 * can tell "no entry here" apart from "an entry nobody can read".
 *
 * ── Why a string is the normal case ──────────────────────────────────────────
 * Entries are written as JSON **text** (see `createEvent` below), so the blob
 * comes back a string and is parsed here. Objects are still accepted: a
 * caller-supplied `client` may hand back a real object, and refusing it would
 * break a seam that never had this problem.
 *
 * Three outcomes, and the middle one is the fix:
 *   • no `blob` in any part → `null`. Nothing claimed to be an entry — AgentCore
 *     writes events of its own into the same log — so it is skipped.
 *   • a blob that cannot be decoded → **throws** {@link UnreadableMemoryEntryError}.
 *     Skipping it would shorten a `list()` by one and read as "that memory was
 *     never stored", which is the silent failure this release exists to end.
 *   • a decodable blob → the entry.
 */
function entryFromPayload(
  payload: unknown,
  event: { eventId: string; sessionId: string },
): MemoryEntry | null {
  if (!Array.isArray(payload)) return null;
  for (const p of payload) {
    if (!p || typeof p !== 'object' || !('blob' in p)) continue;
    const blob = (p as { blob?: unknown }).blob;
    // A part with no blob VALUE is not an entry either — keep looking.
    if (blob === null || blob === undefined) continue;
    if (typeof blob === 'object') return blob as MemoryEntry;
    if (typeof blob === 'string') {
      try {
        const parsed: unknown = JSON.parse(blob);
        if (parsed !== null && typeof parsed === 'object') return parsed as MemoryEntry;
      } catch {
        /* fall through to the refusal, with the ORIGINAL bytes to describe */
      }
    }
    throw new UnreadableMemoryEntryError({ ...event, stored: blob });
  }
  return null;
}

/**
 * Map the entry-semantic `AgentCoreLikeClient` onto the real AgentCore SDK commands.
 * If AWS renames commands, only this function changes.
 */
function createAgentCoreClient(
  region: string | undefined,
  injected?: BedrockAgentCoreSdkModule,
): AgentCoreLikeClient {
  let mod: BedrockAgentCoreSdkModule;
  if (injected) {
    mod = injected;
  } else {
    try {
      mod = lazyRequire<BedrockAgentCoreSdkModule>('@aws-sdk/client-bedrock-agentcore');
    } catch {
      throw new Error(
        'AgentCoreStore requires the `@aws-sdk/client-bedrock-agentcore` peer dependency.\n' +
          '  Install:  npm install @aws-sdk/client-bedrock-agentcore\n' +
          '  Or pass `client` / `_client` for a pre-built or mock client.',
      );
    }
  }
  if (!mod.BedrockAgentCoreClient) {
    throw new Error(
      'AgentCoreStore: `@aws-sdk/client-bedrock-agentcore` is installed but ' +
        '`BedrockAgentCoreClient` was not found. Update the SDK.',
    );
  }
  const sdk = new mod.BedrockAgentCoreClient({ ...(region && { region }) });

  const send = async (
    Ctor: (new (i: unknown) => unknown) | undefined,
    name: string,
    input: unknown,
  ) => {
    if (!Ctor) {
      throw new Error(
        `AgentCoreStore: \`@aws-sdk/client-bedrock-agentcore\` is missing ${name}. Upgrade the SDK.`,
      );
    }
    return sdk.send(new Ctor(input));
  };

  return {
    async createEvent({ memoryId, actorId, sessionId, entry }) {
      // The entry is stored as a single `blob` document (PayloadType.blob =
      // __DocumentType), and it goes in as JSON TEXT, not as the object.
      // Field-learned on the session store and true of every blob this service
      // holds: hand it an object and it stores its own host language's
      // `toString()` rendering — `{id=m-1, value={...}}` — and returns THAT
      // string, which is not JSON and cannot be turned back into an entry. A
      // `MemoryEntry` is defined as something a store can hold (the port's
      // stores round-trip it through JSON already), so the encoding is ours to
      // pick and the honest pick is the one whose bytes come back unchanged.
      await send(mod.CreateEventCommand, 'CreateEventCommand', {
        memoryId,
        actorId,
        sessionId,
        eventTimestamp: new Date(),
        payload: [{ blob: JSON.stringify(entry) }],
      });
    },
    async listEvents({ memoryId, actorId, sessionId, maxResults, nextToken }) {
      const r = (await send(mod.ListEventsCommand, 'ListEventsCommand', {
        memoryId,
        actorId,
        sessionId,
        includePayloads: true,
        ...(maxResults !== undefined && { maxResults }),
        ...(nextToken !== undefined && { nextToken }),
      })) as {
        events?: ReadonlyArray<{ eventId?: string; payload?: unknown }>;
        nextToken?: string;
      } | null;
      const events: AgentCoreEvent[] = (r?.events ?? []).map((ev) => {
        const eventId = ev.eventId ?? '';
        // A page containing one unreadable entry fails the READ. Returning the
        // rest would be a list that is quietly one memory short, which is the
        // shape of the failure nobody notices.
        return { eventId, entry: entryFromPayload(ev.payload, { eventId, sessionId }) };
      });
      return r?.nextToken ? { events, nextToken: r.nextToken } : { events };
    },
    async deleteEvent({ memoryId, actorId, sessionId, eventId }) {
      await send(mod.DeleteEventCommand, 'DeleteEventCommand', {
        memoryId,
        actorId,
        sessionId,
        eventId,
      });
    },
    async retrieveRecords({ memoryId, namespace, searchQuery, maxResults, memoryStrategyId }) {
      // AgentCore nests the query under `searchCriteria`; the strategy id is the
      // metadata filter that reaches its side rather than being applied after.
      const r = (await send(mod.RetrieveMemoryRecordsCommand, 'RetrieveMemoryRecordsCommand', {
        memoryId,
        namespace,
        searchCriteria: {
          searchQuery,
          ...(maxResults !== undefined && { topK: maxResults }),
          ...(memoryStrategyId !== undefined && { memoryStrategyId }),
        },
        ...(maxResults !== undefined && { maxResults }),
      })) as {
        memoryRecordSummaries?: ReadonlyArray<{
          memoryRecordId?: string;
          content?: { text?: string } | string;
          score?: number;
          memoryStrategyId?: string;
          namespace?: string | readonly string[];
          createdAt?: string | number | Date;
        }>;
      } | null;
      const records: AgentCoreMemoryRecord[] = (r?.memoryRecordSummaries ?? []).map((s) => {
        const content = typeof s.content === 'string' ? s.content : s.content?.text ?? '';
        const namespaceValue = Array.isArray(s.namespace) ? s.namespace[0] : s.namespace;
        const createdAt =
          s.createdAt === undefined ? undefined : new Date(s.createdAt as string).getTime();
        return {
          memoryRecordId: s.memoryRecordId ?? '',
          content,
          ...(typeof s.score === 'number' && { score: s.score }),
          ...(s.memoryStrategyId !== undefined && { memoryStrategyId: s.memoryStrategyId }),
          ...(typeof namespaceValue === 'string' && { namespace: namespaceValue }),
          ...(createdAt !== undefined && Number.isFinite(createdAt) && { createdAt }),
        };
      });
      return { records };
    },
  };
}
