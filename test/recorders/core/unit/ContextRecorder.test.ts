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

// A write inside a slot subflow carries that subflow in its runtimeStageId
// path (`[subflowPath/]stageId#index`) — that path is how ContextRecorder
// attributes the write to a slot (parallel-safe, no stack). Pass the
// enclosing slot subflow id to emulate a write that happened inside it;
// omit it for a write that happened OUTSIDE any slot (should be ignored).
function writeEvent(key: string, value: unknown, enclosingSubflowId?: string): WriteEvent {
  const runtimeStageId = enclosingSubflowId ? `${enclosingSubflowId}/inject#0` : `inject#0`;
  return {
    key,
    value,
    operation: 'set',
    stageName: 'inject',
    stageId: 'inject',
    runtimeStageId,
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
      writeEvent(
        INJECTION_KEYS.SYSTEM_PROMPT,
        [injection({ contentHash: 'a' }), injection({ contentHash: 'b' })],
        SUBFLOW_IDS.SYSTEM_PROMPT,
      ),
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
    rec.onWrite(
      writeEvent(
        INJECTION_KEYS.SYSTEM_PROMPT,
        [injection({ contentHash: 'a' })],
        SUBFLOW_IDS.SYSTEM_PROMPT,
      ),
    );
    rec.onWrite(
      writeEvent(
        INJECTION_KEYS.SYSTEM_PROMPT,
        [
          injection({ contentHash: 'a' }), // duplicate
          injection({ contentHash: 'b' }), // new
        ],
        SUBFLOW_IDS.SYSTEM_PROMPT,
      ),
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

    // Inside messages subflow, a write to the TOOLS injection key is ignored
    // (write's runtimeStageId resolves to 'messages', key is TOOLS → no match).
    rec.onSubflowEntry(subflowEntry(SUBFLOW_IDS.MESSAGES));
    rec.onWrite(
      writeEvent(
        INJECTION_KEYS.TOOLS,
        [injection({ slot: 'tools', contentHash: 'a' })],
        SUBFLOW_IDS.MESSAGES,
      ),
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it('ignores non-subflow subflow entries (e.g. sf-route)', () => {
    const dispatcher = new EventDispatcher();
    const fn = vi.fn();
    dispatcher.on('agentfootprint.context.injected', fn);
    const rec = new ContextRecorder({ dispatcher, getRunContext: makeRun });

    rec.onSubflowEntry(subflowEntry(SUBFLOW_IDS.ROUTE));
    rec.onWrite(
      writeEvent(
        INJECTION_KEYS.SYSTEM_PROMPT,
        [injection({ contentHash: 'a' })],
        SUBFLOW_IDS.ROUTE,
      ),
    );
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('ContextRecorder — parallel slot interleaving (attribution by write, not stack)', () => {
  it('attributes each write to its OWN slot when all 3 slots are open concurrently', () => {
    // This is the regression guard for the slot-fork. Under the selector
    // fan-out, all 3 slot subflows ENTER before any writes, then their
    // writes interleave. A "currently-open slot" stack would resolve every
    // write to the stack top ('tools' here) and silently DROP the messages
    // + system-prompt injections (their key≠'tools' guard fails). Resolving
    // the slot from each write's own runtimeStageId fixes that.
    const dispatcher = new EventDispatcher();
    const fn = vi.fn();
    dispatcher.on('agentfootprint.context.injected', fn);
    const rec = new ContextRecorder({ dispatcher, getRunContext: makeRun });

    rec.onSubflowEntry(subflowEntry(SUBFLOW_IDS.SYSTEM_PROMPT));
    rec.onSubflowEntry(subflowEntry(SUBFLOW_IDS.MESSAGES));
    rec.onSubflowEntry(subflowEntry(SUBFLOW_IDS.TOOLS)); // stack top = 'tools'

    // Interleaved writes, each emitted INSIDE its own slot subflow.
    rec.onWrite(
      writeEvent(
        INJECTION_KEYS.MESSAGES,
        [injection({ slot: 'messages', contentHash: 'm1' })],
        SUBFLOW_IDS.MESSAGES,
      ),
    );
    rec.onWrite(
      writeEvent(
        INJECTION_KEYS.SYSTEM_PROMPT,
        [injection({ slot: 'system-prompt', contentHash: 'sp1' })],
        SUBFLOW_IDS.SYSTEM_PROMPT,
      ),
    );
    rec.onWrite(
      writeEvent(
        INJECTION_KEYS.TOOLS,
        [injection({ slot: 'tools', contentHash: 't1' })],
        SUBFLOW_IDS.TOOLS,
      ),
    );

    rec.onSubflowExit(subflowExit(SUBFLOW_IDS.TOOLS));
    rec.onSubflowExit(subflowExit(SUBFLOW_IDS.MESSAGES));
    rec.onSubflowExit(subflowExit(SUBFLOW_IDS.SYSTEM_PROMPT));

    // All 3 fire (the old stack-top model would emit only the 'tools' one).
    expect(fn).toHaveBeenCalledTimes(3);
    const slots = fn.mock.calls.map((c) => c[0].payload.slot).sort();
    expect(slots).toEqual(['messages', 'system-prompt', 'tools']);
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
    rec.onWrite(writeEvent(COMPOSITION_KEYS.SLOT_COMPOSED, summary, SUBFLOW_IDS.MESSAGES));

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
    rec.onWrite(writeEvent(COMPOSITION_KEYS.EVICTED, evictions, SUBFLOW_IDS.MESSAGES));

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
    rec.onWrite(writeEvent(COMPOSITION_KEYS.BUDGET_PRESSURE, pressure, SUBFLOW_IDS.TOOLS));

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
    rec.onWrite(
      writeEvent(
        INJECTION_KEYS.SYSTEM_PROMPT,
        [injection({ contentHash: 'a' })],
        SUBFLOW_IDS.SYSTEM_PROMPT,
      ),
    );
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
    rec.onWrite(
      writeEvent(INJECTION_KEYS.SYSTEM_PROMPT, 'not-an-array', SUBFLOW_IDS.SYSTEM_PROMPT),
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it('silently ignores injection records missing required fields', () => {
    const dispatcher = new EventDispatcher();
    const fn = vi.fn();
    dispatcher.on('agentfootprint.context.injected', fn);
    const rec = new ContextRecorder({ dispatcher, getRunContext: makeRun });
    rec.onSubflowEntry(subflowEntry(SUBFLOW_IDS.SYSTEM_PROMPT));
    rec.onWrite(
      writeEvent(INJECTION_KEYS.SYSTEM_PROMPT, [{ notValid: true }], SUBFLOW_IDS.SYSTEM_PROMPT),
    );
    expect(fn).not.toHaveBeenCalled();
  });
});
