/**
 * results/subflow — the three pure steps of the results layer (honesty layer
 * 3, step 7b): plan (which calls), check (which verdict), rows (what is filed).
 *
 * Test types (Convention 3): Unit (each step's table, row by row, and the
 * mount's one gate, `batchToJudge` — which visit of the loop head gets the
 * batch) · Property (seeded batches: one row per call that declared a period or
 * whose tool declares a `ToolPeriod`, in batch order; and over seeded visit
 * sequences, each batch handed to the layer exactly once). Integration is
 * test/core/agent/results/layer.test.ts.
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
import { batchToJudge } from '../../../../src/core/agent/honesty/mounts.js';

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
    const plan = planPeriods(calls, [{ toolCallId: 'a', period: STALE }], windowFor('search_logs'));
    expect(plan).toEqual([
      { toolCallId: 'a', toolName: 'backup_runs', declared: [STALE] },
      { toolCallId: 'b', toolName: 'search_logs', declared: [], argument: 'window' },
    ]);
  });

  it('a call id met twice in ONE batch is judged once, over every period declared under it', () => {
    const twice = [calls[0]!, calls[0]!];
    const periods: CallPeriod[] = [
      { toolCallId: 'a', period: FRESH },
      { toolCallId: 'a', period: STALE },
    ];
    const plan = planPeriods(twice, periods, noToolPeriod);
    expect(plan).toHaveLength(1);
    // Merged, the least held wins — an over-report, never a hidden verdict.
    expect(checkPeriods(plan)[0]!.verdict).toBe('not-held');
  });

  it('every period a call declared is kept — a coverage() around an absent() declares two', () => {
    const periods: CallPeriod[] = [
      { toolCallId: 'a', period: BLIND },
      { toolCallId: 'a', period: STALE },
    ];
    expect(planPeriods([calls[0]!], periods, noToolPeriod)[0]!.declared).toEqual([BLIND, STALE]);
  });

  it('no batch, no plan', () => {
    expect(planPeriods([], [], windowFor('search_logs'))).toEqual([]);
  });
});

describe('unit: batchToJudge — which loop-head visit gets the batch', () => {
  it('the first visit after ToolCalls ran it: the loop head is one iteration past the stamp', () => {
    expect(batchToJudge(2, 1)).toBe(1);
    expect(batchToJudge(8, 7)).toBe(7);
  });

  it('a re-entry that ran no tool (a re-ask, a nudge, a recheck, a wrap-up) advanced it again: nothing', () => {
    expect(batchToJudge(3, 1)).toBeUndefined();
    expect(batchToJudge(9, 1)).toBeUndefined();
  });

  it('no stamp — the first iteration, a resumed leg, an unarmed dispatch: nothing', () => {
    expect(batchToJudge(1, undefined)).toBeUndefined();
    expect(batchToJudge(2, undefined)).toBeUndefined();
    expect(batchToJudge(2, '1')).toBeUndefined();
    expect(batchToJudge(2, null)).toBeUndefined();
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

  it('a row for exactly the calls that declared a period or whose tool declares one, in order', () => {
    for (let n = 0; n < 1000; n += 1) {
      const size = Math.floor(rnd() * 8);
      const calls: BatchCall[] = Array.from({ length: size }, (_, i) => ({
        toolCallId: `c${i}`,
        toolName: pick(['backup_runs', 'search_logs', 'lookup']),
      }));
      const periods: CallPeriod[] = calls
        .filter(() => rnd() < 0.5)
        .map((c) => ({ toolCallId: c.toolCallId, period: pick([STALE, FRESH, BLIND]) }));
      const toolPeriod = windowFor('search_logs');
      const rows = periodRowsOf(checkPeriods(planPeriods(calls, periods, toolPeriod)), {
        turn: 1,
        iteration: 1,
      });
      const expected = calls
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

  it('over seeded visit sequences, each dispatched batch reaches the layer exactly once', () => {
    // A run's loop-head visits: ToolCalls dispatches at the current iteration
    // (stamp) and advances by one; a re-entry (re-ask, nudge, recheck, wrap-up)
    // advances by one with the batch in place. Call ids are irrelevant here.
    for (let n = 0; n < 1000; n += 1) {
      let iteration = 1;
      let stamp: number | undefined;
      const dispatched: number[] = [];
      const judged: number[] = [];
      expect(batchToJudge(iteration, stamp)).toBeUndefined(); // the first visit: no batch
      for (let step = Math.floor(rnd() * 12); step > 0; step -= 1) {
        if (rnd() < 0.6) {
          stamp = iteration;
          dispatched.push(iteration);
        }
        iteration += 1;
        const batch = batchToJudge(iteration, stamp);
        if (batch !== undefined) judged.push(batch);
      }
      expect(judged).toEqual(dispatched);
    }
  });
});
