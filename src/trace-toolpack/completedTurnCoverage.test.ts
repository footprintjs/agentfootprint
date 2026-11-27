import { expect, it } from 'vitest';

import { issueCompletedTurn } from '../core/agent/turnEvidence/completedTurnHandle.js';
import type { AgentfootprintEventMap } from '../events/registry.js';
import { readCompletedTurnCoverage } from './completedTurnCoverage.js';

const runId = 'run-a';
const logAddress = { logRunId: runId, drillPath: [] };
const owner = {};
const ref = 'art_abcdefghijklmnopqrstuv';
const terminal: AgentfootprintEventMap['agentfootprint.agent.turn_end'] = {
  type: 'agentfootprint.agent.turn_end',
  payload: {
    turnIndex: 7,
    finalContent: 'fixture reply',
    totalInputTokens: 0,
    totalOutputTokens: 0,
    iterationCount: 1,
    durationMs: 0,
    answerAssessment: {
      assessment: 'unknown',
      standing: 'not-sure',
      reasons: ['result-cut', 'placed-unread'],
      checked: [],
    },
  },
  meta: {
    runId,
    runtimeStageId: 'terminal',
    subflowPath: [],
    compositionPath: [],
    wallClockMs: 0,
    runOffsetMs: 0,
  },
};

function readWithLimits(placedUnread: boolean) {
  const call = {
    turn: 7,
    toolName: 'lookup',
    toolCallId: 'call-a',
    callOccurrenceKey: [12, 34, 56, 78, 0],
  };
  const libraryResultLimits = [
    { ...call, kind: 'result-cut', totalChars: 3000, keptChars: 1000, maxChars: 2000 },
    ...(placedUnread ? [{ ...call, kind: 'placed-unread', ref }] : []),
  ];
  const handle = issueCompletedTurn({
    owner,
    scope: { tenant: 'tenant', principal: 'operator', conversation: 'session' },
    origin: { runId, engineRunId: runId, logAddress },
    allowed: () => true,
    source: {
      kind: 'live',
      recording: {
        events: [terminal],
        snapshot: {
          runId,
          logAddress,
          initialState: {},
          sharedState: {
            turnNumber: 7,
            libraryResultLimits,
            settledToolCallsComplete: true,
            settledToolCalls: [
              {
                callOccurrenceKey: call.callOccurrenceKey,
                execution: 'returned',
                delivery: 'native',
              },
            ],
          },
        },
      },
    },
  });
  return readCompletedTurnCoverage(owner, handle);
}

it('retains positive result limits and explicitly leaves overall omission coverage open', async () => {
  const result = await readWithLimits(true);
  expect(result).toMatchObject({
    runId,
    facts: [
      { kind: 'declared-coverage', calls: [] },
      {
        kind: 'result-cut',
        pointers: [{ kind: 'state', key: 'libraryResultLimits', path: '/0/keptChars' }],
      },
      {
        kind: 'placed-unread',
        pointers: [{ kind: 'state', key: 'libraryResultLimits', path: '/1/kind' }],
      },
    ],
    gaps: ['evidence-verdict-not-collected', 'omission-coverage-incomplete'],
  });
  expect(JSON.stringify(result)).not.toContain(ref);
});

it('turns a compact reason without a committed witness into a gap and keeps an independent cut', async () => {
  expect(await readWithLimits(false)).toMatchObject({
    runId,
    facts: [{ kind: 'declared-coverage', calls: [] }, { kind: 'result-cut' }],
    gaps: ['evidence-verdict-not-collected', 'placed-unread', 'omission-coverage-incomplete'],
  });
});

it('reports a resumed turn with unreadable coverage as gaps without a coverage fact', async () => {
  const handle = issueCompletedTurn({
    owner,
    scope: { tenant: 'tenant', principal: 'operator', conversation: 'session' },
    origin: { runId, engineRunId: runId, logAddress, resumed: true },
    allowed: () => true,
    source: {
      kind: 'live',
      recording: {
        events: [
          {
            ...terminal,
            payload: {
              ...terminal.payload,
              answerAssessment: {
                assessment: 'unknown',
                standing: 'not-sure',
                reasons: ['coverage-gap', 'declared-absent'],
                checked: [],
              },
            },
          },
        ],
        snapshot: {
          runId,
          logAddress,
          initialState: { turnNumber: 7, coverageDeclared: [{ checked: ['source'] }] },
          sharedState: { turnNumber: 7, coverageDeclared: [] },
        },
      },
    },
  });
  const result = await readCompletedTurnCoverage(owner, handle);
  expect(result).toMatchObject({
    facts: [],
    gaps: expect.arrayContaining([
      'coverage-not-collected',
      'resumed-turn-coverage-incomplete',
      'coverage-gap',
      'declared-absent',
    ]),
  });
});
