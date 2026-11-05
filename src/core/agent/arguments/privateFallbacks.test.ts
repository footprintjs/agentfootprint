import { expect, it } from 'vitest';
import { privateKeptSelections, privateResolutionSelections } from './privateAnswers.js';

it('withholds the whole kept-answer carrier when a later row loses its identity', () => {
  const after = [
    { turn: 1, toolName: 'lookup', argument: 'account', value: 'first' },
    { value: 'PRIVATE-unclassified-fixture' },
  ];
  expect(privateKeptSelections(undefined, undefined, after, 1)).toEqual([
    { root: 'argumentAnswersKept', path: '' },
  ]);
});

it('withholds resolved fills when no admitted batch call owns their call id', () => {
  const rows = [
    {
      toolCallId: 'foreign',
      iteration: 1,
      fills: [
        { argument: 'account', source: 'answered' as const, value: 'PRIVATE-unclassified-fixture' },
      ],
    },
  ];
  const calls = [{ id: 'admitted', name: 'lookup', args: {} }];
  expect(privateResolutionSelections(undefined, rows, calls, () => undefined, 1)).toEqual([
    { root: 'argumentResolutions', path: '' },
  ]);
});
