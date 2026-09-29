/**
 * STEP 5, THIRD REGISTRATION of the inputs bench — the sources-only door after the enum fix
 * (`bench/inputs/RULE-step5c.md`): `rule.mjs` · `judgeStep5c`.
 *
 * Test types:
 *   - UNIT  — S5-1 … S5-7 and S5-10 are v2's clauses, value for value, over the same rows; S5-8
 *             and S5-9 carry v2's measured values and are judged at the owner's raised ceilings
 *             (input 2.00 × off with calls still 1.20 × off; served 2.50 ×): they hold at the
 *             ceiling and fail just past it; nothing to count is NOT-MEASURABLE; v2's own verdict
 *             on the same rows does not move;
 *   - DRIFT — RULE-step5c.md's margins equal `STEP5C_MARGINS`, and every margin but the two the
 *             ruling raised equals v2's.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { caseById } from '../../../bench/inputs/cases.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { aggregate } from '../../../bench/inputs/metrics.mjs';
import {
  STEP5B_MARGINS,
  STEP5C_MARGINS,
  judgeStep5b,
  judgeStep5c,
  // @ts-expect-error — a plain .mjs bench module, no types
} from '../../../bench/inputs/rule.mjs';

const RULE_MD = readFileSync(
  join(__dirname, '..', '..', '..', 'bench', 'inputs', 'RULE-step5c.md'),
  'utf8',
);

/** A row as `readRun` makes one — only the fields the step-5 summaries read. */
function row(arm: string, caseId: string, o: Record<string, any> = {}) {
  const caseDef = caseById(caseId);
  const stated = Object.keys(caseDef.stated).length > 0;
  return {
    key: `${arm}/${caseId}/r${o.rep ?? 0}`,
    arm,
    caseId,
    group: caseDef.group,
    rep: o.rep ?? 0,
    complete: true,
    toolCalls: { proposed: 1, dispatched: 1, refused: 0, failed: 0 },
    periodCalls: [
      {
        toolCallId: 'a',
        tool: 'search_logs',
        argument: 'window',
        origin: 'sent',
        dispatched: true,
        ok: true,
        ranWith: '24h',
        cls: stated ? 'person' : 'model-chosen',
        ...(o.meant !== undefined && { meant: o.meant }),
        ...(o.row !== undefined && { row: o.row }),
        ...(o.askedFor === true && { askedFor: true, askedAs: ['unverified'] }),
      },
    ],
    names: [],
    periodExpected: true,
    noPeriodCall: false,
    answer: {
      present: true,
      ranDurations: ['d1'],
      statedDurations: [],
      statesRan: false,
      statesOther: false,
      factsExpected: 2,
      factsFound: 2,
      asksInProse: false,
    },
    standing: { standing: 'consistent', reasons: [] },
    argumentRows: { total: 1, bySource: {}, byAsked: {} },
    llm: { calls: o.calls ?? 2, input: o.input ?? 2000, output: 100, cacheRead: 0, cacheWrite: 0 },
    usd: 0,
    requestsDigest: 'x',
  };
}

const SAID = { source: 'said', claimed: 'user', matched: 'phrase' };

/**
 * One arm: `k` of 10 stated calls said with no ask; P1 asked and answered; `l` of 10 L5 calls
 * said. `input` and `calls` are each row's input tokens and model calls.
 */
function arm(name: string, k: number, l = 0, llm: { input?: number; calls?: number } = {}) {
  const armed = name !== 'off';
  const out = [];
  for (let i = 0; i < 10; i += 1) {
    out.push(
      row(name, 'c1-exact-24h', {
        rep: i,
        ...llm,
        ...(armed && (i < k ? { row: SAID } : { row: { source: 'answered' }, askedFor: true })),
      }),
    );
    out.push(
      row(name, 'p1-checkout-errors', {
        rep: i,
        ...llm,
        meant: armed,
        ...(armed && { row: { source: 'answered' }, askedFor: true }),
      }),
    );
    out.push(
      row(name, 'l5-other-sense', {
        rep: i,
        ...llm,
        ...(armed && { row: i < l ? SAID : { source: 'answered' } }),
      }),
    );
  }
  return out;
}

const SERVED = (fullB = 1100) => ({
  off: { perRequest: 100 },
  ruled: { perRequest: 1000 },
  fullB: { perRequest: fullB },
});
const agg = (rows: any[]) => aggregate(rows, { sources: true });
const clauseOf = (v: any, id: string) => v.clauses.find((c: any) => c.id === id);

