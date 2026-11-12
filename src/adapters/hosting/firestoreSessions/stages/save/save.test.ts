import { describe, expect, it } from 'vitest';
import { buildStore } from '../../factory.js';
import { FIRESTORE_MAX_ENVELOPE_BYTES } from '../../constants.js';
import { EnvelopeTooLargeError } from '../../errors.js';
import type { SessionRunRecord } from '../../record.js';
import { fakeFirestore } from '../../../../../../test/hosting/firestoreDouble.js';

const envelope = (content = 'before') => ({
  format: 'conversation-v1' as const,
  savedAt: 1700000000000,
  data: {
    version: 1 as const,
    runId: 'run',
    history: [{ role: 'user' as const, content }],
    lastCompletedIteration: 0,
    originalInput: { message: 'hello' },
    checkpointedAt: 1700000000000,
  },
});

describe('save chart contract', () => {
  it('records the native size refusal without storing the oversized content or reaching the SDK', async () => {
    const fake = fakeFirestore();
    const records: SessionRunRecord[] = [];
    const store = buildStore({ _sdk: fake.sdk }, (record) => records.push(record));
    await expect(
      store.persist('too-large', envelope('private-canary'.repeat(100000))),
    ).rejects.toBeInstanceOf(EnvelopeTooLargeError);
    expect(fake.calls).not.toContain('Firestore.runTransaction');
    expect(records).toHaveLength(1);
    const text = JSON.stringify(records[0]?.snapshot);
    expect(text).toContain('envelope-too-large');
    expect(text).toContain(String(FIRESTORE_MAX_ENVELOPE_BYTES));
    expect(text).not.toContain('private-canary');
    await store.close();
  });

  it('snapshots and starts the transaction before the caller can mutate the envelope', async () => {
    const fake = fakeFirestore();
    const store = buildStore({ _sdk: fake.sdk });
    const input = envelope();
    const pending = store.persist('session', input);
    expect(fake.calls).toContain('Firestore.runTransaction');
    input.data.history[0]!.content = 'after';
    await pending;
    const stored = await store.hydrate('session');
    expect(stored?.format).toBe('conversation-v1');
    if (stored?.format !== 'conversation-v1') throw new Error('Expected a conversation');
    expect(stored.data.history[0]?.content).toBe('before');
    await store.close();
  });
});
