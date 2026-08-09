/**
 * s3VectorsStore — the index preflight (9.4.0).
 *
 * Until 9.4.0 this adapter dispatched exactly two operations against a real
 * account, PutVectors and QueryVectors, and never looked at the INDEX. It
 * trusted three preconditions it had no evidence for, and a production field
 * report found all three failing at once:
 *
 *   (a) A EUCLIDEAN index was accepted. The construction refusal reads
 *       `options.distanceMetric` — a claim by the caller about an index this
 *       store did not create — so the default (undeclared) sailed straight
 *       through. Measured live: a vector queried against ITSELF came back at
 *       0.9991630113800056, where a true cosine self-similarity is exactly 1.0.
 *       The adapter's own header had already named this failure — "a number
 *       that READS like a cosine and is not one, which no threshold can
 *       separate from a real score" — and then did not check for it.
 *   (b) An index created without `nonFilterableMetadataKeys: ['af']` failed as
 *       a raw AWS ValidationException, MID-IMPORT, with documents already
 *       written: "Filterable metadata must have at most 2048 bytes".
 *   (c) The index dimension was never compared with the embedder at all.
 *
 * One GetIndex, lazily on first use and memoized, answers all three. That is
 * the discipline every sibling store already had at open — sqliteVectorStore's
 * schema identity, pgVectorStore's schema check, staticVectorStore's load-time
 * fingerprint. This store had nothing to open, so it opened nothing.
 *
 * Nothing here reaches AWS.
 */

import { describe, expect, it } from 'vitest';

import { s3VectorsStore, EmbedderMismatchError } from '../../../src/memory-providers.js';
import type { MemoryEntry } from '../../../src/memory/entry/index.js';
import type { MemoryIdentity } from '../../../src/memory/identity/index.js';

const CORPUS: MemoryIdentity = { conversationId: '_global' };

interface Sent {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

/** An index as GetIndex describes one. Every field is optional on the wire. */
interface IndexShape {
  distanceMetric?: string;
  dimension?: number;
  metadataConfiguration?: { nonFilterableMetadataKeys?: unknown };
}

const HEALTHY: IndexShape = {
  distanceMetric: 'cosine',
  metadataConfiguration: { nonFilterableMetadataKeys: ['af'] },
};

/**
 * A double whose GetIndex answers with a specific index shape — or throws,
 * which is its own case: an index this store cannot READ is an index whose
 * metric, layout and dimension it would be guessing at.
 */
function openWith(index: IndexShape | Error, answers: Record<string, unknown> = {}) {
  const sent: Sent[] = [];
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
      if (c.__name === 'GetIndex') {
        if (index instanceof Error) throw index;
        return { index };
      }
      return answers[c.__name] ?? {};
    },
  };

  const store = s3VectorsStore({
    bucket: 'my-corpus',
    index: 'docs',
    _client: client,
    _sdk: {
      GetIndexCommand: command('GetIndex'),
      PutVectorsCommand: command('PutVectors'),
      QueryVectorsCommand: command('QueryVectors'),
      GetVectorsCommand: command('GetVectors'),
      ListVectorsCommand: command('ListVectors'),
      DeleteVectorsCommand: command('DeleteVectors'),
    },
  });
  return { store, sent };
}

function entry(id: string, embedding: number[]): MemoryEntry<unknown> {
  const now = Date.now();
  return {
    id,
    value: { id },
    version: 1,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    accessCount: 0,
    embedding,
  } as MemoryEntry<unknown>;
}

const message = async (run: () => Promise<unknown>): Promise<string> =>
  run().then(
    () => '',
    (err: Error) => err.message,
  );

// ─── unit — GetIndex happens, once, before anything else ────────────

describe('s3VectorsStore reads the index before it trusts it', () => {
  it('sends GetIndex before the first real operation', async () => {
    const { store, sent } = openWith(HEALTHY, { GetVectors: { vectors: [] } });
    await store.get(CORPUS, 'a');
    expect(sent.map((s) => s.name)).toEqual(['GetIndex', 'GetVectors']);
    expect(sent[0]?.input).toEqual({ vectorBucketName: 'my-corpus', indexName: 'docs' });
  });

  it('asks ONCE, however many operations follow', async () => {
    const { store, sent } = openWith(HEALTHY, {
      GetVectors: { vectors: [] },
      QueryVectors: { vectors: [] },
      ListVectors: { vectors: [] },
    });
    await store.get(CORPUS, 'a');
    await store.put(CORPUS, entry('a', [1, 0, 0, 0]));
    await store.search(CORPUS, [1, 0, 0, 0]);
    await store.list(CORPUS);
    expect(sent.filter((s) => s.name === 'GetIndex')).toHaveLength(1);
  });

  it('costs nothing until something is actually asked of the store', () => {
    const { sent } = openWith(HEALTHY);
    expect(sent).toEqual([]);
  });
});

