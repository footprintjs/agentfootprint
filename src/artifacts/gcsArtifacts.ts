/**
 * artifacts/gcsArtifacts — the claim-check store in a Cloud Storage bucket.
 *
 * The same five verbs, the same laws, a different vendor's client. Read
 * `objectStore.ts` first for the laws both object adapters obey; read
 * `s3Artifacts.ts` beside this one to see what is genuinely per-vendor rather
 * than per-implementation. Three things really are different here, and each
 * one changes what an operator pays:
 *
 *   1. **A listing carries the metadata.** `bucket.getFiles()` hands back File
 *      objects with their metadata already populated — creation time, size AND
 *      the custom entry holding the ticket. So `list()` is ONE call per page
 *      and needs no per-row read, where the S3 adapter must HEAD each row it
 *      returns. Same port, same promise, cheaper here; said out loud because
 *      "the cloud adapters behave identically" is true of the CONTRACT and not
 *      of the bill.
 *   2. **A bigger metadata budget.** Custom metadata is capped at 8 KiB
 *      (keys and values together), against 2 KB on the other column. The
 *      ticket is checked against it at put and refused by name, so the cap is
 *      a stated limit and not a surprise from the service.
 *   3. **The client has no command objects.** Methods hang off a chain —
 *      `storage.bucket(b).file(k).save(...)` — which is why this column's pin
 *      test asserts a METHOD CHAIN rather than a set of command names.
 *
 * ── The object key ──────────────────────────────────────────────────────────
 * `[<prefix>/]<tenant>/<principal>/<conversation>/<ref>`, scope-partitioned by
 * `scopePath.ts` — the same percent-encoding law as the directory adapter, so
 * a tenant of literally `'..'` is a NAME here too. A ref alone opens nothing:
 * a wrong scope computes a different object name, the service answers 404, and
 * the caller reads `null`.
 *
 * ── What a 404 is allowed to mean here ──────────────────────────────────────
 * A missing object and a missing bucket look the SAME on this column
 * (`code: 404`, reason `notFound`, differing only in prose this adapter will
 * not parse). So the split is made by the call instead: only a read of one
 * named object may read a 404 as "not there". A 404 from a save or a listing
 * is not an answer to anything the caller asked — it goes through the
 * sanitizer, because nothing downstream converts it and the client's own text
 * for it carries the object name.
 *
 * ── Retention, and the operator's bulk tool ─────────────────────────────────
 * `ttlMs` stamps `expiresAt` AT MINT (stated, never sprung); expiry is
 * enforced on READ and the expired object is deleted on the way past; budgets
 * evict oldest-first (an object store has no cheap read-recency). A put SCANS
 * the scope only when a byte/count budget is configured — with no budget there
 * is nothing to plan, and a put stays a single upload.
 *
 * Reclaiming what nobody reads again is **Object Lifecycle Management**, the
 * operator's bulk tool. This adapter does not create rules: a lifecycle rule
 * is a cost and compliance decision that belongs to your infrastructure.
 * Align it like this:
 *
 * ```jsonc
 * // Delete objects 7 days after creation. Keep the rule LONGER than the
 * // store's ttlMs, never shorter: `expiresAt` is the promise printed on the
 * // ticket, and a lifecycle rule that deletes first makes a live ticket
 * // resolve to null BEFORE the time it stated. Longer, and lifecycle is what
 * // it should be — the backstop for what the store's own sweep never
 * // revisited.
 * { "lifecycle": { "rule": [
 *     { "action": { "type": "Delete" },
 *       "condition": { "age": 7, "matchesPrefix": ["artifacts/"] } }
 * ]}}
 * ```
 *
 * ── Lazy peer dependency ────────────────────────────────────────────────────
 * `@google-cloud/storage` is an OPTIONAL peer dependency, required at
 * CONSTRUCTION (the sqliteSessions law): importing the barrel costs a browser
 * bundle nothing, and a missing install refuses where the config was written.
 * Pass `storage` to share the client your app already built.
 *
 * ── What that peer's TREE carries, said out loud ────────────────────────────
 * Optional means it is your dependency and not this package's — nothing here
 * loads it unless you call `gcsArtifacts` — but you inherit its tree when you
 * do. Two independent audits (2026-08-13, 2026-08-14) reported the same five
 * MODERATE advisories, and they reproduce here:
 *
 *   `@google-cloud/storage` → `retry-request` → `teeny-request` → `gaxios` → `uuid`
 *
 * rooted in `uuid` (GHSA-w5hq-g745-h8pq — a missing buffer bounds check in
 * v3/v5/v6 when `buf` is provided). It is not a defect in this adapter and
 * there is no line here that would fix it: the chain is entirely inside
 * Google's client.
 *
 * **Do not take `npm audit fix --force`.** Its resolution installs
 * `@google-cloud/storage@5.18.3` — a major DOWNGRADE to a client from a
 * different era of the API. Trading a bounds check in a path this adapter does
 * not exercise for a client several majors behind the service is a different
 * outage, not a security improvement, and this package will never pin you to
 * it. Pin the newest 7.x yourself and watch the upstream chain.
 *
 * ── Status ──────────────────────────────────────────────────────────────────
 * **Field-validated** (was "awaiting field use" through 9.28.0). The method
 * chain it calls is pinned against the really-installed package by
 * `test/adapters/google/google-surface-pin.test.ts`, and the behaviour is
 * proved offline against an emulation double that speaks the same chain — but
 * the promotion rests on live evidence, not on those:
 *
 * An independent trial ran THIS adapter, unchanged since 9.25.0, against a real
 * Cloud Storage bucket (`@google-cloud/storage@7.22.0`, uniform bucket-level
 * access, public-access prevention on) and all nine checks passed: JSON
 * put/head/get with a verified SHA-256, scope isolation refusing another
 * tenant / principal / conversation, two distinct cursor pages, a byte-exact
 * native `putStream`/`getStream`, a TTL that expired and lazy-deleted, a
 * `maxCountPerScope` eviction reporting `max-count`, an oversize label refused
 * BEFORE upload against the 8 KiB metadata budget, a missing bucket answering
 * with the documented ambiguous `null` on read and a sanitized 404 on write
 * that leaked neither key nor scope, and an idempotent repeated delete.
 * (FINDINGS "Cloud Storage `gcsArtifacts()` — field PASS".)
 *
 * What that does NOT promote: the same evidence says nothing about a bucket
 * with soft delete or object versioning enabled — the trial's bucket had both
 * off, on purpose, so the evidence would be disposable.
 */

