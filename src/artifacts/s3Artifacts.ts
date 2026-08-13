/**
 * artifacts/s3Artifacts — the claim-check store in an S3 bucket.
 *
 * The third rung of the same ladder: `inMemoryArtifacts` for a test,
 * `fileArtifacts`/`sqliteArtifacts` for one machine, this for a fleet. Nothing
 * about the five verbs changes — a tool that stored a dataset against the
 * in-memory store stores it here by swapping one constructor, because the port
 * is the contract and this file is only a translation of it.
 *
 * Read `objectStore.ts` first: it holds the five laws both object adapters
 * obey (payload as canonical bytes in the body, ONE metadata entry carrying
 * the ticket, a checked metadata budget, 404-means-null-everything-else-means-
 * error, service-time ordering). What is genuinely S3's, and therefore lives
 * here:
 *
 * ── The object key ──────────────────────────────────────────────────────────
 * `[<prefix>/]<tenant>/<principal>/<conversation>/<ref>` — the scope
 * partitioned into key segments by `scopePath.ts`, the same percent-encoding
 * law the directory adapter uses, so a tenant of literally `'..'` is a NAME in
 * both. A ref alone opens nothing: a wrong scope computes a different key,
 * S3 answers 404, and the caller reads `null` — one indistinguishable miss,
 * never a cross-tenant read.
 *
 * ── The ticket rides as object metadata, not a sidecar ──────────────────────
 * `x-amz-meta-af-artifact`, one entry, ASCII JSON. Two reasons this beats a
 * second `<ref>.meta.json` object: `head()` becomes ONE HeadObject (the port
 * promises the render-by-ref decision without paying for the payload, and a
 * sidecar would make it a second GET), and `get()` returns the ticket AND the
 * bytes in a single GetObject — a sidecar would make every read two round
 * trips and open a window where one exists and the other does not.
 *
 * The cost is S3's cap: **2 KB of user metadata per object**, checked at put
 * and refused by name. A ticket is small (a ref, a kind, a media type, sizes,
 * a label); it only reaches 2 KB if the label is prose or `parentRefs` is a
 * bibliography, and the refusal says which.
 *
 * ── What a 404 is allowed to mean here ──────────────────────────────────────
 * S3 answers 404 for two different sentences: "no such key" and "no such
 * bucket". Only the first is the port's "no data", so this adapter reads the
 * CODE and not the status, and only the calls that named one object —
 * Head/Get/Delete — may read a 404 as `null` at all. A 404 from PutObject or
 * ListObjectsV2 means the bucket is not there; it goes through the sanitizer
 * like every other failure, because nothing downstream is waiting to turn it
 * into `null` and the SDK's text for it contains the object key.
 *
 * ── What a listing costs, said plainly ──────────────────────────────────────
 * `ListObjectsV2` returns keys, sizes and `LastModified` — never user
 * metadata. So `list()` pages the keys (cheap, 1000 per call), sorts by
 * `LastModified` (newest first, as the port promises), and issues one
 * `HeadObject` for each row IT RETURNS — not for the whole scope. An expired
 * object inside a page is dropped from that page rather than backfilled, so a
 * page can come back short while more pages remain. That is the honest trade;
 * an "index object" listing every ticket in a scope would be cheaper and
 * would be a lost-update race between two writers, which is worse than a
 * round trip.
 *
 * ── Retention, and the operator's bulk tool ─────────────────────────────────
 * The dials work exactly as everywhere else: `ttlMs` stamps `expiresAt` AT
 * MINT (stated, never sprung), and budgets evict oldest-first (S3 has no cheap
 * read-recency, the same statement `fileArtifacts` makes). Two S3-specific
 * facts:
 *
 *   • **Expiry is enforced on READ.** An expired object answers `null` from
 *     `head`/`get` and is deleted on the way past (a sweep on access), so an
 *     expired ticket can never be redeemed even if the object is still there.
 *   • **A put only SCANS the scope when a budget is configured.** With no
 *     `maxBytesPerScope`/`maxCountPerScope` there is nothing to plan, so a put
 *     is exactly one `PutObject` — and paying for a full scope listing on
 *     every write would be a real bill for no answer.
 *
 * Which leaves reclamation of storage for artifacts nobody reads again — and
 * that is what **S3 Lifecycle rules** are for. They are the operator's bulk
 * tool and this adapter does not create them (a lifecycle rule is a cost and
 * compliance decision that belongs to your infrastructure). Align them like
 * this:
 *
 * ```jsonc
 * // Expire objects 7 days after creation, under the store's prefix.
 * // Keep the rule LONGER than the store's ttlMs, never shorter:
 * // the store's expiresAt is the promise consumers read on the ticket, and a
 * // lifecycle rule that deletes first makes a live ticket resolve to null
 * // BEFORE the time it printed. Longer, and lifecycle is what it should be:
 * // the backstop that reclaims what the store's own sweep never revisited.
 * { "Rules": [{ "ID": "agentfootprint-artifacts", "Status": "Enabled",
 *               "Filter": { "Prefix": "artifacts/" },
 *               "Expiration": { "Days": 7 } }] }
 * ```
 *
 * ── Lazy peer dependency ────────────────────────────────────────────────────
 * `@aws-sdk/client-s3` is an OPTIONAL peer dependency, required at
 * CONSTRUCTION (the sqliteSessions law): importing the barrel costs a browser
 * bundle nothing, and a missing install refuses where the config was written
 * rather than at the first put of the first run. Pass `client` to share the
 * SDK configuration your app already has.
 *
 * ── Status ──────────────────────────────────────────────────────────────────
 * Contract-shaped and tested; awaiting field use. The five commands it
 * dispatches are pinned by `test/adapters/aws/aws-command-pin.test.ts`; the
 * behavior is proved against an emulation double that speaks the same five.
 * No live call has been made from this repository.
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
import { assertStreamBytes, bytesAsStream } from './streaming.js';
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

/** S3's user-metadata cap: 2 KB per object, keys and values together. */
const S3_METADATA_BUDGET = 2 * 1024;

