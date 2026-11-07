import { describe, expect, it } from 'vitest';
import { decodeReply } from './decode.js';

describe('time reply channel decoding', () => {
  it('retains the old range string exactly and trims only correction text', () => {
    expect(decodeReply({ range: 'old-value' })).toEqual({ kind: 'range', value: 'old-value' });
    expect(decodeReply({ correction: '  yesterday  ' })).toEqual({
      kind: 'text',
      value: 'yesterday',
    });
  });

  it.each([
    [{}, 'neither-filled'],
    [{ range: 'r', correction: 'c' }, 'both-filled'],
    [{ range: null }, 'invalid-range'],
    [{ range: 7 }, 'invalid-range'],
    [{ correction: false }, 'invalid-correction'],
    [{ correction: ' ' }, 'invalid-correction'],
    [{ correction: 'x'.repeat(4097) }, 'invalid-correction'],
  ] as const)(
    'holds malformed or conflicting channels without projecting their values',
    (input, rule) => {
      const result = decodeReply(input);
      expect(result).toMatchObject({ kind: 'hold', rule });
      expect(Object.keys(result).sort()).toEqual(['kind', 'reason', 'rule']);
    },
  );
});
