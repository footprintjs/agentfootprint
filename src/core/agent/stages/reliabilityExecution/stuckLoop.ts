import type { ReliabilityScope, ReliabilityRule } from '../../../../reliability/types.js';

/**
 * v2.13 — stuck-loop detection helper. Returns `true` when the last
 * `n` validation errors are IDENTICAL — a hallucinating model that
 * keeps making the same mistake won't make progress on more retries.
 *
 * Default rule template — spread into your `postDecide` to short-circuit
 * stuck loops:
 *
 * ```ts
 * postDecide: [
 *   defaultStuckLoopRule,            // ← spread first; fail-fast on stuck
 *   { when: (s) => s.validationError !== undefined && s.attempt < 3, then: 'retry', ... },
 * ]
 * ```
 *
 * @param scope The reliability scope view passed to rule predicates.
 * @param n How many trailing identical errors trigger detection. Default 2.
 */
export function lastNValidationErrorsMatch(scope: ReliabilityScope, n = 2): boolean {
  const h = scope.validationErrorHistory;
  if (h.length < n) return false;
  const last = h[h.length - 1];
  for (let i = h.length - n; i < h.length; i++) {
    if (h[i] !== last) return false;
  }
  return true;
}

/**
 * v2.13 — drop-in PostDecide rule that fail-fasts when the last 2
 * validation errors match. Spread into `postDecide` BEFORE retry
 * rules so it short-circuits before another wasted attempt.
 *
 * The matched-rule kind `'schema-stuck-loop'` surfaces on
 * `ReliabilityFailFastError.kind` for caller branching.
 */
export const defaultStuckLoopRule: ReliabilityRule = {
  when: (s) => lastNValidationErrorsMatch(s, 2),
  then: 'fail-fast',
  kind: 'schema-stuck-loop',
  label: 'model produced the same validation error twice in a row',
};
