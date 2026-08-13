/**
 * EMULATION DOUBLES for the two object-storage services — the boundary the
 * cloud artifact adapters talk to, simulated in memory.
 *
 * Why doubles and not live calls: a contract suite must run on a laptop with
 * no credentials, in CI, offline, in milliseconds. What the doubles are NOT
 * allowed to be is generous — each one answers exactly the operations its
 * adapter is pinned to (`test/adapters/aws/awsCommandPin.ts`,
 * `test/adapters/google/googlePin.ts`), with the SHAPES this repository read
 * out of the installed SDK type definitions before the adapters were written:
 *
 *   • S3 — `send(new XCommand(input))`; `GetObject` answers a body carrying
 *     the SDK's stream mixin (`transformToByteArray` / `transformToWebStream`),
 *     never a bare buffer, because that mixin is exactly the thing an adapter
 *     can get wrong; `ListObjectsV2` answers `Contents[{Key,Size,LastModified}]`
 *     + `NextContinuationToken` and never user metadata; a missing key throws
 *     with `$metadata.httpStatusCode: 404` and the service's own error name.
 *   • Cloud Storage — the METHOD CHAIN `storage.bucket(b).file(k)`; a listing
 *     answers File objects with `.metadata` already populated (custom entries
 *     included — the real client does this, and it is why that adapter's
 *     `list` needs no per-row read); a missing object throws `{ code: 404 }`.
 *
 * Both take the test's clock, so creation times move with the fake calendar
 * the contract suite drives.
 *
 * The division of labour, stated: these prove BEHAVIOR. That the names and
 * shapes here match the real SDKs is proved separately by the pin tests, one
 * of which runs against the really-installed package.
 */

import { Readable, Writable } from 'node:stream';

// ─────────────────────────────────────────────────────────────────────
// S3
// ─────────────────────────────────────────────────────────────────────

interface StoredObject {
  body: Uint8Array;
  metadata: Record<string, string>;
  contentType?: string;
  lastModified: Date;
}

export interface FakeS3 {
  /** Pass as `_client`. */
  readonly client: { send(command: unknown): Promise<unknown> };
  /** Every operation that reached `send`, in order. */
  readonly sent: string[];
  /** The bucket's contents, for a test that wants to look. */
  readonly objects: Map<string, StoredObject>;
  /** Make the next call of this operation fail with a given error. */
  failNext(operation: string, error: unknown): void;
}

function notFound(): Error {
  const err = new Error('The specified key does not exist.');
  err.name = 'NoSuchKey';
  (err as unknown as { $metadata: { httpStatusCode: number } }).$metadata = {
    httpStatusCode: 404,
  };
  return err;
}

/** A body with the SDK's stream mixin, as the real GetObject answers. */
function sdkBody(bytes: Uint8Array): Record<string, unknown> {
  return {
    transformToByteArray: () => Promise.resolve(bytes),
    transformToWebStream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
  };
}

