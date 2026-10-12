/**
 * The value decision shared by claim-seam adapters. Evidence selection,
 * scope/coverage eligibility, provenance and delivery policy belong to callers.
 * This module owns the existing doubt and numeric-leniency rules; structural
 * comparison stays in ContextFootprint's assertion algebra.
 *
 * Outcomes describe why a comparison did or did not find a conflict. None is
 * a verification badge: in particular, no-conflict is not positive support.
 */
import type { Assertion } from '../assertion/types.js';
import { comparableValueOf, participates } from '../assertion/types.js';
import { conflictsOf } from '../assertion/conflicts.js';

export type ClaimPairEvaluation =
  | 'evidence-unavailable'
  | 'claim-nonparticipating'
  | 'doubt-against-value'
  | 'both-doubt'
  | 'numeric-leniency'
  | 'conflict'
  | 'no-conflict';

const isDoubt = (value: unknown): boolean => value === null || value === 'unknown';

/** The existing one-direction leniency: a raw numeric string claims a number. */
function numericallyEqual(claimed: unknown, settled: unknown): boolean {
  return (
    typeof settled === 'number' &&
    typeof claimed === 'string' &&
    claimed.trim() !== '' &&
    Number(claimed) === settled
  );
}

/**
 * Evaluate an explicitly selected evidence/claim pair, without selecting or
 * rewriting either assertion. Adapters must establish that the asserted pair
 * concerns the same subject, predicate and epoch before interpreting a result.
 * No rule here establishes scope, completeness, authorisation or truth.
 */
export function evaluateClaimPair(evidence: Assertion, claim: Assertion): ClaimPairEvaluation {
  if (!participates(evidence.value)) return 'evidence-unavailable';

  const settled = comparableValueOf(evidence.value);
  // RAW claimed null/'unknown' is doubt; a known(...) wrapper follows the
  // algebra below. Unwrapping both sides here would change the old contract.
  if (isDoubt(claim.value)) return isDoubt(settled) ? 'both-doubt' : 'doubt-against-value';
  if (numericallyEqual(claim.value, settled)) return 'numeric-leniency';

  const conflict = conflictsOf([evidence, claim]).length !== 0;
  // Classify the absence without converting it into positive agreement. Do
  // this AFTER the algebra so its existing serialization failures still occur.
  if (!participates(claim.value)) return 'claim-nonparticipating';
  return conflict ? 'conflict' : 'no-conflict';
}
