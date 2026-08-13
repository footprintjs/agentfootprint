/**
 * artifacts/fileArtifacts — the claim-check store in a directory.
 *
 * One machine, one directory, nothing to install: each artifact is one JSON
 * envelope at `<dir>/<tenant>/<principal>/<conversation>/<ref>.json`, so an
 * incident can be inspected with `ls` and `cat` — a store you cannot read
 * with the tools already on the box is a store you debug by guessing.
 *
 * ── Scope-partitioned paths, structurally traversal-proof ──────────────────
 * The path is built from two kinds of segment and both are closed:
 *   • the ref — MINTED (`art_` + base62), and `isArtifactRef` is asserted
 *     before any ref touches a path anyway, because "cannot happen" is a
 *     claim, not a defence;
 *   • the scope tuple — caller strings, so each segment is percent-encoded
 *     before it becomes a directory name: `..`, `/` and `\` arrive as data
 *     and land as literals, never as navigation. That encoding is
 *     `scopePath.ts`'s to own (9.25.0) — the object-store adapters partition
 *     their keys with the identical law, and one traversal defence that lives
 *     in two files is one that eventually differs in two files.
 *
 * ── Streaming (9.25.0) ─────────────────────────────────────────────────────
 * This adapter implements the port's OPTIONAL `putStream`/`getStream`,
 * because a directory can honestly do it: the bytes go to a sibling
 * `<ref>.bin` as they arrive and the envelope records `payload: { shape:
 * 'external' }`. The envelope is written LAST, so a crash mid-upload leaves an
 * orphan `.bin` nobody can see rather than a ticket pointing at a payload that
 * never finished. A streamed artifact reads back as a `Uint8Array` through
 * `get()`, and `delete`/retention remove both files.
 *
 * ── What this adapter does NOT know ────────────────────────────────────────
 * A directory cannot cheaply know which artifact was READ last, so budget
 * evictions here are oldest-first (by mint time) rather than the in-memory
 * adapter's least-recently-used — stated here so nobody discovers it as a
 * surprise under pressure. TTL expiry behaves identically everywhere.
 *
 * Node-only (`node:fs` via lazy require, the sqliteSessions law) — importing
 * the barrel costs a browser bundle nothing; constructing one where there is
 * no filesystem refuses by name.
 */

import { lazyRequire } from '../lib/lazyRequire.js';
import { prepareArtifact } from './minting.js';
import { isArtifactRef } from './naming.js';
import {
  canonicalPayloadBytes,
  computeArtifactDigest,
  decodeArtifactData,
  encodeArtifactData,
  type EncodedPayload,
} from './payload.js';
import {
  assertRetention,
  planRetention,
  type ArtifactRetention,
  type RetainedRow,
} from './retention.js';
import { scopeSegment } from './scopePath.js';
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

/** What one artifact file holds. `format` is bumped only for a change an
 *  older reader could not survive; a newer number is refused, never half-read. */
const FILE_FORMAT = 1;

interface ArtifactEnvelope {
  readonly format: number;
  readonly meta: ArtifactMeta;
  readonly payload: EncodedPayload;
}

/** Options for {@link fileArtifacts}. */
export interface FileArtifactsOptions {
  /** The root directory. Created if missing, parents included. */
  readonly directory: string;
  /** Retention dials — all optional here: disk is a budget the operator
   *  already owns. TTL is stamped at mint; budgets sweep oldest-first. */
  readonly retention?: ArtifactRetention;
  /** @internal Test seam — the clock. Defaults to `Date.now`. */
  readonly _now?: () => number;
}

/**
 * Raised when an artifact file EXISTS but this runtime cannot read it — a
 * different fact from "no artifact", and only one of them is safe to answer
 * with `null`. (The sqliteSessions law, per file.)
 */
export class UnreadableArtifactFileError extends Error {
  readonly code = 'ERR_UNREADABLE_ARTIFACT_FILE' as const;
  readonly file: string;

