/**
 * adapters/memory/s3Vectors — the corpus outlives the runtime, and can still
 * be updated without one.
 *
 * `sqliteVectorStore` (8.9.0) made a corpus survive a restart by putting it in
 * a file, and `staticVectorStore` (8.20.0) made it survive a runtime with no
 * disk at all by shipping it as a build artifact. Both leave the same gap, and
 * a production field report named it: **a bundle can only change when you
 * redeploy.** Add three documents on a Tuesday and the answer arrives with the
 * next release train. That is a fine trade for product documentation and a bad
 * one for anything a human edits during the day.
 *
 * Amazon S3 Vectors closes it. It is object storage with a native vector index
 * and a query API: durable, serverless, nothing to run, priced like storage
 * rather than like a database cluster. This adapter is the `MemoryStore` port
 * over it, and the two halves that matter are:
 *
 *   - `search()` maps 1:1 onto **QueryVectors** — the vector goes as
 *     `queryVector.float32`, `k` becomes `topK`, tiers become a metadata
 *     `filter`, and the returned `distance` becomes the port's score.
 *   - `put()` / `putMany()` map onto **PutVectors** — so `indexCorpus`,
 *     `indexFolder` and `indexDocuments` run against it unchanged. **That is
 *     the point of writing it rather than only reading it:** a corpus you can
 *     add to from a cron job at 14:00 is a different product from one you can
 *     add to at the next deploy.
 *
 * ── What it is NOT ──────────────────────────────────────────────────────────
 * A vector index is not a key-value store, and this adapter refuses the
 * operations that would need one rather than faking them:
 *
 *   - `putIfVersion` — PutVectors is last-write-wins; there is no
 *     compare-and-set. A read-then-write here would be a compare-and-set that
 *     another writer can walk through the middle of, which is worse than none.
 *   - `recordSignature` / `feedback` — a set of strings and a running average
 *     are not vectors. `seen()` answers `false` and `getFeedback()` `null`,
 *     which are both TRUE (nothing can be recorded, so nothing has been); the
 *     WRITE halves refuse by name.
 *
 * Pair it with a second store for conversation memory — `defineRAG` for the
 * corpus, `defineMemory` for the chat, each with the backend it suits. That is
 * the same shape `staticVectorStore` documents.
 *
 * ── The index you must create first, and why this does not create it ────────
 * A vector index has a DIMENSION and a DISTANCE METRIC fixed at creation, and
 * both are decisions about your embedder that this library must not make on
 * your behalf — creating one silently would pick a size and a metric your
 * corpus then lives with. Create it once, with your infrastructure:
 *
 * ```bash
 * aws s3vectors create-vector-bucket --vector-bucket-name my-corpus
 * aws s3vectors create-index \
 *   --vector-bucket-name my-corpus \
 *   --index-name docs \
 *   --data-type float32 \
 *   --dimension 1024 \
 *   --distance-metric cosine \
 *   --metadata-configuration '{"nonFilterableMetadataKeys":["af"]}'
 * ```
 *
 * `nonFilterableMetadataKeys: ["af"]` is load-bearing, not decoration. This
 * adapter stores the whole entry — the passage the model will read, its
 * provenance, its timestamps — as JSON under the metadata key `af`. Filterable
 * metadata has a small per-vector budget; non-filterable metadata has the large
 * one. Declare `af` non-filterable and a full passage fits; leave it filterable
 * and PutVectors starts refusing your longer chunks partway through an
 * indexing run.
 *
 * Only `ns` (the identity namespace) and `tier` are ever filtered on, and both
 * are short strings.
 *
 * ── Cosine only, said out loud ──────────────────────────────────────────────
 * The port's score is a cosine similarity, and every threshold in this library
 * — starting with `defineRAG`'s 0.7 default — is calibrated on that range. A
 * cosine distance converts exactly (`score = 1 - distance`). A EUCLIDEAN
 * distance does not: any mapping into [-1, 1] produces a number that READS like
 * a cosine and is not one, which is the same class of confident-and-meaningless
 * value the embedder-mismatch refusal exists to stop. So a euclidean index is
 * refused at construction, by name.
 *
 * ── The fingerprint guarantee, stated exactly ───────────────────────────────
 * `sqliteVectorStore` owns its file and can keep a fingerprint row in it. This
 * store owns nothing but vectors, so the guarantee is assembled from what the
 * service actually provides, and it is smaller — so it is spelled out rather
 * than implied:
 *
 *   - **Dimensions** are enforced by S3 Vectors itself. The index declares one;
 *     a vector of another length is rejected by the service, loudly, at the
 *     call. Nothing here can be sloppier than that.
 *   - **The model id** is stamped into every vector's metadata (`fp`) and
 *     checked in two places: against the fingerprint this process has already
 *     seen for the namespace (at write and at search), and against the
 *     fingerprint carried by the HITS that come back (at search). The second
 *     one is what survives a restart: the first query after an embedder swap
 *     sees documents stamped by the old embedder and refuses by name, instead
 *     of returning a confident ranking of two incompatible spaces.
 *   - What is NOT caught: the first WRITE of a fresh process into a namespace
 *     another embedder built. There is no cheap read that would catch it, and a
 *     full index scan on every boot is not one either. It is caught at the next
 *     search, before a single wrong answer is returned.
 *
 * ── Lazy peer dependency ────────────────────────────────────────────────────
 * `@aws-sdk/client-s3vectors` is an OPTIONAL peer dependency, required at
 * construction time. Importing `agentfootprint/memory` costs nothing for
 * consumers who never build one of these. Pass `client` to share the SDK
 * configuration your app already has.
 */

