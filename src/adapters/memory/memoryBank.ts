/**
 * memoryBankStore — the `MemoryStore` port over Vertex AI **Memory Bank**.
 *
 *   import { memoryBankStore } from 'agentfootprint/memory';
 *
 *   const store = memoryBankStore({
 *     project: 'my-project',
 *     location: 'us-central1',
 *     reasoningEngine: '1234567890',
 *   });
 *
 * ── Read this before you write anything into it ─────────────────────────────
 * Memory Bank is a **natural-language** memory service, not a key-value store
 * and not a vector database. A `Memory` is a `fact` string plus an immutable
 * `scope`; retrieval takes a QUESTION IN WORDS, embeds it on Google's side and
 * ranks there. Three consequences, each of which has a silent-failure mode
 * that this adapter turns into something you can see:
 *
 *  1. **It never ranks the vectors you wrote.** `supportsVectorSearch` is
 *     `false` and `ranksBy` is `'server-text'`, so the corpus builders
 *     (`indexCorpus`, `indexFolder`, `indexDocuments`) refuse this store by
 *     name instead of embedding a whole corpus, reporting success, and leaving
 *     it unreachable forever. An `embedding` on an entry handed to `put()` is
 *     **not stored** — there is nowhere to put it and nothing that would read
 *     it — and the two declarations above are how this adapter says so before
 *     you spend anything.
 *
 *  2. **The retrieval score is a DISTANCE, and smaller is closer.** The port's
 *     `ScoredEntry.score` is a cosine similarity, where HIGHER is closer.
 *     Passed through unconverted, `search()` would return the LEAST relevant
 *     memories first with a confident-looking number in the right range —
 *     which no threshold and no eyeball can separate from a working search.
 *     See {@link MemoryBankStore.search} for exactly what this adapter does
 *     instead, and why it refuses `minScore` rather than reinterpreting it.
 *
 *  3. **`scope` is an exact match and immutable once written.** A retrieval
 *     whose scope is a subset of a memory's scope returns NOTHING — not a
 *     superset, not a partial match, nothing. So the scope convention has to
 *     be right before the first write, because it cannot be changed after it
 *     and a bank written under the wrong one is poisoned permanently. See
 *     {@link MemoryBankStoreOptions.scopeFor}.
 *
 * ── How a memory is ADDRESSED, and why it is not just the entry id ──────────
 * A memory's resource name is `<engine>/memories/<resource id>`, and that
 * resource id is composed from **the resolved scope and the entry id
 * together** — never the entry id alone.
 *
 * The reason is that entry ids in this library are deliberately deterministic
 * and identity-free: `msg-<turn>-<index>`, `fact:<key>`, `snap-<turn>`. Two
 * people talking to the same agent produce the SAME entry ids, so an address
 * built from the id alone is one row for both of them — and since a resource
 * name addresses a row directly, the second writer's `fact` lands on the first
 * writer's row while the immutable `scope` stays the first writer's. What comes
 * back is one tenant reading another tenant's private fact, one tenant's own
 * write invisible to them, and `forget()` finding nothing to erase. Every
 * sibling store in this library namespaces by identity (`s3Vectors` keys on
 * `<namespace>#<id>`, `pgVector` on `(namespace, id)`, `InMemoryStore` on a map
 * per namespace); this one does the same thing, keyed on the SCOPE rather than
 * the raw identity so that a widened `scopeFor` widens sharing exactly as much
 * as it widens retrieval, and not one row more.
 *
 * The composed address is a partition, not the boundary itself. The boundary is
 * the stored `scope`, which is re-checked on the way back from every read AND
 * before every overwrite — so even an address collision is refused rather than
 * written through.
 *
 * ── The retrieved NAME is not the name you wrote ────────────────────────────
 * A live field trial on the raw service found this and it is worth stating,
 * because it is exactly the assumption an adapter is tempted to make: `create`
 * and `list` came back with the caller-chosen memory ids, while SIMILARITY
 * RETRIEVAL answered with generated numeric resource names for the very same
 * facts (FINDINGS "Agent Runtime Memory Bank"). Anything reading an entry id
 * out of `memory.name` would therefore work perfectly on `list()` and hand back
 * unusable ids from `search()` — ids that no `get()` or `delete()` could find.
 *
 * This adapter never does that: `toEntry` reads the id from the metadata this
 * library wrote, and the resource name is carried only as
 * `entry.metadata.resourceName`, for looking at. The same trial also confirmed
 * exact-match scope semantics (a partial `{tenant}` scope retrieved nothing)
 * and the distance-not-similarity ranking that {@link MemoryBankStore.search}
 * converts.
 *
 * ── Writes are long-running operations ──────────────────────────────────────
 * `create`, `patch` and `delete` all answer with an Operation rather than the
 * resource — verified against the installed SDK's own return types. Every
 * write here waits for `done` before returning, because a `put` that came back
 * early followed by a `get` is a race whose failure mode is "no data", and
 * nobody can tell that from a memory that was never written.
 *
 * ── What has no primitive here, and is therefore refused ────────────────────
 * `putIfVersion`, `seen`, `recordSignature`, `feedback` and `getFeedback` have
 * no counterpart in this service: a `Memory` carries no etag and there is no
 * dedup or feedback surface. The sibling AgentCore adapter emulates them
 * in-process; this one refuses them by name, and the difference is deliberate.
 * A store you reach for BECAUSE it is shared across a fleet is the worst place
 * for a per-process shadow: `seen()` would answer `false` in the second
 * container for a signature the first one recorded, and an emulated
 * `putIfVersion` across two writers is a lost-update generator that reports
 * `{ applied: true }` to both. A refusal you read once beats a correctness bug
 * you never find.
 *
 * Pattern: Adapter (GoF) — `MemoryStore` onto `reasoningEngines.memories`,
 * through the shared REST client in `adapters/google/aiPlatform.ts`.
 */

import type { MemoryEntry } from '../../memory/entry/index.js';
import type { MemoryIdentity } from '../../memory/identity/index.js';
import type {
  ListOptions,
  ListResult,
  MemoryStore,
  PutIfVersionResult,
  ScoredEntry,
  SearchOptions,
} from '../../memory/store/types.js';
import {
  awaitOperation,
  buildAiPlatformClient,
  DEFAULT_OPERATION_TIMEOUT_MS,
  fingerprint,
  googleSdkFailure,
  isAlreadyExists,
  isNotFound,
  isSanitizedGoogleError,
  resolveEngine,
  safeResourceId,
  type AiPlatformConnection,
  type EngineScope,
  type MemoriesApi,
  type VertexMemory,
  type VertexMemoryMetadataValue,
  type VertexRetrievedMemory,
} from '../google/aiPlatform.js';

