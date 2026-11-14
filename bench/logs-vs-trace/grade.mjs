/**
 * Grader-owned synthetic truth. Nothing in this module is served to either arm.
 * A candidate is data, never JavaScript or prose to evaluate. Replaying it checks
 * the planted bug and independent boundary/credit controls, not model ability.
 */
const HOLDOUTS = [
  ['recorded-bug', 66000, 2310, 702, 0.42, 'decline'],
  ['higher-income', 84000, 2947, 710, 0.421, 'decline'],
  ['at-boundary', 96000, 3200, 700, 0.4, 'approve'],
  ['below-boundary', 12000, 399, 680, 0.399, 'approve'],
  ['above-boundary', 120000, 4010, 800, 0.401, 'decline'],
  ['credit-floor', 60000, 500, 619, 0.1, 'decline'],
  ['below-prime', 60000, 500, 679, 0.1, 'refer'],
  ['prime-floor', 60000, 500, 680, 0.1, 'approve'],
  ['zero-debt-control', 36000, 0, 720, 0, 'approve'],
].map(([id, annualIncome, monthlyDebt, creditScore, dti, decision]) => ({
  id,
  input: { annualIncome, monthlyDebt, creditScore },
  expected: { dti, decision },
}));

const POLICY = [
  { when: ({ creditScore }) => creditScore < 620, then: 'decline' },
  { when: ({ dti }) => dti > 0.4, then: 'decline' },
  { when: ({ creditScore, dti }) => creditScore >= 680 && dti <= 0.4, then: 'approve' },
];

/** Own data properties only: no inherited operations, getters or extra keys. */
function dataShape(value, allowed) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).every(
    (key) => typeof key === 'string' && allowed.includes(key) && 'value' in descriptors[key],
  );
}

function validCandidate(candidate) {
  if (!dataShape(candidate, ['operation', 'field'])) return false;
  const keys = Object.keys(Object.getOwnPropertyDescriptors(candidate));
  if (candidate.operation === 'keep') return keys.length === 1;
  return (
    keys.length === 2 &&
    candidate.operation === 'denominator' &&
    ['monthlyIncome', 'annualIncome'].includes(candidate.field)
  );
}

function replay(input, field) {
  const denominator = field === 'monthlyIncome' ? input.annualIncome / 12 : input.annualIncome;
  const dti = Math.round((input.monthlyDebt / denominator) * 1000) / 1000;
  const decision =
    POLICY.find((rule) => rule.when({ creditScore: input.creditScore, dti }))?.then ?? 'refer';
  return { dti, decision };
}

/** Missing evidence is outside the correctness denominator, even for a valid fix. */
export function gradeFix(candidate, options = {}) {
  if (!dataShape(options, ['captureStatus', 'originalField'])) {
    return { status: 'checked-fail', reason: 'invalid-options', checks: [] };
  }
  const { captureStatus = 'complete', originalField = 'annualIncome' } = options;
  if (captureStatus !== 'complete') {
    return { status: 'not-graded', reason: 'capture-unavailable', checks: [] };
  }
  if (!['monthlyIncome', 'annualIncome'].includes(originalField)) {
    return { status: 'checked-fail', reason: 'invalid-original-field', checks: [] };
  }
  if (!validCandidate(candidate)) {
    return { status: 'checked-fail', reason: 'invalid-candidate', checks: [] };
  }
  const field = candidate.operation === 'keep' ? originalField : candidate.field;
  const checks = HOLDOUTS.map(({ id, input, expected }) => {
    const actual = replay(input, field);
    return {
      id,
      expected: { ...expected },
      actual,
      pass: actual.dti === expected.dti && actual.decision === expected.decision,
    };
  });
  const pass = checks.every((check) => check.pass);
  return {
    status: pass ? 'checked-pass' : 'checked-fail',
    reason: pass ? 'replay-agrees' : 'replay-mismatch',
    checks,
  };
}
