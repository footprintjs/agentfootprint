import { describe, expect, it } from 'vitest';
import { writeOwner } from './write.js';
import type { OwnershipCall } from '../../call.js';
import type { FirestoreTransactionLike } from '../../types.js';

function input(keptOwner: string | undefined) {
  const writes: Record<string, unknown>[] = [];
  const ref = {
    id: 'document',
    get: async () => ({ id: 'document', exists: false, data: () => undefined }),
    delete: async () => undefined,
  };
  const tx: FirestoreTransactionLike = {
    get: ref.get,
    set: (_ref, row) => {
      writes.push(row);
      return tx;
    },
  };
  const call: OwnershipCall = {
    failed: false,
    sessionId: 'session',
    tx,
    ref,
    row: { envelope: 'bytes', owner: 'incoming cannot override resolved owner' },
    owner: 'incoming',
    keptOwner,
  };
  return { call, writes };
}

describe('transaction row write', () => {
  it('writes explicit null for no established owner and does not mutate the prepared row', () => {
    const { call, writes } = input(undefined);
    writeOwner(call);
    expect(writes).toEqual([{ envelope: 'bytes', owner: null }]);
    expect(call.row.owner).toBe('incoming cannot override resolved owner');
  });

  it('writes the resolved owner rather than a stale incoming column', () => {
    const { call, writes } = input('first signer');
    writeOwner(call);
    expect(writes).toEqual([{ envelope: 'bytes', owner: 'first signer' }]);
  });
});
