/**
 * The REGISTERED RULE for honesty steps 3 and 4 (`bench/inputs/RULE.md`) and its transcription
 * (`bench/inputs/rule.mjs`).
 *
 * Test types:
 *   - UNIT  — Fisher's exact test against hand-computed tails; each gated clause passes AT its
 *             threshold and fails just past it; a clause with nothing to count is NOT-MEASURABLE,
 *             never a pass; the rule refuses to compare arms from different invocations; the
 *             hand-label bar;
 *   - DRIFT — the page and the code cannot part: every margin in RULE.md's table equals
 *             `MARGINS`, and the case ids RULE.md lists for each set are the ones the reader's
 *             sets select.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { CASES } from '../../../bench/inputs/cases.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { SETS, aggregate } from '../../../bench/inputs/metrics.mjs';
import {
  MARGINS,
  RULE_ID,
  fisherGreater,
  judgeStep3,
  judgeStep4,
  labelsClear,
  provocation,
  // @ts-expect-error — a plain .mjs bench module, no types
} from '../../../bench/inputs/rule.mjs';

const RULE_MD = readFileSync(
  join(__dirname, '..', '..', '..', 'bench', 'inputs', 'RULE.md'),
  'utf8',
);

/** A row as `metrics.mjs` · `readRun` makes one — only the fields the summaries read. */
function row(arm: string, caseId: string, o: Record<string, any> = {}) {
  const caseDef = CASES.find((c: any) => c.id === caseId);
  const cls = o.cls ?? (Object.keys(caseDef.stated).length > 0 ? 'person' : 'default-unchosen');
  const periodCall = {
    toolCallId: 'a',
    tool: 'search_logs',
    argument: 'window',
    origin: 'omitted',
    dispatched: true,
    ok: true,
    ranWith: '2h',
    cls,
    ...(o.meant !== undefined && { meant: o.meant }),
    ...(o.rowSource !== undefined && { row: { source: o.rowSource } }),
    ...(o.askedFor === true && { askedFor: true }),
  };
  return {
    key: `${arm}/${caseId}/r${o.rep ?? 0}`,
    arm,
    caseId,
    group: caseDef.group,
    rep: o.rep ?? 0,
    complete: true,
    toolCalls: { proposed: 1, dispatched: 1, refused: 0, failed: 0 },
    periodCalls: o.noCall ? [] : [periodCall],
    names: [],
    periodExpected: true,
    noPeriodCall: o.noCall === true,
    answer: {
      present: true,
      ranDurations: o.noCall ? [] : ['h2'],
      statedDurations: o.statesRan ? ['h2'] : [],
      statesRan: o.statesRan === true,
      statesOther: false,
      factsExpected: 2,
      factsFound: o.factsFound ?? 2,
      asksInProse: false,
    },
    standing: { standing: 'consistent', reasons: o.reasons ?? [] },
    argumentRows: { total: o.rowSource ? 1 : 0, bySource: {}, byAsked: {} },
    llm: { calls: o.calls ?? 2, input: o.input ?? 2000, output: 100, cacheRead: 0, cacheWrite: 0 },
    usd: 0,
    requestsDigest: 'x',
  };
}

/** `n` rows of one case for one arm, the first `k` built with `hit`, the rest with `miss`. */
function rows(arm: string, caseId: string, n: number, k: number, hit: object, miss: object = {}) {
  return Array.from({ length: n }, (_, i) => row(arm, caseId, { rep: i, ...(i < k ? hit : miss) }));
}

describe('UNIT — Fisher’s exact test, one-sided', () => {
  it('matches hand-computed hypergeometric tails', () => {
    // 0/10 against 10/10: the one table as extreme as the observed one, 1 / C(20, 10).
    expect(fisherGreater(0, 10, 10, 10)).toBeCloseTo(1 / 184756, 12);
    // 1/4 against 3/4: P(X ≥ 3) with K = 4, N = 8, n2 = 4 = (C(4,3)C(4,1) + C(4,4)C(4,0)) / C(8,4) = 17/70.
    expect(fisherGreater(1, 4, 3, 4)).toBeCloseTo(17 / 70, 12);
    // Equal proportions: far from significant.
    expect(fisherGreater(5, 10, 5, 10)).toBeGreaterThan(0.5);
    // A fall is never a significant rise.
    expect(fisherGreater(9, 10, 1, 10)).toBeGreaterThan(0.99);
    expect(fisherGreater(0, 0, 3, 5)).toBe(1);
  });
});

