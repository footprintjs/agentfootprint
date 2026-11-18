import { CASES } from './cases.mjs';
import { gradeFix } from './grade.mjs';
import { captureCase } from './capture.mjs';
import { evidenceFor } from './evidence.mjs';

export const MODE = 'deterministic-harness-validation';
const SCRIPTS = Object.freeze([
  { id: 'monthly-field', candidate: { operation: 'denominator', field: 'monthlyIncome' } },
  { id: 'annual-field', candidate: { operation: 'denominator', field: 'annualIncome' } },
  { id: 'keep', candidate: { operation: 'keep' } },
]);

/** Paired order is reproducible. This does not randomize or run an actual model. */
export function planOf(seed = 1729) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error('Seed must be a uint32');
  let value = seed;
  const random = () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value;
  };
  const plan = CASES.flatMap((c) => ['logs', 'trace'].map((arm) => ({ caseId: c.id, arm })));
  for (let i = plan.length - 1; i > 0; i -= 1) {
    const j = random() % (i + 1);
    [plan[i], plan[j]] = [plan[j], plan[i]];
  }
  return plan;
}

/** Refuse other modes before loading any package door or running a fixture. */
export async function runValidation(options = {}) {
  if (
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Reflect.ownKeys(options).some(
      (key) =>
        !['mode', 'seed', 'loadDoors'].includes(key) ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key), 'value'),
    )
  ) {
    throw new Error('Unsupported harness configuration; model/provider runs are disabled');
  }
  const { mode = MODE, seed = 1729, loadDoors } = options;
  if (mode !== MODE)
    throw new Error('Only deterministic harness validation is enabled; model runs are disabled');
  const plan = planOf(seed);
  if (typeof loadDoors !== 'function')
    throw new Error('An explicit local trace-tool door is required');
  const doors = await loadDoors();
  if (typeof doors.traceToolpack !== 'function' || typeof doors.callTraceTool !== 'function') {
    throw new Error('This build lacks the existing trace-tool door');
  }
  const captures = new Map();
  for (const c of CASES) captures.set(c.id, await captureCase(c));
  const rows = [];
  for (const item of plan) {
    const c = CASES.find((candidate) => candidate.id === item.caseId);
    const capture = captures.get(c.id);
    const evidence = await evidenceFor(item.arm, capture, doors);
    rows.push({
      ...item,
      captureDigest: capture.captureDigest,
      evidence,
      scriptedChecks: SCRIPTS.map(({ id, candidate }) => ({
        id,
        candidate: { ...candidate },
        grade: gradeFix(candidate, {
          captureStatus: capture.captureStatus,
          originalField: c.variant === 'annual' ? 'annualIncome' : 'monthlyIncome',
        }),
      })),
    });
  }
  return {
    schemaVersion: 1,
    mode: MODE,
    seed,
    plan,
    conclusion:
      'Harness verification only. No model debugging quality, token savings or cost advantage was measured.',
    usage: {
      modelCalls: 0,
      providerCalls: 0,
      inputTokens: null,
      outputTokens: null,
      modelSpendUsd: 0,
      provenance:
        'No model/provider adapter is enabled; token usage is not collected. Other computing costs are not measured.',
    },
    rows,
  };
}
