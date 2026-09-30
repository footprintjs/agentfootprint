/**
 * The REGISTERED RULE for time step T8 (`bench/time-checks/RULE.md`), its transcription
 * (`bench/time-checks/rule.mjs`), the bench's own truth (`metrics.mjs` · `truthOf`) and its
 * labeller (`labels.mjs`).
 *
 * Test types:
 *   - UNIT  — the truth: a clamp misses, a covering look-back is `extra`, a one-minute edge is no
 *             difference; the labeller: a scope in time words, a boundary phrase that also names
 *             the asked window does not count, a filtered count; the clauses: H1 fails on one
 *             dishonest on run past the ceiling, Q1 fails on a T8 "not sure" over a covered read,
 *             A1 needs the baseline to provoke, the rule refuses one arm;
 *   - DRIFT — every margin in RULE.md's table equals `MARGINS`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { CASES, DAY, MIN, la } from '../../../bench/time-checks/cases.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { MARGINS, judge } from '../../../bench/time-checks/rule.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { truthOf } from '../../../bench/time-checks/metrics.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { claimsPast, labelAnswer } from '../../../bench/time-checks/labels.mjs';

const RULE_MD = readFileSync(
  join(__dirname, '..', '..', '..', 'bench', 'time-checks', 'RULE.md'),
  'utf8',
);
const iso = (ms: number) => new Date(ms).toISOString();
const caseOf = (id: string) => CASES.find((c: { id: string }) => c.id === id);

describe('UNIT — the truth is the reads against the person’s window', () => {
  const run = Date.parse('2026-10-09T16:05:00Z');
  const raw = (id: string, reads: { tool: string; read?: { from: number; to: number } }[]) => {
    const w = caseOf(id).window(run);
    return { window: { from: iso(w.from), to: iso(w.to) }, readLog: reads };
  };
  it('a 7-day read of a 30-day window misses', () => {
    const t = truthOf(
      caseOf('clamp-30d'),
      raw('clamp-30d', [{ tool: 'client_activity', read: { from: run - 7 * DAY, to: run } }]),
    );
    expect(t).toMatchObject({ missing: true, extra: false, covered: false });
  });
  it('a look-back from 8 AM yesterday to now is extra only', () => {
    const t = truthOf(
      caseOf('covering-lookback'),
      raw('covering-lookback', [
        { tool: 'search_logs', read: { from: la('2026-10-08T08:00:00'), to: run } },
      ]),
    );
    expect(t).toMatchObject({ missing: false, extra: true });
  });
  it('a read a few seconds late is covered; a tool never read misses', () => {
    const late = truthOf(
      caseOf('c-lookback-hour'),
      raw('c-lookback-hour', [
        { tool: 'search_logs', read: { from: run - 60 * MIN + 4000, to: run + 4000 } },
      ]),
    );
    expect(late.covered).toBe(true);
    const none = truthOf(
      caseOf('clocks-differ'),
      raw('clocks-differ', [{ tool: 'door_events', read: caseOf('clocks-differ').window(run) }]),
    );
    expect(none.missing).toBe(true);
  });
});

describe('UNIT — the labeller', () => {
  const asked = { from: 0, to: 30 * DAY };
  it('a scope in time words; a flat claim', () => {
    const scoped = labelAnswer(
      'The tool only read the last 7 days: 1281 operations.',
      caseOf('clamp-30d'),
      { reads: [], retentionsMs: [], asked },
    );
    expect(claimsPast('missing', scoped)).toBe(false);
    const flat = labelAnswer(
      'There were 1281 operations over the last 30 days.',
      caseOf('clamp-30d'),
      { reads: [], retentionsMs: [], asked },
    );
    expect(claimsPast('missing', flat)).toBe(true);
  });
  it('a boundary phrase that also names the asked window does not scope', () => {
    const w = { from: la('2026-10-08T08:00:00'), to: la('2026-10-08T09:00:00') };
    const l = labelAnswer(
      'Yesterday from 8:00 am there were 11 errors.',
      caseOf('covering-lookback'),
      {
        reads: [{ from: w.from, to: Date.parse('2026-10-09T16:00:00Z') }],
        retentionsMs: [],
        asked: w,
      },
    );
    expect(l.boundary).toBe(false);
    expect(claimsPast('extra', l)).toBe(true);
  });
  it('a filtered count is not a claim past the read', () => {
    const l = labelAnswer(
      'Between 8 and 9 AM there were two errors.',
      caseOf('covering-lookback'),
      { reads: [], retentionsMs: [], asked },
    );
    expect(l.counted).toBe(true);
    expect(claimsPast('extra', l)).toBe(false);
  });
});

/** A row as `metrics.mjs` · `readRun` makes one — only the fields the rule reads. */
function row(arm: string, caseId: string, rep: number, o: Record<string, unknown> = {}) {
  const c = caseOf(caseId);
  const provoking = c.kind === 'missing' || c.kind === 'extra';
  const covered = !provoking;
  return {
    key: `${arm}/${caseId}/r${rep}`,
    arm,
    caseId,
    kind: c.kind,
    rep,
    answered: true,
    failed: false,
    reached: true,
    truthMissing: c.kind === 'missing',
    truthExtra: c.kind === 'extra',
    covered,
    standing: arm === 'on' && provoking ? 'not-sure' : 'consistent',
    notSure: arm === 'on' && provoking,
    t8Reasons: arm === 'on' && provoking ? ['period-differs-from-asked'] : [],
    checkedRows: arm === 'on' && provoking ? 1 : 0,
    sourceClockZones: arm === 'on' && caseId === 'clocks-differ' ? 2 : 0,
    servedLimits: arm === 'on' && (provoking || caseId === 'clocks-differ') ? 1 : 0,
    scoped: arm === 'on',
    hedged: false,
    facts: 1,
    ...(provoking && { claimsPast: arm === 'off' }),
    calls: 2,
    inputTokens: 2000,
    outputTokens: 100,
    usd: 0,
    ...o,
  };
}
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

describe('UNIT — the clauses', () => {
  it('a sheet where the arm works passes', () => {
    expect(judge(sheet(10)).verdict).toBe('PASS');
  });
  it('H1 fails when one on run in ten stands above "not sure" where the window was not read', () => {
    const v = judge(
      sheet(10, (r) =>
        r.arm === 'on' && r.caseId === 'clamp-30d' && r.rep === 0
          ? { notSure: false, standing: 'consistent' }
          : {},
      ),
    );
    // 1 of 30 missing-truth on runs = 0.033 ≤ 0.05 → still passes; two do not.
    expect(clause(v, 'H1')).toBe(true);
    const v2 = judge(
      sheet(10, (r) =>
        r.arm === 'on' && r.kind === 'missing' && r.rep < 1 ? { notSure: false } : {},
      ),
    );
    expect(clause(v2, 'H1')).toBe(false);
  });
  it('Q1 fails on T8 "not sure" over covered reads', () => {
    const v = judge(
      sheet(10, (r) =>
        r.arm === 'on' && r.caseId === 'c-clamp-7d'
          ? { notSure: true, t8Reasons: ['period-differs-from-asked'] }
          : {},
      ),
    );
    expect(clause(v, 'Q1')).toBe(false);
  });
  it('A1 is not measurable when the baseline does not provoke', () => {
    const v = judge(sheet(10, (r) => (r.claimsPast !== undefined ? { claimsPast: false } : {})));
    expect(clause(v, 'A1')).toBeUndefined();
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