describe('UNIT — step 3', () => {
  const offArm = () => [
    ...rows('off', 'p1-checkout-errors', 10, 0, {}),
    ...rows('off', 'c1-exact-24h', 10, 0, {}),
  ];
  const passing = () => [
    ...offArm(),
    ...rows('assume', 'p1-checkout-errors', 10, 10, {
      rowSource: 'default',
      reasons: ['argument-assumed'],
    }),
    // S3-2 at its threshold: 9 of 10 stay the person's (off 10 of 10; 0.9 ≥ 1.0 − 0.1).
    ...rows('assume', 'c1-exact-24h', 10, 9, {}, { cls: 'contradicts' }),
  ];

  it('passes when every gated clause holds — each at its threshold', () => {
    const v = judgeStep3(aggregate(passing()));
    expect(v.rule).toBe(RULE_ID);
    expect(v.clauses.map((c: any) => [c.id, c.pass])).toEqual([
      ['S3-1a', true],
      ['S3-1b', true],
      ['S3-2', true],
      ['S3-3', true],
      ['S3-4', true],
    ]);
    expect(v.verdict).toBe('PASS');
  });

  it('fails when the ledger misses a default (S3-1a) or the standing does not name it (S3-1b)', () => {
    const rowsMissed = [
      ...offArm(),
      ...rows(
        'assume',
        'p1-checkout-errors',
        10,
        9,
        { rowSource: 'default', reasons: ['argument-assumed'] },
        { reasons: ['argument-assumed'] },
      ),
      ...rows('assume', 'c1-exact-24h', 10, 10, {}),
    ];
    const v = judgeStep3(aggregate(rowsMissed));
    expect(v.clauses.find((c: any) => c.id === 'S3-1a').pass).toBe(false);
    expect(v.verdict).toBe('FAIL');
    const unnamed = [
      ...offArm(),
      ...rows(
        'assume',
        'p1-checkout-errors',
        10,
        7,
        { rowSource: 'default', reasons: ['argument-assumed'] },
        { rowSource: 'default' },
      ),
      ...rows('assume', 'c1-exact-24h', 10, 10, {}),
    ];
    expect(judgeStep3(aggregate(unnamed)).clauses.find((c: any) => c.id === 'S3-1b').pass).toBe(
      false,
    );
  });

  it('fails when the person’s stated periods fall past the margin (S3-2)', () => {
    const r = [
      ...offArm(),
      ...rows('assume', 'p1-checkout-errors', 10, 10, {
        rowSource: 'default',
        reasons: ['argument-assumed'],
      }),
      ...rows('assume', 'c1-exact-24h', 10, 8, {}, { cls: 'contradicts' }),
    ];
    const v = judgeStep3(aggregate(r));
    expect(v.clauses.find((c: any) => c.id === 'S3-2').pass).toBe(false);
    expect(v.verdict).toBe('FAIL');
  });

  it('fails when facts fall (S3-3) or the overhead passes its ceiling (S3-4)', () => {
    const facts = passing().map((x) =>
      x.arm === 'assume' ? { ...x, answer: { ...x.answer, factsFound: 1 } } : x,
    );
    expect(judgeStep3(aggregate(facts)).clauses.find((c: any) => c.id === 'S3-3').pass).toBe(false);
    const tokensUp = passing().map((x) =>
      x.arm === 'assume' ? { ...x, llm: { ...x.llm, input: 2400 } } : x,
    );
    expect(judgeStep3(aggregate(tokensUp)).clauses.find((c: any) => c.id === 'S3-4').pass).toBe(
      false,
    );
    const callsUp = passing().map((x) =>
      x.arm === 'assume' ? { ...x, llm: { ...x.llm, calls: 3, input: 3000 } } : x,
    );
    expect(judgeStep3(aggregate(callsUp)).clauses.find((c: any) => c.id === 'S3-4').pass).toBe(
      false,
    );
  });

  it('a clause with nothing to count is NOT-MEASURABLE, never a pass', () => {
    const r = [
      ...offArm(),
      ...rows('assume', 'p1-checkout-errors', 10, 10, {
        cls: 'model-chosen',
        reasons: ['argument-unverified'],
      }),
      ...rows('assume', 'c1-exact-24h', 10, 10, {}),
    ];
    const v = judgeStep3(aggregate(r));
    expect(v.clauses.find((c: any) => c.id === 'S3-1a').pass).toBeUndefined();
    expect(v.verdict).toBe('NOT-MEASURABLE');
  });

  it('refuses to compare arms that did not run in one invocation', () => {
    expect(() => judgeStep3(aggregate(offArm()))).toThrow(/compares arms 'off' and 'assume'/);
  });

  it('reports the provocation and allows the window claim only past the rise, the test AND the labels', () => {
    const r = [
      ...offArm(),
      ...rows('assume', 'p1-checkout-errors', 10, 10, {
        rowSource: 'default',
        reasons: ['argument-assumed'],
        statesRan: true,
      }),
      ...rows('assume', 'c1-exact-24h', 10, 10, {}),
    ];
    const a = aggregate(r);
    expect(provocation(a)).toMatchObject({ periodCalls: 10, defaultUnchosen: 10, rate: 1 });
    const unlabelled = judgeStep3(a);
    expect(unlabelled.reported['R3-b']).toMatchObject({ rise: 1, claimAllowed: false });
    expect(unlabelled.reported['R3-b'].fisherP).toBeLessThan(0.001);
    const labelled = judgeStep3(a, { labelled: 40, agree: 38, skipped: 0, agreement: 0.95 });
    expect(labelled.reported['R3-b'].claimAllowed).toBe(true);
    const poor = judgeStep3(a, { labelled: 40, agree: 30, skipped: 0, agreement: 0.75 });
    expect(poor.reported['R3-b'].claimAllowed).toBe(false);
  });
});

