/**
 * Scenario tests — realistic slot lifecycle flows through ContextRecorder.
 */

import { describe, it, expect, vi } from 'vitest';
import type { FlowSubflowEvent, WriteEvent } from 'footprintjs';
import { EventDispatcher } from '../../../../src/events/dispatcher.js';
import { ContextRecorder } from '../../../../src/recorders/core/ContextRecorder.js';
import { COMPOSITION_KEYS, type InjectionRecord } from '../../../../src/recorders/core/types.js';
import { INJECTION_KEYS, SUBFLOW_IDS } from '../../../../src/conventions.js';

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

function inj(overrides: Partial<InjectionRecord>): InjectionRecord {
  return {
    contentSummary: '',
    contentHash: '',
    slot: 'messages',
    source: 'user',
    reason: '',
    ...overrides,
  };
}

describe('scenario — ReAct iteration with RAG + skill', () => {
  it('emits every context event a consumer expects for a full iteration', () => {
    const dispatcher = new EventDispatcher();
    const events: string[] = [];
    dispatcher.on('agentfootprint.context.*', (e) => events.push(e.type));
    const rec = new ContextRecorder({
      dispatcher,
      getRunContext: () => ({
        runStartMs: Date.now(),
        runId: 'r',
        compositionPath: ['Agent:bot'],
        turnIndex: 0,
        iterIndex: 1,
      }),
    });

    // Iteration 1: system-prompt slot composes from instructions + skill.
    rec.onSubflowEntry(sf(SUBFLOW_IDS.SYSTEM_PROMPT));
    rec.onWrite(
      we(INJECTION_KEYS.SYSTEM_PROMPT, [
        inj({
          slot: 'system-prompt',
          source: 'instructions',
          contentHash: 'i1',
          reason: 'base rules',
        }),
        inj({
          slot: 'system-prompt',
          source: 'skill',
          contentHash: 's1',
          reason: 'skill activated',
        }),
      ]),
    );
    rec.onWrite(
      we(COMPOSITION_KEYS.SLOT_COMPOSED, {
        slot: 'system-prompt',
        iteration: 1,
        budget: { cap: 4000, used: 800, headroomChars: 3200 },
        sourceBreakdown: {
          instructions: { chars: 400, count: 1 },
          skill: { chars: 400, count: 1 },
        },
        droppedCount: 0,
        droppedSummaries: [],
      }),
    );
    rec.onSubflowExit(sf(SUBFLOW_IDS.SYSTEM_PROMPT));

    // Messages slot composes from user + RAG retrievals.
    rec.onSubflowEntry(sf(SUBFLOW_IDS.MESSAGES));
    rec.onWrite(
      we(INJECTION_KEYS.MESSAGES, [
        inj({ slot: 'messages', source: 'user', contentHash: 'u1', asRole: 'user' }),
        inj({
          slot: 'messages',
          source: 'rag',
          contentHash: 'r1',
          asRole: 'tool',
          retrievalScore: 0.92,
        }),
        inj({
          slot: 'messages',
          source: 'rag',
          contentHash: 'r2',
          asRole: 'tool',
          retrievalScore: 0.85,
        }),
      ]),
    );
    rec.onWrite(
      we(COMPOSITION_KEYS.SLOT_COMPOSED, {
        slot: 'messages',
        iteration: 1,
        budget: { cap: 10000, used: 3200, headroomChars: 6800 },
        sourceBreakdown: { user: { chars: 100, count: 1 }, rag: { chars: 3100, count: 2 } },
        droppedCount: 1,
        droppedSummaries: ['low-score-chunk'],
      }),
    );
    rec.onSubflowExit(sf(SUBFLOW_IDS.MESSAGES));

    // Tools slot — no injections.
    rec.onSubflowEntry(sf(SUBFLOW_IDS.TOOLS));
    rec.onWrite(
      we(COMPOSITION_KEYS.SLOT_COMPOSED, {
        slot: 'tools',
        iteration: 1,
        budget: { cap: 2000, used: 500, headroomChars: 1500 },
        sourceBreakdown: { instructions: { chars: 500, count: 3 } },
        droppedCount: 0,
        droppedSummaries: [],
      }),
    );
    rec.onSubflowExit(sf(SUBFLOW_IDS.TOOLS));

    // Expected: 5 injections + 3 slot_composed = 8 events
    expect(events.filter((t) => t === 'agentfootprint.context.injected').length).toBe(5);
    expect(events.filter((t) => t === 'agentfootprint.context.slot_composed').length).toBe(3);
  });
});

describe('scenario — budget pressure + evictions', () => {
  it('emits pressure warning then eviction events', () => {
    const dispatcher = new EventDispatcher();
    const pressure = vi.fn();
    const evicted = vi.fn();
    dispatcher.on('agentfootprint.context.budget_pressure', pressure);
    dispatcher.on('agentfootprint.context.evicted', evicted);

    const rec = new ContextRecorder({
      dispatcher,
      getRunContext: () => ({
        runStartMs: Date.now(),
        runId: 'r',
        compositionPath: [],
      }),
    });

    rec.onSubflowEntry(sf(SUBFLOW_IDS.MESSAGES));
    rec.onWrite(
      we(COMPOSITION_KEYS.BUDGET_PRESSURE, [
        {
          slot: 'messages',
          capTokens: 10000,
          projectedTokens: 12000,
          overflowBy: 2000,
          planAction: 'evict',
        },
      ]),
    );
    rec.onWrite(
      we(COMPOSITION_KEYS.EVICTED, [
        { slot: 'messages', contentHash: 'old1', reason: 'budget', survivalMs: 45000 },
        { slot: 'messages', contentHash: 'old2', reason: 'budget', survivalMs: 60000 },
      ]),
    );

    expect(pressure).toHaveBeenCalledTimes(1);
    expect(evicted).toHaveBeenCalledTimes(2);
  });
});
