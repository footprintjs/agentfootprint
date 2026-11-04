/** Synthetic normalized rows only. No historical study/case data and no provider calls. */
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain benchmark .mjs module
import {
  caseMetric,
  clopperPearson,
  evaluateGate,
  GATES,
  scoreRows,
} from '../../../bench/negative/full/score.mjs';

function row(id = 'r1', caseId = 'c1') {
  return {
    id,
    caseId,
    model: 'synthetic',
    cell: 'enforce',
    arm: 'enforce',
    pairId: id,
    labelsComplete: true,
    ownerPending: false,
    citations: [{ valid: true, correct: true, trueZero: true, held: false }],
    negativeRequired: true,
    fieldPresent: true,
    contradictionEligible: false,
    missedContradiction: false,
    rewordingEligible: false,
    reworded: false,
    detector: [{ positive: true, detected: true }],
    usefulness: 4,
    tokens: 100,
    latencyMs: 100,
  };
}
function score(rows: ReturnType<typeof row>[]) {
  return scoreRows(rows, { expectedReplyIds: rows.map((r) => r.id), scriptedPassed: true });
}

describe('actual independent case outcomes', () => {
  it('one error in100 repeats is one failed case, not a rounded zero-error case', () => {
    const metric = caseMetric(
      Array.from({ length: 100 }, (_, i) => ({
        caseId: 'one-case',
        replyId: `r${i}`,
        value: i === 99,
      })),
      'max',
    );
    expect(metric.observations).toEqual({ num: 1, den: 100, point: 0.01 });
    expect(metric.replies).toEqual({ num: 1, den: 100, point: 0.01 });
    expect(metric.cases).toMatchObject({ num: 1, den: 1, point: 1, high: 1 });
    expect(metric.cases.low).toBeCloseTo(0.025, 12);
  });

  it('claim, reply and case rates remain separate for multiple claims in one reply', () => {
    const metric = caseMetric(
      [
        { caseId: 'a', replyId: 'r1', value: true },
        { caseId: 'a', replyId: 'r1', value: false },
        { caseId: 'a', replyId: 'r2', value: true },
        { caseId: 'b', replyId: 'r3', value: true },
      ],
      'min',
    );
    expect(metric.observations.point).toBe(0.75);
    expect(metric.replies.point).toBeCloseTo(2 / 3);
    expect(metric.cases).toMatchObject({ num: 1, den: 2, point: 0.5 });
  });

  it('has correct exact extreme bounds and refuses fractional successes', () => {
    expect(clopperPearson(0, 8)[1]).toBeCloseTo(0.3694166476, 9);
    expect(clopperPearson(12, 12)[0]).toBeCloseTo(0.7353515306, 9);
    expect(clopperPearson(0, 0)).toEqual([null, null]);
    expect(() => clopperPearson(0.4, 8)).toThrow('integer');
    expect(() => clopperPearson(9, 8)).toThrow('integer');
  });

  it.each([
    ['falseHold', 8, 10, false],
    ['substitution', 6, 10, false],
    ['citationValidity', 12, 6, true],
    ['citationCorrectness', 12, 6, true],
    ['missedContradiction', 3, 10, false],
  ])('identifies impossible %s bounds at the full registered count', (name, n, repeats, value) => {
    const rule = GATES[name];
    const entries = Array.from({ length: Number(n) }, (_, c) =>
      Array.from({ length: Number(repeats) }, (_, r) => ({
        caseId: `c${c}`,
        replyId: `c${c}-r${r}`,
        value,
      })),
    ).flat();
    expect(evaluateGate(caseMetric(entries, rule.direction), rule).status).toBe(
      'insufficient-independent-cases',
    );
  });

  it('can pass with genuinely enough independent cases; floors still apply first', () => {
    const entries = Array.from({ length: 36 }, (_, c) =>
      Array.from({ length: 3 }, (_, r) => ({
        caseId: `c${c}`,
        replyId: `r${c}-${r}`,
        value: false,
      })),
    ).flat();
    expect(evaluateGate(caseMetric(entries, 'max'), GATES.falseHold).status).toBe('pass');
    expect(evaluateGate(caseMetric(entries.slice(0, 2), 'max'), GATES.falseHold).status).toBe(
      'below-floor',
    );
  });

  it('rejects a reply identity reused across cases', () => {
    expect(() =>
      caseMetric(
        [
          { caseId: 'a', replyId: 'same', value: true },
          { caseId: 'b', replyId: 'same', value: true },
        ],
        'min',
      ),
    ).toThrow('two cases');
  });
});