// ─── (a) the metric — the one that returns a plausible wrong number ─

describe('a EUCLIDEAN index is refused, whatever the caller declared', () => {
  it('refuses even when the caller declared nothing — which is the default', async () => {
    const { store } = openWith({ ...HEALTHY, distanceMetric: 'euclidean' });
    const said = await message(() => store.search(CORPUS, [1, 0, 0, 0]));
    expect(said).toContain('euclidean');
    expect(said).toContain('COSINE');
    // The measured number from the field report, so the next reader recognises
    // it rather than dismissing 0.999 as rounding.
    expect(said).toMatch(/0\.999/);
    expect(said).toMatch(/exactly 1\.0/);
  });

  it('says which said what when the declaration and the index disagree', async () => {
    const sent: Sent[] = [];
    const store = s3VectorsStore({
      bucket: 'b',
      index: 'i',
      distanceMetric: 'cosine',
      _client: {
        send: async (cmd: unknown) => {
          const c = cmd as { __name: string };
          sent.push({ name: c.__name, input: {} });
          return { index: { ...HEALTHY, distanceMetric: 'euclidean' } };
        },
      },
      _sdk: {
        GetIndexCommand: class {
          readonly __name = 'GetIndex';
        } as never,
        PutVectorsCommand: class {} as never,
        QueryVectorsCommand: class {} as never,
        GetVectorsCommand: class {} as never,
        ListVectorsCommand: class {} as never,
        DeleteVectorsCommand: class {} as never,
      },
    });
    const said = await message(() => store.get(CORPUS, 'a'));
    expect(said).toContain("You declared 'cosine'");
    expect(said).toMatch(/the index is the one that ranks/);
  });

  it('names the fix, including that the index has to be recreated', async () => {
    const { store } = openWith({ ...HEALTHY, distanceMetric: 'euclidean' });
    const said = await message(() => store.get(CORPUS, 'a'));
    expect(said).toContain('--distance-metric cosine');
  });

  it('accepts the metric however the service capitalises it', async () => {
    const { store } = openWith({ ...HEALTHY, distanceMetric: 'COSINE' }, { GetVectors: {} });
    await expect(store.get(CORPUS, 'a')).resolves.toBeNull();
  });

  it('refuses every operation after the first refusal, without re-asking', async () => {
    const { store, sent } = openWith({ ...HEALTHY, distanceMetric: 'euclidean' });
    await expect(store.get(CORPUS, 'a')).rejects.toThrow(/euclidean/);
    await expect(store.list(CORPUS)).rejects.toThrow(/euclidean/);
    // One clear failure, not a storm of them.
    expect(sent.filter((s) => s.name === 'GetIndex')).toHaveLength(1);
  });
});

// ─── (b) the layout — refused BEFORE the first byte is written ──────

describe('an index that cannot hold a passage is refused before the import starts', () => {
  const NO_AF: IndexShape = { distanceMetric: 'cosine', metadataConfiguration: {} };

  it('refuses the write, naming the key and quoting the exact configuration', async () => {
    const { store } = openWith(NO_AF);
    const said = await message(() => store.put(CORPUS, entry('a', [1, 0, 0, 0])));
    expect(said).toContain("does not declare 'af' as non-filterable metadata");
    expect(said).toContain('{"nonFilterableMetadataKeys":["af"]}');
    // The AWS error it replaces, quoted so a reader who already met it once
    // recognises what they are reading about.
    expect(said).toContain('Filterable metadata must have at most 2048 bytes');
    expect(said).toMatch(/cannot be changed after creation/);
  });

  it('writes NOTHING — the refusal happens before the first PutVectors', async () => {
    const { store, sent } = openWith(NO_AF);
    await expect(
      store.putMany(CORPUS, [entry('a', [1, 0, 0, 0]), entry('b', [0, 1, 0, 0])]),
    ).rejects.toThrow(/non-filterable/);
    expect(sent.map((s) => s.name)).toEqual(['GetIndex']);
  });

  it('reports what the index DOES declare, so the difference is visible', async () => {
    const { store } = openWith({
      distanceMetric: 'cosine',
      metadataConfiguration: { nonFilterableMetadataKeys: ['payload', 'body'] },
    });
    const said = await message(() => store.put(CORPUS, entry('a', [1, 0, 0, 0])));
    expect(said).toContain('The index declares: payload, body');
  });

  it('says so plainly when it declares none at all', async () => {
    const { store } = openWith(NO_AF);
    expect(await message(() => store.put(CORPUS, entry('a', [1, 0, 0, 0])))).toContain(
      '(no non-filterable keys)',
    );
  });

  it('does not block READS — a search still works against such an index', async () => {
    // The failure this prevents is a write failure. Refusing reads too would
    // break a consumer of a corpus somebody else wrote successfully.
    const { store } = openWith(NO_AF, { QueryVectors: { vectors: [] } });
    await expect(store.search(CORPUS, [1, 0, 0, 0])).resolves.toEqual([]);
  });
});

