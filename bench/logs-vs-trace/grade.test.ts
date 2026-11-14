import { describe, expect, it } from 'vitest';
import { CASES, INPUTS, selectCases } from './cases.mjs';
import { gradeFix } from './grade.mjs';

const monthly = { operation: 'denominator', field: 'monthlyIncome' };
const annual = { operation: 'denominator', field: 'annualIncome' };

describe('synthetic case sheet', () => {
  it('contains the planted case, unchanged control and missing-record control without fixes', () => {
    expect(CASES).toEqual([
      { id: 'annual-denominator', variant: 'annual', capture: 'complete' },
      { id: 'monthly-control', variant: 'monthly', capture: 'complete' },
      { id: 'missing-record', variant: 'annual', capture: 'missing' },
    ]);
    expect(INPUTS).toEqual({ annualIncome: 66000, monthlyDebt: 2310, creditScore: 702 });
    expect(Object.isFrozen(INPUTS)).toBe(true);
    expect(Object.isFrozen(CASES)).toBe(true);
    expect(CASES.every(Object.isFrozen)).toBe(true);
    expect(CASES.every((entry) => !('expected' in entry) && !('fix' in entry))).toBe(true);
  });

  it('selects only the requested cases and refuses absent, duplicate or unknown cases', () => {
    expect(selectCases()).toEqual(CASES);
    expect(selectCases(['monthly-control'])).toEqual([CASES[1]]);
    expect(Object.isFrozen(selectCases())).toBe(true);
    expect(() => selectCases([])).toThrow();
    expect(() => selectCases(['monthly-control', 'monthly-control'])).toThrow();
    expect(() => selectCases(['typo'])).toThrow();
    expect(() => selectCases('monthly-control')).toThrow();
    expect(() => selectCases(new Array(1))).toThrow();
    expect(() => selectCases([null])).toThrow();
  });
});

