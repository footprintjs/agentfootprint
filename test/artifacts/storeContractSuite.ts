/**
 * THE ArtifactStore contract suite — one definition, run against every adapter.
 *
 * The port's promise is that a tool written against `inMemoryArtifacts` behaves
 * the same against a bucket. A contract suite COPIED per adapter cannot keep
 * that promise: the copies drift the moment somebody adds a law to one of them,
 * and each copy passing proves only that it agrees with itself. So the suite
 * lives here, is imported by every adapter's test file, and a new law added
 * once is a law every adapter must immediately satisfy — including the two
 * cloud columns, which run it against emulation doubles.
 *
 * What belongs HERE: the five verbs' behavior, promised by the port to every
 * caller. What stays in an adapter's own file: how it stores bytes, what its
 * construction refuses, what a call costs on that column.
 */

import { describe, expect, it } from 'vitest';
import {
  InvalidArtifactError,
  isArtifactRef,
  mintArtifactRef,
  UnknownParentRefError,
  type ArtifactScope,
  type ArtifactStore,
} from '../../src/index.js';

export const SCOPE: ArtifactScope = { conversationId: 'conv-a' };
export const OTHER_SCOPE: ArtifactScope = { conversationId: 'conv-b' };

/** A controllable clock every adapter accepts through its test seam. */
export const clock = () => {
  let at = 1_000_000;
  return { now: () => at, tick: (ms: number) => (at += ms) };
};

/** How a suite builds the adapter under test, with time injected. */
export type MakeStore = (now: () => number) => ArtifactStore;

/**
 * Run the five-verb contract against one adapter.
 *
 * @param name     the adapter's factory name, for the suite title.
 * @param makeStore builds a fresh store bound to the injected clock.
 * @param suite    `describe` variant, so an adapter whose backend may be
 *                 unavailable (node:sqlite on Node 20) can skip as a whole.
 */