import { lazyRequire } from '../lib/lazyRequire.js';
import { prepareArtifact } from './minting.js';
import { isArtifactRef } from './naming.js';
import {
  ARTIFACT_META_KEY,
  assertBucketOption,
  decodeArtifactMetaValue,
  encodeArtifactMetaValue,
  isExpiredMeta,
  objectFailurePolicy,
  pageObjectListing,
  readMetadataEntry,
  type NotFoundMeaning,
  type ObjectListingRow,
} from './objectStore.js';
import {
  canonicalPayloadBytes,
  computeArtifactDigest,
  decodeCanonicalPayload,
  payloadShapeOf,
  type PayloadShape,
} from './payload.js';
import {
  assertRetention,
  planRetention,
  type ArtifactRetention,
  type RetainedRow,
} from './retention.js';
import { normalizeKeyRoot, scopeKeyPrefix } from './scopePath.js';
import { assertStreamBytes } from './streaming.js';
import {
  ArtifactIntegrityError,
  InvalidArtifactError,
  type ArtifactListOptions,
  type ArtifactListResult,
  type ArtifactMeta,
  type ArtifactPutResult,
  type ArtifactRecord,
  type ArtifactRef,
  type ArtifactScope,
  type ArtifactStore,
  type ArtifactStreamPutInput,
  type ArtifactStreamRecord,
} from './types.js';

/** Cloud Storage's custom-metadata cap: 8 KiB, keys and values together. */
const GCS_METADATA_BUDGET = 8 * 1024;

