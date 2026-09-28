/**
 * STEP 5 of the inputs bench — declared sources (`bench/inputs/RULE-step5.md`): the rule as code
 * (`rule.mjs` · `judgeStep5`), step 5's reader (`metrics.mjs` · `summarizeSources`), its cases
 * (`cases.mjs` · `STEP5_CASES`) and the `full` arm through the harness on the scripted mock.
 *
 * Test types:
 *   - UNIT        — each gated clause passes AT its threshold and fails just past it; a clause
 *                   with nothing to count is NOT-MEASURABLE; the rule refuses aggregates without
 *                   the step-5 reader; the sheet's step-5 premises catch a bad case;
 *   - INTEGRATION — the `full` arm on the mock: a quote holding a declared phrase files `said`
 *                   with no ask; a fabricated quote files `quote-not-found` and is asked; the
 *                   same script under `off` sends no `_findings`; the served decoration is
 *                   measured without a model;
 *   - DRIFT       — RULE-step5.md's margins equal `STEP5_MARGINS`, and its gated sets list
 *                   exactly the cases the reader selects.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import {
  ALL_CASES,
  CASES,
  STEP5_CASES,
  caseById,
  step5Problems,
} from '../../../bench/inputs/cases.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { measureServed, runCase } from '../../../bench/inputs/harness.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { STEP5_SETS, aggregate, readRun } from '../../../bench/inputs/metrics.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { STEP5_MARGINS, judgeStep5 } from '../../../bench/inputs/rule.mjs';
import { doors } from './doors.js';

const MINUTE = 60_000;
const RULE_MD = readFileSync(
  join(__dirname, '..', '..', '..', 'bench', 'inputs', 'RULE-step5.md'),
  'utf8',
);

/** A row as `readRun` makes one — only the fields the step-5 summaries read. */
function row(arm: string, caseId: string, o: Record<string, any> = {}) {
  const caseDef = caseById(caseId);
  const stated = Object.keys(caseDef.stated).length > 0;
  const cls = o.cls ?? (stated ? 'person' : 'model-chosen');
  const periodCall = {
    toolCallId: 'a',
    tool: 'search_logs',
    argument: 'window',
    origin: 'sent',
    dispatched: true,
    ok: true,
    ranWith: '24h',
    cls,
    ...(o.meant !== undefined && { meant: o.meant }),
    ...(o.row !== undefined && { row: o.row }),
    ...(o.verdict !== undefined && { verdict: o.verdict }),
    ...(o.askedFor === true && { askedFor: true, askedAs: o.askedAs ?? ['unverified'] }),
  };
  return {
    key: `${arm}/${caseId}/r${o.rep ?? 0}`,
    arm,
    caseId,
    group: caseDef.group,
    rep: o.rep ?? 0,
    complete: true,
    toolCalls: { proposed: 1, dispatched: 1, refused: 0, failed: 0 },
    periodCalls: [periodCall],
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
      factsFound: o.factsFound ?? 2,
      asksInProse: false,
    },
    standing: { standing: 'consistent', reasons: o.reasons ?? [] },
    argumentRows: { total: 1, bySource: {}, byAsked: {} },
    llm: { calls: 2, input: o.input ?? 2000, output: 100, cacheRead: 0, cacheWrite: 0 },
    usd: 0,
    requestsDigest: 'x',
  };
}

const SAID = { source: 'said', claimed: 'user', matched: 'phrase' };
const SERVED_OK = {
  off: { perRequest: 100 },
  findings: { perRequest: 1000 },
  full: { perRequest: 1100 },
};

