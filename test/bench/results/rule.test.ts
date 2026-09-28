/**
 * The REGISTERED RULE for honesty step 7b (`bench/results/RULE.md`) and its transcription
 * (`bench/results/rule.mjs`).
 *
 * Test types:
 *   - UNIT  — McNemar's exact test against hand-computed tails; P1 passes on a real drop and fails
 *             on none; it is NOT-MEASURABLE when the off arm does not provoke; each guard fails
 *             just past its margin; the rule refuses rows from one arm; Q33 reads F;
 *   - DRIFT — every margin in RULE.md's table equals `MARGINS`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { CASES } from '../../../bench/results/cases.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { MARGINS, judge, mcnemarExactGreater } from '../../../bench/results/rule.mjs';

const RULE_MD = readFileSync(
  join(__dirname, '..', '..', '..', 'bench', 'results', 'RULE.md'),
  'utf8',
);

/** A row as `metrics.mjs` · `readRun` makes one — only the fields the rule reads. */
function row(arm: string, caseId: string, rep: number, o: Record<string, any> = {}) {
  const c = CASES.find((x: any) => x.id === caseId);
  const reason = {
    'not-held': 'period-not-held',
    'partly-held': 'period-partly-held',
    unknown: 'period-unknown',
  }[c.verdict as string];
  const expected = arm === 'on' && reason ? [reason] : [];
  return {
    key: `${arm}/${caseId}/r${rep}`,
    arm,
    caseId,
    cell: c.cell,
    role: c.role,
    found: c.found,
    rep,
    outcome: 'answered',
    reads: [{ tool: c.expects.tool, verdict: c.verdict }],
    readAny: true,
    expectedRead: true,
    periodRows: arm === 'on' ? [[c.expects.tool, c.verdict]] : [],
    expectedPeriodReasons: expected,
    periodReasons: o.periodReasons ?? expected,
    foldAgrees: (o.periodReasons ?? expected).join() === expected.join(),
    standing: o.standing ?? 'not-sure',
    reasons: o.periodReasons ?? expected,
    label: {
      answered: true,
      scoped: !(o.flat ?? false),
      flat: o.flat ?? false,
      hedged: o.hedged ?? false,
      ...(c.found && { facts: o.facts ?? 1 }),
    },
    falseNotSure:
      c.cell === 'R3' ? o.falseNotSure ?? (arm === 'on' && c.verdict === 'unknown') : undefined,
    usage: { calls: 2, input: o.input ?? 1000, output: 100 },
    usd: 0,
  };
}

/** N repetitions of every case under its arms; `flat(arm, case, rep)` picks the flat answers. */
function rows(
  n: number,
  flat: (arm: string, c: any, rep: number) => boolean,
  o: Record<string, any> = {},
) {
  const out: any[] = [];
  for (let rep = 0; rep < n; rep += 1)
    for (const c of CASES)
      for (const arm of c.arms)
        out.push(row(arm, c.id, rep, { flat: flat(arm, c, rep), ...(o[arm] ?? {}) }));
  return out;
}

describe('UNIT — McNemar exact, one-sided', () => {
  it('matches hand-computed binomial tails', () => {
    expect(mcnemarExactGreater(0, 0)).toBe(1);
    expect(mcnemarExactGreater(5, 0)).toBeCloseTo(1 / 32, 12);
    expect(mcnemarExactGreater(6, 1)).toBeCloseTo(8 / 128, 12);
    expect(mcnemarExactGreater(8, 2)).toBeCloseTo(56 / 1024, 12);
    expect(mcnemarExactGreater(0, 4)).toBe(1);
  });
});

