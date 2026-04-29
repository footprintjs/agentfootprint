/**
 * Unit tests — eventMeta builder.
 */

import { describe, it, expect } from 'vitest';
import {
  buildEventMeta,
  parseSubflowPath,
  type RunContext,
} from '../../../src/bridge/eventMeta.js';

function run(overrides: Partial<RunContext> = {}): RunContext {
  return {
    runStartMs: Date.now() - 100,
    runId: 'r1',
    compositionPath: [],
    ...overrides,
  };
}

describe('parseSubflowPath', () => {
  it('splits /-separated string into array', () => {
    expect(parseSubflowPath('sf-outer/sf-inner')).toEqual(['sf-outer', 'sf-inner']);
  });
  it('returns empty array for undefined / empty', () => {
    expect(parseSubflowPath(undefined)).toEqual([]);
    expect(parseSubflowPath('')).toEqual([]);
  });
  it('filters out empty segments', () => {
    expect(parseSubflowPath('/sf-a//sf-b/')).toEqual(['sf-a', 'sf-b']);
  });
});

describe('buildEventMeta — origin shapes', () => {
  it('uses TraversalContext.runtimeStageId + subflowPath when provided', () => {
    const meta = buildEventMeta(
      {
        stageId: 's',
        runtimeStageId: 'sf-outer/sf-inner/s#3',
        stageName: 's',
        depth: 2,
        subflowPath: 'sf-outer/sf-inner',
      },
      run(),
    );
    expect(meta.runtimeStageId).toBe('sf-outer/sf-inner/s#3');
    expect(meta.subflowPath).toEqual(['sf-outer', 'sf-inner']);
  });

  it('derives subflowPath from runtimeStageId when origin lacks explicit subflowPath', () => {
    const meta = buildEventMeta({ runtimeStageId: 'sf-outer/sf-inner/s#7' }, run());
    expect(meta.subflowPath).toEqual(['sf-outer', 'sf-inner']);
  });

  it('degrades gracefully when origin is undefined', () => {
    const meta = buildEventMeta(undefined, run());
    expect(meta.runtimeStageId).toBe('unknown#0');
    expect(meta.subflowPath).toEqual([]);
  });
});

describe('buildEventMeta — run-level fields', () => {
  it('copies compositionPath, runId, and optional traceId/correlationId', () => {
    const meta = buildEventMeta(undefined, {
      runStartMs: Date.now(),
      runId: 'r-x',
      compositionPath: ['Sequence:bot', 'Agent:classify'],
      traceId: 'trace-1',
      correlationId: 'corr-5',
      turnIndex: 2,
      iterIndex: 3,
    });
    expect(meta.runId).toBe('r-x');
    expect(meta.compositionPath).toEqual(['Sequence:bot', 'Agent:classify']);
    expect(meta.traceId).toBe('trace-1');
    expect(meta.correlationId).toBe('corr-5');
    expect(meta.turnIndex).toBe(2);
    expect(meta.iterIndex).toBe(3);
  });

  it('omits traceId/correlationId/turnIndex/iterIndex when not supplied', () => {
    const meta = buildEventMeta(undefined, run());
    expect(meta.traceId).toBeUndefined();
    expect(meta.correlationId).toBeUndefined();
    expect(meta.turnIndex).toBeUndefined();
    expect(meta.iterIndex).toBeUndefined();
  });

  it('computes runOffsetMs as wallClockMs - runStartMs', () => {
    const start = Date.now() - 500;
    const meta = buildEventMeta(undefined, run({ runStartMs: start }));
    expect(meta.runOffsetMs).toBeGreaterThanOrEqual(500);
    expect(meta.runOffsetMs).toBeLessThan(1000); // generous
  });
});

describe('INJECTION_KEYS + COMPOSITION_KEYS stability', () => {
  it('exports stable constants (the builder↔recorder contract)', async () => {
    const { INJECTION_KEYS, injectionKeyForSlot, isInjectionKey } = await import(
      '../../../src/conventions.js'
    );
    expect(INJECTION_KEYS.SYSTEM_PROMPT).toBe('systemPromptInjections');
    expect(INJECTION_KEYS.MESSAGES).toBe('messagesInjections');
    expect(INJECTION_KEYS.TOOLS).toBe('toolsInjections');
    expect(injectionKeyForSlot('system-prompt')).toBe('systemPromptInjections');
    expect(isInjectionKey('systemPromptInjections')).toBe(true);
    expect(isInjectionKey('random-key')).toBe(false);
  });

  it('COMPOSITION_KEYS are all distinct from INJECTION_KEYS', async () => {
    const { INJECTION_KEYS } = await import('../../../src/conventions.js');
    const { COMPOSITION_KEYS } = await import('../../../src/recorders/core/types.js');
    const injection = new Set(Object.values(INJECTION_KEYS));
    for (const comp of Object.values(COMPOSITION_KEYS)) {
      expect(injection.has(comp as string)).toBe(false);
    }
  });
});