/** One arm's rows: `k` of `n` stated runs said with no ask, P1 and fake runs asked and answered. */
function arm(name: string, k: number, n = 10, o: Record<string, any> = {}) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const hit = i < k;
    out.push(
      row(name, 'c1-exact-24h', {
        rep: i,
        row: name === 'off' ? undefined : hit ? SAID : { source: 'answered', proposed: true },
        ...(name !== 'off' &&
          !hit && { askedFor: true, verdict: { claimed: 'none', asked: 'unverified' } }),
        ...o.stated,
      }),
    );
    out.push(
      row(name, 'p1-checkout-errors', {
        rep: i,
        meant: name !== 'off',
        ...(name !== 'off' && {
          row: { source: 'answered' },
          askedFor: true,
          askedAs: ['missing'],
        }),
        ...o.unstated,
      }),
    );
    out.push(
      row(name, 'f5-all-week-right-now', {
        rep: i,
        ...(name !== 'off' && { row: { source: 'answered' }, askedFor: true }),
        ...o.fake,
      }),
    );
  }
  return out;
}

const judge = (rows: any[], served: any = SERVED_OK) =>
  judgeStep5(aggregate(rows, { sources: true }), served);
const clauseOf = (v: any, id: string) => v.clauses.find((c: any) => c.id === id);

describe('UNIT — step 5 clauses', () => {
  it('S5-1 and S5-5 pass at their thresholds and fail just past them', () => {
    // 9 of 10 stated calls said with no ask: S5-1 0.9 ≥ 0.8; S5-5 1/10 asked ≤ 0.1.
    let v = judge([...arm('off', 0), ...arm('full', 9)]);
    expect(clauseOf(v, 'S5-1').pass).toBe(true);
    expect(clauseOf(v, 'S5-5').pass).toBe(true);
    // 8 of 10: S5-1 0.8 holds AT the threshold; S5-5 2/10 fails past 0.1.
    v = judge([...arm('off', 0), ...arm('full', 8)]);
    expect(clauseOf(v, 'S5-1').pass).toBe(true);
    expect(clauseOf(v, 'S5-5').pass).toBe(false);
    // 7 of 10: S5-1 fails.
    v = judge([...arm('off', 0), ...arm('full', 7)]);
    expect(clauseOf(v, 'S5-1').pass).toBe(false);
  });

  it('S5-1 counts a said value that was ALSO asked as not verified', () => {
    const v = judge([...arm('off', 0), ...arm('full', 10, 10, { stated: { askedFor: true } })]);
    expect(clauseOf(v, 'S5-1').value.saidNoAsk).toBe(0);
  });

  it('S5-2 reads the standing: an argument reason on a stated run counts against it', () => {
    const v = judge([
      ...arm('off', 0),
      ...arm('full', 10, 10, { stated: { reasons: ['argument-read'] } }),
    ]);
    expect(clauseOf(v, 'S5-2').pass).toBe(false);
    expect(clauseOf(judge([...arm('off', 0), ...arm('full', 10)]), 'S5-2').pass).toBe(true);
  });

  it('S5-4: one period call filed as the person where none was given fails the clause', () => {
    const ok = judge([...arm('off', 0), ...arm('full', 10)]);
    expect(clauseOf(ok, 'S5-4').pass).toBe(true);
    const faked = judge([
      ...arm('off', 0),
      ...arm('full', 10).map((r: any) =>
        r.caseId === 'f5-all-week-right-now' && r.rep === 3
          ? { ...r, periodCalls: [{ ...r.periodCalls[0], row: SAID }] }
          : r,
      ),
    ]);
    expect(clauseOf(faked, 'S5-4').pass).toBe(false);
    expect(clauseOf(faked, 'S5-4').value.filedAsPersons).toBe(1);
    // A READING is not a verification.
    const reading = judge([
      ...arm('off', 0),
      ...arm('full', 10, 10, { fake: { row: { ...SAID, reading: true } } }),
    ]);
    expect(clauseOf(reading, 'S5-4').pass).toBe(true);
  });

  it('S5-8 and S5-9 hold at 1.15 and fail past it; S5-9 without a measurement is NOT-MEASURABLE', () => {
    const at = judge(
      [
        ...arm('off', 10, 10, { stated: { input: 2000 } }),
        ...arm('full', 10, 10, { stated: { input: 2000 } }),
      ],
      {
        off: { perRequest: 1 },
        findings: { perRequest: 1000 },
        full: { perRequest: 1150 },
      },
    );
    expect(clauseOf(at, 'S5-9').pass).toBe(true);
    const past = judge([...arm('off', 10), ...arm('full', 10)], {
      off: { perRequest: 1 },
      findings: { perRequest: 1000 },
      full: { perRequest: 1151 },
    });
    expect(clauseOf(past, 'S5-9').pass).toBe(false);
    const dear = judge([
      ...arm('off', 0),
      ...arm('full', 10, 10, {
        stated: { input: 20000 },
        unstated: { input: 20000 },
        fake: { input: 20000 },
      }),
    ]);
    expect(clauseOf(dear, 'S5-8').pass).toBe(false);
    const none = judgeStep5(
      aggregate([...arm('off', 0), ...arm('full', 10)], { sources: true }),
      undefined,
    );
    expect(clauseOf(none, 'S5-9').pass).toBeUndefined();
    expect(none.verdict).toBe('NOT-MEASURABLE');
  });

  it('S5-8 counts cache reads and writes as input: a cached prompt is not a cheap one', () => {
    const cached = (rows: any[]) =>
      rows.map((r: any) =>
        r.arm === 'full'
          ? { ...r, llm: { ...r.llm, input: 200, cacheRead: 9000, cacheWrite: 0 } }
          : r,
      );
    const v = judge(cached([...arm('off', 0), ...arm('full', 10)]));
    expect(clauseOf(v, 'S5-8').pass).toBe(false);
    expect(clauseOf(v, 'S5-8').value.inputPerCall.armed).toBe(4600);
    expect(clauseOf(v, 'S5-8').value.uncachedInputPerCall.armed).toBe(100);
  });

  it('every clause passing gives PASS; the rule refuses aggregates without the step-5 reader', () => {
    expect(judge([...arm('off', 0), ...arm('full', 10)]).verdict).toBe('PASS');
    expect(() => judgeStep5(aggregate([...arm('off', 0), ...arm('full', 10)]), SERVED_OK)).toThrow(
      /step-5 reader/,
    );
    expect(() => judge(arm('off', 0))).toThrow(/arms 'off' and 'full'/);
  });
});