const ADAPTER = 'memoryBankStore';

/**
 * The metadata keys this adapter owns on a `Memory`.
 *
 * Prefixed, because the metadata map belongs to whoever owns the bank and this
 * library is a guest in it: an unprefixed `id` or `version` collides with the
 * next writer, and Memory Bank's metadata filters are exact-key matches, so a
 * collision is not a merge — it is one party's filter quietly matching the
 * other party's rows.
 */
const META = {
  id: 'agentfootprint_id',
  version: 'agentfootprint_version',
  createdAt: 'agentfootprint_created_at',
  updatedAt: 'agentfootprint_updated_at',
  tier: 'agentfootprint_tier',
  json: 'agentfootprint_json',
  /** {@link MemoryEntry.source}, verbatim, as JSON. See {@link MAX_CARRIED_JSON}. */
  source: 'agentfootprint_source',
  /** {@link MemoryEntry.metadata} the CALLER wrote, verbatim, as JSON. */
  meta: 'agentfootprint_metadata',
  /** {@link MemoryEntry.decayPolicy}, as JSON — retrieval ranking depends on it. */
  decay: 'agentfootprint_decay',
} as const;

/**
 * The metadata keys this adapter GENERATES on the way out, which therefore
 * cannot also be caller metadata.
 *
 * They are read-side facts about the row, not stored data: `source` names the
 * backend, `resourceName` is the Vertex name, `distance` is the raw retrieval
 * distance. Round-tripping an entry this store handed back must not fail, and
 * a caller's own value under one of these names must not be silently replaced
 * — see {@link splitMetadata} for how those two are told apart.
 */
const GENERATED_METADATA = ['source', 'resourceName', 'distance'] as const;

/**
 * What a Vertex resource name for a memory looks like:
 * `projects/<p>/locations/<l>/reasoningEngines/<e>/memories/<resource id>`.
 *
 * Used as the SHAPE half of recognising this adapter's own `resourceName` on the
 * way back in — never as a parser. Nothing reads an id out of a resource name
 * here (the module header says why); this only answers "could this string be one
 * of ours?".
 */
const RESOURCE_NAME = /^projects\/.+\/memories\/[^/]+$/;

/**
 * The most JSON one carried field may be, in characters.
 *
 * Memory Bank metadata values are typed scalars and this column has NOT
 * measured the service's own ceiling on a string one, so the bound is this
 * adapter's own and says so where it refuses. It is a refusal rather than a
 * truncation on purpose: provenance that came back shortened would be
 * provenance nobody could tell was shortened.
 */
export const MAX_CARRIED_JSON = 8_192;

/** The scope map an identity resolves to. Keys and values are both strings. */
export type MemoryScope = Readonly<Record<string, string>>;

/** Options for {@link memoryBankStore}. */
export interface MemoryBankStoreOptions extends AiPlatformConnection {
  /**
   * Map this library's identity tuple onto Memory Bank's `scope` — **the one
   * decision that cannot be taken back.**
   *
   * The default is the full tuple:
   *
   * ```
   *   { tenant: '<tenant|_>', principal: '<principal|_>', conversation: '<conversationId>' }
   * ```
   *
   * which is the same isolation every other store in this library enforces
   * (`identityNamespace` composes exactly these three), so agent code behaves
   * identically whichever column it runs on. That consistency is why it is the
   * default even though it is the NARROWEST useful choice.
   *
   * **What it costs, stated plainly.** Because scope matching is exact, a
   * memory written under a conversation is retrievable only within that
   * conversation. If what you want from a memory bank is "remember this person
   * across their conversations" — which is usually the point — widen it here:
   *
   * ```ts
   *   scopeFor: (identity) => ({
   *     tenant: identity.tenant ?? '_',
   *     principal: identity.principal ?? '_',
   *   })
   * ```
   *
   * **And why it is worth getting right the first time.** `Memory.scope` is
   * immutable. Memories already written keep the scope they were written with,
   * and a later retrieval under a different convention will not find them —
   * not with a warning, not with a partial match, but with an empty result
   * that looks exactly like "this person has told us nothing". Changing the
   * convention on a live bank means re-writing every memory in it.
   *
   * Values may not contain `*`; this adapter replaces any it is handed and
   * refuses an empty scope outright, because a scope of `{}` is the one value
   * that matches every other empty-scoped memory in the bank regardless of who
   * wrote it.
   */
  readonly scopeFor?: (identity: MemoryIdentity) => MemoryScope;
  /**
   * How long a memory lives, as a duration string the API accepts (`'86400s'`).
   * Omit and memories do not expire.
   *
   * A `MemoryEntry.ttl` is a unix TIMESTAMP and this is a DURATION; the two
   * are different quantities and the entry's own is honoured per write, so
   * this is only the default for entries that name none.
   */
  readonly ttl?: string;
  /**
   * How long a write waits for its long-running operation before refusing.
   * Default {@link DEFAULT_OPERATION_TIMEOUT_MS} (30s).
   */
  readonly operationTimeoutMs?: number;
  /**
   * How many rows a `list()` page carries when the caller names no limit.
   * Default 20. The service's own ceiling is 100 and it silently coerces
   * anything larger, so this adapter clamps rather than letting a request for
   * 500 come back as 100 with no explanation.
   */
  readonly pageSize?: number;
}

/** The service's own ceiling on a page or a top-k. Larger values are coerced. */
export const MAX_PAGE_SIZE = 100;

/** What a `list()` page carries when nothing was asked for. */
const DEFAULT_PAGE_SIZE = 20;

/**
 * A `MemoryStore` over Vertex AI Memory Bank.
 *
 * **Status: field-validated on the data plane (2026-08-14).** An independent
 * trial ran THIS class against a real Memory Bank and every one of these
 * answered a live request: the honest `supportsVectorSearch: false` /
 * `ranksBy: 'server-text'` declarations; cross-conversation recall under a
 * widened `scopeFor`; two identities using the SAME entry id without collision
 * or disclosure; string and structured values; opaque pagination cursors; tier
 * filtering; text similarity that found the right marker, excluded the other
 * identity, returned finite distances and converted them to correctly ORDERED
 * scores; overwrite advancing value and version; a scoped delete leaving the
 * other identity intact; `forget()` erasing across the widened scope; and the
 * five unsupported operations refusing by name rather than pretending.
 *
 * The same trial found the one thing that was NOT faithful — `source` and
 * caller `metadata` were accepted and silently dropped — which 9.30.0 fixes by
 * carrying them (see `toMemory`). That fix is tested here and has not itself
 * been re-run in a live project.
 */
