import { describe, expect, it } from 'vitest';
import { ownerOf } from './owner.js';

describe('established owner projection', () => {
  it.each([undefined, {}, { owner: undefined }, { owner: null }, { owner: '' }, { owner: 3 }])(
    'keeps missing, unowned and malformed ownership indistinguishable: %j',
    (row) => {
      expect(ownerOf(row)).toBeUndefined();
    },
  );

  it('returns a stored nonempty owner verbatim, without trimming or deriving an identity', () => {
    expect(ownerOf({ owner: 'owner-a', sessionId: 'another-address' })).toBe('owner-a');
    expect(ownerOf({ owner: ' ' })).toBe(' ');
  });
});
