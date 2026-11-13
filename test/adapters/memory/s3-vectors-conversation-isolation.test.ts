/**
 * s3VectorsStore — one conversation's memory is never listed or erased through
 * another's (finding r3-62-adapters-memory-2, the part that needs no re-keying).
 *
 * A vector's key is `<namespace>#<id>`, and a namespace may itself contain `#`:
 * the conversation id `c#x` is passed through by `encodeIdentityField`. So the
 * key prefix of conversation `c` (`t/p/c#`) is also a prefix of every key of
 * conversation `c#x` (`t/p/c#x#…`). `list` and `forget` used to select rows by
 * that prefix alone; they now also require the row's own `ns` metadata to be
 * the conversation's namespace.
 *
 * What is faked, exactly: the AWS SDK boundary. `_sdk` supplies the six
 * command classes (each records its operation name and input) and `_client`
 * supplies `send()`, backed by a map of stored vectors. The double honours the
 * request flags the way the service documents them — ListVectors returns a
 * row's `metadata` only when `returnMetadata: true` and its `data` only when
 * `returnData: true` — so a selection that needs metadata it did not ask for
 * selects nothing here, as it would against the real service. Nothing reaches
 * AWS. Not shown here: the real service's paging and consistency.
 *
 * NOT fixed here, and so not asserted: when the entry ids also line up (`c` +
 * `x#y` and `c#x` + `y`) the two keys are one key, and the second write
 * replaces the first. Closing that needs a key that cannot collide, which
 * re-keys stored vectors: a follow-up for the major version.
 */

import { describe, expect, it } from 'vitest';

import { s3VectorsStore } from '../../../src/adapters/memory/s3Vectors.js';
import type { MemoryEntry } from '../../../src/memory/entry/index.js';
import { identityNamespace } from '../../../src/memory/identity/index.js';
import type { MemoryIdentity } from '../../../src/memory/identity/index.js';

interface StoredVector {
  key: string;
  data?: unknown;
  metadata?: Record<string, unknown>;
}

/** An S3 Vectors double that keeps what it is given and honours `return*` flags. */
function statefulS3Vectors() {
  const vectors = new Map<string, StoredVector>();
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  const command = (name: string): new (input: unknown) => unknown =>
    class {
      readonly __name = name;
      constructor(readonly __input: unknown) {}
    } as unknown as new (input: unknown) => unknown;
  const shape = (v: StoredVector, input: Record<string, unknown>) => ({
    key: v.key,
    ...(input['returnData'] === true && { data: v.data }),
    ...(input['returnMetadata'] === true && { metadata: v.metadata }),
  });
  const client = {
    send: async (cmd: unknown): Promise<unknown> => {
      const { __name: name, __input } = cmd as { __name: string; __input: unknown };
      const input = __input as Record<string, unknown>;
      sent.push({ name, input });
      switch (name) {
        case 'GetIndex':
          return {
            index: {
              distanceMetric: 'cosine',
              metadataConfiguration: { nonFilterableMetadataKeys: ['af'] },
            },
          };
        case 'PutVectors':
          for (const v of input['vectors'] as StoredVector[])
            vectors.set(v.key, structuredClone(v));
          return {};
        case 'ListVectors':
          return { vectors: [...vectors.values()].map((v) => shape(v, input)) };
        case 'DeleteVectors':
          for (const key of input['keys'] as string[]) vectors.delete(key);
          return {};
        default:
          throw new Error(`statefulS3Vectors: ${name} is not modelled by this double`);
      }
    },
  };
  const sdk = {
    GetIndexCommand: command('GetIndex'),
    PutVectorsCommand: command('PutVectors'),
    QueryVectorsCommand: command('QueryVectors'),
    GetVectorsCommand: command('GetVectors'),
    ListVectorsCommand: command('ListVectors'),
    DeleteVectorsCommand: command('DeleteVectors'),
  };
  return { client, sdk, sent, vectors };
}

function open() {
  const aws = statefulS3Vectors();
  const store = s3VectorsStore({ bucket: 'b', index: 'i', _client: aws.client, _sdk: aws.sdk });
  return { store, aws };
}

function entry(id: string, value: string): MemoryEntry<unknown> {
  return {
    id,
    value,
    version: 1,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    lastAccessedAt: 1_700_000_000_000,
    accessCount: 0,
    embedding: [1, 0, 0, 0],
  } as MemoryEntry<unknown>;
}

const values = (entries: readonly MemoryEntry<unknown>[]) => entries.map((e) => e.value).sort();

// Same tenant, same person; the second conversation's id is the first's plus `#x`.
const C: MemoryIdentity = { tenant: 't', principal: 'p', conversationId: 'c' };
const C_HASH_X: MemoryIdentity = { tenant: 't', principal: 'p', conversationId: 'c#x' };

describe('a conversation whose id merely starts with another one’s is not that one', () => {
  it('the two namespaces really do share a key prefix — the premise of this file', () => {
    expect(identityNamespace(C_HASH_X).startsWith(`${identityNamespace(C)}#`)).toBe(true);
  });

  it('listing conversation `c` does not show `c#x`’s memory', async () => {
    const { store } = open();
    await store.put(C, entry('a', 'c: own entry'));
    await store.put(C_HASH_X, entry('z', 'c#x: not yours'));

    expect(values((await store.list(C)).entries)).toEqual(['c: own entry']);
    expect(values((await store.list(C_HASH_X)).entries)).toEqual(['c#x: not yours']);
  });

  it('erasing conversation `c` leaves `c#x`’s memory where it was', async () => {
    const { store, aws } = open();
    await store.put(C, entry('a', 'c: own entry'));
    await store.put(C_HASH_X, entry('z', 'c#x: not yours'));

    await store.forget(C);

    expect([...aws.vectors.keys()]).toEqual([`${identityNamespace(C_HASH_X)}#z`]);
    expect(values((await store.list(C_HASH_X)).entries)).toEqual(['c#x: not yours']);
    expect((await store.list(C)).entries).toEqual([]);
  });
});

describe('a correctly scoped caller sees no change', () => {
  it('list returns every own entry, including an id that itself contains `#`', async () => {
    const { store } = open();
    await store.put(C, entry('refunds.md#3', 'passage three'));
    await store.put(C, entry('fact:tone', 'short answers'));

    const listed = (await store.list(C)).entries;
    expect(listed.map((e) => e.id).sort()).toEqual(['fact:tone', 'refunds.md#3']);
  });

  it('forget still erases every own entry, and nothing else', async () => {
    const { store, aws } = open();
    const OTHER: MemoryIdentity = { tenant: 't', principal: 'q', conversationId: 'c' };
    await store.put(C, entry('refunds.md#3', 'passage three'));
    await store.put(C, entry('fact:tone', 'short answers'));
    await store.put(OTHER, entry('fact:tone', 'someone else'));

    await store.forget(C);

    // forget now selects by metadata, and the double returns it only when asked:
    // an erasure that forgot to ask would leave both own rows here.
    expect([...aws.vectors.keys()]).toEqual([`${identityNamespace(OTHER)}#fact:tone`]);
  });
});