export class MemoryBankStore implements MemoryStore {
  /**
   * **No.** `search()` exists here, but it is Memory Bank's own retrieval:
   * Google embeds and ranks on its side, over the `fact` strings this store
   * wrote, and never over an `embedding` handed to `put()`. Embeddings are not
   * stored at all.
   *
   * Declared because a method's presence could not say that — and because the
   * sibling column already paid for the lesson once, with a corpus that
   * indexed, billed, reported success, and was unreachable forever.
   */
  readonly supportsVectorSearch = false;

  /**
   * The query form this store takes: **words, not a vector.** `search()` reads
   * {@link SearchOptions.text} and refuses by name without it. A retriever
   * built over this store therefore needs no `Embedder`, and wiring one would
   * be spend on a vector discarded on arrival.
   */
  readonly ranksBy = 'server-text' as const;

  private readonly memories: MemoriesApi;
  private readonly scope: EngineScope;
  private readonly scopeFor: (identity: MemoryIdentity) => MemoryScope;
  private readonly operationTimeoutMs: number;
  private readonly pageSize: number;
  private readonly defaultTtl: string | undefined;
  private closed = false;

  constructor(options: MemoryBankStoreOptions) {
    this.scope = resolveEngine(ADAPTER, options);
    this.memories = buildAiPlatformClient(
      ADAPTER,
      options,
      this.scope,
    ).projects.locations.reasoningEngines.memories;
    this.scopeFor = options.scopeFor ?? defaultScopeFor;
    this.operationTimeoutMs = options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
    this.pageSize = clampPage(options.pageSize ?? DEFAULT_PAGE_SIZE);
    this.defaultTtl = options.ttl;
  }

  // ── Reads ───────────────────────────────────────────────────────

  /**
   * One memory by id.
   *
   * Two independent things keep this from reading somebody else's memory, and
   * both are deliberate. The **address** carries the scope, so another
   * identity's row for the same entry id is a different resource name that
   * simply is not there. And the **stored scope is re-checked on the way
   * back**, because a resource name addresses a memory directly and a `get`
   * alone would happily read another tenant's row for anyone who could guess a
   * name. A memory whose scope is not this identity's answers `null` — the same
   * `null` a missing one answers, because "exists but not yours" is an oracle
   * for which ids are real.
   */
  async get<T = unknown>(identity: MemoryIdentity, id: string): Promise<MemoryEntry<T> | null> {
    this.ensureOpen('get');
    const wanted = this.resolveScope(identity);
    const memory = await this.fetch(this.nameOf(wanted, id));
    if (memory === undefined) return null;
    if (!sameScope(memory.scope, wanted)) return null;
    const entry = toEntry<T>(memory);
    if (entry === null) return null;
    if (entry.ttl !== undefined && entry.ttl <= Date.now()) return null;
    return entry;
  }

  /**
   * A page of this identity's memories, in no particular order.
   *
   * It rides `retrieve` with `simpleRetrievalParams` rather than `memories.list`
   * — deliberately. `list` filters with AIP-160 over the resource's own fields,
   * and whether that filter language can express an exact scope match is not
   * something this adapter is willing to guess at for the call that decides
   * which memories a caller can see. `retrieve` takes the scope as a structured
   * field with semantics the SDK states outright, so the isolation is the
   * service's rather than a filter string's.
   *
   * `tiers` filtering is applied to what comes back, since a tier is this
   * library's own metadata and not something the service ranks on.
   */
  async list<T = unknown>(
    identity: MemoryIdentity,
    options: ListOptions = {},
  ): Promise<ListResult<T>> {
    this.ensureOpen('list');
    const scope = this.resolveScope(identity);
    const pageSize = clampPage(options.limit ?? this.pageSize);
    let page;
    try {
      page = (
        await this.memories.retrieve({
          parent: this.scope.parent,
          requestBody: {
            scope,
            simpleRetrievalParams: {
              pageSize,
              ...(options.cursor !== undefined && { pageToken: options.cursor }),
            },
          },
        })
      )?.data;
    } catch (err) {
      throw googleSdkFailure(ADAPTER, 'memories.retrieve', err);
    }

    const now = Date.now();
    const entries: MemoryEntry<T>[] = [];
    for (const row of page?.retrievedMemories ?? []) {
      const entry = row.memory === undefined ? null : toEntry<T>(row.memory);
      if (entry === null) continue;
      if (entry.ttl !== undefined && entry.ttl <= now) continue;
      if (options.tiers && (entry.tier === undefined || !options.tiers.includes(entry.tier))) {
        continue;
      }
      entries.push(entry);
    }
    const cursor = page?.nextPageToken;
    return typeof cursor === 'string' && cursor !== '' ? { entries, cursor } : { entries };
  }

