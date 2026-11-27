import { storeRequestLimit } from '../../../memory/store/requestLimit.js';
import type {
  ListOptions,
  ListResult,
  MemoryStore,
  PutIfVersionResult,
  ScoredEntry,
  SearchOptions,
} from '../../../memory/store/types.js';
import type { MemoryEntry } from '../../../memory/entry/index.js';
import type { MemoryIdentity } from '../../../memory/identity/index.js';
import { identityNamespace } from '../../../memory/identity/index.js';
import {
  refuseUnhonouredWriteOptions,
  requestedWriteOptions,
  type MemoryWriteOptionName,
  type MemoryWriteOptions,
} from '../../../memory/store/writeOptions.js';
import {
  MAX_EVENT_PAGE_SIZE,
  MAX_RETRIEVAL_RESULTS,
  AGENTCORE_WRITE_OPTIONS,
  type AgentCoreEvent,
  type AgentCoreLikeClient,
  type AgentCoreStoreOptions,
  type AgentCoreEventPayloadSelector,
} from './contract.js';
import { assertAddressable, agentCoreScope } from './identity.js';
import {
  MISSING_SCOPE,
  assertNamespace,
  checkNamespaceVariables,
  frozenScope,
  assertSearchWithinScope,
  holdsActor,
  filedUnder,
  detachedExtraction,
} from './namespace.js';
import { createAgentCoreClient } from './sdkClient.js';
import {
  captureEventPayload,
  assertMixedEventSize,
  clientForwardsEventPayload,
} from './eventPayload.js';
/**
 * AgentCore Memory-backed `MemoryStore`. Implements every method except `search()`.
 *
 * @throws when `@aws-sdk/client-bedrock-agentcore` is not installed and no `client`/`sdk`
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

  /**
   * **Both write options, translated to `CreateEvent`'s own fields:**
   *
   *   `extraction: 'skip'`   → `extractionMode: 'SKIP'` — the event stays in
   *                            short-term memory and is excluded from
   *                            long-term extraction.
   *   `namespaceScope`       → `extractionConfig: { namespaceVariables }` —
   *                            substituted into the memory's
   *                            `namespaceTemplates` during extraction, which
   *                            is how one tenant's derived records stay in
   *                            that tenant's namespace.
   *
   * Absent — and both refused by name — when they could not reach AgentCore:
   * an injected client that does not declare `forwardsWriteOptions`, or an
   * installed SDK too old to MODEL the two fields (its serializer would drop
   * them without a word). The variables are checked here against AgentCore's
   * documented domain before anything is sent (see `checkNamespaceVariables`).
   *
   * A getter, not a field: a wrapper built by spreading this store
   * (`{ ...store, put }`) does not copy it — and a wrapper that does not carry
   * the third argument must not carry the declaration either.
   */
  get writeOptions(): readonly MemoryWriteOptionName[] | undefined {
    return this.writeOptionsRefusal === undefined ? AGENTCORE_WRITE_OPTIONS : undefined;
  }

  private readonly client: AgentCoreLikeClient;
  private readonly eventPayload: AgentCoreEventPayloadSelector | undefined;
  private readonly forwardsEventPayload: boolean;
  private readonly memoryId: string;
  private readonly pageSize: number;
  private readonly searchNamespace: (scope: {
    actorId: string;
    sessionId: string;
    identity: MemoryIdentity;
    namespaceScope?: Readonly<Record<string, string>>;
  }) => string;
  private readonly searchStrategyId: string | undefined;
  private readonly requireNamespaceScope: boolean;
  /**
   * Set by the first write or search that carries a scope: from then on this
   * store is a SCOPED store, and a call without one is refused — a second
   * memory, a `defineRAG` or a direct call that forgot its scope never reads
   * or files across the tenants the first one kept apart.
   */
  private servedScoped = false;
  private readonly searchAcrossPrincipals: boolean;
  /** Why the write options cannot be honoured — `undefined` when they can. */
  private readonly writeOptionsRefusal: string | undefined;
  private closed = false;

  // In-process shadow state for things AgentCore doesn't surface natively.
  private readonly signatures = new Map<string, Set<string>>();
  private readonly feedbackBag = new Map<string, { sum: number; count: number }>();

  constructor(options: AgentCoreStoreOptions) {
    if (!options.memoryId) throw new Error('AgentCoreStore requires `memoryId`.');
    this.memoryId = options.memoryId;
    const pageSize = options.pageSize ?? MAX_EVENT_PAGE_SIZE;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_EVENT_PAGE_SIZE) {
      throw new RangeError(
        `AgentCoreStore: \`pageSize\` must be an integer from 1 to ${MAX_EVENT_PAGE_SIZE} ` +
          '(the ListEvents limit). Use list() cursors to read more than one page.',
      );
    }
    this.pageSize = pageSize;
    this.searchNamespace =
      options.searchNamespace ??
      (({ actorId, sessionId }) => `/actors/${actorId}/sessions/${sessionId}`);
    this.searchStrategyId = options.searchStrategyId;
    this.requireNamespaceScope = options.requireNamespaceScope === true;
    this.searchAcrossPrincipals = options.searchAcrossPrincipals === true;

    const eventPayload = options.eventPayload;
    if (eventPayload !== undefined && typeof eventPayload !== 'function') {
      throw new TypeError('AgentCoreStore: eventPayload must be a synchronous selector.');
    }
    this.eventPayload = eventPayload;
    const injected = options._client ?? options.client;
    this.client =
      injected ?? createAgentCoreClient(options.region, options.sdk, eventPayload !== undefined);
    this.forwardsEventPayload =
      eventPayload !== undefined && clientForwardsEventPayload(this.client);
    this.writeOptionsRefusal =
      this.client.forwardsWriteOptions === true
        ? undefined
        : injected !== undefined
        ? 'its injected client does not declare `forwardsWriteOptions: true`, so it may drop ' +
          "CreateEvent's `extractionMode` / `extractionConfig`. Declare it on the client once it " +
          'forwards both fields unchanged'
        : "the installed `@aws-sdk/client-bedrock-agentcore` does not model CreateEvent's " +
          '`extractionMode` / `extractionConfig`, and its serializer drops a field it does not ' +
          'model. Upgrade the SDK to `@aws-sdk/client-bedrock-agentcore` >=3.1114.0';
  }

  private scope(identity: MemoryIdentity) {
    return agentCoreScope(this.memoryId, identity);
  }
  // The in-process shadow maps (dedup signatures, feedback) are keyed by the
  // SHARED namespace encoder rather than a hand-rolled copy of it: a copy of
  // the tuple layout is a copy of whatever is wrong with it, and this one was
  // a copy of the version where a `/` inside a tenant donated a field boundary
  // — two different identities sharing one dedup set and one feedback bag.
  private shadowKey(identity: MemoryIdentity): string {
    assertAddressable(identity);
    return identityNamespace(identity);
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

  async put<T = unknown>(
    identity: MemoryIdentity,
    entry: MemoryEntry<T>,
    options?: MemoryWriteOptions,
  ): Promise<void> {
    this.ensureOpen('put');
    await this.createEvent(identity, entry, this.extractionFields(options));
  }

  /** One event, with the write options already turned into fields (and checked) once. */
  private async createEvent<T>(
    identity: MemoryIdentity,
    entry: MemoryEntry<T>,
    extraction: ReturnType<AgentCoreStore['extractionFields']>,
  ): Promise<void> {
    if (entry.ttl !== undefined && entry.ttl <= Date.now()) return;
    const scope = this.scope(identity);
    const selected =
      this.eventPayload === undefined
        ? undefined
        : captureEventPayload(entry as MemoryEntry, this.eventPayload);
    if (selected?.eventPayload.kind === 'conversational' && !this.forwardsEventPayload) {
      throw new TypeError(
        'AgentCoreStore: conversational eventPayload requires forwardsEventPayload: true ' +
          'on the client and supported SDK serialization; the write is refused without downgrade.',
      );
    }
    if (selected) assertMixedEventSize({ ...scope, ...extraction, ...selected });
    await this.client.createEvent({
      ...scope,
      entry: selected === undefined ? (entry as MemoryEntry) : selected.entry,
      ...(selected !== undefined && { eventPayload: selected.eventPayload }),
      ...detachedExtraction(extraction),
    });
  }

  async putMany<T = unknown>(
    identity: MemoryIdentity,
    entries: readonly MemoryEntry<T>[],
    options?: MemoryWriteOptions,
  ): Promise<void> {
    this.ensureOpen('putMany');
    // AgentCore has no batch-write API; per-session events are conceptually ordered, so
    // sequentialize and let the SDK retry policy handle backoff. The options ride
    // every event of the batch — a batch is N writes, each asked the same thing,
    // and turned into fields ONCE, so no await between events can change them.
    if (entries.length === 0) return;
    const extraction = this.extractionFields(options);
    for (const entry of entries) await this.createEvent(identity, entry, extraction);
  }

  /**
   * Emulated optimistic concurrency. AgentCore appends unconditionally; we read-then-write
   * inside a JS critical section — adequate for single-writer-per-session deployments.
   */
  async putIfVersion<T = unknown>(
    identity: MemoryIdentity,
    entry: MemoryEntry<T>,
    expectedVersion: number,
    options?: MemoryWriteOptions,
  ): Promise<PutIfVersionResult> {
    this.ensureOpen('putIfVersion');
    // Refused BEFORE the read, so an unhonoured option never costs a list.
    const extraction = this.extractionFields(options);
    const current = await this.get<T>(identity, entry.id);
    if (current === null) {
      if (expectedVersion !== 0) return { applied: false };
    } else if (current.version !== expectedVersion) {
      return { applied: false, currentVersion: current.version };
    }
    await this.createEvent(identity, entry, extraction);
    return { applied: true };
  }

  /**
   * The namespace one search reads — rendered by `searchNamespace` and refused
   * by name when it could read beyond this identity: a wildcard, a namespace
   * that does not hold the scope segment for segment, or one that stops above
   * this identity's actor while the identity names a principal.
   */
  private namespaceFor(
    identity: MemoryIdentity,
    ids: { readonly actorId: string; readonly sessionId: string },
    given: Readonly<Record<string, string>> | undefined,
  ): string {
    // An empty scope asks for nothing — the same rule writes follow
    // (`requestedWriteOptions`) — so it is treated as no scope at all.
    const copied = given === undefined ? undefined : frozenScope(given);
    const namespaceScope =
      copied === undefined || Object.keys(copied).length === 0 ? undefined : copied;
    if (namespaceScope === undefined && (this.requireNamespaceScope || this.servedScoped)) {
      throw new TypeError(MISSING_SCOPE('search'));
    }
    if (namespaceScope !== undefined) this.servedScoped = true;
    if (namespaceScope !== undefined) checkNamespaceVariables(namespaceScope);
    const render = (scope: Readonly<Record<string, string>> | undefined): string =>
      this.searchNamespace({
        actorId: ids.actorId,
        sessionId: ids.sessionId,
        identity,
        ...(scope !== undefined && { namespaceScope: scope }),
      });
    const namespace = render(namespaceScope);
    assertNamespace(namespace);
    if (namespace.includes('*')) {
      throw new TypeError(
        'AgentCoreStore.search(): `searchNamespace` returned a namespace containing `*`. ' +
          'Results are kept only when they are filed at that namespace or under it, and a ' +
          'wildcard cannot be checked that way — so it is refused rather than matching nothing. ' +
          'Name the namespace exactly.',
      );
    }
    if (namespaceScope !== undefined) assertSearchWithinScope(render, namespace, namespaceScope);
    // The actor is required when the identity names a principal — and on EVERY
    // unscoped search: with no scope to confine it, the actor is the only thing
    // that keeps the read on this identity (a namespace template rendered with
    // no tenant collapses to a prefix every tenant shares).
    // `searchAcrossPrincipals` widens a SCOPED search to the tenant's
    // principals; with no scope there is no tenant to stay inside, so it never
    // lifts the actor requirement there.
    const actorRequired =
      namespaceScope === undefined ||
      (identity.principal !== undefined && !this.searchAcrossPrincipals);
    if (actorRequired && !holdsActor(namespace, ids.actorId)) {
      throw new TypeError(
        'AgentCoreStore.search(): the namespace searched does not hold this identity’s ' +
          '`actorId`, so it would read records AgentCore derived from every principal it ' +
          'covers. Put `{actorId}` in the strategy’s namespace template and in ' +
          '`searchNamespace` (e.g. "/tenants/{tenantid}/actors/{actorId}/facts"), or set ' +
          '`searchAcrossPrincipals: true` if the memory is shared on purpose.',
      );
    }
    return namespace;
  }

  /**
   * The write options as `CreateEvent`'s own fields — or a refusal by name for
   * any this store's client cannot carry. The ONE place the vendor-neutral
   * names become AWS's.
   */
  private extractionFields(options: MemoryWriteOptions | undefined): {
    extractionMode?: 'SKIP';
    extractionConfig?: { readonly namespaceVariables: Readonly<Record<string, string>> };
  } {
    refuseUnhonouredWriteOptions(
      'AgentCoreStore',
      this.writeOptions,
      options,
      this.writeOptionsRefusal ?? '',
    );
    const asked = requestedWriteOptions(options);
    // Copy FIRST, then decide on the copy — the same rule as a search: an empty
    // copy is no scope, whatever the caller's object reported a moment earlier.
    const given = options?.namespaceScope;
    const copied = given === undefined ? undefined : frozenScope(given);
    const scope = copied === undefined || Object.keys(copied).length === 0 ? undefined : copied;
    if (scope === undefined && (this.requireNamespaceScope || this.servedScoped)) {
      throw new TypeError(MISSING_SCOPE('write'));
    }
    if (scope !== undefined) this.servedScoped = true;
    if (scope !== undefined) checkNamespaceVariables(scope);
    return {
      ...(asked.includes('extraction') && { extractionMode: 'SKIP' as const }),
      ...(scope !== undefined && { extractionConfig: { namespaceVariables: scope } }),
    };
  }

  async list<T = unknown>(
    identity: MemoryIdentity,
    options: ListOptions = {},
  ): Promise<ListResult<T>> {
    this.ensureOpen('list');
    const limit = storeRequestLimit(options.limit, 'limit') ?? this.pageSize;
    const page = await this.client.listEvents({
      ...this.scope(identity),
      maxResults: Math.min(limit, MAX_EVENT_PAGE_SIZE),
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

  /** Delete session source events and local shadows; derived records have separate retention. */
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
   * saying plainly where they came from, and each value is `{ content }` —
   * the record's text where every memory formatter reads it.
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
    const k = Math.min(storeRequestLimit(options.k, 'k') ?? 10, MAX_RETRIEVAL_RESULTS);
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
    const namespace = this.namespaceFor(identity, scope, options.namespaceScope);
    const page = await this.client.retrieveRecords({
      memoryId: this.memoryId,
      namespace,
      searchQuery: text,
      maxResults: k,
      ...(this.searchStrategyId !== undefined && { memoryStrategyId: this.searchStrategyId }),
    });

    const scored: ScoredEntry<T>[] = [];
    for (const record of page.records) {
      // `namespace` is a PREFIX to AgentCore ("namespaces that start with the
      // provided prefix"), so `/tenants/v1` also returns `/tenants/v12`'s
      // records. Keep only what is filed AT the namespace asked for or under
      // it — and drop a record that names no namespace, which cannot be shown
      // to belong here, or that may be filed under ANOTHER actor (see
      // `filedUnder`).
      if (!filedUnder(record, namespace, scope.actorId)) continue;
      const score = record.score ?? 0;
      if (options.minScore !== undefined && score < options.minScore) continue;
      // AgentCore records carry no tier. A tier filter therefore excludes them
      // all rather than silently ignoring the filter the caller asked for.
      if (options.tiers && options.tiers.length > 0) continue;
      const createdAt = record.createdAt ?? Date.now();
      const entry: MemoryEntry<T> = {
        id: record.memoryRecordId,
        // The store's record shape, `{ content }` — never the bare string.
        // Both prompt formatters read the text off `.content` (the memory
        // flavour as a message, the rag flavour as a passage), so a bare string
        // rendered as an EMPTY block: the record was found and the model never
        // saw it. No `role`: nobody said this; AgentCore derived it.
        // Text only: a client outside the type hands back no non-string.
        value: { content: typeof record.content === 'string' ? record.content : '' } as T,
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
