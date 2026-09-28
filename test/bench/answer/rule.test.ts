/**
 * The REGISTERED RULE for honesty step 6 (`bench/answer/RULE.md`) and its transcription
 * (`bench/answer/rule.mjs`).
 *
 * Test types:
 *   - UNIT  — each gated clause passes AT its threshold and fails just past it; a clause with too
 *             little to count is NOT-MEASURABLE, never a pass; the verdict order (FAIL beats
 *             NOT-MEASURABLE beats PASS); the rule refuses aggregates without both arms;
 *   - DRIFT — the page and the code cannot part: every margin in RULE.md's table equals
 *             `MARGINS`, and the case ids RULE.md lists for each set are the sheet's.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { CASES } from '../../../bench/answer/cases.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { aggregate } from '../../../bench/answer/metrics.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { MARGINS, RULE_ID, judgeStep6, verdictOf } from '../../../bench/answer/rule.mjs';

const RULE_MD = readFileSync(
  join(__dirname, '..', '..', '..', 'bench', 'answer', 'RULE.md'),
  'utf8',
);

/** A row as `metrics.mjs` · `readRun` makes one — only the fields the summaries read. */
function row(arm: string, caseId: string, o: Record<string, any> = {}) {
  const c = CASES.find((x: any) => x.id === caseId);
  const standing = o.standing ?? (c.truth.vouch ? 'consistent' : 'not-sure');
  return {
    key: `${arm}/${caseId}/r${o.rep ?? 0}`,
    arm,
    caseId,
    set: c.set,
    kind: c.kind,
    vouch: c.truth.vouch,
    rep: o.rep ?? 0,
    outcome: o.outcome ?? 'answered',
    standing,
    reasons: [],
    flags: standing === 'not-sure' || standing === 'ask',
    supports: standing === 'consistent' || standing === 'known',
    equality:
      arm === 'off'
        ? { events: [0], readAfterIsAgentAssessment: true }
        : {
            events: [o.events ?? 1],
            eventIsTurnEnd: true,
            eventIsReadAfter: o.equal ?? true,
            eventIsAgentAssessment: true,
          },
    answerIsModelText: o.answerIsModelText ?? true,
    answerIsTurnEnd: true,
    lineAppended: false,
    words: {
      hedges: o.hedges ?? false,
      attributes: false,
      nonExistence: false,
      completeness: false,
      flat: false,
    },
    exceeds: false,
    uncarried: o.uncarried ?? [],
    facts: { expected: c.facts.length, found: o.factsFound ?? c.facts.length },
    calls: { dispatched: 1, failed: 0, tools: [] },
    grounded: 0,
    unsupported: 0,
    firstRequestDigest: o.first ?? `d-${caseId}`,
    requestsDigest: '',
    llm: { calls: o.calls ?? 2, input: o.input ?? 1000, output: 100, cacheRead: 0, cacheWrite: 0 },
    usd: 0,
  };
}

/** Both arms, `n` answers per case; `tweak(arm, caseId, i)` overrides a row's fields. */
function rows(
  n: number,
  tweak: (arm: string, id: string, i: number) => Record<string, any> = () => ({}),
) {
  const out: any[] = [];
  for (const arm of ['off', 'layer'])
    for (const c of CASES)
      for (let i = 0; i < n; i += 1) out.push(row(arm, c.id, { rep: i, ...tweak(arm, c.id, i) }));
  return out;
}

const judge = (rs: any[]) => judgeStep6(aggregate(rs));
const setOf = (id: string) => CASES.find((c: any) => c.id === id).set;