  /**
   * Memory Bank's own semantic retrieval — **text in, and the ranking trap
   * handled rather than passed on.**
   *
   * ── It takes WORDS, not the vector ───────────────────────────────────────
   * Google embeds and ranks server-side, so the `query` vector this method is
   * handed cannot be sent anywhere. The query it needs travels in
   * {@link SearchOptions.text}, and omitting it is refused by name — returning
   * `[]` would read as "no matches" when it means "wrong query form".
   *
   * ── The score, and what this adapter refuses to pretend ──────────────────
   * The service reports a **distance**, in its own words "smaller values
   * indicate more similar memories". The port's score is a cosine similarity,
   * where higher is closer. Two things follow, and both are decisions:
   *
   *   • The distance is **converted**, never forwarded: `score = 1 / (1 + d)`,
   *     which is strictly decreasing in `d`, so **the ordering is right** —
   *     the closest memory has the highest score, which is the whole point.
   *     The raw distance is carried on `entry.metadata.distance` so nothing is
   *     hidden and a caller who knows the metric can do better.
   *
   *   • **`minScore` is REFUSED by name**, because that number is calibrated
   *     for a cosine similarity and this scale is not one. Silently applying a
   *     cosine threshold to a converted distance is precisely the failure this
   *     library refuses elsewhere: a number that READS like a similarity, in
   *     the right range, that no threshold and no eyeball can separate from a
   *     real one. The sibling S3 Vectors adapter refuses a non-cosine index
   *     for the same reason; here the metric is Google's and cannot be
   *     changed, so the threshold is what goes rather than the store.
   *
   * ── One more thing the service requires ──────────────────────────────────
   * Similarity search only works if the reasoning engine was configured with a
   * similarity-search config. Without it the service refuses the call, and
   * that refusal is passed through with its status — it is a setup fact, not a
   * bug in the query.
   *
   * @throws when `options.text` is absent, or `options.minScore` is present.
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
        `${ADAPTER}.search() needs the query as TEXT, in \`options.text\`.\n` +
          `  Memory Bank embeds and ranks on Google's side, so the ${query.length}-dimension ` +
          `vector this method was handed cannot be sent anywhere — and returning [] would look ` +
          `like "no matches" rather than "wrong query form".\n` +
          `  Fix:  store.search(identity, vector, { text: theUserQuestion })\n` +
          `  Backends that rank locally ignore \`text\`, so passing both is always safe.`,
      );
    }
    if (options.minScore !== undefined) {
      throw new Error(
        `${ADAPTER}.search() does not accept \`minScore\`.\n` +
          `  This service reports a DISTANCE (smaller is closer), not a cosine similarity ` +
          `(higher is closer). This adapter converts it to 1/(1+distance) so the ORDERING is ` +
          `right, but that scale is not a cosine one and your threshold was calibrated for a ` +
          `cosine — applying it here would silently keep or drop the wrong memories, with a ` +
          `number in the right range that nothing can distinguish from a real score.\n` +
          `  Fix:  drop minScore and use \`k\` to bound the result, or filter yourself on ` +
          `\`entry.metadata.distance\`, which is carried through unmodified.`,
      );
    }

    const scope = this.resolveScope(identity);
    const topK = clampPage(options.k ?? 10);
    let page;
    try {
      page = (
        await this.memories.retrieve({
          parent: this.scope.parent,
          requestBody: { scope, similaritySearchParams: { searchQuery: text, topK } },
        })
      )?.data;
    } catch (err) {
      throw googleSdkFailure(ADAPTER, 'memories.retrieve', err);
    }

    const now = Date.now();
    const scored: ScoredEntry<T>[] = [];
    for (const row of page?.retrievedMemories ?? []) {
      const entry = row.memory === undefined ? null : toEntry<T>(row.memory, row);
      if (entry === null) continue;
      if (entry.ttl !== undefined && entry.ttl <= now) continue;
      // A tier is this library's metadata, not something the service ranks on,
      // so a tier filter is applied to what came back rather than ignored.
      if (options.tiers && (entry.tier === undefined || !options.tiers.includes(entry.tier))) {
        continue;
      }
      scored.push({ entry, score: scoreFromDistance(row.distance) });
    }
    // The service returns its own ranking; re-sort anyway so the port's
    // "descending by score" holds even if a future API version reorders.
    scored.sort((a, b) =>
      b.score !== a.score ? b.score - a.score : a.entry.id < b.entry.id ? -1 : 1,
    );
    return scored.slice(0, topK);
  }

  // ── Writes ──────────────────────────────────────────────────────

  /**
   * Write one memory, waiting for the service to say it landed.
   *
   * ── Read-then-write, and what the read is FOR ────────────────────────────
   * This costs one `get` before the write, and that read is not an
   * optimisation — it is the tenant check. A `patch` names a resource
   * directly and the service does not ask whose it is, so a patch sent
   * without looking is a write this adapter cannot promise landed on its own
   * row. The address already carries the scope (see the module header), so
   * the row under this name is ours in every ordinary run; the read is what
   * turns "ordinary" into "checked", and what makes the one case where it is
   * NOT ours a refusal you can read instead of a fact one tenant wrote into
   * another tenant's memory.
   *
   * What the read finds decides the rest: an existing row of ours is patched,
   * an absent one is created, and a row that is somebody else's is refused by
   * name. The `create` race — two writers, neither of whom saw a row — is
   * caught as `ALREADY EXISTS` and folded back into the same checked patch.
   */
  async put<T = unknown>(identity: MemoryIdentity, entry: MemoryEntry<T>): Promise<void> {
    this.ensureOpen('put');
    if (entry.ttl !== undefined && entry.ttl <= Date.now()) return;
    const scope = this.resolveScope(identity);
    const body = toMemory(entry, scope, this.defaultTtl);
    const resourceId = resourceIdFor(scope, entry.id);
    const name = `${this.scope.parent}/memories/${resourceId}`;

    if (await this.overwrite(name, scope, entry.id, body)) return;

    let created;
    try {
      created = await this.memories.create({
        parent: this.scope.parent,
        memoryId: resourceId,
        requestBody: body,
      });
    } catch (err) {
      if (!isAlreadyExists(err)) throw this.asFailure(err, 'memories.create');
      // Another writer created it between our read and our create. The row
      // exists now, which is all this wanted — so take the same checked patch
      // path rather than reporting a failure for a race that resolved.
      if (await this.overwrite(name, scope, entry.id, body)) return;
      // Created by someone and gone again before we could read it. Nothing
      // this adapter can say landed, so it says so.
      throw this.asFailure(err, 'memories.create');
    }
    await this.wait(created?.data, `creating memory '${entry.id}'`);
  }

  /**
   * Sequential, not batched: the service has no batch-write operation, and
   * each write is a long-running operation that has to be waited on
   * individually. An empty batch is a no-op and costs no round trip, which
   * callers rely on.
   */
  async putMany<T = unknown>(
    identity: MemoryIdentity,
    entries: readonly MemoryEntry<T>[],
  ): Promise<void> {
    this.ensureOpen('putMany');
    for (const entry of entries) await this.put(identity, entry);
  }

  /**
   * Remove one memory.
   *
   * Scope-checked first, for the reason {@link get} spells out: a resource
   * name addresses a row directly, and a delete that skipped the check would
   * let anyone who could guess an id remove another tenant's memory. A memory
   * that is not this identity's is left alone and reported as nothing to do —
   * the same answer a missing one gets.
   */
  async delete(identity: MemoryIdentity, id: string): Promise<void> {
    this.ensureOpen('delete');
    const scope = this.resolveScope(identity);
    const name = this.nameOf(scope, id);
    const existing = await this.fetch(name);
    if (existing === undefined || !sameScope(existing.scope, scope)) return;
    let deleted;
    try {
      deleted = await this.memories.delete({ name });
    } catch (err) {
      if (isNotFound(err)) return;
      throw this.asFailure(err, 'memories.delete');
    }
    await this.wait(deleted?.data, `deleting memory '${id}'`);
  }