import { identityNamespace } from '../../memory/identity/index.js';
import { lazyRequire } from '../../lib/lazyRequire.js';
import {
  EmbedderMismatchError,
  fingerprintConflict,
  fingerprintText,
  parseFingerprint,
  type Fingerprint,
} from '../../lib/embedderMismatch.js';
import type { MemoryIdentity } from '../../memory/identity/index.js';
import type { MemoryEntry } from '../../memory/entry/index.js';
import type {
  ListOptions,
  ListResult,
  MemoryStore,
  PutIfVersionResult,
  ScoredEntry,
  SearchOptions,
} from '../../memory/store/types.js';

// ─── The little bit of the SDK this adapter uses ─────────────────────

/**
 * The slice of an S3 Vectors client this adapter calls.
 *
 * Structural, so the real SDK client, a pre-built one shared with the rest of
 * your app, or a test double all satisfy it without this package taking a hard
 * type dependency on the optional peer.
 */
export interface S3VectorsLikeClient {
  /** `send(command, options?)` — the second argument carries `abortSignal`. */
  send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
  /** Optional — released by {@link S3VectorsStore.close} when this store built the client. */
  destroy?(): void;
}

/** The constructors this adapter needs out of `@aws-sdk/client-s3vectors`. */
export interface S3VectorsSdkModule {
  readonly S3VectorsClient?: new (config: { region?: string }) => S3VectorsLikeClient;
  readonly PutVectorsCommand?: new (input: unknown) => unknown;
  readonly QueryVectorsCommand?: new (input: unknown) => unknown;
  readonly GetVectorsCommand?: new (input: unknown) => unknown;
  readonly ListVectorsCommand?: new (input: unknown) => unknown;
  readonly DeleteVectorsCommand?: new (input: unknown) => unknown;
}

// ─── Options ─────────────────────────────────────────────────────────

export interface S3VectorsStoreOptions {
  /** The vector bucket (`vectorBucketName`). Created by you, not by this. */
  readonly bucket: string;
  /** The vector index inside it (`indexName`). Created by you, not by this. */
  readonly index: string;
  /** AWS region. Passed to the SDK client when this factory builds one. */
  readonly region?: string;
  /**
   * The metric the index was created with. Only `'cosine'` is supported, and
   * anything else is refused at construction — see the header. This is a
   * DECLARATION about an index this store did not create; state the metric you
   * actually used.
   */
  readonly distanceMetric?: 'cosine';
  /**
   * How many vectors go in one PutVectors call. Default 100 — deliberately
   * well under the service limit, because the failure mode of guessing that
   * limit high is a corpus that indexes 90% of the way and stops.
   */
  readonly batchSize?: number;
  /** A pre-built S3 Vectors client, so one SDK config serves the whole app. */
  readonly client?: S3VectorsLikeClient;
  /** @internal Test injection — skips the SDK require entirely. */
  readonly _client?: S3VectorsLikeClient;
  /** @internal Test injection — the AWS SDK module (exercises the real shim with a mock SDK). */
  readonly _sdk?: S3VectorsSdkModule;
}