describe('UNIT — step 4', () => {
  const offArm = () => [
    ...rows(
      'off',
      'p1-checkout-errors',
      20,
      1,
      { meant: true, cls: 'model-chosen' },
      { meant: false },
    ),
    ...rows('off', 'c1-exact-24h', 10, 0, {}),
  ];

  it('passes when the person’s period runs and needless asks stay at the ceiling', () => {
    const r = [
      ...offArm(),
      ...rows(
        'ask',
        'p1-checkout-errors',
        20,
        18,
        { meant: true, cls: 'model-chosen', askedFor: true },
        { meant: false },
      ),
      ...rows('ask', 'c1-exact-24h', 10, 1, { askedFor: true }),
    ];
    const v = judgeStep4(aggregate(r));
    expect(v.clauses.map((c: any) => [c.id, c.pass])).toEqual([
      ['S4-1', true],
      ['S4-2', true],
      ['S4-3', true],
      ['S4-4', true],
    ]);
    expect(v.verdict).toBe('PASS');
    expect(v.reported['R4-a']).toEqual({
      says: 'P1 runs in which the library asked',
      off: { asked: 0, of: 20 },
      armed: { asked: 18, of: 20 },
    });
  });

  it('fails on needless asks past the ceiling (S4-2), and on a rise short of the margin (S4-1)', () => {
    const needless = [
      ...offArm(),
      ...rows(
        'ask',
        'p1-checkout-errors',
        20,
        18,
        { meant: true, cls: 'model-chosen', askedFor: true },
        { meant: false },
      ),
      ...rows('ask', 'c1-exact-24h', 10, 2, { askedFor: true }),
    ];
    expect(judgeStep4(aggregate(needless)).clauses.find((c: any) => c.id === 'S4-2').pass).toBe(
      false,
    );
    const small = [
      ...offArm(),
      ...rows(
        'ask',
        'p1-checkout-errors',
        20,
        6,
        { meant: true, cls: 'model-chosen' },
        { meant: false },
      ),
      ...rows('ask', 'c1-exact-24h', 10, 0, {}),
    ];
    const v = judgeStep4(aggregate(small));
    expect(v.clauses.find((c: any) => c.id === 'S4-1').pass).toBe(false);
    expect(v.verdict).toBe('FAIL');
  });
});

describe('UNIT — the hand-label bar', () => {
  it('needs enough labels and enough agreement', () => {
    expect(labelsClear(undefined)).toBe(false);
    expect(labelsClear({ labelled: 0, agree: 0, skipped: 0, agreement: undefined })).toBe(false);
    expect(labelsClear({ labelled: 40, agree: 36, skipped: 12, agreement: 0.9 })).toBe(true);
    expect(labelsClear({ labelled: 39, agree: 39, skipped: 1, agreement: 1 })).toBe(false);
    // A smaller sheet, every row labelled.
    expect(labelsClear({ labelled: 12, agree: 12, skipped: 0, agreement: 1 })).toBe(true);
    expect(labelsClear({ labelled: 40, agree: 35, skipped: 0, agreement: 0.875 })).toBe(false);
  });
});

describe('DRIFT — RULE.md and the code say the same thing', () => {
  it('every margin in the page’s table is the one the code compares against', () => {
    const section = RULE_MD.split('## Margins')[1]!.split('\n## ')[0]!;
    const table: Record<string, number> = {};
    for (const m of section.matchAll(/^\| `(\w+)` \| ([\d.]+) \|$/gm)) table[m[1]!] = Number(m[2]);
    expect(table).toEqual({ ...MARGINS });
  });

  it('the page’s sets list exactly the cases the reader’s sets select', () => {
    const idsIn = (label: string) => {
      const line = RULE_MD.split('\n').find((l) => l.startsWith(`| **${label}**`))!;
      return [...line.split('|')[2]!.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]).sort();
    };
    const selected = (pick: (r: any) => boolean) =>
      CASES.filter((c: any) => pick({ group: c.group, caseId: c.id }))
        .map((c: any) => c.id)
        .sort();
    expect(idsIn('unstated')).toEqual(selected(SETS.unstated));
    expect(idsIn('stated')).toEqual(selected(SETS.stated));
  });

  it('the page names the rule the code reports', () => {
    expect(RULE_ID.startsWith('inputs-rule-1')).toBe(true);
    expect(RULE_MD).toMatch(/Rule id: `inputs-rule-1`/);
  });
});
