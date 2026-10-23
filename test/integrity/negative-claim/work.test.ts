/** Work exhaustion is an unread observation, never an absent claim or a partial result. */
import { describe, expect, it } from 'vitest';
import { judgeProseNegatives } from '../../../src/integrity/negative-claim/prose.js';
import {
  createProseWorkBudget,
  ProseWorkLimit,
} from '../../../src/integrity/negative-claim/work.js';
import type { TurnCall, TurnRecord } from '../../../src/integrity/negative-claim/types.js';
import { incidentCall, turnRecord } from './fixtures.js';

const limited = [
  {
    kind: 'negative-claim-note',
    field: '/',
    code: 'input-limit',
    span: expect.any(Object),
    packVersion: expect.any(String),
  },
];

function repeatedRecord(resolved: boolean): TurnRecord {
  const calls: TurnCall[] = Array.from({ length: 100 }, (_, i) => {
    const name = Array.from({ length: 300 }, (_, j) => (i === j ? 'A' : 'a')).join(' ');
    return {
      ...incidentCall({ id: `c${i + 1}` }),
      row: undefined,
      arguments: { lookup: name },
      scope: resolved
        ? [
            {
              from: 'call',
              facet: 'population',
              what: 'lookup',
              argument: 'lookup',
              value: name,
              resolved: { id: `id-${i}`, name },
            },
          ]
        : undefined,
    };
  });
  const record = turnRecord(calls);
  return resolved ? record : { ...record, tools: {} };
}

describe('shared prose work allowance', () => {
  it('does not recover after exhaustion', () => {
    const work = createProseWorkBudget();
    work.charge(8_000_000);
    expect(() => work.charge(1)).toThrow(ProseWorkLimit);
    expect(() => work.charge(0)).toThrow(ProseWorkLimit);
  });

  it('returns a limit note without touching a record after shared work is exhausted', () => {
    const work = createProseWorkBudget();
    expect(() => work.charge(8_000_001)).toThrow(ProseWorkLimit);
    const record = {
      get calls() {
        throw new Error('exhausted observer touched evidence');
      },
    } as unknown as TurnRecord;
    expect(
      judgeProseNegatives({ field: '/', text: 'There are no incidents.', record, work }),
    ).toEqual(limited);
  });

  it.each([false, true])('bounds overlapping exact-name rejections (resolved=%s)', (resolved) => {
    const text = 'There are no ' + 'a '.repeat(1000) + 'incidents.';
    expect(judgeProseNegatives({ field: '/', text, record: repeatedRecord(resolved) })).toEqual(
      limited,
    );
  });

  it('replaces a cheap earlier claim when a later claim exhausts the text allowance', () => {
    const record = repeatedRecord(true);
    const text = 'There are no incidents. There are no ' + 'a '.repeat(1000) + 'incidents.';
    expect(judgeProseNegatives({ field: '/', text, record })).toEqual(limited);
  });

  it('charges pattern preparation before scanning candidate tokens', () => {
    const work = createProseWorkBudget();
    work.charge(7_999_999);
    expect(
      judgeProseNegatives({
        field: '/',
        text: 'There are no incidents.',
        record: turnRecord([incidentCall()]),
        work,
      }),
    ).toEqual(limited);
  });
});
