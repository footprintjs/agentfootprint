import { describe, expect, it } from 'vitest';

import type { AgentfootprintEvent, AgentfootprintEventMap } from '../../../events/registry.js';
import { admitCompletedTurn } from './admitCompletedTurn.js';
import { coverageOfRecordedTurn } from './coverage.js';
import { verdictOfRecordedTurn } from './verdict.js';

const RUN = 'answering-leg';

function terminal(runId: string): AgentfootprintEventMap['agentfootprint.agent.turn_end'] {
  return {
    type: 'agentfootprint.agent.turn_end',
    payload: {
      turnIndex: 0,
      finalContent: 'Fixture answer',
      totalInputTokens: 0,
      totalOutputTokens: 0,
      iterationCount: 1,
      durationMs: 0,
    },
    meta: {
      runId,
      runtimeStageId: 'final',
      subflowPath: [],
      compositionPath: [],
      wallClockMs: 0,
      runOffsetMs: 0,
    },
  };
}

const snapshot = { runId: RUN, initialState: {}, sharedState: {} };

describe('bounded completed-turn admission', () => {
  it('admits 8,192 slots with a genuine terminal and empty declarations', () => {
    const events = new Array<AgentfootprintEvent>(8_191).fill(terminal('different-leg'));
    const answer = terminal(RUN);
    events.push(answer);
    const result = admitCompletedTurn({ events, snapshot }, RUN);
    if (result.status !== 'ready') throw new Error(result.status);
    expect(result.turn.terminal).toBe(answer);
    expect(result.turn.events).toEqual([answer]);
    expect(coverageOfRecordedTurn(result.turn)).toEqual([]);
    expect(verdictOfRecordedTurn(result.turn)).toEqual({ status: 'not-checked' });
  });

  it('refuses 8,193 slots before inspecting even the unrelated prefix', () => {
    const events = new Array<AgentfootprintEvent>(8_193);
    events[8_192] = terminal(RUN);
    let visits = 0;
    Object.defineProperty(events, '0', {
      get() {
        visits++;
        return terminal('different-leg');
      },
    });
    expect(admitCompletedTurn({ events, snapshot }, RUN)).toEqual({
      status: 'coverage-work-limit',
    });
    expect(visits).toBe(0);
  });

  it('refuses an otherwise valid turn when its snapshot came from another leg', () => {
    const events = [terminal(RUN)];
    const otherSnapshot = { ...snapshot, runId: 'different-leg' };
    expect(admitCompletedTurn({ events, snapshot: otherSnapshot }, RUN)).toEqual({
      status: 'turn-unavailable',
    });
  });
});
