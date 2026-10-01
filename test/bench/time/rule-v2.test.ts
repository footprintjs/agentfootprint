/**
 * The REGISTERED RULE `time-rule-t6b-v2` (`bench/time/RULE-v2.md`) and its transcription
 * (`bench/time/rule-v2.mjs`).
 *
 * Test types:
 *   - UNIT     — `steeringOf` takes off only the opening note and the clock sentence; T2a fails on
 *                one control ask, reading row or steering part, and PASSES on clock-only lines
 *                (where v1's T2 fails); T7 fails on one misread answer after a clock-only line,
 *                never on a refusal ("I apologize, but…"), and is not measurable with no such run;
 *                T2b follows T5 and T7;
 *   - IDENTITY — every clause v2 keeps is v1's own result, byte for byte;
 *   - DRIFT    — every margin in RULE-v2.md's table equals `MARGINS`; the kept margins equal v1's.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { CASES } from '../../../bench/time/cases.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { MARGINS as V1, judge as judgeV1 } from '../../../bench/time/rule.mjs';
import {
  MARGINS,
  judge,
  steeringOf,
  v2RowOf,
  // @ts-expect-error — a plain .mjs bench module, no types
} from '../../../bench/time/rule-v2.mjs';

const RULE_MD = readFileSync(
  join(__dirname, '..', '..', '..', 'bench', 'time', 'RULE-v2.md'),
  'utf8',
);

const OPEN =
  '[A note from the library that runs the tools — not from the person, and not a correction from them: when you answer, answer the person directly, as you would from the tool results alone.]';
const CLOCK = "This turn's time: Friday 2026-10-09 09:00 America/Los_Angeles (UTC-07:00).";
const CLOCK_LINE = `${OPEN} ${CLOCK}`;

/** A v2 row — the fields both rules read; by default every on-arm control served the clock only. */
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
    timeLines: 2,
    steeringLines: 0,
    clockOnlyLines: 2,
    misread: false,
    saidRows: 0,
    calls: 2,
    inputTokens: 2000,
    outputTokens: 100,
    usd: 0,
    ...o,
  };
}

/** Every case × both arms × `n` reps, with `patch` applied per row; off arm readable 8/15 wrong. */
function sheet(
  n: number,
  patch: (r: ReturnType<typeof row>) => Record<string, unknown> = () => ({}),
) {
  const rows = [];
  for (const c of CASES)
    for (const arm of ['off', 'on'])
      for (let i = 0; i < n; i += 1) {
        const r = row(arm, c.id, i);
        const gain = r.cell === 'readable' && arm === 'off' && i < Math.ceil(n / 2);
        rows.push({ ...r, ...(gain && { right: false }), ...patch(r) });
      }
  return rows;
}

type Verdict = {
  verdict: string;
  clauses: { id: string; pass: boolean | undefined; detail: string }[];
};
const clause = (v: Verdict, id: string) => v.clauses.find((c) => c.id === id)!.pass;
const onControl = (r: { arm: string; cell: string }) => r.arm === 'on' && r.cell === 'control';

describe('UNIT — steeringOf: only the opening note and the clock sentence are not steering', () => {
  it('a clock-only line has nothing left — known zone and unknown zone', () => {
    expect(steeringOf(CLOCK_LINE)).toBe('');
    expect(
      steeringOf(
        `${OPEN} This turn's time: Friday 2026-10-09 15:40 UTC (the person's time zone is not known).`,
      ),
    ).toBe('');
  });

  it('any part after the clock is steering — control window, pending quote, limit', () => {
    for (const part of [
      "The window the person set in the app's time control is 2026-10-09 08:00–08:39 America/Los_Angeles (UTC-07:00). An answer built on it states that window.",
      'The window for “yesterday” is not settled yet: …',
      'The time the tools read is not the time asked about — …',
    ]) {
      expect(steeringOf(`${CLOCK_LINE} ${part}`)).toBe(part);
    }
  });

  it('a line with no clock sentence is steering whole (a build before G16)', () => {
    expect(steeringOf(`${OPEN} The window for “yesterday” is not settled yet.`)).toBe(
      'The window for “yesterday” is not settled yet.',
    );
  });

  it('v2RowOf counts steering and clock-only lines and reads the misread opening', () => {
    const raw = {
      key: 'on/c-504/r0',
      arm: 'on',
      caseId: 'c-504',
      rep: 0,
      now: '2026-10-09T16:00:00Z',
      answer: "You're right — here are the timeout lines.",
      readLog: [],
      asks: [],
      rows: [],
      requests: [
        { timeLine: CLOCK_LINE },
        { timeLine: `${CLOCK_LINE} The window for “x” is not settled yet.` },
        {},
      ],
      usage: { calls: 3, input: 100, output: 10, cacheRead: 0, cacheWrite: 0 },
      usd: 0,
    };
    expect(v2RowOf(raw)).toMatchObject({ steeringLines: 1, clockOnlyLines: 1, misread: true });
    expect(
      v2RowOf({ ...raw, answer: 'I apologize, but that date is in the future.' }).misread,
    ).toBe(false);
  });
});

