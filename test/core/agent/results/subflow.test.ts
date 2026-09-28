/**
 * results/subflow — the three pure steps of the results layer (honesty layer
 * 3, step 7b): plan (which calls), check (which verdict), rows (what is filed).
 *
 * Test types (Convention 3): Unit (each step's table, row by row) · Property
 * (seeded batches: one row per call that declared a period or whose tool
 * declares a `ToolPeriod`, never one for a call already judged this turn, in
 * batch order). Integration is test/core/agent/results/layer.test.ts.
 */

import { describe, expect, it } from 'vitest';

import {
  checkPeriods,
  periodRowsOf,
  planPeriods,
  type BatchCall,
  type CallPeriod,
} from '../../../../src/core/agent/results/subflow.js';
import type { DeclaredPeriod } from '../../../../src/core/agent/coverage/period.js';

const Q = { from: '2026-09-26T09:00:00Z', to: '2026-09-26T10:00:00Z' };
const STALE: DeclaredPeriod = {
  queried: Q,
  held: { from: '2026-08-27T02:00:00Z', to: '2026-09-26T02:00:00Z' },
};
const FRESH: DeclaredPeriod = {
  queried: Q,
  held: { from: '2026-09-01T00:00:00Z', to: '2026-09-27T00:00:00Z' },
};
const BLIND: DeclaredPeriod = { queried: Q, held: 'unknown' };

const noToolPeriod = (): undefined => undefined;
const windowFor =
  (...names: string[]) =>
  (toolName: string): string | undefined =>
    names.includes(toolName) ? 'window' : undefined;

describe('unit: planPeriods — which calls are the layer’s', () => {
  const calls: BatchCall[] = [
    { toolCallId: 'a', toolName: 'backup_runs' },
    { toolCallId: 'b', toolName: 'search_logs' },
    { toolCallId: 'c', toolName: 'lookup' },
  ];

  it('a declared period, or a tool that declares a ToolPeriod — nothing else', () => {
    const plan = planPeriods(
      calls,
      [{ toolCallId: 'a', period: STALE }],
      [],
      windowFor('search_logs'),
    );
    expect(plan).toEqual([
      { toolCallId: 'a', toolName: 'backup_runs', declared: [STALE] },
      { toolCallId: 'b', toolName: 'search_logs', declared: [], argument: 'window' },
    ]);
  });

  it('a call already judged this turn is skipped — a re-entry files nothing twice', () => {
    const plan = planPeriods(
      calls,
      [{ toolCallId: 'a', period: STALE }],
      ['a', 'b'],
      windowFor('search_logs'),
    );
    expect(plan).toEqual([]);
  });

  it('a call id met twice in one batch is judged once', () => {
    const twice = [calls[0]!, calls[0]!];
    expect(planPeriods(twice, [{ toolCallId: 'a', period: STALE }], [], noToolPeriod)).toHaveLength(
      1,
    );
  });

  it('every period a call declared is kept — a coverage() around an absent() declares two', () => {
    const periods: CallPeriod[] = [
      { toolCallId: 'a', period: BLIND },
      { toolCallId: 'a', period: STALE },
    ];
    expect(planPeriods([calls[0]!], periods, [], noToolPeriod)[0]!.declared).toEqual([
      BLIND,
      STALE,
    ]);
  });

  it('no batch, no plan', () => {
    expect(planPeriods([], [], [], windowFor('search_logs'))).toEqual([]);
  });
});

describe('unit: checkPeriods — the verdict per planned call', () => {
  it('the declared period’s verdict; the least held of two; undeclared for silence', () => {
    const checked = checkPeriods([
      { toolCallId: 'a', toolName: 't', declared: [STALE] },
      { toolCallId: 'b', toolName: 't', declared: [FRESH] },
      { toolCallId: 'c', toolName: 't', declared: [FRESH, BLIND] },
      { toolCallId: 'd', toolName: 't', declared: [], argument: 'window' },
    ]);
    expect(checked.map((c) => [c.toolCallId, c.verdict, c.argument])).toEqual([
      ['a', 'not-held', undefined],
      ['b', 'covered', undefined],
      ['c', 'unknown', undefined],
      ['d', 'undeclared', 'window'],
    ]);
  });
});

describe('unit: periodRowsOf — the row, stamped, no instants', () => {
  it('one row per judged call with the turn and the batch’s iteration', () => {
    const rows = periodRowsOf(
      [
        { toolCallId: 'a', toolName: 'backup_runs', verdict: 'not-held' },
        { toolCallId: 'b', toolName: 'search_logs', verdict: 'undeclared', argument: 'window' },
      ],
      { turn: 2, iteration: 3 },
    );
    expect(rows).toEqual([
      {
        kind: 'period',
        turn: 2,
        toolCallId: 'a',
        toolName: 'backup_runs',
        iteration: 3,
        verdict: 'not-held',
      },
      {
        kind: 'period',
        turn: 2,
        toolCallId: 'b',
        toolName: 'search_logs',
        iteration: 3,
        verdict: 'undeclared',
        argument: 'window',
      },
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/2026-/);
  });
});

describe('property: 1,000 seeded batches', () => {
  let seed = 20260927;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;

  it('a row for exactly the calls that declared a period or whose tool declares one, not yet judged, in order', () => {
    for (let n = 0; n < 1000; n += 1) {
      const size = Math.floor(rnd() * 8);
      const calls: BatchCall[] = Array.from({ length: size }, (_, i) => ({
        toolCallId: `c${i}`,
        toolName: pick(['backup_runs', 'search_logs', 'lookup']),
      }));
      const periods: CallPeriod[] = calls
        .filter(() => rnd() < 0.5)
        .map((c) => ({ toolCallId: c.toolCallId, period: pick([STALE, FRESH, BLIND]) }));
      const filed = calls.filter(() => rnd() < 0.2).map((c) => c.toolCallId);
      const toolPeriod = windowFor('search_logs');
      const rows = periodRowsOf(checkPeriods(planPeriods(calls, periods, filed, toolPeriod)), {
        turn: 1,
        iteration: 1,
      });
      const expected = calls
        .filter((c) => !filed.includes(c.toolCallId))
        .filter(
          (c) =>
            periods.some((p) => p.toolCallId === c.toolCallId) ||
            toolPeriod(c.toolName) !== undefined,
        )
        .map((c) => c.toolCallId);
      expect(rows.map((r) => r.toolCallId)).toEqual(expected);
      for (const row of rows) {
        const declared = periods.some((p) => p.toolCallId === row.toolCallId);
        expect(row.verdict === 'undeclared').toBe(!declared);
      }
    }
  });
});
