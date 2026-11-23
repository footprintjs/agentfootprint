import { describe, expect, it } from 'vitest';

import { assessAnswer } from '../../assess.js';
import { assessmentDataOf, standingFactsOf, standingLineOf } from '../../compose.js';

const turnNumber = 7;

const call = (index: number) => ({
  callOccurrenceKey: [12, 34, 56, 78, index],
  execution: 'returned',
  delivery: 'native',
});

const receipt = (index: number, turn = turnNumber) => ({
  turn,
  toolName: 'lookup',
  toolCallId: `call-${index}`,
  callOccurrenceKey: call(index).callOccurrenceKey,
});

const drop = (index: number, strategy = 'sliding-window') => ({
  ...receipt(index),
  kind: 'result-dropped-from-window',
  strategy,
});

const assess = (settledToolCalls: readonly unknown[], libraryResultLimits?: readonly unknown[]) =>
  assessAnswer({
    snapshot: {
      sharedState: {
        turnNumber,
        settledToolCalls,
        settledToolCallsComplete: true,
        libraryResultLimits,
      },
    },
  });

describe('window removals in the current turn', () => {
  it.each([
    [1, '1 result from this turn was dropped from the conversation before the answer'],
    [2, '2 results from this turn were dropped from the conversation before the answer'],
  ] as const)(
    'reports %i recorded removals in standing and names their witness leaves',
    (count, clause) => {
      const removed = [drop(0), drop(1, 'summarize-oldest')].slice(0, count);
      const assessment = assess([call(0), { ...call(1), delivery: 'rewritten' }, call(2)], removed);
      expect(assessment.standing).toBe('not-sure');
      expect(assessment.reasons).toEqual([
        {
          reason: 'result-dropped-from-window',
          layer: 3,
          source: { kind: 'run' },
          witness: removed.map((_, index) => ({
            kind: 'state',
            key: 'libraryResultLimits',
            path: `/${index}/strategy`,
          })),
        },
      ]);
      const line = standingLineOf(
        assessmentDataOf(assessment),
        [],
        false,
        standingFactsOf(assessment, new Map()),
      );
      expect(line).toBe(`Not sure — ${clause}.`);
    },
  );

  it('leaves unserved and ambiguous calls out of the window count', () => {
    const assessment = assess(
      [
        call(0),
        { ...call(1), delivery: 'withheld' },
        call(2),
        call(2),
        { ...call(3), execution: 'returned-unserved', delivery: undefined },
        call(5),
      ],
      [drop(0), drop(1), drop(2), drop(3), drop(4), drop(5), drop(5, 'summarize-oldest')],
    );
    expect(
      assessment.reasons.find(({ reason }) => reason === 'result-dropped-from-window')?.witness,
    ).toEqual([{ kind: 'state', key: 'libraryResultLimits', path: '/0/strategy' }]);
    expect(assess([call(0)]).reasons).toEqual([]);
  });

  it('keeps the current window receipt separate from an older drop and a current cut', () => {
    const assessment = assess(
      [call(0), call(1)],
      [
        { ...drop(0), turn: turnNumber - 1 },
        { ...receipt(0), kind: 'result-cut', keptChars: 2, maxChars: 2, totalChars: 4 },
        drop(1),
      ],
    );
    expect(assessment.reasons.map(({ reason, witness }) => [reason, witness])).toEqual([
      ['result-cut', [{ kind: 'state', key: 'libraryResultLimits', path: '/1/keptChars' }]],
      [
        'result-dropped-from-window',
        [{ kind: 'state', key: 'libraryResultLimits', path: '/2/strategy' }],
      ],
    ]);
  });

  it('reports the same standing after the strategy name is kept out of a saved recording', () => {
    const raw = assess([call(0)], [drop(0, 'private-strategy')]);
    const served = assessAnswer({
      snapshot: {
        recorders: [{ id: 'agentfootprint.redaction' }],
        sharedState: {
          turnNumber,
          settledToolCalls: [call(0)],
          settledToolCallsComplete: true,
          libraryResultLimits: [drop(0, 'REDACTED')],
        },
      },
    });
    expect(served).toEqual(raw);
    expect(JSON.stringify(served)).not.toContain('private-strategy');
  });
});
