import { describe, expect, it } from 'vitest';
import { judgeTypedNegatives } from '../../../src/integrity/negative-claim/judge.js';
import type { TurnCall } from '../../../src/integrity/negative-claim/types.js';
import { incidentCall, rid, turnRecord } from './fixtures.js';

const judge = (calls: readonly TurnCall[]) =>
  judgeTypedNegatives({
    field: 'negatives',
    negatives: [{ kind: 'none', about: 'payments', restsOn: [rid('c1')] }],
    record: turnRecord(calls),
  })[0]?.row.code;

describe('negative citations use the executed period, not relative spelling', () => {
  it('a later failure for another two-hour window does not erase an earlier empty read', () => {
    expect(
      judge([
        incidentCall({ id: 'c1', window: '2h' }),
        incidentCall({
          id: 'c2',
          window: '2h',
          dispatchedAt: '2026-10-22T14:00:00Z',
          outcome: 'error',
        }),
      ]),
    ).toBe('established');
  });

  it('rows from a disjoint window do not contradict the empty cited window', () => {
    expect(
      judge([
        incidentCall({ id: 'c1', window: '2h' }),
        incidentCall({
          id: 'c2',
          window: '2h',
          dispatchedAt: '2026-10-22T14:00:00Z',
          emptiness: 'non-empty',
          rows: 1,
        }),
      ]),
    ).toBe('established');
  });

  it('a later failure for the same executed span invalidates despite another spelling', () => {
    expect(
      judge([
        incidentCall({ id: 'c1', window: '2h' }),
        incidentCall({ id: 'c2', window: '120m', outcome: 'error' }),
      ]),
    ).toBe('later-read-failed');
  });

  it('the result cannot re-key a search by claiming another queried window', () => {
    const early = incidentCall({ id: 'c1', window: '2h' });
    const late = incidentCall({
      id: 'c2',
      window: '2h',
      dispatchedAt: '2026-10-22T14:00:00Z',
      emptiness: 'non-empty',
      rows: 1,
      queried: { from: '2026-10-22T08:00:00Z', to: '2026-10-22T10:00:00Z' },
    });
    expect(judge([early, late])).toBe('established');
  });
});