export function contractSuite(
  name: string,
  makeStore: MakeStore,
  suite: typeof describe = describe,
): void {
  suite(`${name} — the five-verb contract`, () => {
    it('put mints a ticket; head describes without bytes; get returns meta + data', async () => {
      const time = clock();
      const store = makeStore(time.now);
      const { meta, swept } = await store.put(SCOPE, {
        kind: 'dataset/rows',
        mediaType: 'application/json',
        data: { rows: [1, 2, 3] },
        label: 'Q3 rows',
      });
      expect(swept).toEqual([]);
      expect(isArtifactRef(meta.ref)).toBe(true);
      expect(meta).toMatchObject({ kind: 'dataset/rows', label: 'Q3 rows' });
      expect(meta.bytes).toBe(JSON.stringify({ rows: [1, 2, 3] }).length);

      const head = await store.head(SCOPE, meta.ref);
      expect(head).toMatchObject({ ref: meta.ref, kind: 'dataset/rows' });
      expect(head).not.toHaveProperty('data');

      const got = await store.get(SCOPE, meta.ref);
      expect(got?.meta.ref).toBe(meta.ref);
      expect(got?.data).toEqual({ rows: [1, 2, 3] });
    });

    it('round-trips every payload shape as the value it was given', async () => {
      const time = clock();
      const store = makeStore(time.now);
      const cases: ReadonlyArray<[string, unknown, string]> = [
        ['json', { a: [1, 2], b: 'x' }, 'application/json'],
        ['text', 'plain, with an em-dash — and a ünicode name', 'text/plain'],
        ['binary', new Uint8Array([0, 1, 2, 250, 255]), 'application/octet-stream'],
      ];
      for (const [label, data, mediaType] of cases) {
        const { meta } = await store.put(SCOPE, { kind: label, mediaType, data });
        const got = await store.get(SCOPE, meta.ref);
        expect(got?.data, `${label} must round-trip as the value it was given`).toEqual(data);
      }
    });

    it('a ref alone opens NOTHING — the same ref under another scope is null', async () => {
      const time = clock();
      const store = makeStore(time.now);
      const { meta } = await store.put(SCOPE, {
        kind: 'dataset/rows',
        mediaType: 'application/json',
        data: [1],
      });
      expect(await store.head(OTHER_SCOPE, meta.ref)).toBeNull();
      expect(await store.get(OTHER_SCOPE, meta.ref)).toBeNull();
      // and tenants are part of the tuple, not decoration
      expect(await store.get({ ...SCOPE, tenant: 't2' }, meta.ref)).toBeNull();
      // the owner still resolves
      expect(await store.get(SCOPE, meta.ref)).not.toBeNull();
    });

    it('get/head return null for missing AND for expired — the deliberate ambiguity', async () => {
      const time = clock();
      const store = makeStore(time.now);
      expect(await store.get(SCOPE, mintArtifactRef())).toBeNull();
      const { meta } = await store.put(SCOPE, {
        kind: 'k',
        mediaType: 'text/plain',
        data: 'x',
        expiresAt: time.now() + 100,
      });
      expect(meta.expiresAt).toBe(time.now() + 100);
      expect(await store.get(SCOPE, meta.ref)).not.toBeNull();
      time.tick(101);
      expect(await store.get(SCOPE, meta.ref)).toBeNull();
      expect(await store.head(SCOPE, meta.ref)).toBeNull();
    });

    it('ttl retention stamps expiresAt at mint — expiry is stated, never sprung', async () => {
      const time = clock();
      const store = makeStore(time.now);
      // no caller expiresAt; ttl comes from adapters constructed with ttlMs 1000 in
      // the specific suites below — here we assert the caller statement survives.
      const { meta } = await store.put(SCOPE, {
        kind: 'k',
        mediaType: 'text/plain',
        data: 'x',
        expiresAt: time.now() + 60_000,
      });
      expect(meta.expiresAt).toBe(time.now() + 60_000);
    });

    it('delete removes; deleting an absence is agreement, not an error', async () => {
      const time = clock();
      const store = makeStore(time.now);
      const { meta } = await store.put(SCOPE, { kind: 'k', mediaType: 't', data: 'x' });
      await store.delete(SCOPE, meta.ref);
      expect(await store.get(SCOPE, meta.ref)).toBeNull();
      await expect(store.delete(SCOPE, meta.ref)).resolves.toBeUndefined();
      await expect(store.delete(SCOPE, 'not-a-ref')).resolves.toBeUndefined();
    });

    it('list pages newest-first with a cursor and never carries bytes', async () => {
      const time = clock();
      const store = makeStore(time.now);
      for (let i = 0; i < 5; i++) {
        await store.put(SCOPE, { kind: `k${i}`, mediaType: 't', data: `v${i}` });
        time.tick(10);
      }
      const page1 = await store.list(SCOPE, { limit: 2 });
      expect(page1.artifacts).toHaveLength(2);
      expect(page1.artifacts[0].kind).toBe('k4'); // newest first
      expect(page1.cursor).toBeDefined();
      const page2 = await store.list(SCOPE, { limit: 2, cursor: page1.cursor });
      expect(page2.artifacts).toHaveLength(2);
      const page3 = await store.list(SCOPE, { limit: 2, cursor: page2.cursor });
      expect(page3.artifacts).toHaveLength(1);
      expect(page3.cursor).toBeUndefined();
      const kinds = [...page1.artifacts, ...page2.artifacts, ...page3.artifacts].map((m) => m.kind);
      expect(kinds).toEqual(['k4', 'k3', 'k2', 'k1', 'k0']);
      // other scopes see nothing
      expect((await store.list(OTHER_SCOPE)).artifacts).toEqual([]);
    });

    it('parentRefs are validated at mint — a foreign key cannot dangle at birth', async () => {
      const time = clock();
      const store = makeStore(time.now);
      const { meta: parent } = await store.put(SCOPE, { kind: 'k', mediaType: 't', data: 'p' });
      const { meta: child } = await store.put(SCOPE, {
        kind: 'chart/spec',
        mediaType: 'application/json',
        data: {},
        parentRefs: [parent.ref],
      });
      expect(child.parentRefs).toEqual([parent.ref]);
      // an unknown parent refuses BY NAME and stores nothing
      await expect(
        store.put(SCOPE, {
          kind: 'k',
          mediaType: 't',
          data: 'x',
          parentRefs: [mintArtifactRef()],
        }),
      ).rejects.toThrow(UnknownParentRefError);
      // a parent in ANOTHER scope is a dangling parent here
      await expect(
        store.put(OTHER_SCOPE, {
          kind: 'k',
          mediaType: 't',
          data: 'x',
          parentRefs: [parent.ref],
        }),
      ).rejects.toThrow(UnknownParentRefError);
    });

    it('digest: computed at put when asked, verified on get — corruption never rides', async () => {
      const time = clock();
      const store = makeStore(time.now);
      const { meta } = await store.put(SCOPE, {
        kind: 'k',
        mediaType: 'application/json',
        data: { n: 7 },
        digest: 'sha-256',
      });
      expect(meta.digest).toMatch(/^sha-256:[0-9a-f]{64}$/);
      const got = await store.get(SCOPE, meta.ref); // verifies silently when whole
      expect(got?.data).toEqual({ n: 7 });
    });

    it('malformed puts are refused by name (blank kind, born-expired, unknown digest)', async () => {
      const time = clock();
      const store = makeStore(time.now);
      await expect(store.put(SCOPE, { kind: '', mediaType: 't', data: 'x' })).rejects.toThrow(
        InvalidArtifactError,
      );
      await expect(
        store.put(SCOPE, { kind: 'k', mediaType: 't', data: 'x', expiresAt: time.now() - 1 }),
      ).rejects.toThrow(InvalidArtifactError);
      await expect(
        store.put(SCOPE, {
          kind: 'k',
          mediaType: 't',
          data: 'x',
          digest: 'md5' as never,
        }),
      ).rejects.toThrow(InvalidArtifactError);
    });
  });
}