  /**
   * GDPR — every memory for this identity, gone.
   *
   * Paginated retrieve-then-delete, and **deliberately not `memories.purge`**,
   * for two reasons that are both about not being silently wrong on the one
   * operation where that matters most:
   *
   *  1. `PurgeMemoriesRequest.force` defaults to **false**, which the service
   *     documents as "the purge request will be validated but not executed".
   *     A forget built on it and written without that flag would report
   *     success and delete nothing — a compliance failure that looks exactly
   *     like a working erasure.
   *  2. Purge selects rows with an AIP-160 filter STRING, and whether that
   *     language can express an exact scope match is not verified. A filter
   *     that under-matches leaves data behind; one that over-matches deletes
   *     somebody else's. Neither is a guess worth making here.
   *
   * The scoped retrieve has semantics the SDK states outright, so that is what
   * this uses. It costs one delete per memory, which is the right price.
   */
  async forget(identity: MemoryIdentity): Promise<void> {
    this.ensureOpen('forget');
    const scope = this.resolveScope(identity);
    let cursor: string | undefined;
    do {
      let page;
      try {
        page = (
          await this.memories.retrieve({
            parent: this.scope.parent,
            requestBody: {
              scope,
              simpleRetrievalParams: {
                pageSize: MAX_PAGE_SIZE,
                ...(cursor !== undefined && { pageToken: cursor }),
              },
            },
          })
        )?.data;
      } catch (err) {
        throw googleSdkFailure(ADAPTER, 'memories.retrieve', err);
      }
      const names = (page?.retrievedMemories ?? [])
        .map((row) => row.memory?.name)
        .filter((name): name is string => typeof name === 'string' && name !== '');
      for (const name of names) {
        let deleted;
        try {
          deleted = await this.memories.delete({ name });
        } catch (err) {
          if (isNotFound(err)) continue;
          throw this.asFailure(err, 'memories.delete');
        }
        await this.wait(deleted?.data, `deleting memory '${name}'`);
      }
      const next = page?.nextPageToken;
      // A page that deleted everything it listed and hands back the same
      // cursor would loop forever. Erasure walks forward or it stops.
      cursor = typeof next === 'string' && next !== '' && next !== cursor ? next : undefined;
    } while (cursor !== undefined);
  }

  // ── The five with no primitive behind them ──────────────────────

  /**
   * @throws always — this service has no compare-and-set.
   * @see the module header for why this refuses where the sibling adapter
   *      emulates.
   */
  putIfVersion<T = unknown>(
    _identity: MemoryIdentity,
    entry: MemoryEntry<T>,
    expectedVersion: number,
  ): Promise<PutIfVersionResult> {
    return Promise.reject(
      unsupported(
        'putIfVersion',
        `A \`Memory\` carries no etag or generation number, so there is nothing to compare ` +
          `against — the write for '${entry.id}' at version ${expectedVersion} cannot be made ` +
          `conditional.\n` +
          `  Emulating it with a read-then-write would report \`{ applied: true }\` to two ` +
          `writers at once, which is a lost update that no log would show. ` +
          `Use put() when you know you are the only writer, or keep memories that need ` +
          `optimistic concurrency in a store that has it (pgVectorStore, RedisStore, ` +
          `sqliteVectorStore).`,
      ),
    );
  }

  /** @throws always — this service has no recognition set. */
  seen(_identity: MemoryIdentity, signature: string): Promise<boolean> {
    return Promise.reject(
      unsupported(
        'seen',
        `There is no dedup primitive here, and answering '${signature}' from a per-process Map ` +
          `would be worse than refusing: this store is one you reach for BECAUSE it is shared ` +
          `across a fleet, and a second container would answer "never seen" for a signature ` +
          `the first one recorded.\n` +
          `  Keep the recognition set in a store that is really shared (RedisStore), or ` +
          `dedup on a deterministic entry id and let put() overwrite.`,
      ),
    );
  }

  /** @throws always — the write side of a recognition set this service does not have. */
  recordSignature(_identity: MemoryIdentity, signature: string): Promise<void> {
    return Promise.reject(
      unsupported(
        'recordSignature',
        `There is nowhere to record '${signature}'. See seen() — the two are one feature and ` +
          `neither is emulated in-process.`,
      ),
    );
  }

  /** @throws always — this service has no feedback primitive. */
  feedback(_identity: MemoryIdentity, id: string, _usefulness: number): Promise<void> {
    return Promise.reject(
      unsupported(
        'feedback',
        `There is no usefulness signal on a \`Memory\`, so feedback for '${id}' has nowhere ` +
          `durable to go. A per-process tally would be lost on the next deploy and invisible ` +
          `to every other container, which is the shape of a metric that quietly stops ` +
          `meaning anything.`,
      ),
    );
  }

