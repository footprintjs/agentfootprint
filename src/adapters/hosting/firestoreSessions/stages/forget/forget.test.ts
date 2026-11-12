import { describe, expect, it } from 'vitest';
import { forget } from './forget.js';
import type { Call, StorePorts } from '../../call.js';
import { buildStore } from '../../factory.js';
import { fakeFirestore, grpcError } from '../../../../../../test/hosting/firestoreDouble.js';

function call(ports: Pick<StorePorts, 'open' | 'docFor' | 'collectionName'>): Call {
  return { failed: false, sessionId: 'session', ports: ports as StorePorts };
}

describe('forget effect', () => {
  it('forgetting an absent session is idempotent and performs no read', async () => {
    const fake = fakeFirestore();
    const store = buildStore({ _sdk: fake.sdk });
    await store.forget('missing');
    await store.forget('missing');
    expect(fake.calls.filter((value) => value === 'DocumentReference.delete')).toHaveLength(2);
    expect(fake.calls).not.toContain('DocumentReference.get');
    await store.close();
  });

  it('closed refusal precedes document addressing and deletion', async () => {
    const refusal = new Error('closed');
    let addressed = false;
    const input = call({
      collectionName: 'sessions',
      open: () => {
        throw refusal;
      },
      docFor: () => {
        addressed = true;
        throw new Error('must not address');
      },
    });
    await expect(forget(input)).rejects.toBe(refusal);
    expect(addressed).toBe(false);
  });

  it('a delete failure exposes only its operation, collection and status', async () => {
    const input = call({
      collectionName: 'sessions',
      open: () => undefined,
      docFor: () => ({
        id: 'document',
        get: async () => ({ id: 'document', exists: false, data: () => undefined }),
        delete: async () => {
          throw grpcError(7, 'private transport text');
        },
      }),
    });
    const error = await forget(input).catch((failure: unknown) => failure);
    expect((error as Error).name).toBe('FirestoreApiError');
    expect((error as Error).message).toContain('forgetting a session');
    expect((error as Error).message).toContain('PERMISSION_DENIED');
    expect((error as Error).message).not.toContain('private transport text');
    expect((error as Error).cause).toBeUndefined();
  });
});
