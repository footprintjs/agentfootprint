/** Synthetic capture descriptors. Grading truth belongs only to grade.mjs. */
export const INPUTS = Object.freeze({
  annualIncome: 66000,
  monthlyDebt: 2310,
  creditScore: 702,
});

export const CASES = Object.freeze([
  Object.freeze({ id: 'annual-denominator', variant: 'annual', capture: 'complete' }),
  Object.freeze({ id: 'monthly-control', variant: 'monthly', capture: 'complete' }),
  Object.freeze({ id: 'missing-record', variant: 'annual', capture: 'missing' }),
]);

/** Select a nonempty, duplicate-free case list without silently dropping unknown IDs. */
export function selectCases(ids = CASES.map((entry) => entry.id)) {
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    new Set(ids).size !== ids.length ||
    !Array.from(ids).every((id) => typeof id === 'string')
  ) {
    throw new TypeError('Cases must be a nonempty list of distinct case IDs.');
  }
  return Object.freeze(
    ids.map((id) => {
      const entry = CASES.find((candidate) => candidate.id === id);
      if (!entry) throw new RangeError(`Unknown logs-versus-trace case: ${String(id)}`);
      return entry;
    }),
  );
}