describe('UNIT — the split clause', () => {
  it('clock-only lines on every control: v1 T2 FAILS by construction, v2 PASSES', () => {
    const rows = sheet(15);
    expect(clause(judgeV1(rows), 'T2')).toBe(false);
    const v = judge(rows) as Verdict;
    expect(clause(v, 'T2a')).toBe(true);
    expect(clause(v, 'T2b')).toBe(true);
    expect(clause(v, 'T7')).toBe(true);
    expect(v.verdict).toBe('PASS');
  });

  it('T2a fails on one control time ask, one reading row, or one steering part', () => {
    for (const o of [{ timeAsks: 1, asks: 1 }, { readingRows: 1 }, { steeringLines: 1 }]) {
      const rows = sheet(3, (r) => (onControl(r) && r.rep === 0 && r.caseId === 'c-node' ? o : {}));
      expect(clause(judge(rows), 'T2a')).toBe(false);
    }
  });

  it('T7 fails on one misread answer after a clock-only line, on either arm', () => {
    for (const arm of ['off', 'on']) {
      const rows = sheet(3, (r) =>
        r.cell === 'control' && r.arm === arm && r.rep === 0 ? { misread: true } : {},
      );
      expect(clause(judge(rows), 'T7')).toBe(false);
      expect(clause(judge(rows), 'T2b')).toBe(false);
    }
  });

  it('T7 does not count a misread after a STEERING line (T2a owns that run)', () => {
    const rows = sheet(3, (r) =>
      onControl(r) && r.rep === 0 ? { misread: true, steeringLines: 1 } : {},
    );
    const v = judge(rows) as Verdict;
    expect(clause(v, 'T7')).toBe(true);
    expect(clause(v, 'T2a')).toBe(false);
  });

  it('T7 is not measurable with no clock-only control run', () => {
    const rows = sheet(2, (r) => (r.cell === 'control' ? { clockOnlyLines: 0, timeLines: 0 } : {}));
    const v = judge(rows) as Verdict;
    expect(clause(v, 'T7')).toBeUndefined();
    expect(clause(v, 'T2b')).toBeUndefined();
    expect(v.verdict).toBe('NOT-MEASURABLE');
  });

  it('T2b follows T5: just past the token ceiling it fails with it', () => {
    const past = sheet(2, (r) =>
      r.arm === 'on' ? { inputTokens: 2000 * MARGINS.inputTokensRatio + 2 } : {},
    );
    expect(clause(judge(past), 'T5')).toBe(false);
    expect(clause(judge(past), 'T2b')).toBe(false);
  });
});

describe('IDENTITY — every clause v2 keeps is v1’s own', () => {
  it('T1, T3, T4, T5, T6, G1, G2 equal v1’s, in v1’s order, with T2a/T2b where T2 was and T7 after T6', () => {
    const rows = sheet(5, (r) =>
      r.caseId === 'yesterday' && r.arm === 'on' && r.rep === 1 ? { saidRows: 1 } : {},
    );
    const v1 = judgeV1(rows) as Verdict;
    const v2 = judge(rows) as Verdict;
    expect(v2.clauses.map((c) => c.id)).toEqual([
      'T1',
      'T2a',
      'T2b',
      'T3',
      'T4',
      'T5',
      'T6',
      'T7',
      'G1',
      'G2',
    ]);
    for (const id of ['T1', 'T3', 'T4', 'T5', 'T6', 'G1', 'G2']) {
      expect(v2.clauses.find((c) => c.id === id)).toEqual(v1.clauses.find((c) => c.id === id));
    }
    expect(() => judge(rows.filter((r) => r.arm === 'on'))).toThrow(/arms off and on/);
  });
});

describe('DRIFT — RULE-v2.md and MARGINS cannot part', () => {
  it('every margin in the table equals MARGINS', () => {
    const table = RULE_MD.slice(RULE_MD.indexOf('## Margins'));
    const found: Record<string, number> = {};
    for (const m of table.matchAll(/^\| `(\w+)` \| ([\d.]+) \|$/gm)) found[m[1]!] = Number(m[2]);
    expect(found).toEqual({ ...MARGINS });
  });

  it('the margins v2 keeps are v1’s; only T2’s line count was replaced', () => {
    const { controlSteeringLines, controlMisreads, ...kept } = MARGINS;
    const { controlTimeLines, ...v1Kept } = V1;
    expect(kept).toEqual(v1Kept);
    expect([controlSteeringLines, controlMisreads, controlTimeLines]).toEqual([0, 0, 0]);
  });
});
