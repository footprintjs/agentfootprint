import { describe, expect, it } from 'vitest';
import { decode } from './decode.js';
import { UnreadableEnvelopeError } from '../../../../../hosting/errors.js';

const envelope = {
  format: 'conversation-v1',
  savedAt: 1000,
  data: {
    version: 1,
    runId: 'run',
    history: [{ role: 'user', content: 'hello' }],
    lastCompletedIteration: 0,
    originalInput: { message: 'hello' },
    checkpointedAt: 1000,
  },
};

describe('stored envelope decoding', () => {
  it('reads a complete valid envelope without projecting away its fields', () => {
    const row = { envelope: JSON.stringify(envelope), irrelevant: 'column' };
    expect(decode(row, 'session')).toEqual(envelope);
    expect(row.envelope).toBe(JSON.stringify(envelope));
  });

  it.each([undefined, null, 12, '{not json'])(
    'a present unreadable value is refused: %s',
    (value) => {
      expect(() => decode({ envelope: value }, 'session')).toThrow(UnreadableEnvelopeError);
    },
  );

  it('keeps the canonical format and checkpoint refusals instead of answering absence', () => {
    expect(() =>
      decode({ envelope: JSON.stringify({ ...envelope, format: 'future-format' }) }, 's'),
    ).toThrow(TypeError);
    expect(() =>
      decode({ envelope: JSON.stringify({ ...envelope, data: { version: 1 } }) }, 's'),
    ).toThrow(/required fields/);
  });
});
