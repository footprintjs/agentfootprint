import { describe, expect, it } from 'vitest';
import { configureSelfExplain, type SelfExplainPort } from './configure.js';

describe('self-explain declaration', () => {
  it('keeps the original options object for a dynamic agent', () => {
    const receiver: SelfExplainPort = { opts: {} };
    const options = { id: 'explain' };
    expect(configureSelfExplain(receiver, options, receiver)).toBe(receiver);
    expect(receiver.selfExplainConfig).toBe(options);
  });

  it('refuses a duplicate before reading reactMode', () => {
    const first = {};
    const receiver: SelfExplainPort = {
      selfExplainConfig: first,
      get opts(): never {
        throw new Error('mode was read');
      },
    };
    expect(() => configureSelfExplain(receiver, {}, receiver)).toThrow('already enabled');
    expect(receiver.selfExplainConfig).toBe(first);
  });

  it('refuses classic mode without recording options', () => {
    const receiver: SelfExplainPort = { opts: { reactMode: 'classic' } };
    expect(() => configureSelfExplain(receiver, {}, receiver)).toThrow(
      'per-iteration slot recomposition',
    );
    expect(receiver.selfExplainConfig).toBeUndefined();
  });
});
