import { describe, expect, it } from 'vitest';
import { readNativeToolFailure, toolFailure } from './toolFailure.js';

describe('native tool failure declaration', () => {
  it('recognizes only the original native return and keeps its metadata off the value', () => {
    const declaration = { category: 'timeout', tryInstead: 'Check the replica.' } as const;
    const returned = toolFailure('Collector unavailable.', declaration);
    expect(readNativeToolFailure(returned)).toEqual(declaration);
    expect(JSON.stringify(returned)).toBe('{"content":"Collector unavailable."}');
    expect(readNativeToolFailure(structuredClone(returned))).toBeUndefined();
    expect(readNativeToolFailure({ ...returned, ...declaration })).toBeUndefined();
  });

  it('takes its own data snapshot and validates the engine categories', () => {
    const declaration = { category: 'network', notChecked: 'primary' } as const;
    const returned = toolFailure(null, declaration);
    expect(readNativeToolFailure(returned)).not.toBe(declaration);
    // @ts-expect-error exercising a malformed JavaScript call
    expect(() => toolFailure(null, { category: 'unknown-category' })).toThrow(TypeError);
    const accessor = {
      category: 'auth',
      get tryInstead(): string {
        throw new Error('getter ran');
      },
    } as const;
    expect(() => toolFailure(null, accessor)).toThrow('Expected an enumerable data property.');
  });
});
