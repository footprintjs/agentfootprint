import { describe, expect, it } from 'vitest';
import { ownershipChart } from '../../chart.js';
import { execute } from '../../execute.js';
import type { OwnershipCall } from '../../call.js';
import type { FirestoreTransactionLike } from '../../types.js';
import { SessionOwnershipConflictError } from '../../../../../hosting/errors.js';

function transaction(existingOwner: unknown, incoming: string | undefined) {
  const writes: Record<string, unknown>[] = [];
  const ref = {
    id: 'document',
    get: async () => ({ id: 'document', exists: false, data: () => undefined }),
    delete: async () => undefined,
  };
  const tx: FirestoreTransactionLike = {
    get: async () => ({
      id: 'document',
      exists: true,
      data: () => ({ owner: existingOwner, obsolete: 'old column' }),
    }),
    set: (_ref, row) => {
      writes.push(row);
      return tx;
    },
  };
  const input: OwnershipCall = {
    failed: false,
    sessionId: 'session',
    tx,
    ref,
    row: { envelope: 'new bytes' },
    owner: incoming,
  };
  return { input, writes };
}

describe('transaction owner chart', () => {
  it('a leaner turn preserves the first signer while replacing other columns', async () => {
    const { input, writes } = transaction('owner-a', undefined);
    await execute(ownershipChart, input);
    expect(writes).toEqual([{ envelope: 'new bytes', owner: 'owner-a' }]);
  });

  it('a conflicting signer refuses the whole write with the canonical error', async () => {
    const { input, writes } = transaction('owner-a', 'owner-b');
    await expect(execute(ownershipChart, input)).rejects.toBeInstanceOf(
      SessionOwnershipConflictError,
    );
    expect(writes).toEqual([]);
  });

  it('a transaction read failure never writes or turns private SDK text into scope data', async () => {
    const { input, writes } = transaction(undefined, 'owner-a');
    const refusal = new Error('private SDK transport text');
    input.tx.get = async () => {
      throw refusal;
    };
    const records: unknown[] = [];
    await expect(execute(ownershipChart, input, (record) => records.push(record))).rejects.toBe(
      refusal,
    );
    expect(writes).toEqual([]);
    expect(records).toHaveLength(1);
    expect(JSON.stringify(records)).not.toContain('private SDK transport text');
  });
});