/** A durable vector index in S3, plus the two things this store owns beyond the port. */
export interface S3VectorsStore extends MemoryStore {
  /** The vector bucket this store reads and writes. */
  readonly bucket: string;
  /** The vector index inside it. */
  readonly index: string;
  /**
   * The embedder fingerprint (`'<id>@<dims>'`) this PROCESS has seen for a
   * namespace, or `undefined` when it has seen none yet.
   *
   * Deliberately not "the fingerprint the index was built with" — see the
   * header for exactly what this store can and cannot know. It is populated by
   * the first write or the first search of the namespace in this process.
   */
  fingerprintOf(identity: MemoryIdentity): string | undefined;
  /**
   * Release the SDK client, if this store built one. Idempotent. A client you
   * passed in is yours and is left alone.
   */
  close(): void;
}

// ─── Metadata layout ─────────────────────────────────────────────────

/** The identity namespace, filtered on at query time. Short, so filterable. */
const NS_KEY = 'ns';
/** The tier, filtered on when the caller asks for one. Short, so filterable. */
const TIER_KEY = 'tier';
/** The embedder fingerprint, `'<id>@<dims>'`. Short, so filterable. */
const FP_KEY = 'fp';
/**
 * Everything else — the passage, provenance, versions, timestamps — as one
 * JSON string. Declared NON-filterable at index creation so it gets the large
 * metadata budget; see the header.
 */
const PAYLOAD_KEY = 'af';

/**
 * Open a `MemoryStore` over an existing S3 Vectors index.
 *
 * @throws when `@aws-sdk/client-s3vectors` is absent and no `client` was passed.
 * @throws when `distanceMetric` is anything but `'cosine'`.
 * @throws EmbedderMismatchError from `put`/`putMany`/`search` when a vector
 *         meets a namespace built by a different embedder.
 *
 * @example  A corpus you can add to without a redeploy
 * ```ts
 * import { defineRAG, indexDocuments } from 'agentfootprint';
 * import { s3VectorsStore } from 'agentfootprint/memory';
 * import { bedrockEmbedder } from 'agentfootprint/providers';
 *
 * const store = s3VectorsStore({ bucket: 'my-corpus', index: 'docs', region: 'us-east-1' });
 * const embedder = bedrockEmbedder({ region: 'us-east-1' });
 *
 * // Run this from a cron job. No deploy, no restart — the agent sees it next turn.
 * await indexDocuments(store, embedder, newDocs, { embedderId: embedder.id });
 *
 * const agent = Agent.create({ provider })
 *   .rag(defineRAG({ id: 'docs', store, embedder, embedderId: embedder.id }))
 *   .build();
 * ```
 */