  /** @throws always — the read side of feedback this service does not record. */
  getFeedback(
    _identity: MemoryIdentity,
    id: string,
  ): Promise<{ average: number; count: number } | null> {
    return Promise.reject(
      unsupported(
        'getFeedback',
        `Nothing records feedback here, so there is none to read for '${id}'. Answering ` +
          `\`null\` would be indistinguishable from "recorded, but neutral", which callers ` +
          `are documented to treat differently.`,
      ),
    );
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  /**
   * Stop using this store. Idempotent and final. Nothing is torn down on
   * Google's side — the memories outlive this process, which is the point.
   */
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  // ── Internals ───────────────────────────────────────────────────

  /** Where this identity's copy of `id` lives. See the module header. */
  private nameOf(scope: MemoryScope, id: string): string {
    return `${this.scope.parent}/memories/${resourceIdFor(scope, id)}`;
  }

  /** One memory by resource name, or `undefined` when there is none. */
  private async fetch(name: string): Promise<VertexMemory | undefined> {
    try {
      return (await this.memories.get({ name }))?.data;
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw this.asFailure(err, 'memories.get');
    }
  }

  /**
   * Patch the row at `name` if it exists AND is this scope's; answer `false`
   * when there is nothing there to patch.
   *
   * A row that exists under somebody else's scope is REFUSED rather than
   * written. It should be unreachable — the address carries the scope — so
   * reaching it means the fingerprint collided or the bank was written by
   * another tool under a name of ours, and both of those are facts an operator
   * has to be told rather than have resolved in favour of the last writer.
   */
  private async overwrite(
    name: string,
    scope: MemoryScope,
    id: string,
    body: VertexMemory,
  ): Promise<boolean> {
    const existing = await this.fetch(name);
    if (existing === undefined) return false;
    if (!sameScope(existing.scope, scope)) throw foreignMemory(id, name);
    let patched;
    try {
      patched = await this.memories.patch({
        name,
        // `scope` is immutable and deliberately NOT in the mask: including it
        // would make every update a request to change something the service
        // refuses to change.
        updateMask: 'fact,metadata',
        requestBody: { fact: body.fact, metadata: body.metadata },
      });
    } catch (err) {
      // Deleted between the read and the patch. Nothing was overwritten, so
      // the caller falls through to a create — the outcome they asked for.
      if (isNotFound(err)) return false;
      throw this.asFailure(err, 'memories.patch');
    }
    // Awaited OUTSIDE the try: an operation refusal is already sanitized and
    // already says what to do, and re-wrapping would replace a precise
    // diagnosis with a generic one.
    await this.wait(patched?.data, `updating memory '${id}'`);
    return true;
  }

  private ensureOpen(op: string): void {
    if (this.closed) throw new Error(`${ADAPTER}.${op}() called after close().`);
  }

  private wait(operation: Parameters<typeof awaitOperation>[2], what: string): Promise<void> {
    return awaitOperation(
      ADAPTER,
      this.memories.operations,
      operation,
      what,
      this.operationTimeoutMs,
    );
  }

  /** Keep an already-sanitized refusal; sanitize anything else. */
  private asFailure(err: unknown, operation: string): Error {
    if (isSanitizedGoogleError(err)) return err as Error;
    return googleSdkFailure(ADAPTER, operation, err);
  }

  /** The identity's scope, checked for the two values that would break isolation. */
  private resolveScope(identity: MemoryIdentity): MemoryScope {
    const raw = this.scopeFor(identity);
    const entries = Object.entries(raw ?? {}).filter(
      ([key, value]) => typeof value === 'string' && key !== '',
    );
    if (entries.length === 0) {
      throw new TypeError(
        `${ADAPTER}: 'scopeFor' produced an empty scope for conversation ` +
          `'${identity.conversationId}'.\n` +
          `  An empty scope is not "no scoping" — it is a real scope that matches every other ` +
          `empty-scoped memory in the bank, whoever wrote it. Return at least one key.`,
      );
    }
    // The service rejects `*` in a scope value. Replaced rather than passed on,
    // so a tenant named with one is a NAME and not a wildcard.
    return Object.fromEntries(entries.map(([key, value]) => [key, value.replace(/\*/g, '_')]));
  }
}

/**
 * A `MemoryStore` over Vertex AI Memory Bank.
 *
 * @example  Per-person memory that survives a conversation ending
 *   const store = memoryBankStore({
 *     project: 'my-project',
 *     location: 'us-central1',
 *     reasoningEngine: '1234567890',
 *     scopeFor: (id) => ({ tenant: id.tenant ?? '_', principal: id.principal ?? '_' }),
 *   });
 *
 *   const hits = await store.search(identity, [], { text: 'what does she prefer?', k: 5 });
 */
export function memoryBankStore(options: MemoryBankStoreOptions): MemoryBankStore {
  return new MemoryBankStore(options);
}

// ─── Mapping ─────────────────────────────────────────────────────────

/**
 * The resource id one memory is addressed by: **the scope and the entry id,
 * together.**
 *
 * Keyed on the resolved SCOPE rather than on the raw identity, so the two
 * decisions stay one decision: whatever `scopeFor` says two callers share, they
 * share here too, and whatever it keeps apart is kept apart here. A `scopeFor`
 * widened to `{ tenant, principal }` gives one person one row for `fact:tone`
 * across all their conversations — which is the point of widening it — while
 * the default tuple gives them one per conversation.
 *
 * The scope is folded to a fingerprint rather than spelled out: real tenant,
 * principal and conversation ids do not fit in 63 characters together, and the
 * entry id is the half worth being able to read in the console. The `m` prefix
 * is what keeps the composed id starting with a letter, which is what lets an
 * ordinary lowercase entry id survive {@link safeResourceId} unchanged and stay
 * legible.
 */
function resourceIdFor(scope: MemoryScope, id: string): string {
  return safeResourceId(`m${fingerprint(canonicalScope(scope))}-${id}`);
}

/**
 * A scope as one unambiguous string.
 *
 * Keys sorted, so the order `scopeFor` happened to return them in cannot change
 * an address. Every key and value length-prefixed, so no two different scopes
 * can spell themselves the same way — `{ 'a=1,b': '2' }` and
 * `{ a: '1', b: '2' }` would otherwise be the same string, and two different
 * scopes that share an address are the very bug this composer exists to close.
 */
function canonicalScope(scope: MemoryScope): string {
  return Object.keys(scope)
    .sort()
    .map((key) => `${key.length}:${key}=${scope[key]!.length}:${scope[key]!}`)
    .join(',');
}

/** Somebody else's memory is sitting where this identity's would be. */
function foreignMemory(id: string, name: string): Error {
  const err = new Error(
    `${ADAPTER}: refusing to overwrite '${id}' — the memory at '${name}' carries a different ` +
      `scope, so it belongs to another identity.\n` +
      `  A memory's address is composed from the scope AND the entry id, so this should be ` +
      `unreachable. Reaching it means either the scope fingerprint collided, or something ` +
      `other than this library wrote a memory under a name of ours.\n` +
      `  The write is refused rather than applied: the row's scope is immutable, so writing ` +
      `would leave one identity's fact under another identity's scope — readable by them, ` +
      `invisible to you, and missed by forget(). Report the memory id; do not retry.`,
  );
  err.name = 'MemoryScopeConflictError';
  return err;
}

/** The default scope: the full identity tuple, matching every other store. */
function defaultScopeFor(identity: MemoryIdentity): MemoryScope {
  return {
    tenant: identity.tenant || '_',
    principal: identity.principal || '_',
    conversation: identity.conversationId,
  };
}

/**
 * Distance → a score whose ORDER is right.
 *
 * `1 / (1 + d)` is strictly decreasing on `d >= 0`, lands in `(0, 1]`, and is
 * exactly 1 at distance 0. It is **not** a cosine similarity and this adapter
 * never says it is — see {@link MemoryBankStore.search} for why `minScore` is
 * refused rather than measured against it.
 *
 * A row with no distance is a simple retrieval, which does no ranking at all;
 * `0` is the honest score for "this was not ranked", and it sorts last.
 */
export function scoreFromDistance(distance: number | null | undefined): number {
  if (typeof distance !== 'number' || !Number.isFinite(distance)) return 0;
  return 1 / (1 + Math.max(0, distance));
}

/** Do two scopes match the way the service matches them — same keys, same values? */
function sameScope(
  stored: Record<string, string> | null | undefined,
  wanted: MemoryScope,
): boolean {
  if (stored === null || stored === undefined) return false;
  const storedKeys = Object.keys(stored);
  const wantedKeys = Object.keys(wanted);
  if (storedKeys.length !== wantedKeys.length) return false;
  return wantedKeys.every((key) => stored[key] === wanted[key]);
}

/** Clamp a page size or top-k into what the service will actually honour. */
function clampPage(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(value)));
}