async function collect(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
    chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
  }
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** An in-memory S3, speaking the five pinned commands and nothing else. */
export function fakeS3(now: () => number = Date.now): FakeS3 {
  const objects = new Map<string, StoredObject>();
  const sent: string[] = [];
  const failures = new Map<string, unknown>();

  const client = {
    async send(command: unknown): Promise<unknown> {
      const cmd = command as { __command?: string; __input?: Record<string, unknown> };
      const operation = cmd.__command ?? '(not a command)';
      const input = cmd.__input ?? {};
      sent.push(operation);
      if (failures.has(operation)) {
        const err = failures.get(operation);
        failures.delete(operation);
        throw err;
      }
      const key = String(input.Key ?? '');
      switch (operation) {
        case 'PutObject': {
          objects.set(key, {
            body: await collect(input.Body),
            metadata: { ...((input.Metadata as Record<string, string>) ?? {}) },
            ...(typeof input.ContentType === 'string' && { contentType: input.ContentType }),
            lastModified: new Date(now()),
          });
          return {};
        }
        case 'HeadObject': {
          const held = objects.get(key);
          if (!held) throw notFound();
          // S3 lower-cases user-metadata keys in transit; the double does too,
          // so an adapter that reads them case-sensitively fails HERE.
          return {
            Metadata: Object.fromEntries(
              Object.entries(held.metadata).map(([k, v]) => [k.toLowerCase(), v]),
            ),
            ContentLength: held.body.byteLength,
            ContentType: held.contentType,
            LastModified: held.lastModified,
          };
        }
        case 'GetObject': {
          const held = objects.get(key);
          if (!held) throw notFound();
          return {
            Body: sdkBody(held.body),
            Metadata: Object.fromEntries(
              Object.entries(held.metadata).map(([k, v]) => [k.toLowerCase(), v]),
            ),
            ContentType: held.contentType,
            LastModified: held.lastModified,
          };
        }
        case 'DeleteObject': {
          objects.delete(key); // S3 deletes an absence without complaint
          return {};
        }
        case 'ListObjectsV2': {
          const prefix = String(input.Prefix ?? '');
          const limit = typeof input.MaxKeys === 'number' ? input.MaxKeys : 1000;
          const all = [...objects.entries()]
            .filter(([name]) => name.startsWith(prefix))
            .sort(([a], [b]) => (a < b ? -1 : 1)); // S3 lists lexicographically
          const start =
            typeof input.ContinuationToken === 'string' ? Number(input.ContinuationToken) : 0;
          const page = all.slice(start, start + limit);
          const next = start + page.length;
          return {
            Contents: page.map(([name, held]) => ({
              Key: name,
              Size: held.body.byteLength,
              LastModified: held.lastModified,
            })),
            KeyCount: page.length,
            IsTruncated: next < all.length,
            ...(next < all.length && { NextContinuationToken: String(next) }),
          };
        }
        default:
          throw new Error(`fakeS3: unexpected operation '${operation}'`);
      }
    },
  };

  return {
    client,
    sent,
    objects,
    failNext(operation, error) {
      failures.set(operation, error);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Cloud Storage
// ─────────────────────────────────────────────────────────────────────

interface StoredBlob {
  bytes: Uint8Array;
  contentType?: string;
  timeCreated: string;
  custom: Record<string, string>;
}

export interface FakeGcs {
  /** Pass as `_storage`. */
  readonly storage: { bucket(name: string): unknown };
  readonly calls: string[];
  readonly blobs: Map<string, StoredBlob>;
  failNext(method: string, error: unknown): void;
}

function gcsNotFound(): Error {
  const err = new Error('No such object.');
  (err as unknown as { code: number }).code = 404;
  return err;
}

/** An in-memory Cloud Storage, speaking the pinned method chain. */
export function fakeGcs(now: () => number = Date.now): FakeGcs {
  const blobs = new Map<string, StoredBlob>();
  const calls: string[] = [];
  const failures = new Map<string, unknown>();

  const guard = (method: string): void => {
    calls.push(method);
    if (failures.has(method)) {
      const err = failures.get(method);
      failures.delete(method);
      throw err;
    }
  };

  const metadataOf = (name: string, held: StoredBlob): Record<string, unknown> => ({
    name,
    size: String(held.bytes.byteLength),
    timeCreated: held.timeCreated,
    updated: held.timeCreated,
    contentType: held.contentType,
    metadata: { ...held.custom },
  });

  const makeFile = (name: string, seeded?: StoredBlob): Record<string, unknown> => ({
    name,
    metadata: seeded ? metadataOf(name, seeded) : undefined,
    save(data: Uint8Array | string, options?: Record<string, unknown>): Promise<void> {
      guard('save');
      const meta = (options?.metadata ?? {}) as { metadata?: Record<string, string> };
      blobs.set(name, {
        bytes: typeof data === 'string' ? new TextEncoder().encode(data) : data,
        ...(typeof options?.contentType === 'string' && { contentType: options.contentType }),
        timeCreated: new Date(now()).toISOString(),
        custom: { ...(meta.metadata ?? {}) },
      });
      return Promise.resolve();
    },
    download(): Promise<[Uint8Array]> {
      guard('download');
      const held = blobs.get(name);
      if (!held) throw gcsNotFound();
      return Promise.resolve([held.bytes]);
    },
    getMetadata(): Promise<[Record<string, unknown>, unknown]> {
      guard('getMetadata');
      const held = blobs.get(name);
      if (!held) throw gcsNotFound();
      return Promise.resolve([metadataOf(name, held), {}]);
    },
    delete(options?: { ignoreNotFound?: boolean }): Promise<unknown> {
      guard('delete');
      if (!blobs.has(name) && options?.ignoreNotFound !== true) throw gcsNotFound();
      blobs.delete(name);
      return Promise.resolve({});
    },
    createReadStream(): Readable {
      guard('createReadStream');
      const held = blobs.get(name);
      if (!held) throw gcsNotFound();
      return Readable.from([held.bytes]);
    },
    createWriteStream(options?: Record<string, unknown>): NodeJS.WritableStream {
      guard('createWriteStream');
      const meta = (options?.metadata ?? {}) as { metadata?: Record<string, string> };
      const chunks: Uint8Array[] = [];
      return new Writable({
        write(chunk: Uint8Array, _enc: string, cb: () => void) {
          chunks.push(Uint8Array.from(chunk));
          cb();
        },
        final(cb: () => void) {
          const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
          const bytes = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          blobs.set(name, {
            bytes,
            ...(typeof options?.contentType === 'string' && { contentType: options.contentType }),
            timeCreated: new Date(now()).toISOString(),
            custom: { ...(meta.metadata ?? {}) },
          });
          cb();
        },
      });
    },
  });

  const bucket = {
    file: (name: string) => makeFile(name),
    getFiles(query?: Record<string, unknown>): Promise<[unknown[], unknown, unknown]> {
      guard('getFiles');
      const prefix = String(query?.prefix ?? '');
      const limit = typeof query?.maxResults === 'number' ? query.maxResults : 1000;
      const all = [...blobs.entries()]
        .filter(([name]) => name.startsWith(prefix))
        .sort(([a], [b]) => (a < b ? -1 : 1));
      const start = typeof query?.pageToken === 'string' ? Number(query.pageToken) : 0;
      const page = all.slice(start, start + limit);
      const next = start + page.length;
      // The real client hands back File instances with `.metadata` populated.
      return Promise.resolve([
        page.map(([name, held]) => makeFile(name, held)),
        next < all.length ? { pageToken: String(next) } : null,
        {},
      ]);
    },
  };

  return {
    storage: { bucket: () => bucket },
    calls,
    blobs,
    failNext(method, error) {
      failures.set(method, error);
    },
  };
}
