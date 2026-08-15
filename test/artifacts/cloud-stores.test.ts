/**
 * The two CLOUD artifact adapters — the laws that are theirs alone, against
 * emulation doubles at the SDK boundary.
 *
 * The five-verb contract they share with every other store is the EXPORTED
 * battery (`src/artifacts/conformance`), run against these same doubles in
 * `./store-conformance.test.ts`.
 *
 * Sections follow Convention 3:
 *   Integration — scope-partitioned keys (traversal arrives as data), the
 *                 metadata budget refusal, retention + the read-time sweep,
 *                 the call SHAPE (what a listing costs on each column).
 *   Regression  — 404-means-null vs everything-else-means-error, and the
 *                 secrecy law: the object KEY carries the tenant, so an SDK
 *                 failure's text never reaches the caller.
 *
 * Nothing here reaches a cloud or needs a credential. The doubles' fidelity to
 * the real SDK names/shapes is the pin tests' job, not this file's.
 */

import { describe, expect, it } from 'vitest';
import {
  gcsArtifacts,
  InvalidArtifactError,
  isArtifactRef,
  mintArtifactRef,
  s3Artifacts,
  type ArtifactScope,
  type ArtifactStore,
} from '../../src/index.js';
import { fakeGcs, fakeS3 } from './fakes/objectServices.js';
import { clock, SCOPE } from './storeFixtures.js';

// ─────────────────────────────────────────────────────────────────────
// Functional — the five-verb contract, per adapter
//
// MOVED to the exported battery: `src/artifacts/conformance`, which both cloud
// columns run against these same doubles in `./store-conformance.test.ts` —
// one definition for all five stores, and one an out-of-tree store can import.
// What stays here is what is theirs alone: key layout, the metadata budget,
// the CALL SHAPE of a listing, and the secrecy law on an SDK failure.
// ─────────────────────────────────────────────────────────────────────

