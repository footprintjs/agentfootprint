/**
 * Unit tests — ContextRecorder.
 *
 * Covers subflow entry/exit tracking, injection diff emission,
 * slot-composition summary, evictions, budget pressure, and the
 * listener-count fast-path skip.
 */

import { describe, it, expect, vi } from 'vitest';
import type { FlowSubflowEvent, WriteEvent } from 'footprintjs';
import { EventDispatcher } from '../../../../src/events/dispatcher.js';
import { ContextRecorder } from '../../../../src/recorders/core/ContextRecorder.js';
import {
  COMPOSITION_KEYS,
  type BudgetPressureRecord,
  type EvictionRecord,
  type InjectionRecord,
  type SlotComposition,
} from '../../../../src/recorders/core/types.js';
import { INJECTION_KEYS, SUBFLOW_IDS } from '../../../../src/conventions.js';
import type { RunContext } from '../../../../src/bridge/eventMeta.js';

function makeRun(): RunContext {
  return {
    runStartMs: Date.now(),
    runId: 'r-test',
    compositionPath: ['Sequence:bot'],
  };
}

function subflowEntry(subflowId: string): FlowSubflowEvent {
  return {
    name: subflowId,
    subflowId,
    traversalContext: {
      stageId: subflowId,
      runtimeStageId: `${subflowId}#0`,
      stageName: subflowId,
      depth: 0,
    },
  };
}

function subflowExit(subflowId: string): FlowSubflowEvent {
  return { ...subflowEntry(subflowId) };
}

function writeEvent(key: string, value: unknown): WriteEvent {
  return {
    key,
    value,
    operation: 'set',
    stageName: 'inject',
    stageId: 'inject',
    runtimeStageId: `inject#0`,
    pipelineId: 'pipeline',
    timestamp: Date.now(),
  } as WriteEvent;
}

function injection(overrides: Partial<InjectionRecord> = {}): InjectionRecord {
  return {
    contentSummary: 'x',
    contentHash: 'h1',
    slot: 'system-prompt',
    source: 'skill',
    reason: 'test',
    ...overrides,
  };
}

describe('ContextRecorder — injection emit', () => {
  it('emits context.injected for each new entry in a slot-subflow write', () => {
    const dispatcher = new EventDispatcher();
    const fn = vi.fn();
    dispatcher.on('agentfootprint.context.injected', fn);
    const rec = new ContextRecorder({ dispatcher, getRunContext: makeRun });

    rec.onSubflowEntry(subflowEntry(SUBFLOW_IDS.SYSTEM_PROMPT));
    rec.onWrite(
      writeEvent(INJECTION_KEYS.SYSTEM_PROMPT, [
        injection({ contentHash: 'a' }),
        injection({ contentHash: 'b' }),
      ]),
    );
    rec.onSubflowExit(subflowExit(SUBFLOW_IDS.SYSTEM_PROMPT));

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[0][0].payload.contentHash).toBe('a');
    expect(fn.mock.calls[1][0].payload.contentHash).toBe('b');
  });

  it('does not re-emit for injections already seen (same hash)', () => {
    const dispatcher = new EventDispatcher();
    const fn = vi.fn();
    dispatcher.on('agentfootprint.context.injected', fn);
    const rec = new ContextRecorder({ dispatcher, getRunContext: makeRun });

    rec.onSubflowEntry(subflowEntry(SUBFLOW_IDS.SYSTEM_PROMPT));
    rec.onWrite(writeEvent(INJECTION_KEYS.SYSTEM_PROMPT, [injection({ contentHash: 'a' })]));
    rec.onWrite(
      writeEvent(INJECTION_KEYS.SYSTEM_PROMPT, [
        injection({ contentHash: 'a' }), // duplicate
        injection({ contentHash: 'b' }), // new
      ]),
    );

    expect(fn).toHaveBeenCalledTimes(2); // a + b, not a twice
    expect(fn.mock.calls[1][0].payload.contentHash).toBe('b');
  });

  it('ignores writes when no slot subflow is active', () => {
    const dispatcher = new EventDispatcher();
    const fn = vi.fn();
    dispatcher.on('agentfootprint.context.injected', fn);
    const rec = new ContextRecorder({ dispatcher, getRunContext: makeRun });

    // No subflow entry — just a write. Should be ignored.
    rec.onWrite(writeEvent(INJECTION_KEYS.SYSTEM_PROMPT, [injection({ contentHash: 'a' })]));
    expect(fn).not.toHaveBeenCalled();
  });

  it("ignores writes to the wrong slot's injection key", () => {
    const dispatcher = new EventDispatcher();
    const fn = vi.fn();
    dispatcher.on('agentfootprint.context.injected', fn);
    const rec = new ContextRecorder({ dispatcher, getRunContext: makeRun });

    // Inside messages subflow, a write to the TOOLS injection key is ignored.
    rec.onSubflowEntry(subflowEntry(SUBFLOW_IDS.MESSAGES));
    rec.onWrite(writeEvent(INJECTION_KEYS.TOOLS, [injection({ slot: 'tools', contentHash: 'a' })]));
    expect(fn).not.toHaveBeenCalled();
  });

  it('ignores non-subflow subflow entries (e.g. sf-route)', () => {
    const dispatcher = new EventDispatcher();
    const fn = vi.fn();
    dispatcher.on('agentfootprint.context.injected', fn);
    const rec = new ContextRecorder({ dispatcher, getRunContext: makeRun });

    rec.onSubflowEntry(subflowEntry(SUBFLOW_IDS.ROUTE));
    rec.onWrite(writeEvent(INJECTION_KEYS.SYSTEM_PROMPT, [injection({ contentHash: 'a' })]));
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('ContextRecorder — slot_composed emit', () => {
  it('emits context.slot_composed when a composition record is written', () => {
    const dispatcher = new EventDispatcher();
    const fn = vi.fn();
    dispatcher.on('agentfootprint.context.slot_composed', fn);
    const rec = new ContextRecorder({ dispatcher, getRunContext: makeRun });

    rec.onSubflowEntry(subflowEntry(SUBFLOW_IDS.MESSAGES));
    const summary: SlotComposition = {
      slot: 'messages',
      iteration: 1,
      budget: { cap: 1000, used: 600, headroomChars: 400 },
      sourceBreakdown: { rag: { chars: 400, count: 2 }, user: { chars: 200, count: 1 } },
      droppedCount: 1,
      droppedSummaries: ['dropped-chunk-5'],
    };
    rec.onWrite(writeEvent(COMPOSITION_KEYS.SLOT_COMPOSED, summary));

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0].payload.slot).toBe('messages');
    expect(fn.mock.calls[0][0].payload.iteration).toBe(1);
  });
});

describe('ContextRecorder — eviction emit', () => {
  it('emits one context.evicted per eviction record', () => {
    const dispatcher = new EventDispatcher();
    const fn = vi.fn();
    dispatcher.on('agentfootprint.context.evicted', fn);
    const rec = new ContextRecorder({ dispatcher, getRunContext: makeRun });

    rec.onSubflowEntry(subflowEntry(SUBFLOW_IDS.MESSAGES));
    const evictions: EvictionRecord[] = [
      { slot: 'messages', contentHash: 'h1', reason: 'budget', survivalMs: 1200 },
      { slot: 'messages', contentHash: 'h2', reason: 'stale', survivalMs: 60000 },
    ];
    rec.onWrite(writeEvent(COMPOSITION_KEYS.EVICTED, evictions));

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[0][0].payload.reason).toBe('budget');
    expect(fn.mock.calls[1][0].payload.reason).toBe('stale');
  });
});

