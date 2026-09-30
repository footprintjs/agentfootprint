/**
 * The REGISTERED RULE for time step T6b (`bench/time/RULE.md`) and its transcription
 * (`bench/time/rule.mjs`).
 *
 * Test types:
 *   - UNIT  — Fisher's one-sided exact test against hand-computed tails; T1 passes on a real gain
 *             and fails on none; T2 fails on one control confirmation; T5 fails just past the
 *             ceiling; T6 fails on one said row; the rule refuses rows from one arm;
 *   - DRIFT — every margin in RULE.md's table equals `MARGINS`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { CASES } from '../../../bench/time/cases.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { MARGINS, fisherGreater, judge } from '../../../bench/time/rule.mjs';

const RULE_MD = readFileSync(join(__dirname, '..', '..', '..', 'bench', 'time', 'RULE.md'), 'utf8');

/** A row as `metrics.mjs` · `readRun` makes one — only the fields the rule reads. */
function row(arm: string, caseId: string, rep: number, o: Record<string, unknown> = {}) {
  const c = CASES.find((x: { id: string }) => x.id === caseId);
  const readable = c.cell === 'readable' || c.cell === 'unreadable' || c.cell === 'future';
  return {
    key: `${arm}/${caseId}/r${rep}`,
    arm,
    caseId,
    cell: c.cell,
    rep,
    completed: true,
    right: true,
    asks: 0,
    timeAsks: 0,
    readingRows: arm === 'on' && readable ? 1 : 0,
    timeLines: 0,
    saidRows: 0,
    calls: 2,
    inputTokens: 2000,
    outputTokens: 100,
    usd: 0,
    ...o,
  };
}

/** Every case × both arms × `n` reps, with `patch` applied per row. */
function sheet(
  n: number,
  patch: (r: ReturnType<typeof row>) => Record<string, unknown> = () => ({}),
) {
  const rows = [];
  for (const c of CASES)
    for (const arm of ['off', 'on'])
      for (let i = 0; i < n; i += 1) {
        const r = row(arm, c.id, i);
        rows.push({ ...r, ...patch(r) });
      }
  return rows;
}

const clause = (v: { clauses: { id: string; pass: boolean | undefined }[] }, id: string) =>
  v.clauses.find((c) => c.id === id)!.pass;

describe('UNIT — Fisher one-sided', () => {
  it('matches hand-computed tails', () => {
    // 3 of 3 vs 0 of 3: P = 1 / C(6,3) = 0.05.
    expect(fisherGreater(3, 3, 0, 3)).toBeCloseTo(0.05, 10);
    // Nothing varies → 1.
    expect(fisherGreater(3, 3, 3, 3)).toBe(1);
    expect(fisherGreater(0, 0, 0, 0)).toBe(1);
  });
});

describe('UNIT — the clauses', () => {
  it('T1 passes on a real gain and fails on none', () => {
    const gain = sheet(15, (r) =>
      r.cell === 'readable' && r.arm === 'off' && r.rep < 8 ? { right: false } : {},
    );
    expect(clause(judge(gain), 'T1')).toBe(true);
    expect(judge(gain).verdict).toBe('PASS');
    expect(clause(judge(sheet(15)), 'T1')).toBe(false);
  });

  it('T2 fails on one control confirmation, or one control time line', () => {
    const ask = sheet(3, (r) =>
      r.caseId === 'c-node' && r.arm === 'on' && r.rep === 0 ? { timeAsks: 1, asks: 1 } : {},
    );
    expect(clause(judge(ask), 'T2')).toBe(false);
    const line = sheet(3, (r) =>
      r.caseId === 'c-504' && r.arm === 'on' && r.rep === 0 ? { timeLines: 1 } : {},
    );
    expect(clause(judge(line), 'T2')).toBe(false);
  });

  it('T5 holds at the ceiling and fails just past it', () => {
    const at = sheet(2, (r) =>
      r.arm === 'on' ? { inputTokens: 2000 * MARGINS.inputTokensRatio } : {},
    );
    expect(clause(judge(at), 'T5')).toBe(true);
    const past = sheet(2, (r) =>
      r.arm === 'on' ? { inputTokens: 2000 * MARGINS.inputTokensRatio + 2 } : {},
    );
    expect(clause(judge(past), 'T5')).toBe(false);
  });

  it('T6 fails on one run that files a said row', () => {
    const said = sheet(2, (r) =>
      r.caseId === 'yesterday' && r.arm === 'on' && r.rep === 0 ? { saidRows: 1 } : {},
    );
    expect(clause(judge(said), 'T6')).toBe(false);
  });

  it('refuses rows from one arm', () => {
    expect(() => judge(sheet(2).filter((r) => r.arm === 'on'))).toThrow(/arms off and on/);
  });
});

describe('DRIFT — RULE.md and MARGINS cannot part', () => {
  it('every margin in the table equals MARGINS', () => {
    const table = RULE_MD.slice(RULE_MD.indexOf('## Margins'));
    const found: Record<string, number> = {};
    for (const m of table.matchAll(/^\| `(\w+)` \| ([\d.]+) \|$/gm)) found[m[1]!] = Number(m[2]);
    expect(found).toEqual({ ...MARGINS });
  });
});