export function s3VectorsStore(options: S3VectorsStoreOptions): S3VectorsStore {
  const { bucket, index } = options;
  if (!bucket || bucket.trim() === '' || !index || index.trim() === '') {
    throw new TypeError(
      `s3VectorsStore: both \`bucket\` and \`index\` are required and must be non-empty — ` +
        `received bucket='${String(bucket)}', index='${String(index)}'. This store never ` +
        `creates either: an index's dimension and distance metric are decisions about your ` +
        `embedder, and picking them for you would be picking them forever.`,
    );
  }
  const metric = options.distanceMetric ?? 'cosine';
  if (metric !== 'cosine') {
    throw new TypeError(
      `s3VectorsStore: distanceMetric '${String(metric)}' is not supported — this store ` +
        `reports COSINE similarity, and every threshold in this library (starting with ` +
        `defineRAG's 0.7 default) is calibrated on that range.\n` +
        `  A cosine distance converts exactly (score = 1 - distance). A euclidean one does ` +
        `not: mapping it into [-1, 1] would produce a number that reads like a cosine and ` +
        `is not one, which no threshold can separate from a real score.\n` +
        `  Fix:  create the index with --distance-metric cosine, or rank euclidean results ` +
        `in your own adapter where the units are yours to interpret.`,
    );
  }
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? 100));

  type Connection = {
    readonly client: S3VectorsLikeClient;
    readonly Put: new (input: unknown) => unknown;
    readonly Query: new (input: unknown) => unknown;
    readonly Get: new (input: unknown) => unknown;
    readonly List: new (input: unknown) => unknown;
    readonly Delete: new (input: unknown) => unknown;
    readonly owned: boolean;
  };
  let connection: Connection | undefined;

  /**
   * Resolve the client + command constructors, once, on first call.
   *
   * Three ways in, and the first is what keeps the tests free of AWS:
   *   `_client` — test injection. The SDK is never required, and each command
   *               is a plain object stamped with its own name, so a double
   *               sees exactly which call was made and with what.
   *   `client`  — your own pre-built client; config and credentials stay yours.
   *   neither   — this factory builds one from `region`.
   */
  const connect = (): Connection => {
    if (connection) return connection;
    if (options._client) {
      const sdk = options._sdk;
      connection = {
        client: options._client,
        Put: sdk?.PutVectorsCommand ?? shimCommand('PutVectors'),
        Query: sdk?.QueryVectorsCommand ?? shimCommand('QueryVectors'),
        Get: sdk?.GetVectorsCommand ?? shimCommand('GetVectors'),
        List: sdk?.ListVectorsCommand ?? shimCommand('ListVectors'),
        Delete: sdk?.DeleteVectorsCommand ?? shimCommand('DeleteVectors'),
        owned: false,
      };
      return connection;
    }
    const sdk = options._sdk ?? loadS3VectorsSdk();
    const missing = (
      [
        'PutVectorsCommand',
        'QueryVectorsCommand',
        'GetVectorsCommand',
        'ListVectorsCommand',
        'DeleteVectorsCommand',
      ] as const
    ).filter((name) => typeof sdk[name] !== 'function');
    if (missing.length > 0) {
      throw new Error(
        `s3VectorsStore: \`@aws-sdk/client-s3vectors\` is installed but ${missing.join(', ')} ` +
          `${missing.length === 1 ? 'was' : 'were'} not found. Update the SDK.`,
      );
    }
    if (!options.client && typeof sdk.S3VectorsClient !== 'function') {
      throw new Error(
        's3VectorsStore: `@aws-sdk/client-s3vectors` is installed but `S3VectorsClient` was ' +
          'not found. Update the SDK, or pass `client` with a pre-built one.',
      );
    }
    const owned = !options.client;
    connection = {
      client:
        options.client ??
        // Checked directly above.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        new sdk.S3VectorsClient!({ ...(options.region && { region: options.region }) }),
      // All five checked directly above.
      /* eslint-disable @typescript-eslint/no-non-null-assertion */
      Put: sdk.PutVectorsCommand!,
      Query: sdk.QueryVectorsCommand!,
      Get: sdk.GetVectorsCommand!,
      List: sdk.ListVectorsCommand!,
      Delete: sdk.DeleteVectorsCommand!,
      /* eslint-enable @typescript-eslint/no-non-null-assertion */
      owned,
    };
    return connection;
  };

  const call = async (
    build: (conn: Connection) => unknown,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    const conn = connect();
    const command = build(conn);
    return signal ? conn.client.send(command, { abortSignal: signal }) : conn.client.send(command);
  };

  const scope = { vectorBucketName: bucket, indexName: index };

  /** Fingerprints this process has seen, one per namespace. */
  const fingerprints = new Map<string, string>();

  let closed = false;
  const open = (verb: string): void => {
    if (closed) {
      throw new Error(
        `[memory] the s3VectorsStore for '${bucket}/${index}' is closed, so it cannot ` +
          `${verb}. close() is final by design — reopening the client behind you would hide ` +
          `a shutdown-ordering bug rather than surface it. Build a new store if you need one ` +
          `after closing this.`,
      );
    }
  };

  /**
   * Compare an arriving fingerprint against the one this process holds, refuse
   * a real conflict, and adopt the arriving one when it is the first or the
   * more specific of the two. The same rule `sqliteVectorStore` applies — over
   * a smaller record, which the header states precisely.
   */
  const reconcile = (ns: string, incoming: Fingerprint, operation: 'write to' | 'search'): void => {
    const storedText = fingerprints.get(ns);
    if (storedText === undefined) {
      fingerprints.set(ns, fingerprintText(incoming));
      return;
    }
    const conflict = fingerprintConflict(parseFingerprint(storedText), incoming);
    if (conflict !== null) {
      throw new EmbedderMismatchError(
        ns,
        storedText,
        fingerprintText(incoming),
        conflict,
        operation,
        'point this store at a different index',
      );
    }
    if (parseFingerprint(storedText).id === undefined && incoming.id !== undefined) {
      fingerprints.set(ns, fingerprintText(incoming));
    }
  };

  const store: S3VectorsStore = {
    bucket,
    index,

    // Vectors in, ranked vectors out — QueryVectors ranks the embeddings this
    // store was handed, so the corpus builders may write into it.
    supportsVectorSearch: true,
    ranksBy: 'vector',

    fingerprintOf(identity: MemoryIdentity): string | undefined {
      return fingerprints.get(identityNamespace(identity));
    },

    async get<T = unknown>(identity: MemoryIdentity, id: string): Promise<MemoryEntry<T> | null> {
      open('read an entry');
      const ns = identityNamespace(identity);
      const out = (await call((c) => new c.Get({ ...scope, keys: [vectorKey(ns, id)] }))) as
        | { vectors?: RawVector[] }
        | undefined;
      const row = out?.vectors?.[0];
      if (!row) return null;
      const entry = vectorToEntry<T>(row);
      // Expired reads as absent, the same as every other store. No access
      // counters: S3 Vectors has no in-place metadata update, so bumping one
      // would mean rewriting the vector on every read.
      if (!entry || isExpired(entry.ttl)) return null;
      return entry;
    },

    async put<T = unknown>(identity: MemoryIdentity, entry: MemoryEntry<T>): Promise<void> {
      await this.putMany(identity, [entry]);
    },

    async putMany<T = unknown>(
      identity: MemoryIdentity,
      entries: readonly MemoryEntry<T>[],
    ): Promise<void> {
      open('write entries');
      // The port requires an empty batch to be a no-op — callers rely on it to
      // skip a round-trip on a turn that produced nothing.
      if (entries.length === 0) return;
      const ns = identityNamespace(identity);

      const vectors = entries.map((entry) => {
        const embedding = entry.embedding;
        if (!embedding || embedding.length === 0) {
          throw new Error(
            `s3VectorsStore.putMany: entry '${entry.id}' carries no \`embedding\`, and a vector ` +
              `index has nowhere to put an entry without one.\n` +
              `  Every write here must arrive already embedded — which is what indexDocuments, ` +
              `indexCorpus and indexFolder do. A conversation-memory pipeline over an ` +
              `un-embedded turn belongs in a store built for key-value writes (RedisStore, ` +
              `AgentCoreStore), registered separately with defineMemory.`,
          );
        }
        const fp: Fingerprint = {
          ...(entry.embeddingModel !== undefined && { id: entry.embeddingModel }),
          dims: embedding.length,
        };
        reconcile(ns, fp, 'write to');
        return {
          key: vectorKey(ns, entry.id),
          data: { float32: [...embedding] },
          metadata: {
            [NS_KEY]: ns,
            ...(entry.tier !== undefined && { [TIER_KEY]: entry.tier }),
            [FP_KEY]: fingerprintText(fp),
            [PAYLOAD_KEY]: JSON.stringify(payloadOf(entry)),
          },
        };
      });

      // Chunked well under the service limit. PutVectors is not transactional
      // across chunks and this does not pretend otherwise: a failure part-way
      // throws with the chunks before it already written, which is exactly what
      // the port says about batches. The corpus builders are id-deterministic,
      // so re-running the same index call converges.
      for (let i = 0; i < vectors.length; i += batchSize) {
        const chunk = vectors.slice(i, i + batchSize);
        await call((c) => new c.Put({ ...scope, vectors: chunk }));
      }
    },

    async putIfVersion(): Promise<PutIfVersionResult> {
      return refuse(
        'putIfVersion',
        'PutVectors is last-write-wins; S3 Vectors has no compare-and-set',
        'a read-then-write here would be a compare-and-set another writer can walk through ' +
          'the middle of, which is worse than not offering one',
        'use put()/putMany() when you are the only writer, or keep the version-critical ' +
          'entries in a store with real conditional writes (RedisStore) and the corpus here',
      );
    },

    async list<T = unknown>(
      identity: MemoryIdentity,
      listOptions?: ListOptions,
    ): Promise<ListResult<T>> {
      open('list entries');
      const ns = identityNamespace(identity);
      const prefix = `${ns}#`;
      const limit = Math.max(1, Math.floor(listOptions?.limit ?? 100));
      const tierFilter = listOptions?.tiers ? new Set(listOptions.tiers) : undefined;

      const page: MemoryEntry<T>[] = [];
      // ListVectors has no key-prefix filter, so a namespace is selected HERE,
      // over pages of the whole index. That is honest but not free: on an index
      // holding many namespaces this reads more than it returns. One index per
      // corpus is the shape this store is for, and `search()` — the hot path —
      // filters server-side on `ns` and never does this.
      let token: string | undefined = listOptions?.cursor;
      do {
        const out = (await call(
          (c) =>
            new c.List({
              ...scope,
              maxResults: Math.min(500, Math.max(limit, 100)),
              returnMetadata: true,
              returnData: true,
              ...(token !== undefined && { nextToken: token }),
            }),
        )) as { vectors?: RawVector[]; nextToken?: string } | undefined;
        token = out?.nextToken;
        for (const row of out?.vectors ?? []) {
          if (typeof row.key !== 'string' || !row.key.startsWith(prefix)) continue;
          const entry = vectorToEntry<T>(row);
          if (!entry || isExpired(entry.ttl)) continue;
          if (tierFilter && (entry.tier === undefined || !tierFilter.has(entry.tier))) continue;
          page.push(entry);
          if (page.length === limit) break;
        }
      } while (page.length < limit && token !== undefined);

      // The cursor is the service's own continuation token, so a caller pages
      // through the INDEX rather than through our filtered view — which is why
      // it is only returned when the service says there is more.
      return { entries: page, ...(token !== undefined && { cursor: token }) };
    },

    async delete(identity: MemoryIdentity, id: string): Promise<void> {
      open('delete an entry');
      const ns = identityNamespace(identity);
      await call((c) => new c.Delete({ ...scope, keys: [vectorKey(ns, id)] }));
    },

    async seen(): Promise<boolean> {
      // TRUE, not a stub: nothing can be recorded here (see `recordSignature`),
      // so nothing has been.
      return false;
    },

    async recordSignature(): Promise<void> {
      return refuse(
        'recordSignature',
        'a recognition set is a set of strings, and this index stores vectors',
        'accepting the signature and dropping it would make seen() answer false forever ' +
          'while looking like a working dedup',
        'give the write pipeline a store with a set primitive (RedisStore) and keep the ' +
          'corpus here — a corpus registered through defineRAG is read-only and never ' +
          'records signatures at all',
      );
    },

    async feedback(): Promise<void> {
      return refuse(
        'feedback',
        'a running usefulness average needs a read-modify-write this index cannot do',
        'silently dropping the signal would leave getFeedback() answering null forever ' +
          'while the calls that fed it looked successful',
        'record usefulness in a store built for counters (RedisStore), or collect it in ' +
          'your own telemetry from the agentfootprint.memory.retrieved events',
      );
    },

    async getFeedback(): Promise<{ average: number; count: number } | null> {
      // TRUE, not a stub: no feedback can be recorded here, so none has been.
      return null;
    },

    async forget(identity: MemoryIdentity): Promise<void> {
      open('forget a namespace');
      const ns = identityNamespace(identity);
      const prefix = `${ns}#`;
      let token: string | undefined;
      do {
        const out = (await call(
          (c) =>
            new c.List({
              ...scope,
              maxResults: 500,
              ...(token !== undefined && { nextToken: token }),
            }),
        )) as { vectors?: RawVector[]; nextToken?: string } | undefined;
        token = out?.nextToken;
        const keys = (out?.vectors ?? [])
          .map((v) => v.key)
          .filter((k): k is string => typeof k === 'string' && k.startsWith(prefix));
        // Deleted page by page rather than collected and deleted at the end: a
        // GDPR erasure that fails half way should have erased half, not
        // nothing.
        for (let i = 0; i < keys.length; i += batchSize) {
          await call((c) => new c.Delete({ ...scope, keys: keys.slice(i, i + batchSize) }));
        }
      } while (token !== undefined);
      fingerprints.delete(ns);
    },

    async search<T = unknown>(
      identity: MemoryIdentity,
      query: readonly number[],
      searchOptions?: SearchOptions,
    ): Promise<readonly ScoredEntry<T>[]> {
      open('search');
      const ns = identityNamespace(identity);
      const k = Math.max(1, Math.floor(searchOptions?.k ?? 10));
      if (query.length === 0) return [];

      // Refused BEFORE the call, against what this process has seen — and
      // again below, against what actually comes back.
      reconcile(
        ns,
        {
          ...(searchOptions?.embedderId !== undefined && { id: searchOptions.embedderId }),
          dims: query.length,
        },
        'search',
      );

      const tiers = searchOptions?.tiers;
      const nsClause = { [NS_KEY]: { $eq: ns } };
      const filter =
        tiers && tiers.length > 0
          ? { $and: [nsClause, { [TIER_KEY]: { $in: [...tiers] } }] }
          : nsClause;

      const out = (await call(
        (c) =>
          new c.Query({
            ...scope,
            queryVector: { float32: [...query] },
            topK: k,
            filter,
            returnMetadata: true,
            returnDistance: true,
          }),
      )) as { vectors?: RawVector[] } | undefined;

      const incoming: Fingerprint = {
        ...(searchOptions?.embedderId !== undefined && { id: searchOptions.embedderId }),
        dims: query.length,
      };
      const now = Date.now();
      const minScore = searchOptions?.minScore;
      const scored: ScoredEntry<T>[] = [];
      for (const row of out?.vectors ?? []) {
        // The restart-surviving half of the fingerprint check: these documents
        // carry the fingerprint they were written with, and a swap shows up
        // here, on the first query, before a single ranking is returned.
        const storedFp = readMetaString(row, FP_KEY);
        if (storedFp !== undefined) {
          const conflict = fingerprintConflict(parseFingerprint(storedFp), incoming);
          if (conflict !== null) {
            throw new EmbedderMismatchError(
              ns,
              storedFp,
              fingerprintText(incoming),
              conflict,
              'search',
              'point this store at a different index',
            );
          }
        }
        const entry = vectorToEntry<T>(row);
        if (!entry) continue;
        if (entry.ttl !== undefined && entry.ttl <= now) continue;
        // Cosine distance to cosine similarity. Exact, not a rescaling — which
        // is why a euclidean index is refused at construction rather than
        // approximated here.
        const distance = typeof row.distance === 'number' ? row.distance : undefined;
        if (distance === undefined) continue;
        const score = 1 - distance;
        if (minScore !== undefined && score < minScore) continue;
        scored.push({ entry, score });
      }

      // S3 Vectors returns its own ranking; re-sort anyway so the port's
      // "descending by score" holds even if a future API version reorders.
      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0;
      });
      return scored.slice(0, k);
    },

    close(): void {
      if (closed) return;
      closed = true;
      if (connection?.owned) connection.client.destroy?.();
    },
  };

  return store;
}