/** Keys per ListObjectsV2 call. S3's own maximum. */
const LIST_PAGE_SIZE = 1000;

/** How many ListObjectsV2 calls one `list()`/sweep may make before it stops
 *  walking. A scope with a million objects is a retention bug, and spending
 *  the caller's afternoon proving it is not the answer. */
const MAX_LIST_CALLS = 20;

// ─── The slice of the SDK this adapter uses ──────────────────────────
// Declared locally, the way every adapter here declares the part of its
// backend it calls, so nothing takes a hard import on an optional peer dep.

/** A `*Client` as this adapter uses it: `send`, and nothing else. */
export interface S3ArtifactsClientLike {
  send(command: unknown): Promise<unknown>;
}

/** The five command constructors this adapter dispatches. */
export interface S3ArtifactsSdkModule {
  readonly S3Client?: new (config: { region?: string }) => S3ArtifactsClientLike;
  readonly PutObjectCommand?: new (input: unknown) => unknown;
  readonly GetObjectCommand?: new (input: unknown) => unknown;
  readonly HeadObjectCommand?: new (input: unknown) => unknown;
  readonly DeleteObjectCommand?: new (input: unknown) => unknown;
  readonly ListObjectsV2Command?: new (input: unknown) => unknown;
}

/** Options for {@link s3Artifacts}. */
export interface S3ArtifactsOptions {
  /** The bucket. It must already exist — this library never creates one. */
  readonly bucket: string;
  /** Key prefix inside the bucket, so a bucket can be shared. The scope
   *  layout starts under it. Absent = at the root of the bucket. */
  readonly prefix?: string;
  /** Region for the client this factory builds. Ignored when `client` is
   *  passed — that client's configuration is yours. */
  readonly region?: string;
  /** Your own pre-built client; configuration and credentials stay yours. */
  readonly client?: S3ArtifactsClientLike;
  /** Retention dials. Budgets evict OLDEST-first here: S3 has no cheap
   *  read-recency, the same statement `fileArtifacts` makes about a
   *  directory. */
  readonly retention?: ArtifactRetention;
  /** @internal Test seam — the SDK module, injected. */
  readonly _sdk?: S3ArtifactsSdkModule;
  /** @internal Test seam — a client injected past the SDK entirely. */
  readonly _client?: S3ArtifactsClientLike;
  /** @internal Test seam — the clock. Defaults to `Date.now`. */
  readonly _now?: () => number;
}

/** Load the peer dep, or refuse by name with the install line. */
function loadS3Sdk(): S3ArtifactsSdkModule {
  try {
    return lazyRequire<S3ArtifactsSdkModule>('@aws-sdk/client-s3');
  } catch {
    throw new Error(
      `[artifacts] s3Artifacts requires the \`@aws-sdk/client-s3\` package.\n` +
        `  Install:  npm install @aws-sdk/client-s3\n` +
        `  It is an OPTIONAL peer dependency, loaded only when you construct this store — ` +
        `every other artifact adapter (inMemoryArtifacts, fileArtifacts, sqliteArtifacts) needs ` +
        `nothing installed.`,
    );
  }
}

