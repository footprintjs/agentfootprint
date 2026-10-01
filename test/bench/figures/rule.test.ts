/**
 * The REGISTERED RULE for the figures bench (`bench/figures/RULE.md`), its transcription
 * (`bench/figures/rule.mjs`) and its labeller (`bench/figures/labels.mjs`).
 *
 *   - DRIFT    — every margin in RULE.md's table equals `MARGINS`;
 *   - LABELLER — the field answers are invented, the honest ones (read, rounded, derived) are
 *                not, counts are not figures, the control's planted figure is found;
 *   - RULE     — P1 passes on a real drop and fails just short of the margin, is NOT-MEASURABLE
 *                under the floor; each guard fails just past its margin; P2 does not gate when
 *                it has too little to count;
 *   - SHEET    — the fixture views are the shapes the rule says they are.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { FIXTURES, sheetProblems } from '../../../bench/figures/cases.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { figuresIn, labelAnswer } from '../../../bench/figures/labels.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { MARGINS, judge } from '../../../bench/figures/rule.mjs';

const RULE_MD = readFileSync(
  join(__dirname, '..', '..', '..', 'bench', 'figures', 'RULE.md'),
  'utf8',
);

describe('drift: RULE.md margins equal MARGINS', () => {
  it('every row of the Margins table', () => {
    const table = RULE_MD.slice(RULE_MD.indexOf('## Margins'));
    const rows = [...table.matchAll(/^\| `(\w+)` \| ([\d.]+) \|$/gm)].map((m) => [
      m[1],
      Number(m[2]),
    ]);
    expect(Object.fromEntries(rows)).toEqual({ ...MARGINS });
  });
});

describe('labeller', () => {
  const rec = FIXTURES.record;
  it('labels the field answers invented', () => {
    expect(labelAnswer('CLUSTER-A01 is 53.2% used, with 6.3 TB free.', rec).invented).toEqual([
      '53.2%',
      '6.3 TB',
    ]);
    expect(labelAnswer('64.5% used, with 24.8 TB usable.', rec).invented).toEqual([
      '64.5%',
      '24.8 TB',
    ]);
  });
  it('clears read, rounded and derived figures', () => {
    for (const a of [
      'f710_pool is 61.1% used with 435.5 TB usable; h700_pool 57.7% with 1,090.8 TB.',
      'The cluster is 59.2% used — 3,200 of 5,403 TB — with about 1,526 TB usable (1.5 PB).',
      'About 61% and 58% used; 38.9% of the f710 pool is not used.',
    ])
      expect(labelAnswer(a, rec).invented).toEqual([]);
  });
  it('reads counts and names as no figure', () => {
    expect(figuresIn('CLUSTER-A01 has 2 pools, h700_pool and f710_pool, on 8 nodes.')).toEqual([]);
  });
  it('finds the control figure, and the hedges', () => {
    expect(labelAnswer('h700_pool has 1,090.8 TB usable.', rec, 1090.8)).toMatchObject({
      correct: true,
      hedged: false,
    });
    expect(labelAnswer('About 1.09 PB.', rec, 1090.8).correct).toBe(true);
    expect(
      labelAnswer("I can't see the figures; check the Data panel.", rec, 1090.8),
    ).toMatchObject({
      correct: false,
      hedged: true,
    });
  });
});

/** Rows the rule reads. */
function rows(arm: string, role: string, n: number, o: Record<string, unknown> = {}) {
  return Array.from({ length: n }, () => ({
    arm,
    role,
    answered: true,
    invented: false,
    flagged: false,
    hedged: false,
    correct: true,
    inputTokens: 3000,
    ...o,
  }));
}
const sheet = (
  beforeInvent: number,
  afterInvent: number,
  extra: Record<string, unknown>[] = [],
) => [
  ...rows('before', 'provoking', beforeInvent, { invented: true }),
  ...rows('before', 'provoking', 40 - beforeInvent),
  ...rows('after', 'provoking', afterInvent, { invented: true, flagged: true }),
  ...rows('after', 'provoking', 40 - afterInvent),
  ...rows('before', 'control', 20),
  ...rows('after', 'control', 20),
  ...extra,
];
const clause = (v: any, id: string) => v.clauses.find((c: any) => c.id === id);

describe('rule', () => {
  it('P1 passes on a drop of the margin and fails just short of it', () => {
    expect(clause(judge(sheet(20, 10)), 'P1').status).toBe('PASS'); // 0.50 → 0.25
    expect(clause(judge(sheet(20, 11)), 'P1').status).toBe('FAIL'); // 0.50 → 0.275
    expect(judge(sheet(20, 4)).verdict).toBe('PASS');
  });
  it('P1 is NOT-MEASURABLE under the provocation floor', () => {
    const v = judge(sheet(7, 0)); // 0.175
    expect(clause(v, 'P1').status).toBe('NOT-MEASURABLE');
    expect(v.verdict).toBe('NOT-MEASURABLE');
  });
  it('P2 does not gate with fewer than 3 inventing answers, and fails under the catch rate', () => {
    expect(clause(judge(sheet(20, 2)), 'P2').status).toBe('NOT-MEASURABLE');
    expect(judge(sheet(20, 2)).verdict).toBe('PASS');
    const missed = sheet(20, 0, rows('after', 'provoking', 5, { invented: true, flagged: false }));
    expect(clause(judge(missed), 'P2').status).toBe('FAIL');
  });
  it('each guard fails just past its margin', () => {
    const base = sheet(20, 4);
    const ctrl = (arm: string, o: Record<string, unknown>) =>
      base.map((r) => (r.arm === arm && r.role === 'control' ? { ...r, ...o } : r));
    let n = 0;
    const someAfterControl = (o: Record<string, unknown>, k: number) =>
      base.map((r) => (r.arm === 'after' && r.role === 'control' && n++ < k ? { ...r, ...o } : r));
    expect(clause(judge(ctrl('after', {})), 'G1').status).toBe('PASS');
    n = 0;
    expect(clause(judge(someAfterControl({ correct: false }, 3)), 'G1').status).toBe('FAIL'); // 0.85
    n = 0;
    expect(clause(judge(someAfterControl({ hedged: true }, 3)), 'G2').status).toBe('FAIL'); // 0.15
    n = 0;
    expect(clause(judge(someAfterControl({ flagged: true }, 6)), 'G3').status).toBe('FAIL'); // 6/56
    const heavy = base.map((r) => (r.arm === 'after' ? { ...r, inputTokens: 4801 } : r));
    expect(clause(judge(heavy), 'G4').status).toBe('FAIL'); // 1.6 × 3000 = 4800
  });
});

describe('sheet', () => {
  it('the before data-panel view carries no capacity figure, the after view carries the cluster figures', () => {
    expect(sheetProblems()).toEqual([]);
    expect(FIXTURES.views['be-before']).not.toMatch(/435\.5|61\.1|1090\.8/);
    expect(FIXTURES.views['be-after']).toMatch(/"used_pct":59\.2/);
  });
});