  constructor(file: string, detail: string) {
    super(
      `[artifacts] the artifact file at '${file}' cannot be read: ${detail} ` +
        `An unreadable artifact and a missing one are different facts — this refuses rather ` +
        `than reporting "no data" over bytes that exist. Move the file aside to release the ref.`,
    );
    this.name = 'UnreadableArtifactFileError';
    this.file = file;
  }
}

type FsModule = typeof import('node:fs');
type PathModule = typeof import('node:path');

/**
 * A directory-backed artifact store — durable across restarts, legible to a
 * human, one file per artifact.
 *
 * @example
 *   const store = fileArtifacts({ directory: './artifacts' });
 *   const agent = Agent.create({ provider, artifacts: store });
 */
export function fileArtifacts(options: FileArtifactsOptions): ArtifactStore {
  const { directory, retention } = options;
  if (typeof directory !== 'string' || directory.trim() === '') {
    throw new TypeError(
      `[artifacts] fileArtifacts({ directory: ${JSON.stringify(directory)} }) names no ` +
        `directory. Give it a path — it will be created if it does not exist.`,
    );
  }
  assertRetention('fileArtifacts', retention);
  const now = options._now ?? Date.now;
  const fs = lazyRequire<FsModule>('node:fs');
  const path = lazyRequire<PathModule>('node:path');
  fs.mkdirSync(directory, { recursive: true });

  // One RAW tuple field → one inert directory name. The law (encode the
  // FIELD not the joined namespace; encode dots too, so a literal '..' is a
  // NAME) is `scopePath.ts`'s — shared with the object-store adapters rather
  // than restated here.
  const scopeDir = (scope: ArtifactScope): string =>
    path.join(
      directory,
      scopeSegment(scope.tenant),
      scopeSegment(scope.principal),
      scopeSegment(scope.conversationId),
    );

  const fileFor = (scope: ArtifactScope, ref: ArtifactRef): string =>
    path.join(scopeDir(scope), `${ref}.json`);

  /** Where a STREAMED payload's bytes live: beside the envelope. */
  const payloadFileFor = (scope: ArtifactScope, ref: ArtifactRef): string =>
    path.join(scopeDir(scope), `${ref}.bin`);

  /** Remove an artifact's files — the envelope and, when it was streamed,
   *  the sibling payload. One remover, so no caller can forget half. */
  const removeArtifactFiles = (scope: ArtifactScope, ref: ArtifactRef): void => {
    fs.rmSync(fileFor(scope, ref), { force: true });
    fs.rmSync(payloadFileFor(scope, ref), { force: true });
  };

  const readEnvelope = (file: string): ArtifactEnvelope | undefined => {
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      return undefined; // never written (or already swept) — the null case.
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new UnreadableArtifactFileError(file, 'it is not JSON.');
    }
    const candidate = parsed as Partial<ArtifactEnvelope> | null;
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      typeof candidate.format !== 'number' ||
      candidate.meta === undefined ||
      candidate.payload === undefined
    ) {
      throw new UnreadableArtifactFileError(file, 'it is not an artifact envelope.');
    }
    if (candidate.format > FILE_FORMAT) {
      throw new UnreadableArtifactFileError(
        file,
        `it was written with format ${candidate.format} and this runtime reads format ` +
          `${FILE_FORMAT}; roll agentfootprint forward rather than half-read it.`,
      );
    }
    return candidate as ArtifactEnvelope;
  };

  /** Read a LIVE envelope; sweep the file when the calendar says it is gone. */
  const liveEnvelope = (scope: ArtifactScope, ref: ArtifactRef): ArtifactEnvelope | undefined => {
    if (!isArtifactRef(ref)) return undefined;
    const file = fileFor(scope, ref);
    const envelope = readEnvelope(file);
    if (envelope === undefined) return undefined;
    if (envelope.meta.expiresAt !== undefined && envelope.meta.expiresAt <= now()) {
      removeArtifactFiles(scope, ref);
      return undefined;
    }
    return envelope;
  };

  /** Every live meta in a scope (expired files swept as they are found). */
  const scopeMetas = (scope: ArtifactScope): ArtifactMeta[] => {
    const dir = scopeDir(scope);
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return []; // scope never wrote anything.
    }
    const at = now();
    const metas: ArtifactMeta[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const ref = name.slice(0, -'.json'.length);
      if (!isArtifactRef(ref)) continue; // not ours; leave foreign files alone.
      const envelope = readEnvelope(path.join(dir, name));
      if (envelope === undefined) continue;
      if (envelope.meta.expiresAt !== undefined && envelope.meta.expiresAt <= at) {
        removeArtifactFiles(scope, ref);
        continue;
      }
      metas.push(envelope.meta);
    }
    return metas;
  };

  return {
    async put(scope, input): Promise<ArtifactPutResult> {
      const at = now();
      const { meta } = await prepareArtifact(
        input,
        (parent) => liveEnvelope(scope, parent) !== undefined,
        retention,
        at,
      );
      const rows: RetainedRow[] = scopeMetas(scope).map((held) => ({
        ref: held.ref,
        kind: held.kind,
        bytes: held.bytes,
        ...(held.expiresAt !== undefined && { expiresAt: held.expiresAt }),
        // A directory has no cheap read-recency; oldest-first is the stated law.
        lastAccessedAt: held.createdAt,
      }));
      const plan = planRetention(rows, meta.bytes, retention, at);
      if (plan.refusal !== undefined) throw new InvalidArtifactError(plan.refusal);
      for (const swept of plan.swept) removeArtifactFiles(scope, swept.ref);
      const envelope: ArtifactEnvelope = {
        format: FILE_FORMAT,
        meta,
        payload: encodeArtifactData(input.data),
      };
      fs.mkdirSync(scopeDir(scope), { recursive: true });
      fs.writeFileSync(fileFor(scope, meta.ref), JSON.stringify(envelope));
      return { meta, swept: plan.swept };
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async head(scope, ref): Promise<ArtifactMeta | null> {
      return liveEnvelope(scope, ref)?.meta ?? null;
    },

    async get(scope, ref): Promise<ArtifactRecord | null> {
      const envelope = liveEnvelope(scope, ref);
      if (envelope === undefined) return null;
      // A STREAMED payload lives beside the envelope: this adapter is the one
      // that knows where, so it reads the bytes rather than asking the shared
      // decoder to reach a file it cannot see.
      const data =
        envelope.payload.shape === 'external'
          ? readPayloadFile(scope, envelope.meta.ref)
          : decodeArtifactData(envelope.payload);
      if (data === undefined) return null; // the sibling bytes are gone
      if (envelope.meta.digest !== undefined) {
        const actual = await computeArtifactDigest(data);
        if (actual !== envelope.meta.digest) {
          throw new ArtifactIntegrityError(envelope.meta.ref, envelope.meta.digest, actual);
        }
      }
      return { meta: envelope.meta, data };
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async delete(scope, ref): Promise<void> {
      if (!isArtifactRef(ref)) return;
      removeArtifactFiles(scope, ref);
    },

    // eslint-disable-next-line @typescript-eslint/require-await
    async list(scope, listOptions?: ArtifactListOptions): Promise<ArtifactListResult> {
      const all = scopeMetas(scope).sort(
        (a, b) => b.createdAt - a.createdAt || (a.ref < b.ref ? -1 : 1),
      );
      const offset = decodeCursor(listOptions?.cursor);
      const limit = Math.max(1, Math.floor(listOptions?.limit ?? 50));
      const page = all.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      return {
        artifacts: page,
        ...(nextOffset < all.length && { cursor: String(nextOffset) }),
      };
    },

    /**
     * The streamed put: bytes to `<ref>.bin` as they arrive, envelope LAST.
     *
     * The declared `bytes` is what retention plans against, and it is
     * VERIFIED as the stream ends — a producer that said 10 MB and sent 11 is
     * refused by name and leaves nothing behind, because a ticket that
     * misdescribes its own payload is the accepted-and-silently-wrong failure
     * this whole folder exists to prevent.
     */
    async putStream(
      scope,
      input: ArtifactStreamPutInput,
      body: ReadableStream<Uint8Array>,
    ): Promise<ArtifactPutResult> {
      const at = now();
      const declared = assertStreamBytes('fileArtifacts', input.bytes);
      const { meta } = await prepareArtifact(
        { ...input, data: new Uint8Array(0) },
        (parent) => liveEnvelope(scope, parent) !== undefined,
        retention,
        at,
      );
      const stated: ArtifactMeta = { ...meta, bytes: declared };
      const rows: RetainedRow[] = scopeMetas(scope).map((held) => ({
        ref: held.ref,
        kind: held.kind,
        bytes: held.bytes,
        ...(held.expiresAt !== undefined && { expiresAt: held.expiresAt }),
        lastAccessedAt: held.createdAt,
      }));
      const plan = planRetention(rows, declared, retention, at);
      if (plan.refusal !== undefined) throw new InvalidArtifactError(plan.refusal);
      for (const swept of plan.swept) removeArtifactFiles(scope, swept.ref);

      fs.mkdirSync(scopeDir(scope), { recursive: true });
      const payloadFile = payloadFileFor(scope, stated.ref);
      const handle = fs.openSync(payloadFile, 'w');
      let written = 0;
      try {
        const reader = body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value === undefined) continue;
            written += value.byteLength;
            if (written > declared) {
              await reader.cancel();
              break;
            }
            fs.writeSync(handle, value);
          }
        } finally {
          reader.releaseLock();
        }
      } finally {
        fs.closeSync(handle);
      }
      if (written !== declared) {
        fs.rmSync(payloadFile, { force: true });
        throw new InvalidArtifactError(
          `fileArtifacts: the streamed payload is ${written} bytes but declared ${declared}. ` +
            `Nothing was stored: a ticket whose \`bytes\` misdescribes its own payload would ` +
            `be believed by every later consumer. State the exact byte length.`,
        );
      }
      // The envelope LAST: a crash before this line leaves an orphan .bin that
      // no ref names, never a ticket pointing at an unfinished payload.
      const envelope: ArtifactEnvelope = {
        format: FILE_FORMAT,
        meta: stated,
        payload: { shape: 'external', value: `${stated.ref}.bin` },
      };
      fs.writeFileSync(fileFor(scope, stated.ref), JSON.stringify(envelope));
      return { meta: stated, swept: plan.swept };
    },

    /** The streamed read: the payload's canonical bytes, straight off disk
     *  for a streamed artifact, and as one chunk for an inline one (this
     *  store held it whole — it says so rather than pretending to be lazy). */
    // eslint-disable-next-line @typescript-eslint/require-await
    async getStream(scope, ref): Promise<ArtifactStreamRecord | null> {
      const envelope = liveEnvelope(scope, ref);
      if (envelope === undefined) return null;
      if (envelope.payload.shape === 'external') {
        const file = payloadFileFor(scope, envelope.meta.ref);
        if (!fs.existsSync(file)) return null;
        const stream = lazyRequire<typeof import('node:stream')>('node:stream');
        return {
          meta: envelope.meta,
          body: stream.Readable.toWeb(
            fs.createReadStream(file) as unknown as import('node:stream').Readable,
          ) as ReadableStream<Uint8Array>,
        };
      }
      return {
        meta: envelope.meta,
        body: bytesAsStream(canonicalPayloadBytes(decodeArtifactData(envelope.payload))),
      };
    },
  };

  /** The bytes of a streamed payload, or undefined when the sibling file is
   *  gone (an interrupted write, an external deletion) — which is "no data",
   *  the same answer a missing envelope gives. */
  function readPayloadFile(scope: ArtifactScope, ref: ArtifactRef): Uint8Array | undefined {
    try {
      return new Uint8Array(fs.readFileSync(payloadFileFor(scope, ref)));
    } catch {
      return undefined;
    }
  }
}

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const parsed = Number(cursor);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}