/**
 * S3 error codes that are 404 and are NOT about the object: the BUCKET is not
 * there.
 *
 * The status alone cannot carry this. `NoSuchBucket` is a modelled S3
 * exception with `$metadata.httpStatusCode: 404`, exactly like `NoSuchKey`, so
 * a check that reads only the status answers "that artifact is missing" for a
 * store pointed at a bucket that does not exist — an empty scope reported over
 * a configuration mistake, which is the failure law 4 forbids. Named codes,
 * not the status, are what separate the two.
 */
const NOT_ABOUT_THE_OBJECT: ReadonlySet<string> = new Set(['NoSuchBucket']);

/** Is this the SDK's "no such OBJECT"? 404 in any of the spellings S3 uses,
 *  minus the 404s that are about something else — see law 4 in
 *  `objectStore.ts`. Everything this rejects is NOT "no data". */
function isMissingObject(err: unknown): boolean {
  const e = err as {
    name?: unknown;
    Code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  } | null;
  if (e === null || typeof e !== 'object') return false;
  const name = typeof e.name === 'string' ? e.name : '';
  const code = typeof e.Code === 'string' ? e.Code : '';
  if (NOT_ABOUT_THE_OBJECT.has(name) || NOT_ABOUT_THE_OBJECT.has(code)) return false;
  if (e.$metadata?.httpStatusCode === 404) return true;
  return name === 'NotFound' || name === 'NoSuchKey' || code === 'NotFound' || code === 'NoSuchKey';
}

/** The bytes of a GetObject body, whichever shape the SDK handed back. */
async function readBodyBytes(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  const stream = body as { transformToByteArray?: () => Promise<Uint8Array> } | null;
  if (stream !== null && typeof stream?.transformToByteArray === 'function') {
    return await stream.transformToByteArray();
  }
  throw new Error(
    `[artifacts] s3Artifacts: GetObject answered with a body this adapter cannot read ` +
      `(no transformToByteArray). The SDK's response stream mixin is missing — check the ` +
      `@aws-sdk/client-s3 version.`,
  );
}

/** The web stream of a GetObject body, or the bytes wrapped as one. */
async function readBodyStream(body: unknown): Promise<ReadableStream<Uint8Array>> {
  const stream = body as { transformToWebStream?: () => ReadableStream<Uint8Array> } | null;
  if (stream !== null && typeof stream?.transformToWebStream === 'function') {
    return stream.transformToWebStream();
  }
  return bytesAsStream(await readBodyBytes(body));
}

/**
 * Yield a web stream's chunks while COUNTING them against the declared
 * length, so a producer that lied about its own payload fails with this
 * library's sentence rather than as a malformed HTTP request.
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
          `s3Artifacts: the streamed payload is longer than the ${declared} bytes it declared. ` +
            `The upload was cut off rather than completed under a meta that describes a ` +
            `different payload. State the exact byte length.`,
        );
      }
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
  if (total !== declared) {
    throw new InvalidArtifactError(
      `s3Artifacts: the streamed payload ended after ${total} bytes but declared ${declared}. ` +
        `The upload fails rather than storing a ticket that misdescribes its own payload.`,
    );
  }
}

/**
 * An artifact store in an S3 bucket.
 *
 * @example
 *   const store = s3Artifacts({ bucket: 'my-agent-artifacts', prefix: 'artifacts' });
 *   const agent = Agent.create({ provider, artifacts: store });
 */
