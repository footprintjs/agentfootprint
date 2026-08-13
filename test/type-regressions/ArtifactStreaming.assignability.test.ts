/**
 * Compile-level regression — the OPTIONAL streaming leg is honest AT THE TYPE.
 *
 * The promise in the port's header is not "detect before you call" as advice;
 * it is that the compiler enforces it. Three things are pinned here, and each
 * one is a bug this file exists to make impossible:
 *
 *   1. **Calling `putStream`/`getStream` on a bare `ArtifactStore` does not
 *      compile.** If the members were declared non-optional "for convenience",
 *      every consumer would compile against `inMemoryArtifacts` and fail at
 *      run time on the one store that cannot stream — the accepted-and-
 *      silently-wrong shape, in a capability.
 *   2. **The guards NARROW.** After `canStreamArtifacts(store)`, the call is
 *      legal with no `!` and no cast, so the honest branch is also the
 *      comfortable one.
 *   3. **A streamed put has no `digest` field at all.** Absent at the type,
 *      not refused at run time: a store that never holds the payload whole
 *      cannot produce the digest every other adapter computes the same way,
 *      and an option you can pass and have ignored is worse than one that
 *      does not exist.
 *
 * Lives under ./tsconfig.json (`npm run test:types`); the runtime half is
 * `test/artifacts/streaming.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type {
  ArtifactScope,
  ArtifactStore,
  ArtifactStreamPutInput,
  StreamingArtifactStore,
} from '../../src/index';
import {
  canGetArtifactStream,
  canPutArtifactStream,
  canStreamArtifacts,
  inMemoryArtifacts,
} from '../../src/index';

const SCOPE: ArtifactScope = { conversationId: 'c-1' };

// ─── 1. The absent member is a TYPE error, not a runtime surprise ──

declare const body: ReadableStream<Uint8Array>;

/** Never called — its body exists to be COMPILED. */
function undetectedCallsDoNotCompile(anyStore: ArtifactStore): void {
  // putStream is optional on the port: an undetected call is exactly the
  // mistake this optionality exists to prevent.
  // @ts-expect-error putStream is optional: calling it undetected must not compile.
  void anyStore.putStream(SCOPE, { kind: 'k', mediaType: 't', bytes: 1 }, body);
  // ...and the same for the read half.
  // @ts-expect-error getStream is optional: calling it undetected must not compile.
  void anyStore.getStream(SCOPE, 'art_aaaaaaaaaaaaaaaaaaaaaa');
}

// ─── 2. The guards narrow, so the honest branch compiles clean ─────

function streamThrough(store: ArtifactStore): Promise<unknown> | undefined {
  if (!canPutArtifactStream(store)) return undefined;
  // No `!`, no cast: the guard did the work.
  return store.putStream(SCOPE, { kind: 'k', mediaType: 't', bytes: 1 }, body);
}

function readThrough(store: ArtifactStore): Promise<unknown> | undefined {
  return canGetArtifactStream(store)
    ? store.getStream(SCOPE, 'art_aaaaaaaaaaaaaaaaaaaaaa')
    : undefined;
}

/** Never called — the STREAMING type needs no guard at all. */
function aStreamingStoreNeedsNoGuard(streaming: StreamingArtifactStore): void {
  void streaming.putStream(SCOPE, { kind: 'k', mediaType: 't', bytes: 1 }, body);
  void streaming.getStream(SCOPE, 'art_aaaaaaaaaaaaaaaaaaaaaa');
}

// ─── 3. `bytes` is required; `digest` does not exist ───────────────

const stated: ArtifactStreamPutInput = { kind: 'k', mediaType: 't', bytes: 10 };

// `bytes` is not optional — retention and the upload both need the size
// BEFORE the first chunk.
// @ts-expect-error `bytes` is required on a streamed put — omitting it must not compile.
const missingBytes: ArtifactStreamPutInput = { kind: 'k', mediaType: 't' };

// There is no `digest` on a streamed put: a store that never holds the payload
// whole cannot compute one, and an option you can pass and have ignored is
// worse than one that does not exist.
// prettier-ignore
// @ts-expect-error a streamed put has no `digest` field at all — passing one must not compile.
const withDigest: ArtifactStreamPutInput = { kind: 'k', mediaType: 't', bytes: 10, digest: 'sha-256' };

describe('artifact streaming — the runtime twin of the type claims', () => {
  it('the compile-only fixtures exist (never invoked — their BODIES are the test)', () => {
    expect(typeof undetectedCallsDoNotCompile).toBe('function');
    expect(typeof aStreamingStoreNeedsNoGuard).toBe('function');
  });

  it('the guards agree with the types they narrow to', () => {
    const memory = inMemoryArtifacts();
    expect(canStreamArtifacts(memory)).toBe(false);
    expect(streamThrough(memory)).toBeUndefined();
    expect(readThrough(memory)).toBeUndefined();
  });

  it('a stated stream input carries its declared length', () => {
    expect(stated.bytes).toBe(10);
    // Referenced so the deliberately-broken literals are not unused symbols.
    expect([missingBytes, withDigest].length).toBe(2);
  });
});
