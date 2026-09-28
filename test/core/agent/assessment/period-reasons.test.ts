/**
 * The standing fold reads the results layer's period rows (honesty layer 3,
 * step 7b) — over hand-built committed records.
 *
 * Test types:
 *   - UNIT      — each verdict's reason (`covered` fires none); the
 *                 `result-period` check; THIS turn's rows only (the turn
 *                 stamp); the last row per call wins; the join — a period
 *                 reason's witnesses are its row and the inputs layer's row
 *                 for the same call's period argument; an unknown verdict
 *                 word is skipped, never guessed;
 *   - PROPERTY  — over 1,000 generated ledgers: a period reason fires iff a
 *                 current row of this turn carries its verdict; no period row
 *                 ever supports "known"; the fold never reads an instant.
 */

import { describe, expect, it } from 'vitest';

import { assessAnswer } from '../../../../src/core/agent/assessment/assess.js';

type State = Record<string, unknown>;
const run = (state: State) => assessAnswer({ snapshot: { sharedState: state } });

const periodRow = (
  toolCallId: string,
  verdict: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  kind: 'period',
  turn: 1,
  toolCallId,
  toolName: 'backup_runs',
  iteration: 1,
  verdict,
  ...extra,
});
const argumentRow = (toolCallId: string, argument = 'window'): Record<string, unknown> => ({
  kind: 'argument',
  turn: 1,
  toolCallId,
  toolName: 'search_logs',
  iteration: 1,
  argument,
  rule: 'assume',
  period: true,
  source: 'default',
  value: '2h',
});

describe('UNIT — one reason per verdict', () => {
  const cases: ReadonlyArray<readonly [string, string | undefined]> = [
    ['not-held', 'period-not-held'],
    ['partly-held', 'period-partly-held'],
    ['unknown', 'period-unknown'],
    ['undeclared', 'period-undeclared'],
    ['covered', undefined],
  ];
  for (const [verdict, reason] of cases) {
    it(`${verdict} → ${reason ?? 'nothing fires'}`, () => {
      const a = run({ turnNumber: 1, findingsLedger: [periodRow('c1', verdict)] });
      expect(a.reasons.map((r) => r.reason)).toEqual(reason === undefined ? [] : [reason]);
      if (reason !== undefined) {
        expect(a.reasons[0]).toEqual({
          reason,
          layer: 3,
          witness: [{ kind: 'state', key: 'findingsLedger', path: '/0/verdict' }],
        });
        expect(a.standing).toBe('not-sure');
      } else {
        expect(a.standing).toBe('consistent'); // a check ran, none fired — never "known"
      }
      expect(a.checked).toEqual([
        {
          layer: 3,
          check: 'result-period',
          ran: 1,
          of: 1,
          witness: [{ kind: 'state', key: 'findingsLedger', path: '/0/verdict' }],
        },
      ]);
    });
  }
});

describe('UNIT — which rows the fold reads', () => {
  it('this turn only: a turn-1 verdict does not make a turn-2 answer not sure', () => {
    const a = run({ turnNumber: 2, findingsLedger: [periodRow('c1', 'not-held')] });
    expect(a.reasons).toEqual([]);
    expect(a.checked).toEqual([]);
  });

  it('a record with no turnNumber reads every period row — it may over-report, never hide', () => {
    expect(
      run({ findingsLedger: [periodRow('c1', 'not-held')] }).reasons.map((r) => r.reason),
    ).toEqual(['period-not-held']);
  });

  it('the last row per call wins', () => {
    const a = run({
      turnNumber: 1,
      findingsLedger: [periodRow('c1', 'not-held'), periodRow('c1', 'covered')],
    });
    expect(a.reasons).toEqual([]);
  });

  it('a verdict word the fold does not know is skipped, never guessed — and still counted as filed', () => {
    const a = run({ turnNumber: 1, findingsLedger: [periodRow('c1', 'held-ish')] });
    expect(a.reasons).toEqual([]);
    expect(a.checked.map((c) => c.check)).toEqual(['result-period']);
  });

  it('two calls, two reasons, each witnessed by its own row', () => {
    const a = run({
      turnNumber: 1,
      findingsLedger: [periodRow('c1', 'not-held'), periodRow('c2', 'unknown')],
    });
    expect(
      a.reasons.map((r) => [r.reason, r.witness.map((w) => (w as { path: string }).path)]),
    ).toEqual([
      ['period-not-held', ['/0/verdict']],
      ['period-unknown', ['/1/verdict']],
    ]);
  });
});

describe('UNIT — the join with the inputs layer (results.md § 3.7)', () => {
  it('a period reason names the argument row that says who chose the period', () => {
    const a = run({
      turnNumber: 1,
      findingsLedger: [argumentRow('c1'), periodRow('c1', 'not-held', { argument: 'window' })],
    });
    const notHeld = a.reasons.find((r) => r.reason === 'period-not-held')!;
    expect(notHeld.witness).toEqual([
      { kind: 'state', key: 'findingsLedger', path: '/1/verdict' },
      { kind: 'state', key: 'findingsLedger', path: '/0/argument' },
    ]);
    // …and the argument row fires its own layer-2 reason beside it.
    expect(a.reasons.map((r) => r.reason)).toEqual(['argument-assumed', 'period-not-held']);
  });

  it('no join without the argument name, or across calls', () => {
    const a = run({
      turnNumber: 1,
      findingsLedger: [argumentRow('c2'), periodRow('c1', 'not-held', { argument: 'window' })],
    });
    expect(a.reasons.find((r) => r.reason === 'period-not-held')!.witness).toHaveLength(1);
    const b = run({
      turnNumber: 1,
      findingsLedger: [argumentRow('c1'), periodRow('c1', 'not-held')],
    });
    expect(b.reasons.find((r) => r.reason === 'period-not-held')!.witness).toHaveLength(1);
  });
});

describe('PROPERTY — 1,000 generated ledgers', () => {
  let seed = 7_2026_09_27;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const VERDICTS = ['covered', 'partly-held', 'not-held', 'unknown', 'undeclared'];
  const REASON: Record<string, string | undefined> = {
    covered: undefined,
    'partly-held': 'period-partly-held',
    'not-held': 'period-not-held',
    unknown: 'period-unknown',
    undeclared: 'period-undeclared',
  };

  it('a period reason fires iff a current row of this turn carries its verdict; never "known"', () => {
    for (let n = 0; n < 1000; n += 1) {
      const turn = 1 + Math.floor(rnd() * 2);
      const rows = Array.from({ length: Math.floor(rnd() * 6) }, () =>
        periodRow(pick(['a', 'b', 'c']), pick(VERDICTS), { turn: 1 + Math.floor(rnd() * 2) }),
      );
      const current = new Map<string, string>();
      for (const row of rows)
        if (row.turn === turn) current.set(String(row.toolCallId), String(row.verdict));
      const expected = new Set(
        [...current.values()].map((v) => REASON[v]).filter((r) => r !== undefined),
      );
      const a = run({ turnNumber: turn, findingsLedger: rows });
      const fired = new Set(a.reasons.map((r) => r.reason));
      expect(fired).toEqual(expected);
      expect(a.assessment).not.toBe('known');
      expect(JSON.stringify(a)).not.toMatch(/2026-/);
    }
  });
});