export function s3Artifacts(options: S3ArtifactsOptions): ArtifactStore {
  const bucket = assertBucketOption('s3Artifacts', 'bucket', options.bucket);
  const root = normalizeKeyRoot('s3Artifacts', options.prefix);
  const { retention } = options;
  assertRetention('s3Artifacts', retention);
  const now = options._now ?? Date.now;

  // Resolved at CONSTRUCTION: a missing peer dep refuses where the config was
  // written, not at the first put of the first run.
  const sdk = options._sdk ?? (options._client ? {} : loadS3Sdk());
  const client = options._client ?? options.client ?? buildClient(sdk, options.region);
  const commands = resolveCommands(
    sdk,
    options._client !== undefined || options.client !== undefined,
  );

  const keyFor = (scope: ArtifactScope, ref: ArtifactRef): string =>
    `${scopeKeyPrefix(scope, root)}${ref}`;

  const failure = objectFailurePolicy('s3Artifacts', isMissingObject);

  /**
   * One command, dispatched.
   *
   * `meaning` says whether THIS call asked about one object, and so whether a
   * 404 may travel back raw for the call site to read as `null`. It defaults
   * to `'not-an-answer'`: a new call site that forgets it gets the sanitizer,
   * never the leak. Only pass `'missing-object'` where the `catch` that
   * converts it is a line away.
   */
  const send = async (
    operation: string,
    command: unknown,
    meaning: NotFoundMeaning = 'not-an-answer',
  ): Promise<unknown> => {
    try {
      return await client.send(command);
    } catch (err) {
      throw failure(operation, err, meaning);
    }
  };

  /** HeadObject → the ticket, or undefined for missing/foreign/expired.
   *  Expired objects are swept on the way past. */
  const liveHead = async (
    scope: ArtifactScope,
    ref: ArtifactRef,
  ): Promise<{ meta: ArtifactMeta; shape: PayloadShape } | undefined> => {
    if (!isArtifactRef(ref)) return undefined;
    const key = keyFor(scope, ref);
    let output: { Metadata?: Record<string, unknown> };
    try {
      output = (await send(
        'HeadObject',
        new commands.Head({ Bucket: bucket, Key: key }),
        'missing-object',
      )) as { Metadata?: Record<string, unknown> };
    } catch (err) {
      if (isMissingObject(err)) return undefined;
      throw err;
    }
    const ticket = decodeArtifactMetaValue(readMetadataEntry(output?.Metadata, ARTIFACT_META_KEY));
    if (ticket === undefined) return undefined; // not one of ours
    if (isExpiredMeta(ticket.meta, now())) {
      await removeKey(key);
      return undefined;
    }
    return ticket;
  };

  const removeKey = async (key: string): Promise<void> => {
    try {
      await send(
        'DeleteObject',
        new commands.Delete({ Bucket: bucket, Key: key }),
        'missing-object',
      );
    } catch (err) {
      if (!isMissingObject(err)) throw err; // deleting an absence is agreement
    }
  };

  /** Every key in a scope, with the size and creation time S3 reports for
   *  free on a listing. */
  const listKeys = async (
    scope: ArtifactScope,
  ): Promise<Array<{ key: string; ref: string; serviceCreatedAt: number; bytes: number }>> => {
    const prefix = scopeKeyPrefix(scope, root);
    const rows: Array<{ key: string; ref: string; serviceCreatedAt: number; bytes: number }> = [];
    let token: string | undefined;
    for (let call = 0; call < MAX_LIST_CALLS; call++) {
      const output = (await send(
        'ListObjectsV2',
        new commands.List({
          Bucket: bucket,
          Prefix: prefix,
          MaxKeys: LIST_PAGE_SIZE,
          ...(token !== undefined && { ContinuationToken: token }),
        }),
      )) as {
        Contents?: Array<{ Key?: string; LastModified?: Date | string; Size?: number }>;
        NextContinuationToken?: string;
        IsTruncated?: boolean;
      };
      for (const object of output?.Contents ?? []) {
        const key = object.Key;
        if (typeof key !== 'string') continue;
        const ref = key.slice(prefix.length);
        if (!isArtifactRef(ref)) continue; // foreign object in a shared bucket
        rows.push({
          key,
          ref,
          serviceCreatedAt: toMillis(object.LastModified),
          bytes: typeof object.Size === 'number' ? object.Size : 0,
        });
      }
      token = output?.IsTruncated === true ? output.NextContinuationToken : undefined;
      if (token === undefined) break;
    }
    return rows;
  };

  return {
    async put(scope, input): Promise<ArtifactPutResult> {
      const at = now();
      const { meta } = await prepareArtifact(
        input,
        async (parent) => (await liveHead(scope, parent)) !== undefined,
        retention,
        at,
      );
      const bytes = canonicalPayloadBytes(input.data);
      const shape = payloadShapeOf(input.data);
      const metaValue = encodeArtifactMetaValue(meta, shape, S3_METADATA_BUDGET, 's3Artifacts');
      const swept = await applyRetention(scope, meta.bytes, at);
      await send(
        'PutObject',
        new commands.Put({
          Bucket: bucket,
          Key: keyFor(scope, meta.ref),
          Body: bytes,
          ContentType: meta.mediaType,
          Metadata: { [ARTIFACT_META_KEY]: metaValue },
        }),
      );
      return { meta, swept };
    },

    async head(scope, ref): Promise<ArtifactMeta | null> {
      return (await liveHead(scope, ref))?.meta ?? null;
    },

    async get(scope, ref): Promise<ArtifactRecord | null> {
      if (!isArtifactRef(ref)) return null;
      const key = keyFor(scope, ref);
      let output: { Body?: unknown; Metadata?: Record<string, unknown> };
      try {
        output = (await send(
          'GetObject',
          new commands.Get({ Bucket: bucket, Key: key }),
          'missing-object',
        )) as { Body?: unknown; Metadata?: Record<string, unknown> };
      } catch (err) {
        if (isMissingObject(err)) return null;
        throw err;
      }
      const ticket = decodeArtifactMetaValue(
        readMetadataEntry(output?.Metadata, ARTIFACT_META_KEY),
      );
      if (ticket === undefined) return null;
      if (isExpiredMeta(ticket.meta, now())) {
        await removeKey(key);
        return null;
      }
      const bytes = await readBodyBytes(output.Body);
      const data = decodeCanonicalPayload(ticket.shape, bytes);
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
      await removeKey(keyFor(scope, ref));
    },

    async list(scope, listOptions?: ArtifactListOptions): Promise<ArtifactListResult> {
      const keys = await listKeys(scope);
      // Order and page over the KEY rows (LastModified is free on a listing);
      // only the rows this page returns are HEADed for their tickets.
      const window = pageObjectListing(
        keys.map((row) => ({
          meta: { ref: row.ref } as ArtifactMeta,
          serviceCreatedAt: row.serviceCreatedAt,
        })),
        listOptions,
      );
      const rows: ArtifactMeta[] = [];
      for (const stub of window.artifacts) {
        const ticket = await liveHead(scope, stub.ref);
        if (ticket !== undefined) rows.push(ticket.meta);
      }
      return { artifacts: rows, ...(window.cursor !== undefined && { cursor: window.cursor }) };
    },

    async putStream(
      scope,
      input: ArtifactStreamPutInput,
      body: ReadableStream<Uint8Array>,
    ): Promise<ArtifactPutResult> {
      const at = now();
      const declared = assertStreamBytes('s3Artifacts', input.bytes);
      // The streamed payload is bytes by definition: nothing here parses it,
      // so it reads back as a Uint8Array through get() and as the same bytes
      // through getStream().
      const { meta } = await prepareArtifact(
        { ...input, data: new Uint8Array(0) },
        async (parent) => (await liveHead(scope, parent)) !== undefined,
        retention,
        at,
      );
      const stated: ArtifactMeta = { ...meta, bytes: declared };
      const metaValue = encodeArtifactMetaValue(
        stated,
        'binary',
        S3_METADATA_BUDGET,
        's3Artifacts',
      );
      const swept = await applyRetention(scope, declared, at);
      const stream = lazyRequire<typeof import('node:stream')>('node:stream');
      await send(
        'PutObject',
        new commands.Put({
          Bucket: bucket,
          Key: keyFor(scope, stated.ref),
          Body: stream.Readable.from(countedChunks(body, declared)),
          ContentLength: declared,
          ContentType: stated.mediaType,
          Metadata: { [ARTIFACT_META_KEY]: metaValue },
        }),
      );
      return { meta: stated, swept };
    },

    async getStream(scope, ref): Promise<ArtifactStreamRecord | null> {
      if (!isArtifactRef(ref)) return null;
      const key = keyFor(scope, ref);
      let output: { Body?: unknown; Metadata?: Record<string, unknown> };
      try {
        output = (await send(
          'GetObject',
          new commands.Get({ Bucket: bucket, Key: key }),
          'missing-object',
        )) as { Body?: unknown; Metadata?: Record<string, unknown> };
      } catch (err) {
        if (isMissingObject(err)) return null;
        throw err;
      }
      const ticket = decodeArtifactMetaValue(
        readMetadataEntry(output?.Metadata, ARTIFACT_META_KEY),
      );
      if (ticket === undefined) return null;
      if (isExpiredMeta(ticket.meta, now())) {
        await removeKey(key);
        return null;
      }
      return { meta: ticket.meta, body: await readBodyStream(output.Body) };
    },
  };

  /**
   * The retention pass, run at put. Returns what it swept.
   *
   * With no budget dials there is nothing to plan, so nothing is listed: a
   * put stays exactly one PutObject. Expiry still binds — it is enforced at
   * read, where it cannot be missed, and reclaimed in bulk by the lifecycle
   * rule in this file's header.
   */
  async function applyRetention(
    scope: ArtifactScope,
    incomingBytes: number,
    at: number,
  ): Promise<ArtifactPutResult['swept']> {
    if (
      retention === undefined ||
      (retention.maxBytesPerScope === undefined && retention.maxCountPerScope === undefined)
    ) {
      return [];
    }
    const keys = await listKeys(scope);
    const held: RetainedRow[] = [];
    for (const row of keys) {
      const ticket = await liveHead(scope, row.ref);
      if (ticket === undefined) continue; // missing, foreign, or just swept
      held.push({
        ref: ticket.meta.ref,
        kind: ticket.meta.kind,
        bytes: ticket.meta.bytes,
        ...(ticket.meta.expiresAt !== undefined && { expiresAt: ticket.meta.expiresAt }),
        // No cheap read-recency in an object store: oldest-first is the
        // stated law, exactly as it is for a directory.
        lastAccessedAt: ticket.meta.createdAt,
      });
    }
    const plan = planRetention(held, incomingBytes, retention, at);
    if (plan.refusal !== undefined) throw new InvalidArtifactError(plan.refusal);
    for (const gone of plan.swept) await removeKey(keyFor(scope, gone.ref));
    return plan.swept;
  }
}