describe('denominators and completeness', () => {
  it('wrong citations fail correctness but cannot become false holds', () => {
    const r = row();
    r.citations.push({ valid: true, correct: false, trueZero: true, held: true });
    r.citations.push({ valid: true, correct: true, trueZero: false, held: true });
    const metrics = score([r]).groups[0].metrics;
    expect(metrics.citationCorrectness.observations).toEqual({ num: 2, den: 3, point: 2 / 3 });
    expect(metrics.falseHold.observations).toEqual({ num: 0, den: 1, point: 0 });
  });

  it('a correctly cited true-zero withheld claim counts as a false hold', () => {
    const r = row();
    r.citations[0].held = true;
    expect(score([r]).groups[0].metrics.falseHold.observations.point).toBe(1);
  });

  it('an omitted required field is a drop even when there are no citations', () => {
    const r = row();
    r.citations = [];
    r.fieldPresent = false;
    const group = score([r]).groups[0];
    expect(group.metrics.fieldDrop.observations.point).toBe(1);
    expect(group.metrics.citationValidity.observations.den).toBe(0);
    expect(group.typedRecommended).toBe(false);
  });

  it.each(['label', 'owner', 'manifest', 'missing-reply', 'mock-suite', 'unknown-boolean'])(
    '%s prevents any passing recommendation',
    (missing) => {
      const r = row();
      const options = { expectedReplyIds: ['r1'], scriptedPassed: true };
      if (missing === 'label') r.labelsComplete = false;
      if (missing === 'owner') r.ownerPending = true;
      if (missing === 'manifest') options.expectedReplyIds = [];
      if (missing === 'missing-reply') options.expectedReplyIds.push('r2');
      if (missing === 'mock-suite') options.scriptedPassed = false;
      if (missing === 'unknown-boolean') Object.assign(r.citations[0], { trueZero: undefined });
      const result = scoreRows([r], options);
      expect(result.complete).toBe(false);
      expect(result.problems.length).toBeGreaterThan(0);
      expect(
        result.groups.every(
          (g: { typedRecommended: boolean; proseGatesPass: boolean }) =>
            !g.typedRecommended && !g.proseGatesPass,
        ),
      ).toBe(true);
      for (const group of result.groups)
        expect(
          Object.values(group.gates).every((g) => (g as { status: string }).status !== 'pass'),
        ).toBe(true);
    },
  );

  it('rejects duplicated reply IDs and keeps models/cells/arms separated', () => {
    expect(() => score([row(), row()])).toThrow('duplicate');
    const other = { ...row('r2'), model: 'other' };
    expect(score([row(), other]).groups).toHaveLength(2);
  });
});

describe('a measured off comparison is mandatory', () => {
  it('pairs identical model/case/repetition across differently named cells', () => {
    const off = { ...row('off'), pairId: 'pair', cell: 'observe', arm: 'off' };
    const enforced = { ...row('enforce'), pairId: 'pair', tokens: 115, latencyMs: 130 };
    const group = score([off, enforced]).groups.find((g: { arm: string }) => g.arm === 'enforce');
    expect(group.comparison).toMatchObject({
      status: 'measured',
      pairs: 1,
      usefulnessDifference: 0,
      tokenRatio: 1.15,
      latencyRatio: 1.3,
      usefulness: 'pass',
      tokens: 'pass',
      latency: 'pass',
    });
  });

  it('never substitutes an unrelated case or averages away a missing pair', () => {
    const off = { ...row('off', 'other-case'), arm: 'off', pairId: 'pair' };
    const enforced = { ...row('enforce'), pairId: 'pair' };
    expect(score([off, enforced]).groups[1].comparison.status).toBe('baseline-case-mismatch');
    expect(score([enforced]).groups[0].comparison.status).toBe('missing-or-ambiguous-baseline');
  });

  it('rates a usefulness reduction and added correction tokens as failures', () => {
    const off = { ...row('off'), arm: 'off', pairId: 'pair' };
    const enforced = {
      ...row('enforce'),
      pairId: 'pair',
      usefulness: 3,
      tokens: 200,
      latencyMs: 200,
    };
    expect(score([off, enforced]).groups[1].comparison).toMatchObject({
      usefulness: 'fail',
      tokens: 'fail',
      latency: 'fail',
    });
  });

  it('keeps the among substitution and no-flat-increase requirements separate', () => {
    const count = {
      ...row('count'),
      arm: 'count',
      pairId: 'pair',
      nearMatch: { substitution: false, flat: false, ask: true, notFound: true },
    };
    const suggestions = {
      ...row('suggestions'),
      arm: 'suggestions',
      pairId: 'pair',
      nearMatch: { substitution: false, flat: true, ask: false, notFound: true },
    };
    const group = score([count, suggestions]).groups[1];
    expect(group.metrics.substitution.observations.point).toBe(0);
    expect(group.metrics.nearAsk.observations.point).toBe(0);
    expect(group.nearMatchComparison).toMatchObject({ flatDifference: 1, noFlatIncrease: 'fail' });
    expect(group.namesMayShip).toBe(false);
  });
});
