import { describe, expect, it } from 'vitest';
import { countRegexInputWork, countSplitInputWork } from './nativeWork.js';

describe('native text work counts admitted input, not elapsed time', () => {
  it('keeps matches, misses and global/sticky cursors while counting their search windows', () => {
    const original = RegExp.prototype.exec;
    const global = /b/g;
    global.lastIndex = 1;
    const sticky = /b/y;
    sticky.lastIndex = 2;
    const counted = countRegexInputWork(() => [
      global.exec('aabb'), // positions 1 through 2, inclusive: 2 characters
      global.exec('aabb'), // position 3: 1 character
      global.exec('aabb'), // at end: no remaining characters
      sticky.exec('aabb'), // position 2: 1 character
      /z/.exec('abcd'), // full miss: 4 characters
    ]);
    expect(counted.result.map((m) => m?.index)).toEqual([2, 3, undefined, 2, undefined]);
    expect([counted.calls, counted.work]).toEqual([5, 8]);
    expect([global.lastIndex, sticky.lastIndex]).toEqual([0, 3]);
    expect(RegExp.prototype.exec).toBe(original);
  });

  it('does not introduce extra string coercions and restores after a thrown call', () => {
    const original = RegExp.prototype.exec;
    let conversions = 0;
    const value = { toString: () => (++conversions, 'abc') };
    const counted = countRegexInputWork(() => /b/.exec(value as unknown as string));
    expect(counted.result?.index).toBe(1);
    expect([conversions, counted.calls, counted.work]).toEqual([1, 1, 0]);
    const failure = new Error('work failed');
    expect(() =>
      countRegexInputWork(() => {
        throw failure;
      }),
    ).toThrow(failure);
    expect(RegExp.prototype.exec).toBe(original);
  });

  it('preserves split results, defaults, limits and finally restoration', () => {
    const original = String.prototype.split;
    const counted = countSplitInputWork(() => [
      'a,b,c'.split(','),
      'a,b,c'.split(',', 2),
      ('abc' as unknown as { split(): string[] }).split(),
    ]);
    expect(counted.result).toEqual([['a', 'b', 'c'], ['a', 'b'], ['abc']]);
    expect([counted.calls, counted.work]).toEqual([3, 13]);
    expect(String.prototype.split).toBe(original);
    const failure = new Error('work failed');
    expect(() =>
      countSplitInputWork(() => {
        throw failure;
      }),
    ).toThrow(failure);
    expect(String.prototype.split).toBe(original);
  });
});