/** Objects per listing call. */
const LIST_PAGE_SIZE = 1000;

/** How many listing calls one scan may make before it stops walking. */
const MAX_LIST_CALLS = 20;

// ─── The slice of the SDK this adapter uses ──────────────────────────

/** One object's metadata, as this adapter reads it. */
export interface GcsFileMetadataLike {
  readonly size?: string | number;
  readonly timeCreated?: string;
  readonly contentType?: string;
  /** The custom entries — where the ticket rides. */
  readonly metadata?: Record<string, unknown>;
}

/** One object handle, as this adapter calls it. */
export interface GcsFileLike {
  /** Populated by a listing; a File built by `bucket.file()` may not have it. */
  readonly name?: string;
  readonly metadata?: GcsFileMetadataLike;
  save(data: Uint8Array | string, options?: unknown): Promise<unknown>;
  download(options?: unknown): Promise<[Uint8Array]>;
  getMetadata(options?: unknown): Promise<[GcsFileMetadataLike, unknown?]>;
  delete(options?: unknown): Promise<unknown>;
  createReadStream(options?: unknown): NodeJS.ReadableStream;
  createWriteStream(options?: unknown): NodeJS.WritableStream;
}

/** One bucket handle, as this adapter calls it. */
export interface GcsBucketLike {
  file(name: string): GcsFileLike;
  getFiles(query?: unknown): Promise<[GcsFileLike[], unknown?, unknown?]>;
}

/** The client, as this adapter calls it. */
export interface GcsStorageLike {
  bucket(name: string): GcsBucketLike;
}

/** The module shape this adapter loads. */
export interface GcsSdkModule {
  readonly Storage?: new (config: Record<string, unknown>) => GcsStorageLike;
}

/** Options for {@link gcsArtifacts}. */
export interface GcsArtifactsOptions {
  /** The bucket. It must already exist — this library never creates one. */
  readonly bucket: string;
  /** Object-name prefix inside the bucket, so a bucket can be shared. */
  readonly prefix?: string;
  /** Project id for the client this factory builds. Ignored when `storage` is
   *  passed — that client's configuration is yours. */
  readonly projectId?: string;
  /** Your own pre-built client; configuration and credentials stay yours. */
  readonly storage?: GcsStorageLike;
  /** Retention dials. Budgets evict OLDEST-first (no cheap read-recency). */
  readonly retention?: ArtifactRetention;
  /** @internal Test seam — the SDK module, injected. */
  readonly _sdk?: GcsSdkModule;
  /** @internal Test seam — a client injected past the SDK entirely. */
  readonly _storage?: GcsStorageLike;
  /** @internal Test seam — the clock. Defaults to `Date.now`. */
  readonly _now?: () => number;
}

/** Load the peer dep, or refuse by name with the install line. */
function loadGcsSdk(): GcsSdkModule {
  let mod: GcsSdkModule;
  try {
    mod = lazyRequire<GcsSdkModule>('@google-cloud/storage');
  } catch {
    throw new Error(
      `[artifacts] gcsArtifacts requires the \`@google-cloud/storage\` package.\n` +
        `  Install:  npm install @google-cloud/storage\n` +
        `  It is an OPTIONAL peer dependency, loaded only when you construct this store — ` +
        `every other artifact adapter (inMemoryArtifacts, fileArtifacts, sqliteArtifacts) needs ` +
        `nothing installed.`,
    );
  }
  if (typeof mod.Storage !== 'function') {
    throw new Error(
      `[artifacts] gcsArtifacts: \`@google-cloud/storage\` is installed but exports no ` +
        `\`Storage\`. This adapter is built against the 7.x client — update the package, or ` +
        `pass \`storage\` with a pre-built client.`,
    );
  }
  return mod;
}

