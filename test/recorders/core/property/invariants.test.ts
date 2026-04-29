/**
 * Property tests — invariants that must hold across random slot lifecycles.
 */

import { describe, it, expect, vi } from 'vitest';
import type { FlowSubflowEvent, WriteEvent } from 'footprintjs';
import { EventDispatcher } from '../../../../src/events/dispatcher.js';
import { ContextRecorder } from '../../../../src/recorders/core/ContextRecorder.js';
import { INJECTION_KEYS, SUBFLOW_IDS } from '../../../../src/conventions.js';
import type { InjectionRecord } from '../../../../src/recorders/core/types.js';

function sf(subflowId: string): FlowSubflowEvent {
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
function we(key: string, value: unknown): WriteEvent {
  return {
    key,
    value,
    operation: 'set',
    stageName: key,
    stageId: key,
    runtimeStageId: `${key}#0`,
    pipelineId: 'p',
    timestamp: Date.now(),
  } as WriteEvent;
}
function inj(hash: string): InjectionRecord {
  return {
    contentSummary: '',
    contentHash: hash,
    slot: 'system-prompt',
    source: 'skill',
    reason: '',
  };
}

describe('property — N unique injections → N injected events', () => {
  it.each([1, 5, 25, 100])('emits exactly N events for N unique hashes (%d)', (n) => {
    const d = new EventDispatcher();
    const fn = vi.fn();
    d.on('agentfootprint.context.injected', fn);
    const rec = new ContextRecorder({
      dispatcher: d,
      getRunContext: () => ({ runStartMs: Date.now(), runId: 'r', compositionPath: [] }),
    });
    rec.onSubflowEntry(sf(SUBFLOW_IDS.SYSTEM_PROMPT));
    const records = Array.from({ length: n }, (_, i) => inj(`h${i}`));
    rec.onWrite(we(INJECTION_KEYS.SYSTEM_PROMPT, records));
    expect(fn).toHaveBeenCalledTimes(n);
  });
});

describe('property — dedup holds across repeated writes', () => {
  it('N writes of the SAME hash produce exactly 1 event', () => {
    const d = new EventDispatcher();
    const fn = vi.fn();
    d.on('agentfootprint.context.injected', fn);
    const rec = new ContextRecorder({
      dispatcher: d,
      getRunContext: () => ({ runStartMs: Date.now(), runId: 'r', compositionPath: [] }),
    });
    rec.onSubflowEntry(sf(SUBFLOW_IDS.SYSTEM_PROMPT));
    for (let i = 0; i < 50; i++) {
      rec.onWrite(we(INJECTION_KEYS.SYSTEM_PROMPT, [inj('h-same')]));
    }
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('property — seen-set resets across slot re-entries', () => {
  it('same hash in a NEW slot entry emits a NEW event', () => {
    const d = new EventDispatcher();
    const fn = vi.fn();
    d.on('agentfootprint.context.injected', fn);
    const rec = new ContextRecorder({
      dispatcher: d,
      getRunContext: () => ({ runStartMs: Date.now(), runId: 'r', compositionPath: [] }),
    });
    rec.onSubflowEntry(sf(SUBFLOW_IDS.SYSTEM_PROMPT));
    rec.onWrite(we(INJECTION_KEYS.SYSTEM_PROMPT, [inj('h-x')]));
    rec.onSubflowExit(sf(SUBFLOW_IDS.SYSTEM_PROMPT));
    // New iteration — re-enter and write the same hash
    rec.onSubflowEntry(sf(SUBFLOW_IDS.SYSTEM_PROMPT));
    rec.onWrite(we(INJECTION_KEYS.SYSTEM_PROMPT, [inj('h-x')]));
    // Two events — each iteration is its own window
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
