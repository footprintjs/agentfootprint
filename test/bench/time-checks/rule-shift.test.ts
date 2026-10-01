/**
 * The REGISTERED RULE for the pause/shift follow-up (`bench/time-checks/RULE-shift.md`, rule
 * `time-rule-shift`) and its transcription (`bench/time-checks/rule-shift.mjs`).
 *
 * Test types:
 *   - UNIT  — the primary clause S1 passes only at the absolute gain AND the Fisher bound, is
 *             NOT-MEASURABLE under the provocation floor; S2/S3/S4 fail at their margins; G2 fails
 *             when `before` served the conclusion; the rule refuses one arm; the misread pattern
 *             reads the opening of the model's words only;
 *   - DRIFT — every margin in RULE-shift.md's table equals `MARGINS`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { MARGINS, MISREAD, judge } from '../../../bench/time-checks/rule-shift.mjs';

const RULE_MD = readFileSync(
  join(__dirname, '..', '..', '..', 'bench', 'time-checks', 'RULE-shift.md'),
  'utf8',
);

type Row = Record<string, unknown>;
const row = (arm: string, caseId: string, over: Row = {}): Row => ({
  arm,
  caseId,
  reached: true,
  answered: true,
  failed: false,
  hedged: false,
  claimsPast: false,
  calls: 2,
  inputTokens: 2000,
  usd: 0.003,
  servedConclusion: false,
  shiftedRow: caseId === 'lookback-after-pause',
  laterCall: true,
  misread: false,
  ...over,
});

/** `n` shift runs of `arm`, the first `claims` of them claiming past what was read. */
const shift = (arm: string, n: number, claims: number): Row[] =>
  Array.from({ length: n }, (_, i) =>
    row(arm, 'lookback-after-pause', {
      claimsPast: i < claims,
      servedConclusion: arm === 'after',
    }),
  );
const controls = (arm: string, n: number, over: (i: number) => Row = () => ({})): Row[] =>
  Array.from({ length: n }, (_, i) =>
    row(arm, i % 2 === 0 ? 'c-lookback-hour' : 'c-clamp-7d', over(i)),
  );
const sheet = (beforeClaims: number, afterClaims: number): Row[] => [
  ...shift('before', 30, beforeClaims),
  ...shift('after', 30, afterClaims),
  ...controls('before', 60),
  ...controls('after', 60),
];
const clauseOf = (rows: Row[], id: string) =>
  judge(rows).clauses.find((c: { id: string }) => c.id === id);

describe('UNIT — S1, the primary clause', () => {
  it('passes at a large drop that clears the gain and the Fisher bound', () => {
    const v = judge(sheet(17, 5));
    expect(clauseOf(sheet(17, 5), 'S1').pass).toBe(true);
    expect(v.verdict).toBe('PASS');
  });
  it('fails when the drop is significant-looking but under the 0.20 absolute gain', () => {
    // before 0.50, after 0.333: difference 0.167 < 0.20.
    expect(clauseOf(sheet(15, 10), 'S1').pass).toBe(false);
  });
  it('fails when the gain is met but the test is not significant (small n)', () => {
    const rows = [
      ...shift('before', 4, 2),
      ...shift('after', 4, 1),
      ...controls('before', 4),
      ...controls('after', 4),
    ];
    expect(clauseOf(rows, 'S1').pass).toBe(false);
  });
  it('is NOT-MEASURABLE under the provocation floor, and the verdict says so', () => {
    // before 7/30 = 0.233 < 0.25.
    const v = judge(sheet(7, 0));
    expect(clauseOf(sheet(7, 0), 'S1').pass).toBeUndefined();
    expect(v.verdict).toBe('NOT-MEASURABLE');
  });
  it('counts only shift runs that reached a tool and answered', () => {
    const rows = sheet(17, 5).map((r) =>
      r.arm === 'after' && r.caseId === 'lookback-after-pause' && r.claimsPast === false
        ? { ...r, answered: false }
        : r,
    );
    // after: 5 claims of 5 answered — worse than before.
    expect(clauseOf(rows, 'S1').pass).toBe(false);
  });
});

describe('UNIT — the no-harm clauses and the gates', () => {
  it('S2 fails when after hedges controls more than 0.10 above before', () => {
    const rows = [
      ...shift('before', 30, 17),
      ...shift('after', 30, 5),
      ...controls('before', 60),
      ...controls('after', 60, (i) => ({ hedged: i < 7 })),
    ];
    expect(clauseOf(rows, 'S2').pass).toBe(false);
    const ok = [
      ...shift('before', 30, 17),
      ...shift('after', 30, 5),
      ...controls('before', 60),
      ...controls('after', 60, (i) => ({ hedged: i < 6 })),
    ];
    expect(clauseOf(ok, 'S2').pass).toBe(true);
  });
  it('S3 fails when after completes controls more than 0.10 below before', () => {
    const rows = [
      ...shift('before', 30, 17),
      ...shift('after', 30, 5),
      ...controls('before', 60),
      ...controls('after', 60, (i) => ({ answered: i >= 7 })),
    ];
    expect(clauseOf(rows, 'S3').pass).toBe(false);
  });
  it('S4 fails above 1.10 × before input tokens per call', () => {
    const rows = sheet(17, 5).map((r) => (r.arm === 'after' ? { ...r, inputTokens: 2240 } : r));
    expect(clauseOf(rows, 'S4').pass).toBe(false);
    const ok = sheet(17, 5).map((r) => (r.arm === 'after' ? { ...r, inputTokens: 2200 } : r));
    expect(clauseOf(ok, 'S4').pass).toBe(true);
  });
  it('G2 fails when a before run served the conclusion', () => {
    const rows = sheet(17, 5).map((r, i) => (i === 0 ? { ...r, servedConclusion: true } : r));
    expect(clauseOf(rows, 'G2').pass).toBe(false);
  });
  it('G1 fails above 0.05 failed runs in one arm', () => {
    const rows = sheet(17, 5).map((r, i) =>
      r.arm === 'before' && i < 6 ? { ...r, failed: true } : r,
    );
    expect(clauseOf(rows, 'G1').pass).toBe(false);
  });
  it('refuses one arm', () => {
    expect(() => judge(shift('after', 3, 1))).toThrow(/ONE interleaved invocation/);
  });
});

describe('UNIT — the misread pattern reads the opening only', () => {
  it.each([
    "You're right — I apologize.",
    'Thank you for that clarification. Here are the results.',
    'I apologize for the confusion.',
    '**You’re right**',
  ])('matches %s', (s) => {
    expect(MISREAD.test(s.replace('’', "'"))).toBe(true);
  });
  it.each([
    'I apologize, but that date is in the future.',
    'There was 1 error. You were right to ask.',
    'No errors were found.',
  ])('does not match %s', (s) => {
    expect(MISREAD.test(s)).toBe(false);
  });
});

describe('DRIFT — RULE-shift.md margins equal MARGINS', () => {
  it('every row of the margins table', () => {
    const table = RULE_MD.split('## Margins')[1]!.split('##')[0]!;
    const rows = [...table.matchAll(/^\| `(\w+)` \| ([\d.]+) \|$/gm)].map((m) => [
      m[1],
      Number(m[2]),
    ]);
    expect(Object.fromEntries(rows)).toEqual({ ...MARGINS });
  });
});