// ─── (c) the dimension — the same rule sqliteVectorStore applies ────

describe('the index dimension is checked against the embedder', () => {
  const FOUR: IndexShape = { ...HEALTHY, dimension: 4 };

  it('refuses a write of the wrong length, naming both numbers', async () => {
    const { store, sent } = openWith(FOUR);
    const said = await message(() => store.put(CORPUS, entry('a', [1, 0, 0])));
    expect(said).toContain('the index@4');
    expect(said).toContain('this embedder@3');
    expect(said).toMatch(/different lengths cannot be compared/);
    // And nothing was written.
    expect(sent.map((s) => s.name)).toEqual(['GetIndex']);
  });

  it('refuses a search of the wrong length before the query is billed', async () => {
    const { store, sent } = openWith(FOUR, { QueryVectors: { vectors: [] } });
    await expect(store.search(CORPUS, [1, 0, 0])).rejects.toBeInstanceOf(EmbedderMismatchError);
    expect(sent.map((s) => s.name)).toEqual(['GetIndex']);
  });

  it('catches on the FIRST search of a fresh process, which the fingerprint cannot', async () => {
    // The store's own fingerprint map is per-process and empty at boot, so
    // before 9.4.0 the first query of a restarted process against an index
    // built by another embedder had nothing to disagree with.
    const { store } = openWith(FOUR, { QueryVectors: { vectors: [] } });
    await expect(store.search(CORPUS, [1, 0, 0, 0, 0, 0])).rejects.toThrow(EmbedderMismatchError);
  });

  it('lets a matching embedder through', async () => {
    const { store, sent } = openWith(FOUR, { QueryVectors: { vectors: [] } });
    await store.put(CORPUS, entry('a', [1, 0, 0, 0]));
    await store.search(CORPUS, [1, 0, 0, 0]);
    expect(sent.map((s) => s.name)).toEqual(['GetIndex', 'PutVectors', 'QueryVectors']);
  });

  it('says nothing when the index does not report a dimension', async () => {
    const { store } = openWith(HEALTHY);
    await expect(store.put(CORPUS, entry('a', [1, 0, 0]))).resolves.toBeUndefined();
  });
});

// ─── the preflight's own failure is never a silent pass ─────────────

describe('when GetIndex itself cannot answer', () => {
  it('refuses by name, and names what to check', async () => {
    const denied = Object.assign(
      new Error('User is not authorized to perform s3vectors:GetIndex'),
      {
        name: 'AccessDeniedException',
      },
    );
    const { store } = openWith(denied);
    const said = await message(() => store.get(CORPUS, 'a'));
    expect(said).toContain("could not read the index 'my-corpus/docs'");
    expect(said).toContain('s3vectors:GetIndex');
    expect(said).toContain('User is not authorized');
    expect(said).toMatch(/the index exists in this region/);
  });

  it('never passes through to the operation that was asked for', async () => {
    const { store, sent } = openWith(new Error('NoSuchIndex'), {
      QueryVectors: { vectors: [] },
    });
    await expect(store.search(CORPUS, [1, 0, 0, 0])).rejects.toThrow(/could not read the index/);
    // A store that guessed here guessed wrong three times in the field.
    expect(sent.map((s) => s.name)).toEqual(['GetIndex']);
  });

  it('an index that answers with nothing at all is treated as unknown, not as broken', async () => {
    // Every field of GetIndexOutput.index is optional on the wire. An empty
    // answer says nothing, and "says nothing" is not "says euclidean".
    const { store } = openWith({}, { GetVectors: { vectors: [] } });
    await expect(store.get(CORPUS, 'a')).resolves.toBeNull();
  });
});
