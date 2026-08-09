/**
 * s3VectorsStore (9.3.0) — a durable corpus with nothing to run.
 *
 * Seven patterns, in the house order:
 *   unit · boundary · scenario · property · security · refusal · integration
 *
 * Every test here injects a client or an SDK module. NOTHING in this file
 * reaches AWS, needs a credential, or installs `@aws-sdk/client-s3vectors` —
 * the `_client` / `_sdk` seams exist so an adapter can be exercised without an
 * account, the same way every other vendor adapter in this repo is.
 *
 * What this file exists to pin:
 *
 *   1. **The COMMAND NAMES.** A store adapter is a translation, and the one
 *      part of it a type-checker cannot see is which operation of the vendor's
 *      API it dispatches. Two AWS adapters have shipped calling operations that
 *      do not exist — compiling, testing green against a double that answered
 *      whatever it was asked, and failing on the first real call. The pin below
 *      states the five operation names against the published S3 Vectors API, so
 *      a rename is a failing test rather than a field report.
 *   2. `search()` is QueryVectors with the vector, `k` → `topK`, tiers → a
 *      metadata filter, and `distance` → the cosine score the port reports.
 *   3. Two embedding spaces never mix — refused at write, at search, and
 *      against the fingerprints the HITS come back carrying.
 *   4. What a vector index cannot do is REFUSED by name, never faked.
 */

import { describe, expect, it } from 'vitest';

import { s3VectorsStore, EmbedderMismatchError } from '../../../src/memory-providers.js';
import { indexDocuments } from '../../../src/index.js';
import { mockEmbedder } from '../../../src/memory/index.js';
import type { MemoryEntry } from '../../../src/memory/entry/index.js';
import { identityNamespace } from '../../../src/memory/identity/index.js';
import type { MemoryIdentity } from '../../../src/memory/identity/index.js';

const CORPUS: MemoryIdentity = { conversationId: '_global' };