describe('UNIT — the sheet’s step-5 premises', () => {
  it('the sheet as written is sound; a bait holding a declared phrase, or a stated case its words do not hold, is caught', () => {
    expect(step5Problems()).toEqual([]);
    expect(ALL_CASES.length).toBe(CASES.length + STEP5_CASES.length);
    const bait = STEP5_CASES.find((c: any) => c.id === 'f5-all-week-right-now');
    expect(
      step5Problems([{ ...bait, turns: ['Checkout has been slow over the past week. Errors?'] }]),
    ).toEqual([
      expect.stringMatching(/f5-all-week-right-now: fake-quote bait holds 7d /),
      expect.stringMatching(/f5-all-week-right-now: fake-quote bait holds -7d /),
    ]);
    expect(step5Problems([{ ...bait, turns: ['Any errors in the last 24h?'] }])).toEqual([
      expect.stringMatching(/holds 24h /),
      expect.stringMatching(/holds -24h /),
    ]);
    const stated = STEP5_CASES.find((c: any) => c.id === 's5-words-io-hour');
    expect(step5Problems([{ ...stated, turns: ['Disk I/O on srv-9051 lately?'] }])).toEqual([
      expect.stringMatching(/stated io_profile\.time_range = 1h, but no turn holds it/),
    ]);
  });
});

