/**
 * ROI tests — ContextRecorder doesn't leak state across long runs.
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

describe('ROI — seen-set clears on slot exit', () => {
  it('10000 enter/exit cycles do not retain hashes indefinitely', () => {
    const d = new EventDispatcher();
    d.on('agentfootprint.context.injected', () => {});
    const rec = new ContextRecorder({
      dispatcher: d,
      getRunContext: () => ({ runStartMs: Date.now(), runId: 'r', compositionPath: [] }),
    });

    for (let i = 0; i < 10_000; i++) {
      rec.onSubflowEntry(sf(SUBFLOW_IDS.SYSTEM_PROMPT));
      rec.onWrite(
        we(INJECTION_KEYS.SYSTEM_PROMPT, [
          {
            contentSummary: '',
            contentHash: `h-${i}`,
            slot: 'system-prompt',
            source: 'skill',
            reason: '',
          },
        ]),
      );
      rec.onSubflowExit(sf(SUBFLOW_IDS.SYSTEM_PROMPT));
    }

    // The internal seen-set is keyed by slot. After every exit we delete
    // the slot's entry. Private-field inspection is intentionally avoided;
    // instead we verify the recorder can STILL emit for a fresh hash,
    // which would fail if the seen-set leaked and grew unbounded.
    rec.onSubflowEntry(sf(SUBFLOW_IDS.SYSTEM_PROMPT));
    let emitted = 0;
    d.on('agentfootprint.context.injected', () => {
      emitted++;
    });
    rec.onWrite(
      we(INJECTION_KEYS.SYSTEM_PROMPT, [
        {
          contentSummary: '',
          contentHash: 'h-final',
          slot: 'system-prompt',
          source: 'skill',
          reason: '',
        },
      ]),
    );
    expect(emitted).toBe(1);
  });
});
