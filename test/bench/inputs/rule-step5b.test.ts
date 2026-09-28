/**
 * STEP 5, SECOND REGISTRATION of the inputs bench — the sources-only door
 * (`bench/inputs/RULE-step5b.md`): `rule.mjs` · `judgeStep5b` and the `full-b` arm through the
 * harness on the scripted mock.
 *
 * Test types:
 *   - UNIT        — S5-1 … S5-8 are step 5's own clauses, value for value, over the same rows;
 *                   the re-based S5-9 and the added S5-10 hold at their thresholds and fail just
 *                   past them; nothing to count is NOT-MEASURABLE; the rule refuses a run
 *                   without the `full-b` arm;
 *   - INTEGRATION — `full-b` on the mock: the record says sources are armed, only the ruled tools
 *                   carry `_findings`, and it holds `from` alone; a quote holding a declared
 *                   phrase files `said` with no ask; the served decoration is measured without a
 *                   model, with the cost projection's token counts;
 *   - DRIFT       — RULE-step5b.md's margins equal `STEP5B_MARGINS`, and every carried margin
 *                   equals step 5's.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { ALL_ARMS, ARMS, caseById, sheetProblems } from '../../../bench/inputs/cases.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { measureServedB, runCase } from '../../../bench/inputs/harness.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { aggregate, readRun } from '../../../bench/inputs/metrics.mjs';
import {
  STEP5B_MARGINS,
  STEP5_MARGINS,
  judgeStep5,
  judgeStep5b,
  // @ts-expect-error — a plain .mjs bench module, no types
} from '../../../bench/inputs/rule.mjs';
import { doors } from './doors.js';

const MINUTE = 60_000;
const RULE_MD = readFileSync(
  join(__dirname, '..', '..', '..', 'bench', 'inputs', 'RULE-step5b.md'),
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
    llm: { calls: 2, input: 2000, output: 100, cacheRead: 0, cacheWrite: 0 },
    usd: 0,
    requestsDigest: 'x',
  };
}

const SAID = { source: 'said', claimed: 'user', matched: 'phrase' };

/** One arm: `k` of 10 stated calls said with no ask; P1 asked and answered; `l` of 10 L5 calls said. */
function arm(name: string, k: number, l = 0) {
  const armed = name !== 'off';
  const out = [];
  for (let i = 0; i < 10; i += 1) {
    out.push(
      row(name, 'c1-exact-24h', {
        rep: i,
        ...(armed && (i < k ? { row: SAID } : { row: { source: 'answered' }, askedFor: true })),
      }),
    );
    out.push(
      row(name, 'p1-checkout-errors', {
        rep: i,
        meant: armed,
        ...(armed && { row: { source: 'answered' }, askedFor: true }),
      }),
    );
    out.push(
      row(name, 'l5-other-sense', {
        rep: i,
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
const judge = (rows: any[], served: any = SERVED()) =>
  judgeStep5b(aggregate(rows, { sources: true }), served);
const clauseOf = (v: any, id: string) => v.clauses.find((c: any) => c.id === id);

describe('UNIT — the second registration', () => {
  it('S5-1 … S5-8 are step 5’s own clauses over the same rows, value for value', () => {
    for (const k of [7, 8, 9, 10]) {
      const b = judge([...arm('off', 0), ...arm('full-b', k)]);
      const relabelled = [...arm('off', 0), ...arm('full-b', k)].map((r) =>
        r.arm === 'full-b' ? { ...r, arm: 'full' } : r,
      );
      const v1 = judgeStep5(aggregate(relabelled, { sources: true }), undefined);
      const carried = (v: any) => v.clauses.filter((c: any) => !['S5-9', 'S5-10'].includes(c.id));
      expect(carried(b)).toEqual(carried(v1));
      expect(carried(b).map((c: any) => c.id)).toEqual([
        'S5-1',
        'S5-2',
        'S5-3',
        'S5-4',
        'S5-5',
        'S5-6',
        'S5-7',
        'S5-8',
      ]);
    }
  });

  it('S5-9 is re-based on the steps 3–4 agent: holds at 1.15, fails past it, NOT-MEASURABLE unmeasured', () => {
    expect(
      clauseOf(judge([...arm('off', 0), ...arm('full-b', 10)], SERVED(1150)), 'S5-9').pass,
    ).toBe(true);
    const past = clauseOf(judge([...arm('off', 0), ...arm('full-b', 10)], SERVED(1151)), 'S5-9');
    expect(past.pass).toBe(false);
    expect(past.value).toMatchObject({ ruled: 1000, fullB: 1151 });
    const none = judgeStep5b(
      aggregate([...arm('off', 0), ...arm('full-b', 10)], { sources: true }),
      undefined,
    );
    expect(clauseOf(none, 'S5-9').pass).toBeUndefined();
    expect(none.verdict).toBe('NOT-MEASURABLE');
  });

  it('S5-10: L5 calls filed as the person’s words hold at 0.10 and fail past it; no L5 call is NOT-MEASURABLE', () => {
    const at = judge([...arm('off', 0), ...arm('full-b', 10, 1)]);
    expect(clauseOf(at, 'S5-10')).toMatchObject({
      pass: true,
      value: { filedAsPersons: 1, of: 10 },
    });
    expect(at.verdict).toBe('PASS');
    const past = judge([...arm('off', 0), ...arm('full-b', 10, 2)]);
    expect(clauseOf(past, 'S5-10').pass).toBe(false);
    expect(past.verdict).toBe('FAIL');
    const noLimit = judge(
      [...arm('off', 0), ...arm('full-b', 10)].filter((r) => r.caseId !== 'l5-other-sense'),
    );
    expect(clauseOf(noLimit, 'S5-10').pass).toBeUndefined();
  });

  it('refuses a run without the full-b arm; the arm is added beside the registered ones', () => {
    expect(() => judge(arm('off', 0))).toThrow(/arms 'off' and 'full-b'/);
    expect(ARMS).toEqual(['off', 'assume', 'ask', 'full']);
    expect(ALL_ARMS).toEqual(['off', 'assume', 'ask', 'full', 'full-b']);
    expect(sheetProblems()).toEqual([]);
  });
});

describe('INTEGRATION — the full-b arm on the scripted mock', () => {
  it(
    'arms sources without the ledger: only ruled tools carry _findings, with from alone; a declared phrase files said with no ask',
    async () => {
      const caseDef = caseById('s5-words-io-hour');
      const rep = caseDef.mock.findIndex((v: any) => v.label === 'quotes the words');
      const served: any[] = [];
      const spy = {
        ...doors,
        mock: (o: any) =>
          doors.mock({
            ...o,
            respond: (req: any) => {
              served.push(req.tools);
              return o.respond(req);
            },
          }),
      };
      const raw = await runCase({
        doors: spy,
        caseDef,
        arm: 'full-b',
        rep,
        provider: 'mock',
        model: 'mock',
      });
      // (+ `results: true` since the merge with honesty step 7b: the bench's tools declare a ToolPeriod.)
      expect(raw.recording.snapshot.sharedState.honestyLayers).toEqual({
        inputs: true,
        argumentSources: true,
        results: true,
      });
      const tools = served[0];
      const reserved = (name: string) =>
        tools.find((t: any) => t.name === name).inputSchema.properties._findings;
      expect(Object.keys(reserved('io_profile').properties)).toEqual(['from']);
      expect(reserved('io_profile').required).toEqual(['from']);
      expect(reserved('list_hosts')).toBeUndefined();
      const r = readRun(raw);
      expect(r.periodCalls[0].row).toMatchObject({
        source: 'said',
        claimed: 'user',
        matched: 'phrase',
      });
      expect(r.periodCalls[0].askedFor).toBeUndefined();
    },
    MINUTE,
  );

  it(
    'the served decoration and the projection’s token counts are measured without a model',
    async () => {
      const s = await measureServedB(doors, [caseById('c1-exact-24h')]);
      expect(s.fullB.perRequest).toBeGreaterThan(s.ruled.perRequest);
      expect(s.ruled.perRequest).toBeGreaterThan(s.off.perRequest);
      expect(s.off.requests).toBe(s.fullB.requests);
      for (const a of ['off', 'ruled', 'fullB']) {
        expect(s[a].projection.runs).toBe(2);
        expect(s[a].projection.usdPerRun).toBeGreaterThan(0);
      }
    },
    MINUTE,
  );
});

describe('DRIFT — RULE-step5b.md and the code say the same thing', () => {
  it('every margin in the page’s table is the one the code compares against; carried margins are step 5’s', () => {
    const section = RULE_MD.split('## Margins')[1]!;
    const table: Record<string, number> = {};
    for (const m of section.matchAll(/^\| `(\w+)` \| ([\d.]+) \|$/gm)) table[m[1]!] = Number(m[2]);
    expect(table).toEqual({ ...STEP5B_MARGINS });
    for (const [k, v] of Object.entries(STEP5_MARGINS)) expect(STEP5B_MARGINS[k]).toBe(v);
  });
});