/** `LastModified` as milliseconds, whatever shape it arrived in. */
function toMillis(value: Date | string | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function buildClient(sdk: S3ArtifactsSdkModule, region: string | undefined): S3ArtifactsClientLike {
  if (typeof sdk.S3Client !== 'function') {
    throw new Error(
      `[artifacts] s3Artifacts: \`@aws-sdk/client-s3\` is installed but exports no S3Client. ` +
        `Update the SDK, or pass \`client\` with a pre-built one.`,
    );
  }
  return new sdk.S3Client({ ...(region !== undefined && { region }) });
}

/**
 * The five command constructors, resolved once.
 *
 * A name this adapter reaches for and the SDK does not export is a REFUSAL,
 * never a silent `undefined` that fails as "x is not a constructor" three
 * frames away — the command-name pin exists because this package shipped that
 * bug three times.
 */
function resolveCommands(
  sdk: S3ArtifactsSdkModule,
  injected: boolean,
): {
  Put: new (input: unknown) => unknown;
  Get: new (input: unknown) => unknown;
  Head: new (input: unknown) => unknown;
  Delete: new (input: unknown) => unknown;
  List: new (input: unknown) => unknown;
} {
  const wanted = [
    'PutObjectCommand',
    'GetObjectCommand',
    'HeadObjectCommand',
    'DeleteObjectCommand',
    'ListObjectsV2Command',
  ] as const;
  const missing = wanted.filter((name) => typeof sdk[name] !== 'function');
  if (missing.length > 0) {
    if (injected && missing.length === wanted.length) {
      // An injected client with no SDK module: the double owns the wire, and
      // each command is a plain object stamped with its own operation name.
      return {
        Put: shimCommand('PutObject'),
        Get: shimCommand('GetObject'),
        Head: shimCommand('HeadObject'),
        Delete: shimCommand('DeleteObject'),
        List: shimCommand('ListObjectsV2'),
      };
    }
    throw new Error(
      `[artifacts] s3Artifacts: \`@aws-sdk/client-s3\` is installed but ${missing.join(', ')} ` +
        `${missing.length === 1 ? 'was' : 'were'} not found. Update the SDK.`,
    );
  }
  /* eslint-disable @typescript-eslint/no-non-null-assertion */
  return {
    Put: sdk.PutObjectCommand!,
    Get: sdk.GetObjectCommand!,
    Head: sdk.HeadObjectCommand!,
    Delete: sdk.DeleteObjectCommand!,
    List: sdk.ListObjectsV2Command!,
  };
  /* eslint-enable @typescript-eslint/no-non-null-assertion */
}

/** A stand-in command for an injected client: it carries the operation name
 *  and the input, so a double sees exactly which call was made. */
function shimCommand(operation: string): new (input: unknown) => unknown {
  return class {
    static readonly __command = operation;
    readonly __command = operation;
    readonly __input: unknown;
    constructor(input: unknown) {
      this.__input = input;
    }
  };
}