describe('UNIT — the step-6 clauses', () => {
  it('passes when every clause holds', () => {
    const v = judge(rows(4));
    expect(v.rule).toBe(RULE_ID);
    expect(
      Object.fromEntries(Object.entries(v.clauses).map(([k, c]: any) => [k, c.result])),
    ).toEqual({
      'A-1': 'PASS',
      'A-2': 'PASS',
      'A-3': 'PASS',
      'A-4': 'PASS',
      'A-5': 'PASS',
      'A-6': 'PASS',
      'A-7': 'PASS',
      'A-8': 'PASS',
    });
    expect(v.verdict).toBe('PASS');
    // the verbalised baseline reads sensitivity on the provoking set and specificity on the
    // controls, for BOTH arms
    const r2 = Object.entries(v.reported).find(([k]) => k.startsWith('R-2'))?.[1] as any;
    for (const arm of ['layer', 'off']) {
      expect(r2[arm].sensitivity.n, arm).toBe(20);
      expect(r2[arm].specificity.n, arm).toBe(20);
    }
  });

  it('A-1 passes at 0.80 and fails just under it; not-assessed does not count', () => {
    // 5 provoking cases × 4 = 20 answers; 4 misses → 0.80.
    let misses = 0;
    const at = judge(
      rows(4, (arm, id) =>
        arm === 'layer' && setOf(id) === 'provoking' && misses < 4
          ? ((misses += 1), { standing: 'not-assessed' })
          : {},
      ),
    );
    expect(at.clauses['A-1']).toMatchObject({ k: 16, n: 20, result: 'PASS' });
    misses = 0;
    const under = judge(
      rows(4, (arm, id) =>
        arm === 'layer' && setOf(id) === 'provoking' && misses < 5
          ? ((misses += 1), { standing: 'consistent' })
          : {},
      ),
    );
    expect(under.clauses['A-1']).toMatchObject({ k: 15, n: 20, result: 'FAIL' });
  });

  it('A-1 and A-2 are NOT-MEASURABLE under 20 answers, never a pass', () => {
    const v = judge(rows(3));
    expect(v.clauses['A-1'].result).toBe('NOT-MEASURABLE');
    expect(v.clauses['A-2'].result).toBe('NOT-MEASURABLE');
    expect(v.verdict).toBe('NOT-MEASURABLE');
  });

  it('A-2 reads the control answers inside the record; one outside it leaves the denominator', () => {
    let beyond = 0;
    const v = judge(
      rows(5, (arm, id) =>
        arm === 'layer' && setOf(id) === 'control' && beyond < 3
          ? ((beyond += 1), { standing: 'not-sure', uncarried: ['9921'] })
          : {},
      ),
    );
    expect(v.clauses['A-2']).toMatchObject({ k: 22, n: 22, result: 'PASS' });
    let wolves = 0;
    const cried = judge(
      rows(5, (arm, id) =>
        arm === 'layer' && setOf(id) === 'control' && wolves < 3
          ? ((wolves += 1), { standing: 'not-sure' })
          : {},
      ),
    );
    expect(cried.clauses['A-2']).toMatchObject({ k: 22, n: 25, result: 'FAIL' });
  });

  it('A-3 fails on one unequal run, on a second event, or on an event under off', () => {
    expect(
      judge(
        rows(4, (arm, id, i) =>
          arm === 'layer' && i === 0 && id === 'found-hosts' ? { equal: false } : {},
        ),
      ).clauses['A-3'].result,
    ).toBe('FAIL');
    expect(
      judge(
        rows(4, (arm, id, i) =>
          arm === 'layer' && i === 0 && id === 'found-hosts' ? { events: 2 } : {},
        ),
      ).clauses['A-3'].result,
    ).toBe('FAIL');
    const offFires = rows(4).map((r) =>
      r.arm === 'off' && r.rep === 0 ? { ...r, equality: { ...r.equality, events: [1] } } : r,
    );
    expect(judge(offFires).clauses['A-3'].result).toBe('FAIL');
  });

  it('A-4 fails when one case serves a different first request under the layer', () => {
    const v = judge(
      rows(4, (arm, id) => (arm === 'layer' && id === 'found-deploys' ? { first: 'other' } : {})),
    );
    expect(v.clauses['A-4']).toMatchObject({
      k: 11,
      n: 12,
      differing: ['found-deploys'],
      result: 'FAIL',
    });
  });

  it('A-5 fails when one answer is not the model text', () => {
    const v = judge(
      rows(4, (arm, id, i) =>
        arm === 'layer' && id === 'found-hosts' && i === 1 ? { answerIsModelText: false } : {},
      ),
    );
    expect(v.clauses['A-5'].result).toBe('FAIL');
  });

  it('A-6 passes at off − 0.05 and fails past it', () => {
    // found-hosts has 3 facts; 5 control cases × 4 runs. Dropping one fact on 3 hosts runs
    // lowers the mean by 3 × (1/3) / 20 = 0.05.
    const at = judge(
      rows(4, (arm, id, i) =>
        arm === 'layer' && id === 'found-hosts' && i < 3 ? { factsFound: 2 } : {},
      ),
    );
    expect(at.clauses['A-6'].result).toBe('PASS');
    const past = judge(
      rows(4, (arm, id, i) =>
        arm === 'layer' && id === 'found-hosts' && i < 4 ? { factsFound: 2 } : {},
      ),
    );
    expect(past.clauses['A-6'].result).toBe('FAIL');
  });

  it('A-7 fails when control hedges rise past 0.10, or control runs pause more', () => {
    const hedge = judge(
      rows(4, (arm, id, i) =>
        arm === 'layer' && setOf(id) === 'control' && i < 1 ? { hedges: true } : {},
      ),
    );
    // 5 of 20 control answers hedge under layer (0.25), none under off.
    expect(hedge.clauses['A-7'].result).toBe('FAIL');
    const ask = judge(
      rows(4, (arm, id, i) =>
        arm === 'layer' && setOf(id) === 'control' && i < 1 ? { outcome: 'paused' } : {},
      ),
    );
    expect(ask.clauses['A-7'].result).toBe('FAIL');
  });

  it('A-8 passes at 1.10 × tokens and fails past it', () => {
    expect(
      judge(rows(4, (arm) => (arm === 'layer' ? { input: 1100 } : {}))).clauses['A-8'].result,
    ).toBe('PASS');
    expect(
      judge(rows(4, (arm) => (arm === 'layer' ? { input: 1101 } : {}))).clauses['A-8'].result,
    ).toBe('FAIL');
  });

  it('the verdict: FAIL beats NOT-MEASURABLE beats PASS; both arms are required', () => {
    expect(verdictOf({ a: { result: 'PASS' }, b: { result: 'NOT-MEASURABLE' } })).toBe(
      'NOT-MEASURABLE',
    );
    expect(verdictOf({ a: { result: 'FAIL' }, b: { result: 'NOT-MEASURABLE' } })).toBe('FAIL');
    const offOnly = rows(4).filter((r) => r.arm === 'off');
    expect(() => judge(offOnly)).toThrow(/both must be present/);
  });
});

describe('DRIFT — RULE.md and rule.mjs', () => {
  it('every margin in the table equals MARGINS, and nothing is missing', () => {
    const table = RULE_MD.slice(RULE_MD.indexOf('## Margins'));
    const pairs = [...table.matchAll(/^\| `(\w+)` \| ([\d.]+) \|$/gm)].map((m) => [
      m[1],
      Number(m[2]),
    ]);
    expect(Object.fromEntries(pairs)).toEqual({ ...MARGINS });
  });

  it('the sets RULE.md lists are the sheet’s', () => {
    for (const set of ['provoking', 'control', 'gap']) {
      const line = RULE_MD.split('\n').find((l) => l.startsWith(`| **${set}** |`));
      expect(line, set).toBeDefined();
      const listed = [...(line as string).split('|')[2].matchAll(/`([a-z0-9-]+)`/g)].map(
        (m) => m[1],
      );
      expect(listed.sort()).toEqual(
        CASES.filter((c: any) => c.set === set)
          .map((c: any) => c.id)
          .sort(),
      );
    }
  });
});