// ─── Refusals ────────────────────────────────────────────────────────

/** One shape for every "a vector index cannot do this" refusal. */
function refuse(method: string, because: string, why: string, fix: string): never {
  throw new Error(
    `s3VectorsStore.${method}: not supported — ${because}.\n` +
      `  This refuses rather than accepting the call: ${why}.\n` +
      `  Fix:  ${fix}.`,
  );
}

// ─── Keys, payloads, rows ────────────────────────────────────────────

/**
 * `'<namespace>#<id>'`.
 *
 * The namespace is in the KEY as well as in the metadata, and the redundancy is
 * deliberate: `search` filters server-side on the metadata, while `list` and
 * `forget` need to select a namespace out of a page of keys, which ListVectors
 * gives no filter for.
 */
function vectorKey(namespace: string, id: string): string {
  return `${namespace}#${id}`;
}

/** The entry id back out of a key. Ids may contain `#` (`'refunds.md#3'`); namespaces may not. */
function idFromKey(key: string, prefixLength: number): string {
  return key.slice(prefixLength);
}

/** Everything the metadata blob carries — the entry minus what is already columns. */
interface Payload {
  readonly id: string;
  readonly value: unknown;
  readonly metadata?: Record<string, unknown>;
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastAccessedAt: number;
  readonly accessCount: number;
  readonly ttl?: number;
  readonly tier?: 'hot' | 'warm' | 'cold';
  readonly source?: MemoryEntry<unknown>['source'];
  readonly embeddingModel?: string;
}

