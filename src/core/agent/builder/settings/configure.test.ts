import { describe, expect, it } from 'vitest';
import type { RunConfigFn } from '../../types.js';
import { setRunConfiguration, type RunConfigurationPort } from './configure.js';
import { setMaxIterations, type IterationLimitPort } from './iterations.js';

describe('builder run settings', () => {
  it('retains the exact resolver and refuses replacement before reading its shape', () => {
    const receiver: RunConfigurationPort = {};
    const resolver: RunConfigFn = () => undefined;
    expect(setRunConfiguration(receiver, resolver, receiver)).toBe(receiver);
    expect(receiver.runConfigFn).toBe(resolver);
    expect(() => setRunConfiguration(receiver, null as unknown as RunConfigFn, receiver)).toThrow(
      'AgentBuilder.configure: already set.',
    );
    expect(receiver.runConfigFn).toBe(resolver);
  });

  it('rejects invalid iteration counts without losing the last valid declaration', () => {
    const receiver: IterationLimitPort = {};
    expect(setMaxIterations(receiver, 3, receiver)).toBe(receiver);
    for (const value of [0, -1, 1.5, Infinity, NaN]) {
      expect(() => setMaxIterations(receiver, value, receiver)).toThrow(
        'expected a positive integer',
      );
      expect(receiver.maxIterationsOverride).toBe(3);
    }
    expect(setMaxIterations(receiver, 2, receiver)).toBe(receiver);
    expect(receiver.maxIterationsOverride).toBe(2);
  });
});