describe('INTEGRATION — the full arm on the scripted mock', () => {
  async function run(caseId: string, label: string, armName: string) {
    const caseDef = caseById(caseId);
    const rep = caseDef.mock.findIndex((v: any) => v.label === label);
    expect(rep).toBeGreaterThanOrEqual(0);
    const raw = await runCase({
      doors,
      caseDef,
      arm: armName,
      rep,
      provider: 'mock',
      model: 'mock',
    });
    return { raw, row: readRun(raw) };
  }

  it(
    'a quote holding a declared phrase files said by phrase, with no ask; the standing names no argument',
    async () => {
      const { raw, row: r } = await run('s5-words-io-hour', 'quotes the words', 'full');
      expect(raw.recording.snapshot.sharedState.honestyLayers).toEqual({
        inputs: true,
        argumentSources: true,
      });
      const c = r.periodCalls[0];
      expect(c.row).toMatchObject({ source: 'said', claimed: 'user', matched: 'phrase' });
      expect(c.askedFor).toBeUndefined();
      expect(r.standing.reasons.some((x: string) => x.startsWith('argument-'))).toBe(false);
    },
    MINUTE,
  );

  it(
    'a fabricated quote files quote-not-found, is asked, and runs with the person’s answer',
    async () => {
      const { raw, row: r } = await run('f5-all-week-right-now', 'fabricates a quote', 'full');
      const c = r.periodCalls[0];
      expect(c.verdict).toMatchObject({ claimed: 'user', failed: 'quote-not-found' });
      expect(c.askedAs).toEqual(['unverified']);
      expect(c.row).toMatchObject({ source: 'answered' });
      expect(c.ranWith).toBe('1h');
      expect(raw.turns[0].asks).toHaveLength(1);
    },
    MINUTE,
  );

  it(
    'the same script under off sends no _findings, and its row carries no step-5 key',
    async () => {
      const { raw, row: r } = await run('s5-words-io-hour', 'quotes the words', 'off');
      expect(raw.execLog[0].received).toEqual({ host: 'srv-9051', time_range: '1h' });
      expect(r.periodCalls[0].row).toBeUndefined();
      expect(r.argumentRows).toEqual({ total: 0, bySource: {}, byAsked: {} });
    },
    MINUTE,
  );

  it(
    'the served decoration is measured without a model: full > .findings() > off',
    async () => {
      const served = await measureServed(doors, [caseById('c1-exact-24h')]);
      expect(served.findings.perRequest).toBeGreaterThan(served.off.perRequest);
      expect(served.full.perRequest).toBeGreaterThan(served.findings.perRequest);
      expect(served.off.requests).toBe(served.full.requests);
    },
    MINUTE,
  );
});

describe('DRIFT — RULE-step5.md and the code say the same thing', () => {
  it('every margin in the page’s table is the one the code compares against', () => {
    const section = RULE_MD.split('## Margins')[1]!;
    const table: Record<string, number> = {};
    for (const m of section.matchAll(/^\| `(\w+)` \| ([\d.]+) \|$/gm)) table[m[1]!] = Number(m[2]);
    expect(table).toEqual({ ...STEP5_MARGINS });
  });

  it('the page’s gated sets list exactly the cases the reader selects', () => {
    const idsIn = (label: string) => {
      const line = RULE_MD.split('\n').find((l) => l.startsWith(`| **${label}**`))!;
      return [...line.split('|')[2]!.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]).sort();
    };
    const selected = (pick: (r: any) => boolean) =>
      ALL_CASES.filter((c: any) => pick({ group: c.group, caseId: c.id }))
        .map((c: any) => c.id)
        .sort();
    expect(idsIn('unstated')).toEqual(selected(STEP5_SETS.unstated));
    expect(idsIn('stated')).toEqual(selected(STEP5_SETS.stated));
    expect(idsIn('no period given')).toEqual(selected(STEP5_SETS.fake));
    expect(selected(STEP5_SETS.noPeriodGiven)).toEqual(
      [...selected(STEP5_SETS.unstated), ...selected(STEP5_SETS.fake)].sort(),
    );
  });
});