describe('UNIT — the third registration', () => {
  it('S5-1 … S5-7 and S5-10 are v2’s clauses over the same rows, value for value; v2’s verdict does not move', () => {
    for (const [k, l] of [
      [7, 0],
      [8, 1],
      [10, 2],
    ] as const) {
      const rows = [...arm('off', 0), ...arm('full-b', k, l, { input: 4000 })];
      const v2 = judgeStep5b(agg(rows), SERVED(2400));
      const v3 = judgeStep5c(agg(rows), SERVED(2400));
      const carried = (v: any) => v.clauses.filter((c: any) => !['S5-8', 'S5-9'].includes(c.id));
      expect(carried(v3)).toEqual(carried(v2));
      expect(v3.clauses.map((c: any) => c.id)).toEqual(v2.clauses.map((c: any) => c.id));
      for (const id of ['S5-8', 'S5-9']) {
        expect(clauseOf(v3, id).value).toEqual(clauseOf(v2, id).value);
        expect(clauseOf(v3, id).says).toBe(clauseOf(v2, id).says);
      }
      expect(v3.reported).toEqual(v2.reported);
      expect(v3.provocation).toEqual(v2.provocation);
      // The same rows, judged by v2: its 1.15 ceilings still fail them.
      expect(clauseOf(v2, 'S5-8').pass).toBe(false);
      expect(clauseOf(v2, 'S5-9').pass).toBe(false);
      expect(v3).toMatchObject({ step: '5c', rule: expect.stringMatching(/^inputs-rule-step5c /) });
    }
  });

  it('S5-8: input tokens per call hold at 2.00 × off and fail past it', () => {
    const at = judgeStep5c(
      agg([...arm('off', 0), ...arm('full-b', 10, 0, { input: 4000 })]),
      SERVED(),
    );
    expect(clauseOf(at, 'S5-8').pass).toBe(true);
    expect(clauseOf(at, 'S5-8').threshold).toMatch(/^input ≤ 2\.00 × off; calls ≤ 1\.20 × off/);
    expect(at.verdict).toBe('PASS');
    const past = judgeStep5c(
      agg([...arm('off', 0), ...arm('full-b', 10, 0, { input: 4002 })]),
      SERVED(),
    );
    expect(clauseOf(past, 'S5-8').pass).toBe(false);
    expect(past.verdict).toBe('FAIL');
  });

  it('S5-8: calls per run keep v2’s 1.20 × off — the ruling did not move it', () => {
    // 5 calls a run off, so 6 is the ceiling (input per call held equal at 400).
    const at = judgeStep5c(
      agg([...arm('off', 0, 0, { calls: 5 }), ...arm('full-b', 10, 0, { calls: 6, input: 2400 })]),
      SERVED(),
    );
    expect(clauseOf(at, 'S5-8').pass).toBe(true);
    const past = judgeStep5c(
      agg([...arm('off', 0, 0, { calls: 5 }), ...arm('full-b', 10, 0, { calls: 7, input: 2800 })]),
      SERVED(),
    );
    expect(clauseOf(past, 'S5-8').pass).toBe(false);
  });

  it('S5-9: the served decoration holds at 2.50 × the steps 3–4 agent, fails past it, NOT-MEASURABLE unmeasured', () => {
    const rows = [...arm('off', 0), ...arm('full-b', 10)];
    expect(clauseOf(judgeStep5c(agg(rows), SERVED(2500)), 'S5-9').pass).toBe(true);
    const past = clauseOf(judgeStep5c(agg(rows), SERVED(2501)), 'S5-9');
    expect(past.pass).toBe(false);
    expect(past.threshold).toMatch(/^≤ 2\.50 × the steps 3–4 agent/);
    const none = judgeStep5c(agg(rows), undefined);
    expect(clauseOf(none, 'S5-9').pass).toBeUndefined();
    expect(none.verdict).toBe('NOT-MEASURABLE');
  });

  it('refuses a run without the full-b arm', () => {
    expect(() => judgeStep5c(agg(arm('off', 0)), SERVED())).toThrow(/arms 'off' and 'full-b'/);
  });
});

describe('DRIFT — RULE-step5c.md and the code say the same thing', () => {
  it('every margin in the page’s table is the one the code compares against; only the ruled two moved', () => {
    const section = RULE_MD.split('## Margins')[1]!;
    const table: Record<string, number> = {};
    for (const m of section.matchAll(/^\| `(\w+)` \| ([\d.]+) \|$/gm)) table[m[1]!] = Number(m[2]);
    expect(table).toEqual({ ...STEP5C_MARGINS });
    const moved = Object.keys(STEP5C_MARGINS).filter(
      (k) => STEP5C_MARGINS[k] !== STEP5B_MARGINS[k],
    );
    expect(moved.sort()).toEqual(['inputTokensRatio', 'servedRatio']);
    expect(STEP5C_MARGINS).toMatchObject({
      inputTokensRatio: 2,
      servedRatio: 2.5,
      modelCallsRatio: 1.2,
    });
  });
});