const str = (value: string): VertexMemoryMetadataValue => ({ stringValue: value });
const num = (value: number): VertexMemoryMetadataValue => ({ doubleValue: value });

/**
 * `MemoryEntry` → `Memory`.
 *
 * The value becomes the `fact`. A string goes through as itself — this is a
 * natural-language store and a sentence is what it ranks well. Anything else
 * is JSON, flagged so the read side restores the original type, and worth
 * knowing about: a JSON blob IS what gets embedded and ranked, so semantic
 * retrieval over structured values is close to meaningless. Store a sentence
 * when you want it found.
 *
 * ── What is CARRIED, and why it took a field trial ──────────────────────────
 * `source`, the caller's own `metadata` and `decayPolicy` are stored as JSON
 * under prefixed keys of ours and restored verbatim on the way back.
 *
 * They were dropped until 9.30.0, and an independent trial (2026-08-14) is what
 * made that visible: an entry written with `source.turn`, `source.messageId`
 * and `metadata.classification` came back carrying only this adapter's own
 * metadata. That is a contract failure and not merely a gap —
 * `MemorySource.identity` is documented as a field "storage adapters MUST
 * preserve verbatim on every read/write", and the fields feed audit, causal
 * chains, decay and retrieval policy. A store that accepts them, reports
 * success and silently forgets them is the exact shape of wrongness this
 * library refuses everywhere else.
 *
 * `embedding` and `embeddingModel` are the ONE pair still dropped, and that is
 * a refusal rather than an oversight: there is nowhere to put a vector here and
 * nothing that would rank it (see `supportsVectorSearch`), and a stored
 * `embeddingModel` with no vector beside it would claim a compatibility that
 * does not exist.
 */
function toMemory(
  entry: MemoryEntry<unknown>,
  scope: MemoryScope,
  defaultTtl: string | undefined,
): VertexMemory {
  const isString = typeof entry.value === 'string';
  const carried = splitMetadata(entry);
  const metadata: Record<string, VertexMemoryMetadataValue> = {
    [META.id]: str(entry.id),
    [META.version]: num(entry.version),
    [META.createdAt]: num(entry.createdAt),
    [META.updatedAt]: num(entry.updatedAt),
    [META.json]: { boolValue: !isString },
    ...(entry.tier !== undefined && { [META.tier]: str(entry.tier) }),
    ...(entry.source !== undefined && {
      [META.source]: str(carriedJson(entry.source, 'source', entry.id)),
    }),
    ...(carried !== undefined && {
      [META.meta]: str(carriedJson(carried, 'metadata', entry.id)),
    }),
    ...(entry.decayPolicy !== undefined && {
      [META.decay]: str(carriedJson(entry.decayPolicy, 'decayPolicy', entry.id)),
    }),
  };
  return {
    fact: isString ? (entry.value as string) : JSON.stringify(entry.value ?? null),
    scope: { ...scope },
    metadata,
    // An entry's own `ttl` is a unix TIMESTAMP; the service takes a DURATION.
    // Converted here rather than at the call site so both spellings of "how
    // long does this live" resolve in one place.
    ...(entry.ttl !== undefined
      ? { ttl: `${Math.max(1, Math.round((entry.ttl - Date.now()) / 1000))}s` }
      : defaultTtl !== undefined && { ttl: defaultTtl }),
  };
}

/**
 * The caller's own metadata, with this adapter's generated keys separated out
 * — or `undefined` when there is none to carry.
 *
 * The three keys in {@link GENERATED_METADATA} are produced on every read, so
 * an entry that came out of this store carries them and a `get`-then-`put`
 * round trip hands them straight back. Two cases, told apart rather than
 * conflated:
 *
 *  • **It is one of ours coming home** — recognised by IDENTITY, not by shape.
 *    See {@link isGeneratedValue}.
 *  • **It is the caller's own value** under one of those names — refused by
 *    name. Storing it would mean the next read silently answered with our
 *    value instead of theirs, which is the failure mode this whole function
 *    exists to end.
 */
function splitMetadata(entry: MemoryEntry<unknown>): Record<string, unknown> | undefined {
  const metadata = entry.metadata;
  if (metadata === undefined || metadata === null) return undefined;
  // `toEntry` stamps `source` on EVERY read, so its presence — with exactly the
  // backend name this store writes — is what distinguishes an entry coming home
  // from a caller who happened to pick one of our key names. Computed once for
  // the whole bag, because it is a fact about the ENTRY, not about a key.
  const ours = (metadata as Record<string, unknown>)['source'] === BACKEND_NAME;
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!(GENERATED_METADATA as readonly string[]).includes(key)) {
      kept[key] = value;
      continue;
    }
    if (isGeneratedValue(key, value, ours)) continue;
    throw metadataKeyConflict(entry.id, key, value, ours);
  }
  return Object.keys(kept).length === 0 ? undefined : kept;
}

/**
 * Is this the value THIS adapter put under that key on a read — or the caller's
 * own, wearing one of our names?
 *
 * **Recognition is by identity, not by shape**, and the difference is a bug this
 * adapter shipped once. A shape test asks "is `resourceName` a string, is
 * `distance` a number?" — which every string and every number passes, so a
 * caller's `metadata.resourceName = 'sku-42'` or `metadata.distance = 12` was
 * accepted as ours, dropped, and answered on the next read with THIS adapter's
 * resourceName sitting where their value had been. That is precisely the
 * accepted-and-silently-wrong failure {@link metadataKeyConflict} exists to
 * refuse, and a shape test could not tell the two apart even in principle
 * (finding 29, 2026-08-14 field trial).
 *
 * So the test is: `source` must be exactly {@link BACKEND_NAME} — the stamp
 * `toEntry` writes on every read and nothing else does — and `resourceName` /
 * `distance` count as ours only when that stamp RIDES WITH THEM on the same
 * entry, and the value itself still has the right shape (a Vertex resource name;
 * a number). Both halves are needed: the stamp says "this entry came from here",
 * the shape says "and this field was not overwritten since".
 *
 * The one ambiguity left is honest and narrow: a caller who takes an entry out
 * of this store and writes their OWN number into `metadata.distance` before
 * putting it back is indistinguishable from the retrieval distance that came
 * with it, and is dropped. Keep such a value under a name of your own.
 */
function isGeneratedValue(key: string, value: unknown, ours: boolean): boolean {
  if (key === 'source') return value === BACKEND_NAME;
  if (!ours) return false;
  if (key === 'resourceName') return typeof value === 'string' && RESOURCE_NAME.test(value);
  return typeof value === 'number';
}