function payloadOf(entry: MemoryEntry<unknown>): Payload {
  // The embedding is deliberately NOT in here: it is the vector itself, and
  // storing it twice would double the metadata budget for nothing.
  return {
    id: entry.id,
    value: entry.value ?? null,
    ...(entry.metadata !== undefined && { metadata: { ...entry.metadata } }),
    version: entry.version,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    lastAccessedAt: entry.lastAccessedAt,
    accessCount: entry.accessCount,
    ...(entry.ttl !== undefined && { ttl: entry.ttl }),
    ...(entry.tier !== undefined && { tier: entry.tier }),
    ...(entry.source !== undefined && { source: entry.source }),
    ...(entry.embeddingModel !== undefined && { embeddingModel: entry.embeddingModel }),
  };
}

/** One vector as the service returns it, in the shapes this adapter reads. */
interface RawVector {
  key?: string;
  distance?: number;
  data?: { float32?: number[] } | number[];
  metadata?: Record<string, unknown>;
}

function readMetaString(row: RawVector, key: string): string | undefined {
  const value = row.metadata?.[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * A returned vector back into a `MemoryEntry`, or `undefined` when the row
 * carries no payload this store wrote.
 *
 * A row without `af` is not corruption to shout about — it is somebody else's
 * vector in a shared index — so it is skipped rather than thrown on. A row
 * whose `af` will not parse is the same fact one level down.
 */
function vectorToEntry<T>(row: RawVector): MemoryEntry<T> | undefined {
  const raw = readMetaString(row, PAYLOAD_KEY);
  if (raw === undefined) return undefined;
  let payload: Payload;
  try {
    payload = JSON.parse(raw) as Payload;
  } catch {
    return undefined;
  }
  const ns = readMetaString(row, NS_KEY);
  const id =
    typeof payload.id === 'string' && payload.id.length > 0
      ? payload.id
      : typeof row.key === 'string' && ns !== undefined
      ? idFromKey(row.key, ns.length + 1)
      : undefined;
  if (id === undefined) return undefined;
  const vector = Array.isArray(row.data) ? row.data : row.data?.float32;
  return {
    id,
    value: payload.value as T,
    ...(payload.metadata !== undefined && { metadata: payload.metadata }),
    version: payload.version ?? 1,
    createdAt: payload.createdAt ?? 0,
    updatedAt: payload.updatedAt ?? 0,
    lastAccessedAt: payload.lastAccessedAt ?? 0,
    accessCount: payload.accessCount ?? 0,
    ...(payload.ttl !== undefined && { ttl: payload.ttl }),
    ...(payload.tier !== undefined && { tier: payload.tier }),
    ...(payload.source !== undefined && { source: payload.source }),
    ...(payload.embeddingModel !== undefined && { embeddingModel: payload.embeddingModel }),
    ...(Array.isArray(vector) && vector.length > 0 && { embedding: [...vector] }),
  };
}

function isExpired(ttl: number | undefined): boolean {
  return ttl !== undefined && ttl <= Date.now();
}

// ─── SDK loading ─────────────────────────────────────────────────────

/** A no-op command shim: an injected `_client` receives the input, stamped with its name. */
function shimCommand(name: string): new (input: unknown) => unknown {
  return class {
    readonly __command = name;
    constructor(input: unknown) {
      Object.assign(this, input);
    }
  } as unknown as new (input: unknown) => unknown;
}

function loadS3VectorsSdk(): S3VectorsSdkModule {
  try {
    return lazyRequire<S3VectorsSdkModule>('@aws-sdk/client-s3vectors');
  } catch {
    throw new Error(
      's3VectorsStore requires the `@aws-sdk/client-s3vectors` peer dependency.\n' +
        '  Install:  npm install @aws-sdk/client-s3vectors\n' +
        '  Or pass `client` with a pre-built S3 Vectors client.\n' +
        '  There is deliberately no fallback to an in-memory index: a corpus that forgot ' +
        'every document on restart looks, from the outside, exactly like one that was ' +
        'never built.',
    );
  }
}
