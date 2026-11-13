import { describe, expect, it } from 'vitest';
import type { ScriptTravelOptions } from '../../scripts/types.js';
import { configureScriptTravel, type ScriptTravelPort } from './configure.js';

describe('the builder script attachment declaration', () => {
  it('refuses a non-positive byte bound without consuming the one declaration', () => {
    const receiver: ScriptTravelPort = {};
    expect(() => configureScriptTravel(receiver, { maxBytes: 0 }, receiver)).toThrow(/maxBytes/);
    expect(receiver.scriptTravelValue).toBeUndefined();
    configureScriptTravel(receiver, { which: 'all', maxBytes: 80 }, receiver);
    expect(receiver.scriptTravelValue).toEqual({ which: 'all', maxBytes: 80 });
  });

  it('refuses replacement before reading a new byte policy', () => {
    const receiver: ScriptTravelPort = {};
    configureScriptTravel(receiver, undefined, receiver);
    const original = receiver.scriptTravelValue;
    const replacement: ScriptTravelOptions = {
      get maxBytes(): never {
        throw new Error('replacement must not be read');
      },
    };
    expect(() => configureScriptTravel(receiver, replacement, receiver)).toThrow(/already set/);
    expect(receiver.scriptTravelValue).toBe(original);
  });
});