/**
 * A caller's metadata key collides with one this adapter generates on every read.
 *
 * `ours` says whether the entry carried this store's own `source` stamp, which
 * decides WHICH of the two things went wrong — a name collision, or a value
 * edited into a round-tripped entry — and therefore what the reader should do.
 */
function metadataKeyConflict(id: string, key: string, value: unknown, ours: boolean): Error {
  const err = new Error(
    // The caller's own value, echoed back short: enough to recognise which
    // field this is, never enough to paste a whole payload into a log line
    // that an error reaches more sinks than the writer expects.
    `${ADAPTER}: entry '${id}' carries metadata.${key} = ${shortly(value)}, and this ` +
      `adapter GENERATES metadata.${key} on every read.\n` +
      `  Storing it would mean your value went in and this adapter's came back — a read that ` +
      `looks right and is not. The three generated keys are: ` +
      `${GENERATED_METADATA.join(', ')} (the backend name, the Vertex resource name, and the ` +
      `raw retrieval distance).\n` +
      (ours
        ? `  This entry does carry this store's own metadata.source = '${BACKEND_NAME}', so it ` +
          `came from here — but this particular value is not the one this adapter wrote ` +
          `(a resourceName must look like 'projects/…/memories/<id>'; a distance must be a ` +
          `number). It is refused rather than dropped, because dropping a value somebody ` +
          `deliberately set is the same silent wrongness in the other direction.\n`
        : '') +
      `  Fix: rename the key on your entry. Values this store itself produced are recognised ` +
      `and dropped instead, so reading an entry and writing it back is always safe.`,
  );
  err.name = 'MemoryMetadataConflictError';
  return err;
}

/** A value as at most 80 characters of JSON, for a refusal to point with. */
function shortly(value: unknown): string {
  const json = JSON.stringify(value) ?? String(value);
  return json.length <= 80 ? json : `${json.slice(0, 77)}…`;
}

/** One carried field as JSON, or a refusal that says which field and how big. */
function carriedJson(value: unknown, field: string, id: string): string {
  const json = JSON.stringify(value ?? null);
  if (json.length <= MAX_CARRIED_JSON) return json;
  throw new RangeError(
    `${ADAPTER}: entry '${id}' has a '${field}' of ${json.length} JSON characters, over this ` +
      `adapter's ${MAX_CARRIED_JSON}-character bound for a carried field.\n` +
      `  Memory Bank stores these as metadata STRINGS, and the service's own ceiling on one is ` +
      `not measured by this library — so the bound is ours and deliberately conservative.\n` +
      `  It refuses rather than truncating: provenance that came back shortened would be ` +
      `provenance nothing could tell was shortened. Keep large payloads in the entry VALUE, ` +
      `which becomes the memory's fact.`,
  );
}

/** What this adapter names itself as the backend, in a returned entry's metadata. */
const BACKEND_NAME = 'vertex-memory-bank';

/**
 * `Memory` → `MemoryEntry`, or `null` for a row this store did not write.
 *
 * Memory Bank generates memories of its own (that is a headline feature), and
 * those carry a `fact` and no metadata of ours. They are not entries and are
 * skipped rather than dressed up as ones with invented ids and versions — the
 * ids would belong to Google, `store.get()` on them would work by accident,
 * and a caller could not tell which of their "memories" they had ever written.
 */
function toEntry<T>(
  memory: VertexMemory,
  retrieved?: VertexRetrievedMemory,
): MemoryEntry<T> | null {
  const metadata = memory.metadata ?? {};
  const id = metadata[META.id]?.stringValue;
  if (typeof id !== 'string' || id === '') return null;

  const fact = typeof memory.fact === 'string' ? memory.fact : '';
  const isJson = metadata[META.json]?.boolValue === true;
  let value: unknown = fact;
  if (isJson) {
    try {
      value = JSON.parse(fact);
    } catch {
      // Written as JSON, came back as something else. The bytes are handed
      // through as text rather than dropped: a memory that exists must not
      // read as one that was never written.
      value = fact;
    }
  }

  const createdAt = metadata[META.createdAt]?.doubleValue ?? toMillis(memory.createTime);
  const updatedAt = metadata[META.updatedAt]?.doubleValue ?? toMillis(memory.updateTime);
  const tier = metadata[META.tier]?.stringValue;
  const expireTime = toMillis(memory.expireTime);
  const source = carriedBack<MemoryEntry<T>['source']>(metadata[META.source]?.stringValue);
  const callerMetadata = carriedBack<Record<string, unknown>>(metadata[META.meta]?.stringValue);
  const decayPolicy = carriedBack<MemoryEntry<T>['decayPolicy']>(metadata[META.decay]?.stringValue);

  return {
    id,
    value: value as T,
    version: metadata[META.version]?.doubleValue ?? 1,
    createdAt,
    updatedAt,
    lastAccessedAt: Date.now(),
    accessCount: 0,
    ...(expireTime > 0 && { ttl: expireTime }),
    ...(tier === 'hot' || tier === 'warm' || tier === 'cold' ? { tier } : {}),
    ...(source !== undefined && { source }),
    ...(decayPolicy !== undefined && { decayPolicy }),
    metadata: {
      // The caller's own metadata first, then this adapter's generated facts.
      // They cannot collide: a caller value under a generated key is refused at
      // write time rather than overwritten here (see splitMetadata).
      ...callerMetadata,
      source: BACKEND_NAME,
      ...(memory.name !== null && memory.name !== undefined && { resourceName: memory.name }),
      // The raw distance, carried through unmodified — the honest number
      // beside the converted one, for a caller who knows the metric.
      ...(typeof retrieved?.distance === 'number' && { distance: retrieved.distance }),
    },
  };
}

/**
 * One carried JSON field on the way back, or `undefined`.
 *
 * Unparseable JSON answers `undefined` rather than raising: the bytes were
 * written by an older release of this adapter or edited in the console, and a
 * memory that EXISTS must not read as one that was never written over a
 * damaged provenance field. The entry's own value is unaffected.
 */
function carriedBack<T>(json: string | null | undefined): T | undefined {
  if (typeof json !== 'string' || json === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed === null ? undefined : (parsed as T);
  } catch {
    return undefined;
  }
}

/** An RFC 3339 timestamp as unix milliseconds, or 0 when it is not one. */
function toMillis(value: string | null | undefined): number {
  if (typeof value !== 'string') return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** One refusal shape for the five operations this service has no primitive for. */
function unsupported(operation: string, why: string): Error {
  const err = new Error(
    `${ADAPTER}.${operation}() is not supported by Vertex AI Memory Bank.\n  ${why}`,
  );
  err.name = 'MemoryOperationUnsupportedError';
  return err;
}
