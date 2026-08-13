/**
 * artifacts/streaming — the OPTIONAL leg of the port, and how to ask for it.
 *
 * A claim check exists so a 6 MB result never rides the conversation. It does
 * not follow that the 6 MB should ride the PROCESS: a store that can accept
 * bytes as they arrive, and hand them back the same way, lets a report be
 * written to a bucket without ever existing whole in memory. That is what
 * `putStream` / `getStream` are for.
 *
 * ── Why OPTIONAL members and not two more verbs ─────────────────────────────
 * Not every backend can honor the promise, and the ones that cannot must say
 * so by ABSENCE rather than by faking it. A `Map`-backed store "streaming"
 * bytes it already holds whole would be theatre: the memory was already spent,
 * and a consumer that chose it to bound memory would have been told a
 * falsehood in the shape of a capability. So:
 *
 *   • `fileArtifacts`  — YES. The bytes go to a sibling file as they arrive.
 *   • object stores    — YES, through the SDK's own streaming upload/download.
 *   • `sqliteArtifacts`— NO. `node:sqlite` reads and writes a BLOB whole;
 *                        there is no incremental blob I/O to build on, so a
 *                        stream here would buffer everything and call it a
 *                        stream.
 *   • `inMemoryArtifacts` — NO, by design. It holds payloads whole, under a
 *                        byte budget; streaming into it would defeat both.
 *
 * ── Web streams, one shape ──────────────────────────────────────────────────
 * `ReadableStream<Uint8Array>` — the shape that exists in every supported Node
 * AND in a browser, so the port stays the same object everywhere the rest of
 * this folder already works (the Buffer-free base64 law in `payload.ts`, for
 * the same reason). Node-native adapters bridge at their own edge with
 * `Readable.toWeb` / `Readable.fromWeb`; that bridge is an ADAPTER detail and
 * never leaks into the port.
 *
 * ── What `ctx.artifacts` does NOT get, and why (a decision, not an omission) ─
 * The tool-facing capability keeps FIVE verbs this phase. A tool receives its
 * artifacts pre-scoped and answers a model; the model cannot hold a stream,
 * and a tool that genuinely moves gigabytes wants the store itself, with its
 * own lifecycle and its own error handling. So a tool that needs streaming
 * holds the store (it already constructed it) and calls it directly — while
 * `ctx.artifacts` stays the small, safe, scope-bound surface a model-driven
 * tool can be trusted with.
 */

import { InvalidArtifactError, type ArtifactStore } from './types.js';

/** An {@link ArtifactStore} that really implements `putStream`. */
export type PutStreamingArtifactStore = ArtifactStore & Required<Pick<ArtifactStore, 'putStream'>>;

/** An {@link ArtifactStore} that really implements `getStream`. */
export type GetStreamingArtifactStore = ArtifactStore & Required<Pick<ArtifactStore, 'getStream'>>;

/** An {@link ArtifactStore} that implements BOTH streaming members. */
export type StreamingArtifactStore = ArtifactStore &
  Required<Pick<ArtifactStore, 'putStream' | 'getStream'>>;

/**
 * Can this store take a streamed put? Narrowing type guard — the answer is
 * the type, so a consumer branches once and the compiler carries it.
 *
 * @example
 *   if (canPutArtifactStream(store)) await store.putStream(scope, input, body);
 *   else await store.put(scope, { ...input, data: await collect(body) });
 */
export function canPutArtifactStream(store: ArtifactStore): store is PutStreamingArtifactStore {
  return typeof store.putStream === 'function';
}

/** Can this store hand back a stream? Narrowing type guard. */
export function canGetArtifactStream(store: ArtifactStore): store is GetStreamingArtifactStore {
  return typeof store.getStream === 'function';
}

/** Both halves at once — for a consumer that needs the round trip. */
export function canStreamArtifacts(store: ArtifactStore): store is StreamingArtifactStore {
  return canPutArtifactStream(store) && canGetArtifactStream(store);
}

/**
 * Read a stream to its bytes, refusing at a ceiling instead of growing until
 * the process dies.
 *
 * Adapters that must hold the payload to store it (an object `put` of a
 * declared length) use this, and so does any consumer bridging a stream into
 * `put`. The ceiling is the caller's declared `bytes`: a producer that says
 * 10 MB and sends 11 is refused rather than trusted, because the meta it
 * would otherwise mint describes a payload that does not exist.
 */
export async function collectStream(
  body: ReadableStream<Uint8Array>,
  ceiling: number,
): Promise<{ readonly bytes: Uint8Array; readonly overflowed: boolean }> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > ceiling) {
        await reader.cancel();
        return { bytes: new Uint8Array(0), overflowed: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes: out, overflowed: false };
}

/** One chunk of bytes as a web stream — how a store that HOLDS the payload
 *  answers `getStream` honestly (it never claimed to be lazy; it is handing
 *  over what it has, in the port's shape). */
export function bytesAsStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** The stated `bytes` on a streamed put, checked before anything is stored. */
export function assertStreamBytes(adapter: string, bytes: unknown): number {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
    throw new InvalidArtifactError(
      `${adapter}: putStream needs a stated \`bytes\` (got ${JSON.stringify(bytes)}). A stream ` +
        `has no length until it ends, and both the retention plan and the upload need the size ` +
        `BEFORE the first chunk. State the exact byte length, or use put() with the payload.`,
    );
  }
  return Math.floor(bytes);
}
