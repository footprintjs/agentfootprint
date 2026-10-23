/**
 * delivered — one declared claim of an answer about to be DELIVERED, judged
 * for answer validation (`answer-validation/agentChecks.ts` turns the verdict
 * into a report row).
 *
 * Pattern: pure function over one `check.ts` · `compareClaim` result.
 * Role:    the claim seam's verdict when it can WITHHOLD an answer. It reads
 *          the detector's own selection (`compareClaim`: every row this run
 *          settled for the declared `(entity, field)`) and adds the rules a
 *          verdict that governs delivery needs, because that contract is
 *          unscoped: rows from ANY tool result, with no scope or age check,
 *          and any result carrying the semantics marker settles a fact — so
 *          any row may be forged, foreign or stale.
 *
 * THE LAW — a reading can only withhold. With no reading the claim is not
 * checked (`uncollected`, `not-applicable`), and ONE more reading of the fact,
 * wherever it lands, never makes the verdict more permissive: a forged or
 * stale row can at most withhold an answer, never deliver one or make it
 * read "known". Pinned by the monotonicity property in
 * `test/answer-validation/agentChecks.test.ts`. That is why:
 * - AGREEMENT IS NEVER SUPPORT. It is `agrees` — `not-applicable`, exactly as
 *   silent as no reading at all — and only the app's own checks can pass a
 *   report. A contradiction still withholds.
 * - EVERY READING COUNTS, never the latest alone. A reading that settled
 *   nothing (an `unknown(…)` Claim, a bare `null` or doubt word) beside the
 *   answer's value, readings that disagree, and a reading that is not a
 *   well-formed Claim each withhold, whatever else the run read. A
 *   contradiction is `contradicts` only when every reading is a value the
 *   answer contradicts.
 * - DOUBT IS NEVER AGREEMENT. Doubt on both sides (`null` or `'unknown'` —
 *   in any case or spacing — or an unknown Claim) withholds; only an absence
 *   a tool DECLARED (`known(null)`) agrees with the answer's doubt.
 * - VALUES COMPARE UNDER THE DECLARED NORMALIZATION (`evaluate.ts` ·
 *   `compareClaimValues`), never by exact JSON: `'Settled '` agrees with
 *   `'settled'`, `42.5` with `'42.50'`. Kinds that cannot be compared safely
 *   are `incomparable`, never `contradicts`.
 */

import type { ClaimComparison } from './check.js';
import { claimShapeOf, claimValueKey, compareClaimValues, type ClaimShape } from './evaluate.js';

/** One delivered claim's verdict. Only `contradicts` accuses; nothing here verifies. */
export type DeliveredClaim =
  /** The answer does not state the field. */
  | 'omitted'
  /** The answer declines it (doubt) where the run's readings are values. */
  | 'declined'
  /** No reading of this run settled the fact: the claim is not checked. */
  | 'uncollected'
  /** This run's readings of the fact are not all the same value. */
  | 'disputed'
  /** A reading settled the fact as an unknown `Claim`, and the answer states a value. */
  | 'settled-unknown'
  /** A reading settled only a bare `null` / doubt word, and the answer states a value. */
  | 'settled-doubt'
  /** Doubt on both sides. */
  | 'doubt-on-both-sides'
  /** The answer's value agrees with every reading — agreement, not support. */
  | 'agrees'
  /** Every reading is a value, and the answer's value contradicts each of them. */
  | 'contradicts'
  /** A reading or the answer is not well formed, or the values cannot be compared safely. */
  | 'incomparable';

/** Readings that are values: more than one exact key (or one with none) is a dispute. */
function disputed(values: readonly unknown[]): boolean {
  if (values.length < 2) return false;
  const keys = values.map((value) => claimValueKey(value));
  return keys.includes(undefined) || new Set(keys).size > 1;
}

/** A declared absence (`known(null)`, or a declared doubt word): the one doubt a value settles. */
const declaredAbsence = (shape: ClaimShape): boolean =>
  shape.kind === 'value' && shape.declared && claimShapeOf(shape.face).kind === 'doubt';

/**
 * Judge one compared claim for delivery, over EVERY reading of the fact this
 * run made. Pure and monotone: a reading added anywhere never turns a
 * withholding verdict into `agrees`, `declined` or `uncollected`.
 */
export function judgeDeliveredClaim(comparison: ClaimComparison): DeliveredClaim {
  if (comparison.kind === 'omitted') return 'omitted';
  if (comparison.kind === 'uncollected') return 'uncollected';
  const answer = claimShapeOf(comparison.claimed);
  const readings = comparison.rows.map((row) => ({
    value: row.value,
    shape: claimShapeOf(row.value),
  }));
  if (answer.kind === 'malformed' || readings.some((r) => r.shape.kind === 'malformed')) {
    return 'incomparable';
  }
  const doubts = readings.filter((r) => r.shape.kind === 'doubt');
  const values = readings.filter((r) => r.shape.kind === 'value');

  if (answer.kind === 'doubt') {
    // The answer claims nothing: only a reading that ALSO settled nothing
    // makes this agreement on doubt, which verifies nothing.
    if (doubts.length > 0) return 'doubt-on-both-sides';
    return values.every((r) => declaredAbsence(r.shape)) ? 'agrees' : 'declined';
  }

  if (disputed(values.map((r) => r.value))) return 'disputed';
  if (doubts.some((r) => r.shape.kind === 'doubt' && r.shape.declared)) return 'settled-unknown';
  if (doubts.length > 0) return 'settled-doubt';
  const results = values.map((r) => compareClaimValues(r.value, comparison.claimed));
  if (results.every((result) => result === 'contradicts')) return 'contradicts';
  if (results.every((result) => result === 'agrees')) return 'agrees';
  return 'incomparable';
}