describe('ContextRecorder — budget pressure emit', () => {
  it('emits one context.budget_pressure per pressure record', () => {
    const dispatcher = new EventDispatcher();
    const fn = vi.fn();
    dispatcher.on('agentfootprint.context.budget_pressure', fn);
    const rec = new ContextRecorder({ dispatcher, getRunContext: makeRun });

    rec.onSubflowEntry(subflowEntry(SUBFLOW_IDS.TOOLS));
    const pressure: BudgetPressureRecord[] = [
      {
        slot: 'tools',
        capTokens: 2000,
        projectedTokens: 2500,
        overflowBy: 500,
        planAction: 'evict',
      },
    ];
    rec.onWrite(writeEvent(COMPOSITION_KEYS.BUDGET_PRESSURE, pressure));

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0].payload.planAction).toBe('evict');
  });
});

describe('ContextRecorder — listener-count fast path', () => {
  it('does not dispatch when no listener is attached for the event type', () => {
    const dispatcher = new EventDispatcher();
    const dispatchSpy = vi.spyOn(dispatcher, 'dispatch');
    const rec = new ContextRecorder({ dispatcher, getRunContext: makeRun });

    // No listener for context.injected -- dispatch should be skipped.
    rec.onSubflowEntry(subflowEntry(SUBFLOW_IDS.SYSTEM_PROMPT));
    rec.onWrite(writeEvent(INJECTION_KEYS.SYSTEM_PROMPT, [injection({ contentHash: 'a' })]));
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

describe('ContextRecorder — shape guards (malformed input)', () => {
  it('silently ignores writes where value is not an array', () => {
    const dispatcher = new EventDispatcher();
    const fn = vi.fn();
    dispatcher.on('agentfootprint.context.injected', fn);
    const rec = new ContextRecorder({ dispatcher, getRunContext: makeRun });
    rec.onSubflowEntry(subflowEntry(SUBFLOW_IDS.SYSTEM_PROMPT));
    rec.onWrite(writeEvent(INJECTION_KEYS.SYSTEM_PROMPT, 'not-an-array'));
    expect(fn).not.toHaveBeenCalled();
  });

  it('silently ignores injection records missing required fields', () => {
    const dispatcher = new EventDispatcher();
    const fn = vi.fn();
    dispatcher.on('agentfootprint.context.injected', fn);
    const rec = new ContextRecorder({ dispatcher, getRunContext: makeRun });
    rec.onSubflowEntry(subflowEntry(SUBFLOW_IDS.SYSTEM_PROMPT));
    rec.onWrite(writeEvent(INJECTION_KEYS.SYSTEM_PROMPT, [{ notValid: true }]));
    expect(fn).not.toHaveBeenCalled();
  });
});
