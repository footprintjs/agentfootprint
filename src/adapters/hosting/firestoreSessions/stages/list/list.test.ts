import { describe, expect, it } from 'vitest';
import { query } from './list.js';
import type { ListCall, StorePorts } from '../../call.js';
import { FirestoreIndexMissingError } from '../../errors.js';
import { fakeFirestore, grpcError } from '../../../../../../test/hosting/firestoreDouble.js';

function setup(options: Parameters<typeof fakeFirestore>[0] = {}) {
  const fake = fakeFirestore(options);
  const db = new fake.sdk.Firestore();
  const ports: Pick<
    StorePorts,
    'open' | 'collection' | 'documentIdSentinel' | 'collectionName' | 'databaseName'
  > = {
    open: () => undefined,
    collection: () => db.collection('sessions'),
    documentIdSentinel: fake.sdk.FieldPath.documentId(),
    collectionName: 'sessions',
    databaseName: 'named-db',
  };
  const input: ListCall = {
    failed: false,
    ports: ports as StorePorts,
    sessionId: '',
    userId: 'owner',
  };
  return { fake, input };
}

describe('query stage boundary', () => {
  it('a foreign cursor restarts at the first page without reaching startAfter', async () => {
    const seed = new Map(
      Array.from({ length: 3 }, (_, i) => [String(i).repeat(64), { owner: 'owner', savedAt: i }]),
    );
    const { fake, input } = setup({ seed });
    input.listOptions = { limit: 0, cursor: '1000:foreign/id' };
    await query(input);
    expect(input.snapshot?.docs).toHaveLength(2);
    expect(input.limit).toBe(1);
    expect(input.cursorRecognized).toBe(false);
    expect(fake.calls).not.toContain('Query.startAfter');
    expect(fake.calls.filter((call) => call === 'Query.get')).toHaveLength(1);
  });

  it('a synchronous cursor-builder failure is sanitized before any get', async () => {
    const secret = 'private SDK detail';
    const { fake, input } = setup({ failStartAfterWith: grpcError(7, secret) });
    input.listOptions = { cursor: `1000:${'a'.repeat(64)}` };
    const error = await query(input).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('FirestoreApiError');
    expect((error as Error).message).toContain('PERMISSION_DENIED');
    expect((error as Error).message).not.toContain(secret);
    expect((error as Error).cause).toBeUndefined();
    expect(fake.calls).not.toContain('Query.get');
  });

  it('a missing index keeps its named refusal and database context', async () => {
    const { input } = setup({ failQueryWith: grpcError(9, 'raw backend text') });
    const error = await query(input).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(FirestoreIndexMissingError);
    expect((error as Error).message).toContain('named-db');
    expect((error as Error).message).toContain('sessions');
    expect((error as Error).message).not.toContain('raw backend text');
  });
});
