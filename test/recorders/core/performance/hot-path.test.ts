/**
 * Performance tests — ContextRecorder hot path.
 *
 * Enforces that recorder overhead stays well within hot-path budgets
 * when no listener is attached (the common case in production without
 * observability subscribers).
 *
 * Budgets are REFERENCE UNITS of CPU (test/helpers/perf.ts), not
 * nanoseconds-per-op: a hard ns target on a shared runner measures the
 * runner's spare capacity, and fails exactly when CI is busy. A unit is
 * timed in this same process, moments before the assertion, so load cancels.
 */

import { describe, it } from 'vitest';
import type { FlowSubflowEvent, WriteEvent } from 'footprintjs';
import { EventDispatcher } from '../../../../src/events/dispatcher.js';
import { ContextRecorder } from '../../../../src/recorders/core/ContextRecorder.js';
import { INJECTION_KEYS, SUBFLOW_IDS } from '../../../../src/conventions.js';
import { expectWithinReferenceUnits, measure } from '../../../helpers/perf.js';

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

/** Run `fn` `iters` times (after a warmup) and return the total milliseconds. */
function msFor(iters: number, fn: () => void): number {
  for (let i = 0; i < Math.min(iters, 1000); i++) fn();
  return measure(() => {
    for (let i = 0; i < iters; i++) fn();
  });
}

describe('perf — ContextRecorder hot path', () => {
  it(
    'onWrite injection with NO listener takes the fast-path skip',
    { timeout: 30_000, retry: 2 },
    async () => {
      const d = new EventDispatcher();
      const rec = new ContextRecorder({
        dispatcher: d,
        getRunContext: () => ({ runStartMs: Date.now(), runId: 'r', compositionPath: [] }),
      });
      rec.onSubflowEntry(sf(SUBFLOW_IDS.SYSTEM_PROMPT));
      const event = we(INJECTION_KEYS.SYSTEM_PROMPT, [
        {
          contentSummary: '',
          contentHash: 'h',
          slot: 'system-prompt',
          source: 'skill',
          reason: '',
        },
      ]);
      // 100 reference units for 20k writes — about 5µs each on a quiet
      // machine, and proportionally more room on a loaded one.
      await expectWithinReferenceUnits(
        () => msFor(20_000, () => rec.onWrite(event)),
        100,
        'the no-listener write path must skip early',
      );
    },
  );

  it(
    'onWrite with a listener (1 new injection) stays inside its budget',
    { timeout: 30_000, retry: 2 },
    async () => {
      const d = new EventDispatcher();
      d.on('agentfootprint.context.injected', () => {});
      const rec = new ContextRecorder({
        dispatcher: d,
        getRunContext: () => ({ runStartMs: Date.now(), runId: 'r', compositionPath: [] }),
      });
      rec.onSubflowEntry(sf(SUBFLOW_IDS.SYSTEM_PROMPT));
      // Fresh hash each call to defeat dedup
      let counter = 0;
      // 250 reference units for 5k writes — about 50µs each on a quiet
      // machine. Building and dispatching the event is the cost being bounded.
      await expectWithinReferenceUnits(
        () =>
          msFor(5_000, () => {
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
          }),
        250,
        'building + dispatching an injection event must stay bounded',
      );
    },
  );
});