describe('structured fix grading by independent replay', () => {
  it('repairs the planted annual-denominator bug and checks every holdout', () => {
    const result = gradeFix(monthly);
    expect(result.status).toBe('checked-pass');
    expect(result.checks).toHaveLength(11);
    expect(result.checks.every((check) => check.pass)).toBe(true);
    expect(result.checks.find((check) => check.id === 'recorded-bug')).toMatchObject({
      expected: { dti: 0.42, decision: 'decline' },
      actual: { dti: 0.42, decision: 'decline' },
      pass: true,
    });
  });

  it('rejects the wrong denominator by actual replay, including an independent income', () => {
    const result = gradeFix(annual);
    expect(result.status).toBe('checked-fail');
    expect(result.reason).toBe('replay-mismatch');
    expect(result.checks.find((check) => check.id === 'recorded-bug')).toMatchObject({
      actual: { dti: 0.035, decision: 'approve' },
      pass: false,
    });
    expect(result.checks.find((check) => check.id === 'higher-income')).toMatchObject({
      expected: { dti: 0.421, decision: 'decline' },
      actual: { decision: 'approve' },
      pass: false,
    });
    expect(result.checks.find((check) => check.id === 'higher-income')?.actual.dti).toBe(
      2947 / 84000,
    );
  });

  it('allows keeping an already-correct implementation and rejects keeping the bug', () => {
    expect(gradeFix({ operation: 'keep' }, { originalField: 'monthlyIncome' }).status).toBe(
      'checked-pass',
    );
    expect(gradeFix({ operation: 'keep' }, { originalField: 'annualIncome' }).status).toBe(
      'checked-fail',
    );
    expect(gradeFix(monthly, { originalField: 'monthlyIncome' }).status).toBe('checked-pass');
    expect(gradeFix(annual, { originalField: 'monthlyIncome' }).status).toBe('checked-fail');
  });

  it('pins threshold equality, both nearby sides and the credit gate', () => {
    const checks = gradeFix(monthly).checks;
    expect(checks.find((check) => check.id === 'at-boundary')).toMatchObject({
      actual: { dti: 0.4, decision: 'approve' },
      pass: true,
    });
    expect(checks.find((check) => check.id === 'below-boundary')).toMatchObject({
      actual: { dti: 0.399, decision: 'approve' },
      pass: true,
    });
    expect(checks.find((check) => check.id === 'above-boundary')).toMatchObject({
      actual: { dti: 0.401, decision: 'decline' },
      pass: true,
    });
    expect(checks.find((check) => check.id === 'credit-floor')).toMatchObject({
      actual: { dti: 0.1, decision: 'decline' },
      pass: true,
    });
    expect(checks.find((check) => check.id === 'prime-floor')).toMatchObject({
      actual: { dti: 0.1, decision: 'approve' },
      pass: true,
    });
  });

  it('preserves the public policy referral between the credit floor and prime score', () => {
    const result = gradeFix(monthly);
    expect(result.checks.find((check) => check.id === 'below-prime')).toMatchObject({
      expected: { dti: 0.1, decision: 'refer' },
      actual: { dti: 0.1, decision: 'refer' },
      pass: true,
    });
  });

  it.each([
    ['just-above-boundary', 0.4004, 'decline'],
    ['just-below-boundary', 0.3996, 'approve'],
    ['at-boundary', 0.4, 'approve'],
  ])('uses the unrounded policy ratio for %s', (id, dti, decision) => {
    const result = gradeFix(monthly);
    expect(result.checks.find((check) => check.id === id)).toMatchObject({
      expected: { dti, decision },
      actual: { dti, decision },
      pass: true,
    });
  });

  it.each([
    null,
    undefined,
    'use monthlyIncome',
    [],
    {},
    { operation: 'denominator' },
    { operation: 'denominator', field: 'income' },
    { operation: 'denominator', field: 'monthlyIncome', explanation: 'trust me' },
    { operation: 'keep', field: 'monthlyIncome' },
    { operation: 'execute', source: 'throw new Error()' },
  ])('refuses an invalid candidate without executing or grading it: %j', (candidate) => {
    expect(gradeFix(candidate)).toEqual({
      status: 'checked-fail',
      reason: 'invalid-candidate',
      checks: [],
    });
  });

  it('does not execute accessors or accept inherited fields', () => {
    let reads = 0;
    const accessor = Object.defineProperty({}, 'operation', {
      enumerable: true,
      get() {
        reads += 1;
        return 'keep';
      },
    });
    expect(gradeFix(accessor).reason).toBe('invalid-candidate');
    expect(reads).toBe(0);
    expect(gradeFix(Object.create({ operation: 'keep' })).reason).toBe('invalid-candidate');
    expect(gradeFix({ operation: 'keep', [Symbol('extra')]: true }).reason).toBe(
      'invalid-candidate',
    );
  });

  it('keeps missing and unknown evidence out of correctness, even for an invalid candidate', () => {
    for (const captureStatus of ['missing', 'unknown', null]) {
      expect(gradeFix(monthly, { captureStatus })).toEqual({
        status: 'not-graded',
        reason: 'capture-unavailable',
        checks: [],
      });
      expect(gradeFix('invented fix', { captureStatus }).status).toBe('not-graded');
    }
  });

  it('refuses an unknown original implementation instead of guessing', () => {
    expect(gradeFix({ operation: 'keep' }, { originalField: 'unknown' })).toEqual({
      status: 'checked-fail',
      reason: 'invalid-original-field',
      checks: [],
    });
  });

  it('does not mutate the candidate or share mutable grading rows between runs', () => {
    const candidate = Object.freeze({ ...monthly });
    const first = gradeFix(candidate);
    const second = gradeFix(candidate);
    expect(second).toEqual(first);
    expect(second.checks).not.toBe(first.checks);
    first.checks[0].actual.dti = 123;
    first.checks[0].expected.dti = 123;
    expect(gradeFix(candidate).checks[0].actual.dti).toBe(0.42);
    expect(gradeFix(candidate).checks[0].expected.dti).toBe(0.42);
    expect(candidate).toEqual(monthly);
  });
});
