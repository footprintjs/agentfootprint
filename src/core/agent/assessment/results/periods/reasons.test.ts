import { expect, it } from 'vitest';
import { REASONS } from '../../reasons.js';
import { isDeclarationWitness, isPeriodDeclarationReason } from '../../reasonClasses.js';
import { assessAnswer } from '../../assess.js';

it('admits the argument join only for the closed period declaration family', () => {
  const expected = [
    'period-not-held',
    'period-partly-held',
    'period-unknown',
    'period-undeclared',
    'period-differs-from-asked',
    'period-beyond-retention',
  ];
  for (const { reason } of REASONS) {
    expect(isPeriodDeclarationReason(reason)).toBe(expected.includes(reason));
    expect(isDeclarationWitness('findingsLedger', 'argument', reason)).toBe(
      expected.includes(reason),
    );
  }
});

it.each([
  { keyed: false, argumentKey: false },
  { keyed: true, argumentKey: true },
  { keyed: true, argumentKey: false },
])(
  'a rewritten period joins only its proven argument (keyed=$keyed, argumentKey=$argumentKey)',
  ({ keyed, argumentKey }) => {
    const call = { toolCallId: 'one', toolName: 'lookup', iteration: 1, turn: 1 };
    const key = [1, 2, 3, 4, 0];
    const keyField = keyed ? { callOccurrenceKey: key } : {};
    const a = assessAnswer({
      snapshot: {
        sharedState: {
          turnNumber: 1,
          history: [
            { role: 'user', content: 'Read the last hour.' },
            {
              role: 'assistant',
              content: '',
              toolCalls: [{ id: 'one', name: 'lookup', args: { window: '1h' }, ...keyField }],
            },
            {
              role: 'tool',
              ...call,
              ...keyField,
              content: 'Public summary.',
              toolResultExecution: 'returned',
              toolResultDisposition: 'rewritten',
            },
          ],
          findingsLedger: [
            {
              ...call,
              ...(argumentKey && keyField),
              kind: 'argument',
              argument: 'window',
              rule: 'assume',
              period: true,
              source: 'said',
              value: '1h',
            },
            { ...call, ...keyField, kind: 'period', argument: 'window', verdict: 'not-held' },
          ],
          ...(keyed && {
            enteredToolCalls: [{ callOccurrenceKey: key, entered: true }],
            enteredToolCallsComplete: true,
            settledToolCalls: [
              { callOccurrenceKey: key, execution: 'returned', delivery: 'rewritten' },
            ],
            settledToolCallsComplete: true,
          }),
        },
      },
    });
    expect(a.reasons.find(({ reason }) => reason === 'period-not-held')?.witness).toEqual([
      { kind: 'state', key: 'findingsLedger', path: '/1/verdict' },
      ...(!keyed || argumentKey
        ? [{ kind: 'state', key: 'findingsLedger', path: '/0/argument' }]
        : []),
    ]);
  },
);