/** One command as it reached `send()`: the operation name plus its input. */
interface SentCommand {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

/**
 * An S3 Vectors double.
 *
 * The `_sdk` seam is used rather than `_client` alone, because the constructor
 * NAMES are the thing under test: each fake command class records the operation
 * the adapter chose, so an assertion can be about the API call and not merely
 * about the payload.
 */
function fakeS3Vectors(answers: Partial<Record<string, unknown>> = {}) {
  const sent: SentCommand[] = [];
  const command = (name: string): new (input: unknown) => unknown =>
    class {
      readonly __name = name;
      readonly __input: unknown;
      constructor(input: unknown) {
        this.__input = input;
      }
    } as unknown as new (input: unknown) => unknown;

  const client = {
    send: async (cmd: unknown): Promise<unknown> => {
      const c = cmd as { __name: string; __input: Record<string, unknown> };
      sent.push({ name: c.__name, input: c.__input });
      return answers[c.__name] ?? {};
    },
  };

  return {
    sent,
    client,
    sdk: {
      PutVectorsCommand: command('PutVectors'),
      QueryVectorsCommand: command('QueryVectors'),
      GetVectorsCommand: command('GetVectors'),
      ListVectorsCommand: command('ListVectors'),
      DeleteVectorsCommand: command('DeleteVectors'),
    },
  };
}

function open(answers: Partial<Record<string, unknown>> = {}) {
  const aws = fakeS3Vectors(answers);
  const store = s3VectorsStore({
    bucket: 'my-corpus',
    index: 'docs',
    _client: aws.client,
    _sdk: aws.sdk,
  });
  return { store, aws };
}

function entry(
  id: string,
  embedding: number[] | undefined,
  extra: Partial<MemoryEntry<unknown>> = {},
): MemoryEntry<unknown> {
  const now = Date.now();
  return {
    id,
    value: { id, content: `content of ${id}` },
    version: 1,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    accessCount: 0,
    ...(embedding && { embedding }),
    ...extra,
  } as MemoryEntry<unknown>;
}

/** A row as QueryVectors/GetVectors/ListVectors hand one back. */
function row(id: string, distance?: number, fp = 'mock@4') {
  return {
    key: `${identityNs()}#${id}`,
    ...(distance !== undefined && { distance }),
    metadata: {
      ns: identityNs(),
      fp,
      af: JSON.stringify({
        value: { id, content: `content of ${id}` },
        version: 1,
        createdAt: 1,
        updatedAt: 1,
        lastAccessedAt: 1,
        accessCount: 0,
      }),
    },
  };
}

/** The namespace the port derives from `CORPUS` — asked, never mirrored. */
function identityNs(): string {
  return identityNamespace(CORPUS);
}

/** Same, for the tenant/user/conversation triple a security test uses. */
const NS = identityNamespace(CORPUS);

// ─── The COMMAND-NAME PIN ──────────────────────────────────────────
//
// The cure for a class of bug this repo has met twice: an adapter that
// compiles, passes its tests against an obliging double, and calls an
// operation the service does not have.

describe('s3VectorsStore — the operations it dispatches', () => {
  it('reads and writes through the FIVE published S3 Vectors operations, by name', async () => {
    const { store, aws } = open({ GetVectors: { vectors: [] }, ListVectors: { vectors: [] } });
    await store.put(CORPUS, entry('a', [1, 0, 0, 0]));
    await store.get(CORPUS, 'a');
    await store.search(CORPUS, [1, 0, 0, 0]);
    await store.delete(CORPUS, 'a');
    await store.list(CORPUS);

    // Every name below is an operation of the S3 Vectors API. If a future
    // edit reaches for `SearchVectors` or `UpsertVectors`, this fails HERE
    // rather than on somebody's first real call.
    expect(aws.sent.map((c) => c.name)).toEqual([
      'PutVectors',
      'GetVectors',
      'QueryVectors',
      'DeleteVectors',
      'ListVectors',
    ]);
  });

  it('names the SDK constructors it needs, and refuses an SDK that lacks one', () => {
    // The other half of the pin: the constructor names read off the module.
    const store = s3VectorsStore({
      bucket: 'b',
      index: 'i',
      _sdk: {
        S3VectorsClient: class {
          async send(): Promise<unknown> {
            return {};
          }
        },
        // QueryVectorsCommand deliberately absent.
        PutVectorsCommand: class {},
        GetVectorsCommand: class {},
        ListVectorsCommand: class {},
        DeleteVectorsCommand: class {},
      },
    });
    return expect(store.get(CORPUS, 'a')).rejects.toThrow(/QueryVectorsCommand/);
  });

  it('every command carries the bucket and index it was built for', async () => {
    const { store, aws } = open();
    await store.put(CORPUS, entry('a', [1, 0, 0, 0]));
    expect(aws.sent[0]?.input['vectorBucketName']).toBe('my-corpus');
    expect(aws.sent[0]?.input['indexName']).toBe('docs');
  });
});

// ─── Unit — the two halves that matter ─────────────────────────────

describe('s3VectorsStore — unit', () => {
  it('put sends the vector as float32, namespaced, with the entry as metadata', async () => {
    const { store, aws } = open();
    await store.put(CORPUS, entry('refunds.md#0', [1, 0, 0, 0], { tier: 'hot' }));
    const vectors = aws.sent[0]?.input['vectors'] as {
      key: string;
      data: { float32: number[] };
      metadata: Record<string, string>;
    }[];
    expect(vectors[0]?.data.float32).toEqual([1, 0, 0, 0]);
    expect(vectors[0]?.key).toBe(`${NS}#refunds.md#0`);
    expect(vectors[0]?.metadata['ns']).toBe(NS);
    expect(vectors[0]?.metadata['tier']).toBe('hot');
    // The passage rides in the ONE non-filterable key the index declares.
    expect(JSON.parse(String(vectors[0]?.metadata['af']))).toMatchObject({
      value: { id: 'refunds.md#0' },
    });
  });

  it('search is QueryVectors: k → topK, ns → filter, distance → cosine score', async () => {
    const { store, aws } = open({ QueryVectors: { vectors: [row('a', 0.1), row('b', 0.4)] } });
    const hits = await store.search(CORPUS, [1, 0, 0, 0], { k: 2 });
    const input = aws.sent[0]?.input as Record<string, unknown>;
    expect(input['topK']).toBe(2);
    expect(input['queryVector']).toEqual({ float32: [1, 0, 0, 0] });
    expect(input['filter']).toEqual({ ns: { $eq: NS } });
    expect(input['returnMetadata']).toBe(true);
    // 1 - distance, exactly — which is why a euclidean index is refused.
    expect(hits.map((h) => h.score)).toEqual([0.9, 0.6]);
    expect(hits[0]?.entry.id).toBe('a');
  });

  it('a tier filter becomes a server-side metadata filter, not a local one', async () => {
    const { store, aws } = open({ QueryVectors: { vectors: [] } });
    await store.search(CORPUS, [1, 0, 0, 0], { tiers: ['hot', 'warm'] });
    expect(aws.sent[0]?.input['filter']).toEqual({
      $and: [{ ns: { $eq: NS } }, { tier: { $in: ['hot', 'warm'] } }],
    });
  });
});

// ─── Boundary — the edges of a batch and a page ────────────────────

describe('s3VectorsStore — boundary', () => {
  it('an empty batch is a no-op — no call is made at all', async () => {
    const { store, aws } = open();
    await store.putMany(CORPUS, []);
    expect(aws.sent).toHaveLength(0);
  });

  it('writes are chunked, and the chunk size is the one that was asked for', async () => {
    const aws = fakeS3Vectors();
    const store = s3VectorsStore({
      bucket: 'b',
      index: 'i',
      batchSize: 2,
      _client: aws.client,
      _sdk: aws.sdk,
    });
    await store.putMany(
      CORPUS,
      ['a', 'b', 'c', 'd', 'e'].map((id) => entry(id, [1, 0, 0, 0])),
    );
    expect(aws.sent.filter((c) => c.name === 'PutVectors')).toHaveLength(3);
  });

  it('an empty query vector returns nothing rather than asking for a ranking of nothing', async () => {
    const { store, aws } = open();
    expect(await store.search(CORPUS, [])).toEqual([]);
    expect(aws.sent).toHaveLength(0);
  });

  it('an expired entry reads as absent', async () => {
    const expired = row('a');
    expired.metadata.af = JSON.stringify({
      value: { id: 'a' },
      version: 1,
      createdAt: 1,
      updatedAt: 1,
      lastAccessedAt: 1,
      accessCount: 0,
      ttl: Date.now() - 1000,
    });
    const { store } = open({ GetVectors: { vectors: [expired] } });
    expect(await store.get(CORPUS, 'a')).toBeNull();
  });
});

// ─── Scenario — a real SDK module, through the real shim ───────────

describe('s3VectorsStore — scenario', () => {
  it('builds its own client from region, and close() releases only what it built', async () => {
    const built: { region?: string }[] = [];
    let destroyed = 0;
    const store = s3VectorsStore({
      bucket: 'b',
      index: 'i',
      region: 'us-east-1',
      _sdk: {
        S3VectorsClient: class {
          constructor(config: { region?: string }) {
            built.push(config);
          }
          async send(): Promise<unknown> {
            return { vectors: [] };
          }
          destroy(): void {
            destroyed += 1;
          }
        },
        PutVectorsCommand: class {},
        QueryVectorsCommand: class {},
        GetVectorsCommand: class {},
        ListVectorsCommand: class {},
        DeleteVectorsCommand: class {},
      },
    });
    await store.get({ conversationId: 'c' }, 'a');
    expect(built).toEqual([{ region: 'us-east-1' }]);
    store.close();
    expect(destroyed).toBe(1);
  });

  it('a client you passed in is yours — close() leaves it alone', async () => {
    let destroyed = 0;
    const store = s3VectorsStore({
      bucket: 'b',
      index: 'i',
      client: {
        send: async () => ({ vectors: [] }),
        destroy: () => {
          destroyed += 1;
        },
      },
      _sdk: {
        PutVectorsCommand: class {},
        QueryVectorsCommand: class {},
        GetVectorsCommand: class {},
        ListVectorsCommand: class {},
        DeleteVectorsCommand: class {},
      },
    });
    await store.get({ conversationId: 'c' }, 'a');
    store.close();
    expect(destroyed).toBe(0);
  });

  it('forget deletes page by page — a half-finished erasure has erased half', async () => {
    const aws = fakeS3Vectors();
    let page = 0;
    const client = {
      send: async (cmd: unknown): Promise<unknown> => {
        const c = cmd as { __name: string; __input: Record<string, unknown> };
        aws.sent.push({ name: c.__name, input: c.__input });
        if (c.__name !== 'ListVectors') return {};
        page += 1;
        return page === 1
          ? { vectors: [{ key: `${NS}#a` }], nextToken: 'more' }
          : { vectors: [{ key: `${NS}#b` }, { key: 'other-ns#c' }] };
      },
    };
    const store = s3VectorsStore({ bucket: 'b', index: 'i', _client: client, _sdk: aws.sdk });
    await store.forget(CORPUS);
    const deletes = aws.sent.filter((c) => c.name === 'DeleteVectors');
    expect(deletes).toHaveLength(2);
    // The other namespace's key is never deleted — the prefix decides.
    expect(deletes.flatMap((d) => d.input['keys'] as string[])).toEqual([`${NS}#a`, `${NS}#b`]);
  });
});

// ─── Property — declarations a corpus builder reads ────────────────

describe('s3VectorsStore — property', () => {
  it('declares that it ranks the vectors it is given, both ways', () => {
    const { store } = open();
    expect(store.supportsVectorSearch).toBe(true);
    expect(store.ranksBy).toBe('vector');
  });

  it('constructing one touches no SDK and no network', () => {
    // No `_client`, no `_sdk`, no peer dep installed in this repo: an eager
    // require would throw on this line.
    expect(() => s3VectorsStore({ bucket: 'b', index: 'i' })).not.toThrow();
  });

  it('results come back sorted by score whatever order the service returned', async () => {
    const { store } = open({
      QueryVectors: { vectors: [row('far', 0.9), row('near', 0.1), row('mid', 0.5)] },
    });
    const hits = await store.search(CORPUS, [1, 0, 0, 0], { k: 3 });
    expect(hits.map((h) => h.entry.id)).toEqual(['near', 'mid', 'far']);
  });
});

// ─── Security — a namespace is a boundary ──────────────────────────

describe('s3VectorsStore — security', () => {
  it('every key is namespaced, and list() ignores rows outside the namespace', async () => {
    const { store } = open({
      ListVectors: { vectors: [row('mine'), { ...row('theirs'), key: 'other-tenant#theirs' }] },
    });
    const page = await store.list(CORPUS);
    expect(page.entries.map((e) => e.id)).toEqual(['mine']);
  });

  it('the identity reaches the SERVER-side filter, not just the client', async () => {
    const { store, aws } = open({ QueryVectors: { vectors: [] } });
    await store.search({ conversationId: 'user-42' }, [1, 0, 0, 0]);
    expect(JSON.stringify(aws.sent[0]?.input['filter'])).toContain('user-42');
  });
});

// ─── Refusal — what it will not fake ───────────────────────────────

describe('s3VectorsStore — refusal', () => {
  it('refuses a euclidean index rather than rescaling a distance into a fake cosine', () => {
    expect(() =>
      s3VectorsStore({
        bucket: 'b',
        index: 'i',
        distanceMetric: 'euclidean' as unknown as 'cosine',
      }),
    ).toThrow(/reads like a cosine and is not one/);
  });

  it('refuses an empty bucket or index instead of creating one', () => {
    expect(() => s3VectorsStore({ bucket: '', index: 'i' })).toThrow(TypeError);
    expect(() => s3VectorsStore({ bucket: 'b', index: '  ' })).toThrow(TypeError);
  });

  it('refuses an entry with no embedding — a vector index has nowhere to put it', async () => {
    const { store } = open();
    await expect(store.put(CORPUS, entry('a', undefined))).rejects.toThrow(/no `embedding`/);
  });

  it('refuses the three operations a vector index cannot do, by name', async () => {
    const { store } = open();
    await expect(store.putIfVersion(CORPUS, entry('a', [1]), 1)).rejects.toThrow(/compare-and-set/);
    await expect(store.recordSignature!(CORPUS, 'sig')).rejects.toThrow(/recognition set/);
    await expect(store.feedback!(CORPUS, 'a', 1)).rejects.toThrow(/read-modify-write/);
    // …and answers the READ halves truthfully rather than throwing: nothing
    // can be recorded, so nothing has been.
    expect(await store.seen!(CORPUS, 'sig')).toBe(false);
    expect(await store.getFeedback!(CORPUS, 'a')).toBeNull();
  });

  it('refuses a second embedding space at WRITE', async () => {
    const { store } = open();
    await store.put(CORPUS, entry('a', [1, 0, 0, 0], { embeddingModel: 'mock' }));
    await expect(
      store.put(CORPUS, entry('b', [1, 0], { embeddingModel: 'other' })),
    ).rejects.toBeInstanceOf(EmbedderMismatchError);
  });

  it('refuses a swapped embedder at SEARCH, from the fingerprint the HITS carry', async () => {
    // The restart-surviving half: this process has written nothing, so the
    // only evidence is what comes back — and it is enough.
    const { store } = open({ QueryVectors: { vectors: [row('a', 0.1, 'old-embedder@4')] } });
    await expect(
      store.search(CORPUS, [1, 0, 0, 0], { embedderId: 'new-embedder' }),
    ).rejects.toThrow(EmbedderMismatchError);
  });

  it('a closed store refuses rather than reopening itself', async () => {
    const { store } = open();
    store.close();
    await expect(store.get(CORPUS, 'a')).rejects.toThrow(/is closed/);
  });
});

// ─── Integration — the corpus builders run against it unchanged ────

describe('s3VectorsStore — integration', () => {
  it('indexDocuments writes a corpus through PutVectors, embedder id and all', async () => {
    const { store, aws } = open();
    const embedder = mockEmbedder(4);
    const written = await indexDocuments(
      store,
      embedder,
      [
        { id: 'refunds.md#0', content: 'Refunds take 3 business days.' },
        { id: 'returns.md#0', content: 'Returns are free within 30 days.' },
      ],
      { embedderId: embedder.id },
    );
    expect(written).toBe(2);
    const vectors = aws.sent
      .filter((c) => c.name === 'PutVectors')
      .flatMap((c) => c.input['vectors'] as { metadata: Record<string, string> }[]);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]?.metadata['fp']).toBe(
      `${String(embedder.id)}@${String(embedder.dimensions)}`,
    );
  });
});
