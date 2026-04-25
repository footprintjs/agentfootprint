/**
 * Security tests — ContextRecorder tolerates malicious/malformed input
 * without crashing or leaking internal state.
 */

import { describe, it, expect, vi } from 'vitest';
import type { FlowSubflowEvent, WriteEvent } from 'footprintjs';
import { EventDispatcher } from '../../../../src/events/dispatcher.js';
import { ContextRecorder } from '../../../../src/recorders/core/ContextRecorder.js';
import {
  INJECTION_KEYS,
  SUBFLOW_IDS,
} from '../../../../src/conventions.js';

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

describe('security — malformed input handling', () => {
  it('survives null/undefined values in writes', () => {
    const d = new EventDispatcher();
    const rec = new ContextRecorder({
      dispatcher: d,
      getRunContext: () => ({ runStartMs: Date.now(), runId: 'r', compositionPath: [] }),
    });
    rec.onSubflowEntry(sf(SUBFLOW_IDS.SYSTEM_PROMPT));
    expect(() => rec.onWrite(we(INJECTION_KEYS.SYSTEM_PROMPT, null))).not.toThrow();
    expect(() => rec.onWrite(we(INJECTION_KEYS.SYSTEM_PROMPT, undefined))).not.toThrow();
  });

  it('survives value with prototype-pollution payload', () => {
    const d = new EventDispatcher();
    const fn = vi.fn();
    d.on('agentfootprint.context.injected', fn);
    const rec = new ContextRecorder({
      dispatcher: d,
      getRunContext: () => ({ runStartMs: Date.now(), runId: 'r', compositionPath: [] }),
    });
    rec.onSubflowEntry(sf(SUBFLOW_IDS.SYSTEM_PROMPT));
    // Malicious array containing a __proto__-keyed entry
    const hostile = JSON.parse('[{"__proto__":{"polluted":true}}]');
    rec.onWrite(we(INJECTION_KEYS.SYSTEM_PROMPT, hostile));
    // Records missing required fields → ignored (no event emission)
    expect(fn).not.toHaveBeenCalled();
    // Verify prototype was not polluted
    expect((Object.prototype as unknown as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('mismatched slot subflow ID does not confuse the recorder', () => {
    const d = new EventDispatcher();
    const fn = vi.fn();
    d.on('agentfootprint.context.injected', fn);
    const rec = new ContextRecorder({
      dispatcher: d,
      getRunContext: () => ({ runStartMs: Date.now(), runId: 'r', compositionPath: [] }),
    });
    // Attempt to emit when active slot is SYSTEM_PROMPT but write targets MESSAGES key
    rec.onSubflowEntry(sf(SUBFLOW_IDS.SYSTEM_PROMPT));
    rec.onWrite(
      we(INJECTION_KEYS.MESSAGES, [
        { contentSummary: '', contentHash: 'h', slot: 'messages', source: 'user', reason: '' },
      ]),
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it('subflow exit without matching entry does not crash', () => {
    const d = new EventDispatcher();
    const rec = new ContextRecorder({
      dispatcher: d,
      getRunContext: () => ({ runStartMs: Date.now(), runId: 'r', compositionPath: [] }),
    });
    expect(() => rec.onSubflowExit(sf(SUBFLOW_IDS.SYSTEM_PROMPT))).not.toThrow();
  });
});