/**
 * Is this the client's "no such object"?
 *
 * Said honestly: on this column a missing OBJECT and a missing BUCKET arrive
 * identically — `code: 404`, `errors[0].reason: 'notFound'` for both — and the
 * only thing that separates them is prose in the message, which this adapter
 * will not read (a classification that depends on somebody's error text breaks
 * on the first rewording, and the text is the thing we refuse to touch).
 *
 * So the split is made where it CAN be made: by which call the 404 came from.
 * A read of one named object reads it as "no data"; a write or a listing never
 * does — see {@link NotFoundMeaning}. A store pointed at a bucket that does not
 * exist therefore reports empty on a read and says so plainly on the first
 * write, rather than pretending a 404 it cannot classify is an answer.
 */
function isMissingObject(err: unknown): boolean {
  const e = err as { code?: unknown; status?: unknown } | null;
  if (e === null || typeof e !== 'object') return false;
  return e.code === 404 || e.status === 404 || e.code === 'ENOENT';
}

/** `timeCreated` as milliseconds. */
function toMillis(value: string | undefined): number {
  if (typeof value !== 'string') return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * An artifact store in a Cloud Storage bucket.
 *
 * @example
 *   const store = gcsArtifacts({ bucket: 'my-agent-artifacts', prefix: 'artifacts' });
 *   const agent = Agent.create({ provider, artifacts: store });
 */
export function gcsArtifacts(options: GcsArtifactsOptions): ArtifactStore {
  const bucketName = assertBucketOption('gcsArtifacts', 'bucket', options.bucket);
  const root = normalizeKeyRoot('gcsArtifacts', options.prefix);
  const { retention } = options;
  assertRetention('gcsArtifacts', retention);
  const now = options._now ?? Date.now;

  // Resolved at CONSTRUCTION — a missing peer dep refuses where the config
  // was written, not at the first put of the first run.
  const storage: GcsStorageLike =
    options._storage ??
    options.storage ??
    // Checked by loadGcsSdk.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    new (options._sdk?.Storage ?? loadGcsSdk().Storage!)({
      ...(options.projectId !== undefined && { projectId: options.projectId }),
    });
  const bucket = storage.bucket(bucketName);

  const nameFor = (scope: ArtifactScope, ref: ArtifactRef): string =>
    `${scopeKeyPrefix(scope, root)}${ref}`;

  const failure = objectFailurePolicy('gcsArtifacts', isMissingObject);

  /**
   * Run one SDK call, mapping failures the two honest ways.
   *
   * `meaning` says whether THIS call asked about one object, and so whether a
   * 404 may travel back raw for the call site to read as "not there". It
   * defaults to `'not-an-answer'`: a new call site that forgets it gets the
   * sanitizer, never the leak. Only pass `'missing-object'` where the `catch`
   * that converts it is a line away.
   */
  const call = async <T>(
    operation: string,
    run: () => Promise<T>,
    meaning: NotFoundMeaning = 'not-an-answer',
  ): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      throw failure(operation, err, meaning);
    }
  };

  const removeName = async (name: string): Promise<void> => {
    try {
      await call(
        'delete',
        () => bucket.file(name).delete({ ignoreNotFound: true }),
        'missing-object',
      );
    } catch (err) {
      // `ignoreNotFound` already covers the object; a 404 that still arrives is
      // about something else. Swallowed all the same — deleting an absence is
      // agreement — but it arrives sanitized, so no client that ignores the
      // flag can echo the name through this path.
      if (!isMissingObject(err)) throw err;
    }
  };

  /** The ticket carried by one object's metadata, when it is one of ours. */
  const ticketOf = (
    metadata: GcsFileMetadataLike | undefined,
  ): { meta: ArtifactMeta; shape: PayloadShape } | undefined =>
    decodeArtifactMetaValue(readMetadataEntry(metadata?.metadata, ARTIFACT_META_KEY));

  /** getMetadata → the ticket, or undefined for missing/foreign/expired.
   *  Expired objects are swept on the way past. */
  const liveTicket = async (
    scope: ArtifactScope,
    ref: ArtifactRef,
  ): Promise<{ meta: ArtifactMeta; shape: PayloadShape } | undefined> => {
    if (!isArtifactRef(ref)) return undefined;
    const name = nameFor(scope, ref);
    let metadata: GcsFileMetadataLike;
    try {
      [metadata] = await call(
        'getMetadata',
        () => bucket.file(name).getMetadata(),
        'missing-object',
      );
    } catch (err) {
      if (isMissingObject(err)) return undefined;
      throw err;
    }
    const ticket = ticketOf(metadata);
    if (ticket === undefined) return undefined;
    if (isExpiredMeta(ticket.meta, now())) {
      await removeName(name);
      return undefined;
    }
    return ticket;
  };

  /** Every live row in a scope — ONE call per page, tickets included. */
  const listScope = async (
    scope: ArtifactScope,
  ): Promise<Array<ObjectListingRow & { readonly name: string }>> => {
    const prefix = scopeKeyPrefix(scope, root);
    const rows: Array<ObjectListingRow & { name: string }> = [];
    let pageToken: string | undefined;
    const at = now();
    for (let callNo = 0; callNo < MAX_LIST_CALLS; callNo++) {
      const [files, nextQuery] = await call('getFiles', () =>
        bucket.getFiles({
          prefix,
          autoPaginate: false,
          maxResults: LIST_PAGE_SIZE,
          ...(pageToken !== undefined && { pageToken }),
        }),
      );
      for (const file of files ?? []) {
        const name = typeof file.name === 'string' ? file.name : '';
        const ref = name.slice(prefix.length);
        if (!isArtifactRef(ref)) continue; // foreign object in a shared bucket
        const ticket = ticketOf(file.metadata);
        if (ticket === undefined) continue;
        if (isExpiredMeta(ticket.meta, at)) {
          await removeName(name);
          continue;
        }
        rows.push({
          name,
          meta: ticket.meta,
          serviceCreatedAt: toMillis(file.metadata?.timeCreated) || ticket.meta.createdAt,
        });
      }
      pageToken = (nextQuery as { pageToken?: string } | null)?.pageToken;
      if (pageToken === undefined) break;
    }
    return rows;
  };

  /** The retention pass, run at put. Returns what it swept. */
  const applyRetention = async (
    scope: ArtifactScope,
    incomingBytes: number,
    at: number,
  ): Promise<ArtifactPutResult['swept']> => {
    if (
      retention === undefined ||
      (retention.maxBytesPerScope === undefined && retention.maxCountPerScope === undefined)
    ) {
      return [];
    }
    const held: RetainedRow[] = (await listScope(scope)).map((row) => ({
      ref: row.meta.ref,
      kind: row.meta.kind,
      bytes: row.meta.bytes,
      ...(row.meta.expiresAt !== undefined && { expiresAt: row.meta.expiresAt }),
      lastAccessedAt: row.meta.createdAt,
    }));
    const plan = planRetention(held, incomingBytes, retention, at);
    if (plan.refusal !== undefined) throw new InvalidArtifactError(plan.refusal);
    for (const gone of plan.swept) await removeName(nameFor(scope, gone.ref));
    return plan.swept;
  };

  return {
    async put(scope, input): Promise<ArtifactPutResult> {
      const at = now();
      const { meta } = await prepareArtifact(
        input,
        async (parent) => (await liveTicket(scope, parent)) !== undefined,
        retention,
        at,
      );
      const bytes = canonicalPayloadBytes(input.data);
      const shape = payloadShapeOf(input.data);
      const metaValue = encodeArtifactMetaValue(meta, shape, GCS_METADATA_BUDGET, 'gcsArtifacts');
      const swept = await applyRetention(scope, meta.bytes, at);
      await call('save', () =>
        bucket.file(nameFor(scope, meta.ref)).save(bytes, {
          contentType: meta.mediaType,
          resumable: false,
          metadata: { metadata: { [ARTIFACT_META_KEY]: metaValue } },
        }),
      );
      return { meta, swept };
    },

    async head(scope, ref): Promise<ArtifactMeta | null> {
      return (await liveTicket(scope, ref))?.meta ?? null;
    },

    async get(scope, ref): Promise<ArtifactRecord | null> {
      const ticket = await liveTicket(scope, ref);
      if (ticket === undefined) return null;
      let downloaded: Uint8Array;
      try {
        [downloaded] = await call(
          'download',
          () => bucket.file(nameFor(scope, ref)).download(),
          'missing-object',
        );
      } catch (err) {
        if (isMissingObject(err)) return null; // deleted between the head and the read
        throw err;
      }
      const data = decodeCanonicalPayload(ticket.shape, new Uint8Array(downloaded));
      if (ticket.meta.digest !== undefined) {
        const actual = await computeArtifactDigest(data);
        if (actual !== ticket.meta.digest) {
          throw new ArtifactIntegrityError(ticket.meta.ref, ticket.meta.digest, actual);
        }
      }
      return { meta: ticket.meta, data };
    },

    async delete(scope, ref): Promise<void> {
      if (!isArtifactRef(ref)) return;
      await removeName(nameFor(scope, ref));
    },

    async list(scope, listOptions?: ArtifactListOptions): Promise<ArtifactListResult> {
      return pageObjectListing(await listScope(scope), listOptions);
    },

    async putStream(
      scope,
      input: ArtifactStreamPutInput,
      body: ReadableStream<Uint8Array>,
    ): Promise<ArtifactPutResult> {
      const at = now();
      const declared = assertStreamBytes('gcsArtifacts', input.bytes);
      // A streamed payload is bytes by definition: nothing parses it, so it
      // reads back as a Uint8Array through get() and as the same bytes
      // through getStream().
      const { meta } = await prepareArtifact(
        { ...input, data: new Uint8Array(0) },
        async (parent) => (await liveTicket(scope, parent)) !== undefined,
        retention,
        at,
      );
      const stated: ArtifactMeta = { ...meta, bytes: declared };
      const metaValue = encodeArtifactMetaValue(
        stated,
        'binary',
        GCS_METADATA_BUDGET,
        'gcsArtifacts',
      );
      const swept = await applyRetention(scope, declared, at);
      const stream = lazyRequire<typeof import('node:stream')>('node:stream');
      const promises = lazyRequire<typeof import('node:stream/promises')>('node:stream/promises');
      const writable = bucket.file(nameFor(scope, stated.ref)).createWriteStream({
        contentType: stated.mediaType,
        resumable: false,
        metadata: { metadata: { [ARTIFACT_META_KEY]: metaValue } },
      });
      await call('createWriteStream', () =>
        promises.pipeline(
          stream.Readable.from(countedChunks(body, declared)),
          writable as NodeJS.WritableStream,
        ),
      );
      return { meta: stated, swept };
    },

    async getStream(scope, ref): Promise<ArtifactStreamRecord | null> {
      const ticket = await liveTicket(scope, ref);
      if (ticket === undefined) return null;
      const stream = lazyRequire<typeof import('node:stream')>('node:stream');
      const readable = bucket.file(nameFor(scope, ref)).createReadStream();
      return {
        meta: ticket.meta,
        body: stream.Readable.toWeb(
          readable as unknown as import('node:stream').Readable,
        ) as ReadableStream<Uint8Array>,
      };
    },
  };
}

/**
 * Yield a web stream's chunks while COUNTING them against the declared
 * length, so a producer that lied about its own payload fails with this
 * library's sentence rather than as a truncated upload.
 */
async function* countedChunks(
  body: ReadableStream<Uint8Array>,
  declared: number,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > declared) {
        await reader.cancel();
        throw new InvalidArtifactError(
          `gcsArtifacts: the streamed payload is longer than the ${declared} bytes it ` +
            `declared. The upload was cut off rather than completed under a meta that ` +
            `describes a different payload. State the exact byte length.`,
        );
      }
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
  if (total !== declared) {
    throw new InvalidArtifactError(
      `gcsArtifacts: the streamed payload ended after ${total} bytes but declared ${declared}. ` +
        `The upload fails rather than storing a ticket that misdescribes its own payload.`,
    );
  }
}
