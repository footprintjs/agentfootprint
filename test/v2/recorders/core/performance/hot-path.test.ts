/**
 * Performance tests — ContextRecorder hot path.
 *
 * Enforces that recorder overhead stays well within hot-path budgets
 * when no listener is attached (the common case in production without
 * observability subscribers).
 */

import { describe, it, expect } from 'vitest';
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

function nsPerOp(iters: number, fn: () => void): number {
  for (let i = 0; i < Math.min(iters, 1000); i++) fn();
  const start = performance.now();
  for (let i = 0; i < iters; i++) fn();
  return ((performance.now() - start) * 1e6) / iters;
}

describe('perf — ContextRecorder hot path', () => {
  it('onWrite injection with NO listener is <5μs/op (fast-path skip)', () => {
    const d = new EventDispatcher();
    const rec = new ContextRecorder({
      dispatcher: d,
      getRunContext: () => ({ runStartMs: Date.now(), runId: 'r', compositionPath: [] }),
    });
    rec.onSubflowEntry(sf(SUBFLOW_IDS.SYSTEM_PROMPT));
    const event = we(INJECTION_KEYS.SYSTEM_PROMPT, [
      { contentSummary: '', contentHash: 'h', slot: 'system-prompt', source: 'skill', reason: '' },
    ]);
    const ns = nsPerOp(20_000, () => rec.onWrite(event));
    expect(ns).toBeLessThan(5_000);
  });

  it('onWrite with a listener (1 new injection) is <50μs/op', () => {
    const d = new EventDispatcher();
    d.on('agentfootprint.context.injected', () => {});
    const rec = new ContextRecorder({
      dispatcher: d,
      getRunContext: () => ({ runStartMs: Date.now(), runId: 'r', compositionPath: [] }),
    });
    rec.onSubflowEntry(sf(SUBFLOW_IDS.SYSTEM_PROMPT));
    // Fresh hash each call to defeat dedup
    let counter = 0;
    const ns = nsPerOp(5_000, () => {
      rec.onWrite(
        we(INJECTION_KEYS.SYSTEM_PROMPT, [
          {
            contentSummary: '',
            contentHash: `h-${counter++}`,
            slot: 'system-prompt',
            source: 'skill',
            reason: '',
          },
        ]),
      );
    });
    expect(ns).toBeLessThan(50_000);
  });
});