describe('both cloud adapters — retention', () => {
  it('retention: budgets evict oldest-first and report the sweep', async () => {
    const time = clock();
    const fakes = { s3: fakeS3(time.now), gcs: fakeGcs(time.now) };
    const stores: ArtifactStore[] = [
      s3Artifacts({
        bucket: 'b',
        retention: { maxCountPerScope: 2 },
        _client: fakes.s3.client,
        _now: time.now,
      }),
      gcsArtifacts({
        bucket: 'b',
        retention: { maxCountPerScope: 2 },
        _storage: fakes.gcs.storage,
        _now: time.now,
      }),
    ];
    for (const store of stores) {
      const a = (await store.put(SCOPE, { kind: 'a', mediaType: 't', data: '1' })).meta;
      time.tick(10);
      await store.put(SCOPE, { kind: 'b', mediaType: 't', data: '2' });
      time.tick(10);
      const third = await store.put(SCOPE, { kind: 'c', mediaType: 't', data: '3' });
      expect(third.swept).toEqual([{ ref: a.ref, reason: 'max-count', kind: 'a', bytes: 1 }]);
      expect(await store.get(SCOPE, a.ref)).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Integration — what is each adapter's own
// ─────────────────────────────────────────────────────────────────────

describe('s3Artifacts — keys, budgets and what a call costs', () => {
  it('partitions scopes into percent-encoded key segments — traversal arrives as data', async () => {
    const time = clock();
    const fake = fakeS3(time.now);
    const store = s3Artifacts({
      bucket: 'b',
      prefix: 'artifacts',
      _client: fake.client,
      _now: time.now,
    });
    const hostile: ArtifactScope = {
      tenant: '../../escape',
      principal: 'p/../p2',
      conversationId: 'c',
    };
    const { meta } = await store.put(hostile, { kind: 'k', mediaType: 't', data: 'x' });
    expect(await store.get(hostile, meta.ref)).not.toBeNull();
    const key = [...fake.objects.keys()][0]!;
    // The dots and slashes are INERT: one segment per tuple field, exactly as
    // the directory adapter lays them out.
    expect(key).toBe(
      `artifacts/${encodeURIComponent('../../escape').replace(/\./g, '%2E')}/` +
        `${encodeURIComponent('p/../p2').replace(/\./g, '%2E')}/c/${meta.ref}`,
    );
    expect(key).not.toContain('/../');
  });

  it('the ticket rides ONE metadata entry, ASCII, and is legible JSON', async () => {
    const time = clock();
    const fake = fakeS3(time.now);
    const store = s3Artifacts({ bucket: 'b', _client: fake.client, _now: time.now });
    const { meta } = await store.put(SCOPE, {
      kind: 'dataset/rows',
      mediaType: 'application/json',
      data: [1],
      label: 'Q3 — café',
    });
    const stored = [...fake.objects.values()][0]!;
    const value = stored.metadata['af-artifact']!;
    expect(Object.keys(stored.metadata)).toEqual(['af-artifact']);
    // Pure ASCII on the wire: not one code unit above 0x7F, so an HTTP
    // header carries it unmangled no matter what the label said.
    expect([...value].every((ch) => ch.charCodeAt(0) < 0x80)).toBe(true);
    expect(JSON.parse(value)).toMatchObject({ v: 1, shape: 'json', meta: { ref: meta.ref } });
    expect((await store.get(SCOPE, meta.ref))?.meta.label).toBe('Q3 — café'); // and it survives
  });

  it('refuses a ticket too big for the 2 KB metadata budget, naming the field', async () => {
    const time = clock();
    const store = s3Artifacts({ bucket: 'b', _client: fakeS3(time.now).client, _now: time.now });
    await expect(
      store.put(SCOPE, { kind: 'k', mediaType: 't', data: 'x', label: 'L'.repeat(3000) }),
    ).rejects.toThrow(/object-metadata budget[\s\S]*label \(3000 chars\)/);
  });

  it('a put with no budget dials is exactly one PutObject — no scope scan', async () => {
    const time = clock();
    const fake = fakeS3(time.now);
    const store = s3Artifacts({ bucket: 'b', _client: fake.client, _now: time.now });
    await store.put(SCOPE, { kind: 'k', mediaType: 't', data: 'x' });
    expect(fake.sent).toEqual(['PutObject']);
  });

  it('a listing costs ListObjectsV2 + one HeadObject per row RETURNED', async () => {
    const time = clock();
    const fake = fakeS3(time.now);
    const store = s3Artifacts({ bucket: 'b', _client: fake.client, _now: time.now });
    for (let i = 0; i < 3; i++) {
      await store.put(SCOPE, { kind: `k${i}`, mediaType: 't', data: 'x' });
      time.tick(10);
    }
    fake.sent.length = 0;
    await store.list(SCOPE, { limit: 2 });
    expect(fake.sent).toEqual(['ListObjectsV2', 'HeadObject', 'HeadObject']);
  });

  it('leaves foreign objects in a shared bucket alone', async () => {
    const time = clock();
    const fake = fakeS3(time.now);
    const store = s3Artifacts({ bucket: 'b', _client: fake.client, _now: time.now });
    const { meta } = await store.put(SCOPE, { kind: 'k', mediaType: 't', data: 'x' });
    fake.objects.set('_/_/conv-a/somebody-elses-file.txt', {
      body: new Uint8Array([1]),
      metadata: {},
      lastModified: new Date(time.now()),
    });
    const listed = await store.list(SCOPE);
    expect(listed.artifacts.map((m) => m.ref)).toEqual([meta.ref]);
  });
});

describe('gcsArtifacts — the cheaper listing, and the same laws', () => {
  it('partitions scopes into percent-encoded object names', async () => {
    const time = clock();
    const fake = fakeGcs(time.now);
    const store = gcsArtifacts({
      bucket: 'b',
      prefix: 'artifacts',
      _storage: fake.storage,
      _now: time.now,
    });
    const hostile: ArtifactScope = { tenant: '..', principal: 'p', conversationId: 'c' };
    const { meta } = await store.put(hostile, { kind: 'k', mediaType: 't', data: 'x' });
    expect([...fake.blobs.keys()]).toEqual([`artifacts/%2E%2E/p/c/${meta.ref}`]);
    expect(await store.get(hostile, meta.ref)).not.toBeNull();
  });

  it('a listing is ONE call — the metadata rides the listing, so no per-row read', async () => {
    const time = clock();
    const fake = fakeGcs(time.now);
    const store = gcsArtifacts({ bucket: 'b', _storage: fake.storage, _now: time.now });
    for (let i = 0; i < 3; i++) {
      await store.put(SCOPE, { kind: `k${i}`, mediaType: 't', data: 'x' });
      time.tick(10);
    }
    fake.calls.length = 0;
    const page = await store.list(SCOPE, { limit: 2 });
    expect(page.artifacts).toHaveLength(2);
    expect(fake.calls).toEqual(['getFiles']);
  });

  it('refuses a ticket too big for the 8 KiB metadata budget', async () => {
    const time = clock();
    const store = gcsArtifacts({
      bucket: 'b',
      _storage: fakeGcs(time.now).storage,
      _now: time.now,
    });
    // Fits on this column where it would not on the other — the budgets differ,
    // and the adapters state their own rather than sharing a lowest number.
    await expect(
      store.put(SCOPE, { kind: 'k', mediaType: 't', data: 'x', label: 'L'.repeat(3000) }),
    ).resolves.toMatchObject({ meta: { kind: 'k' } });
    await expect(
      store.put(SCOPE, { kind: 'k', mediaType: 't', data: 'x', label: 'L'.repeat(9000) }),
    ).rejects.toThrow(/object-metadata budget/);
  });

  it('an expired object is swept on the way past a read', async () => {
    const time = clock();
    const fake = fakeGcs(time.now);
    const store = gcsArtifacts({ bucket: 'b', _storage: fake.storage, _now: time.now });
    const { meta } = await store.put(SCOPE, {
      kind: 'k',
      mediaType: 't',
      data: 'x',
      expiresAt: time.now() + 50,
    });
    expect(fake.blobs.size).toBe(1);
    time.tick(51);
    expect(await store.head(SCOPE, meta.ref)).toBeNull();
    expect(fake.blobs.size).toBe(0); // gone, not merely hidden
  });
});

// ─────────────────────────────────────────────────────────────────────
// Regression — the two failure classes that must never be confused
// ─────────────────────────────────────────────────────────────────────

/** A scope whose every field is a secret, because the object key carries all
 *  three and an echoed key is how they reach the conversation. */
const TENANT_SCOPE: ArtifactScope = {
  tenant: 'acme-corp',
  principal: 'jane@example.com',
  conversationId: 'c-1',
};

/** The kind of text a real SDK puts in a failure: the bucket, the KEY, and
 *  whatever the request happened to carry. */
const LEAKY = 'bucket b — key acme-corp/jane@example.com/c-1/art_x; token=SECRET-abc';

/** Everything a caller can read off a thrown error — message, stack, the JSON
 *  a sink would serialize, and every own property by name. A secrecy law that
 *  only held for `.message` would be undone by one `JSON.stringify`. */
function everythingReadable(thrown: unknown): string {
  const err = thrown as (Error & Record<string, unknown>) | undefined;
  if (err === undefined) return '';
  const own = Object.getOwnPropertyNames(err).map((key) => {
    try {
      return `${key}=${JSON.stringify(err[key])}`;
    } catch {
      return `${key}=<unserializable>`;
    }
  });
  return [err.message, err.stack, JSON.stringify(err), ...own].join('|');
}

/** The secrecy law, asserted the same way for every column and operation. */
function saysNothingSecret(thrown: unknown): void {
  const text = everythingReadable(thrown);
  expect(text).not.toContain('SECRET-abc');
  expect(text).not.toContain('acme-corp');
  expect(text).not.toContain('jane@example.com');
  expect(text).not.toContain('art_x');
  // and not smuggled back through `cause`, which every serializer walks
  expect((thrown as { cause?: unknown }).cause).toBeUndefined();
}

async function thrownBy(run: () => Promise<unknown>): Promise<unknown> {
  return run().then(
    () => undefined,
    (err: unknown) => err,
  );
}

describe('a 404 from a call that never asked about one object is an error, not "no data"', () => {
  // A write and a listing do not ask "is this object there?", so a 404 from
  // one of them is the SERVICE saying something else — a bucket that does not
  // exist, an endpoint that is wrong. Nobody downstream converts it to null,
  // so it must arrive through the sanitizer like every other failure.
  const s3Cases: ReadonlyArray<[string, (store: ArtifactStore) => Promise<unknown>]> = [
    ['PutObject', (store) => store.put(TENANT_SCOPE, { kind: 'k', mediaType: 't', data: 'x' })],
    ['ListObjectsV2', (store) => store.list(TENANT_SCOPE)],
  ];

  it.each(s3Cases)('s3: a 404 from %s is withheld, never echoed', async (operation, run) => {
    const time = clock();
    const fake = fakeS3(time.now);
    const store = s3Artifacts({ bucket: 'b', _client: fake.client, _now: time.now });
    fake.failNext(
      operation,
      Object.assign(new Error(`NoSuchBucket: ${LEAKY}`), {
        name: 'NoSuchBucket',
        $metadata: { httpStatusCode: 404 },
      }),
    );
    const thrown = await thrownBy(() => run(store));
    expect((thrown as Error | undefined)?.message).toMatch(/NoSuchBucket \(HTTP 404\)/);
    saysNothingSecret(thrown);
  });

  const gcsCases: ReadonlyArray<[string, (store: ArtifactStore) => Promise<unknown>]> = [
    ['save', (store) => store.put(TENANT_SCOPE, { kind: 'k', mediaType: 't', data: 'x' })],
    ['getFiles', (store) => store.list(TENANT_SCOPE)],
  ];

  it.each(gcsCases)('gcs: a 404 from %s is withheld, never echoed', async (method, run) => {
    const time = clock();
    const fake = fakeGcs(time.now);
    const store = gcsArtifacts({ bucket: 'b', _storage: fake.storage, _now: time.now });
    fake.failNext(
      method,
      Object.assign(new Error(`The specified bucket does not exist — ${LEAKY}`), { code: 404 }),
    );
    const thrown = await thrownBy(() => run(store));
    expect((thrown as Error | undefined)?.message).toMatch(/HTTP 404/);
    saysNothingSecret(thrown);
  });
});

describe('s3: a 404 about the BUCKET is not a missing artifact', () => {
  const makeStore = (fake: ReturnType<typeof fakeS3>, now: () => number): ArtifactStore =>
    s3Artifacts({ bucket: 'b', _client: fake.client, _now: now });

  const noSuchBucket = (): Error =>
    Object.assign(new Error(`NoSuchBucket: ${LEAKY}`), {
      name: 'NoSuchBucket',
      $metadata: { httpStatusCode: 404 },
    });

  it.each([
    ['HeadObject', (store: ArtifactStore, ref: string) => store.head(TENANT_SCOPE, ref)],
    ['GetObject', (store: ArtifactStore, ref: string) => store.get(TENANT_SCOPE, ref)],
    ['DeleteObject', (store: ArtifactStore, ref: string) => store.delete(TENANT_SCOPE, ref)],
  ] as const)(
    'a missing bucket on %s raises rather than reporting an empty scope',
    async (operation, run) => {
      const time = clock();
      const fake = fakeS3(time.now);
      const store = makeStore(fake, time.now);
      const { meta } = await store.put(TENANT_SCOPE, { kind: 'k', mediaType: 't', data: 'x' });
      fake.failNext(operation, noSuchBucket());
      const thrown = await thrownBy(() => run(store, meta.ref));
      expect((thrown as Error | undefined)?.message).toMatch(/NoSuchBucket \(HTTP 404\)/);
      saysNothingSecret(thrown);
    },
  );

  it('a missing KEY is still the port’s deliberate "no data"', async () => {
    const time = clock();
    const fake = fakeS3(time.now);
    const store = makeStore(fake, time.now);
    expect(await store.head(TENANT_SCOPE, mintArtifactRef())).toBeNull();
    expect(await store.get(TENANT_SCOPE, mintArtifactRef())).toBeNull();
    await expect(store.delete(TENANT_SCOPE, mintArtifactRef())).resolves.toBeUndefined();
  });
});

describe('missing is null; everything else is an error that says nothing secret', () => {
  it('s3: a DENIED read is NOT reported as "no data"', async () => {
    const time = clock();
    const fake = fakeS3(time.now);
    const store = s3Artifacts({ bucket: 'b', _client: fake.client, _now: time.now });
    const { meta } = await store.put(SCOPE, { kind: 'k', mediaType: 't', data: 'x' });
    const denied = Object.assign(new Error('User: arn:aws:iam::123 is not authorized'), {
      name: 'AccessDenied',
      $metadata: { httpStatusCode: 403 },
    });
    fake.failNext('HeadObject', denied);
    await expect(store.head(SCOPE, meta.ref)).rejects.toThrow(/AccessDenied \(HTTP 403\)/);
  });

  it('s3: the SDK message is WITHHELD — the object key carries the tenant', async () => {
    const time = clock();
    const fake = fakeS3(time.now);
    const store = s3Artifacts({ bucket: 'b', _client: fake.client, _now: time.now });
    const scope: ArtifactScope = {
      tenant: 'acme-corp',
      principal: 'jane@example.com',
      conversationId: 'c-1',
    };
    fake.failNext(
      'PutObject',
      Object.assign(
        new Error('PUT /b/acme-corp/jane@example.com/c-1/art_x failed; token=SECRET-abc'),
        { name: 'ThrottlingException', $metadata: { httpStatusCode: 429 } },
      ),
    );
    const thrown = await store
      .put(scope, { kind: 'k', mediaType: 't', data: 'x' })
      .then(() => undefined)
      .catch((err: Error) => err);
    const text = `${thrown?.message ?? ''}${JSON.stringify(thrown ?? {})}`;
    expect(text).toContain('ThrottlingException');
    expect(text).toContain('HTTP 429');
    expect(text).not.toContain('SECRET-abc');
    expect(text).not.toContain('acme-corp');
    expect(text).not.toContain('jane@example.com');
    // and not smuggled back through `cause`
    expect((thrown as { cause?: unknown }).cause).toBeUndefined();
  });

  it('gcs: a DENIED read is an error; a 404 is null', async () => {
    const time = clock();
    const fake = fakeGcs(time.now);
    const store = gcsArtifacts({ bucket: 'b', _storage: fake.storage, _now: time.now });
    const { meta } = await store.put(SCOPE, { kind: 'k', mediaType: 't', data: 'x' });
    expect(await store.head(SCOPE, mintArtifactRef())).toBeNull();
    fake.failNext(
      'getMetadata',
      Object.assign(new Error('caller does not have storage.objects.get access'), { code: 403 }),
    );
    await expect(store.head(SCOPE, meta.ref)).rejects.toThrow(/HTTP 403/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Construction — refusals where the config is written
// ─────────────────────────────────────────────────────────────────────

describe('construction refuses what cannot work, by name', () => {
  it('names no bucket → a refusal that says buckets are yours to create', () => {
    expect(() => s3Artifacts({ bucket: '', _client: fakeS3().client })).toThrow(/names no bucket/);
    expect(() => gcsArtifacts({ bucket: '  ', _storage: fakeGcs().storage })).toThrow(
      /names no bucket/,
    );
  });

  it('a prefix that reads like a hop is refused, even though a key cannot hop', () => {
    expect(() =>
      s3Artifacts({ bucket: 'b', prefix: '../elsewhere', _client: fakeS3().client }),
    ).toThrow(/contains '\.\.'/);
  });

  it('retention dials that cannot bind are refused at construction', () => {
    expect(() =>
      s3Artifacts({ bucket: 'b', retention: { ttlMs: 0 }, _client: fakeS3().client }),
    ).toThrow(TypeError);
    expect(() =>
      gcsArtifacts({
        bucket: 'b',
        retention: { maxCountPerScope: -1 },
        _storage: fakeGcs().storage,
      }),
    ).toThrow(TypeError);
  });
});
