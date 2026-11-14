import { describe, expect, it } from 'vitest';
import {
  assertOutputFallbackCoherent,
  configureOutputFallback,
  type OutputFallbackPort,
} from './fallback.js';

describe('fallback declaration coherence', () => {
  it('defers parser validation until the whole builder is checked', () => {
    const parsed: unknown[] = [];
    const receiver: OutputFallbackPort = {};
    const fallback = async () => ({ answer: 'fallback' });
    const canned = { answer: 'canned' };
    expect(configureOutputFallback(receiver, { fallback, canned }, receiver)).toBe(receiver);
    expect(receiver.outputFallbackCfg?.fallback).toBe(fallback);
    expect(receiver.outputFallbackCfg?.canned).toBe(canned);
    expect(() => assertOutputFallbackCoherent(receiver)).toThrow('not met');
    receiver.outputSchemaParser = {
      parse(value: unknown) {
        parsed.push(value);
        return value;
      },
    };
    assertOutputFallbackCoherent(receiver);
    expect(parsed).toEqual([canned]);
  });

  it('leaves an unconfigured builder alone without looking for a parser', () => {
    const receiver: OutputFallbackPort = {
      get outputSchemaParser(): never {
        throw new Error('parser was read');
      },
    };
    expect(() => assertOutputFallbackCoherent(receiver)).not.toThrow();
  });
});