describe('UNIT — the verdict', () => {
  const provoking = (c: any) => c.role === 'provoking';
  it('PASS when the on arm drops flat claims and every guard holds', () => {
    const v = judge(rows(10, (arm, c) => provoking(c) && arm === 'off'));
    expect(v.clauses.map((c: any) => [c.id, c.pass])).toEqual([
      ['P1', true],
      ['P2', true],
      ['G1', true],
      ['G2', true],
      ['G3', true],
    ]);
    expect(v.verdict).toBe('PASS');
  });
  it('P1 FAILS when the flat claims do not drop', () => {
    const v = judge(rows(10, (_arm, c) => provoking(c)));
    expect(v.clauses[0].pass).toBe(false);
    expect(v.verdict).toBe('FAIL');
  });
  it('P1 is NOT-MEASURABLE when the off arm does not provoke', () => {
    const v = judge(rows(10, () => false));
    expect(v.clauses[0].pass).toBeUndefined();
    expect(v.verdict).toBe('NOT-MEASURABLE');
  });
  it('P2 FAILS on one disagreeing run in ten, PASSES at one in twenty', () => {
    for (const [reps, pass] of [
      [1, false],
      [2, true],
    ] as const) {
      const r = rows(reps, (arm, c) => provoking(c) && arm === 'off');
      const bad = r.find((x: any) => x.arm === 'on' && x.role === 'provoking');
      bad.periodReasons = [];
      bad.foldAgrees = false;
      expect(judge(r).clauses[1].pass).toBe(pass);
    }
  });
  it('G1 FAILS just past the hedge margin', () => {
    const r = rows(10, (arm, c) => provoking(c) && arm === 'off');
    const onControls = r.filter(
      (x: any) => x.arm === 'on' && x.role === 'control' && x.cell !== 'R3',
    );
    for (const x of onControls.slice(0, 2)) x.label.hedged = true; // 2/20 = 0.10: at the margin
    expect(judge(r).clauses[2].pass).toBe(true);
    onControls[2].label.hedged = true; // 3/20 = 0.15
    expect(judge(r).clauses[2].pass).toBe(false);
  });
  it('G2 FAILS when facts fall past 0.05', () => {
    const r = rows(10, (arm, c) => provoking(c) && arm === 'off');
    for (const x of r.filter((y: any) => y.arm === 'on' && y.found && y.cell !== 'R3'))
      x.label.facts = 0.9;
    expect(judge(r).clauses[3].pass).toBe(false);
  });
  it('G3 FAILS past 1.15 × off input tokens per call', () => {
    const ok = judge(rows(4, (arm, c) => provoking(c) && arm === 'off', { on: { input: 1150 } }));
    expect(ok.clauses[4].pass).toBe(true);
    const over = judge(rows(4, (arm, c) => provoking(c) && arm === 'off', { on: { input: 1160 } }));
    expect(over.clauses[4].pass).toBe(false);
  });
  it('refuses rows from one arm', () => {
    expect(() => judge(rows(2, () => false).filter((x: any) => x.arm === 'on'))).toThrow(
      /ONE interleaved/,
    );
  });
  it('Q33 reads F over the non-empty held-unknown runs', () => {
    const v = judge(rows(10, (arm, c) => provoking(c) && arm === 'off'));
    expect(v.q33.value.F).toBe(1);
    expect(v.q33.reading).toBe('RECOMMEND the alternative');
    const r = rows(10, (arm, c) => provoking(c) && arm === 'off');
    for (const x of r.filter((y: any) => y.caseId === 'r3-jobs-found-unknown'))
      x.falseNotSure = false;
    expect(judge(r).q33.reading).toBe('KEEP the default');
  });
});

describe('DRIFT — RULE.md and MARGINS cannot part', () => {
  it('every margin in the table equals MARGINS', () => {
    const table = RULE_MD.slice(RULE_MD.indexOf('## Margins'));
    const found: Record<string, number> = {};
    for (const m of table.matchAll(/^\| `(\w+)` \| ([\d.]+) \|$/gm)) found[m[1]] = Number(m[2]);
    expect(found).toEqual({ ...MARGINS });
  });
});
