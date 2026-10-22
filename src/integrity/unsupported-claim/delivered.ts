/**
 * delivered — one declared claim of an answer about to be DELIVERED, judged
 * for answer validation (`answer-validation/agentChecks.ts` turns the verdict
 * into a report row).
 *
 * Pattern: pure function over one `check.ts` · `compareClaim` result.
 * Role:    the claim seam's verdict when it can WITHHOLD an answer. It starts
 *          from the detector's own selection and doubt rules (`compareClaim`,
 *          `evaluate.ts` · `evaluateClaimPair`) and adds the rules a verdict
 *          that governs delivery needs, because the contract it reads is
 *          unscoped: the latest `(entity, field)` row from ANY tool result,
 *          with no scope or age check, and any result carrying the semantics
 *          marker settles a fact.
 *
 * THE RULES, each because of that:
 * - AGREEMENT IS NEVER SUPPORT. A row that agrees may come from another
 *   customer's record, a stale read or a page that happens to carry the
 *   marker, so agreement is `agrees` — the row says so and verifies nothing.
 *   Only the app's own checks can pass a report. A contradiction still
 *   withholds: a wrong row can only make the answer be withheld.
 * - A FACT READ TWO WAYS IS DISPUTED. When this run's rows for one fact
 *   disagree, which one is right cannot be told, so the claim is not
 *   compared with the latest (`disputed`). A row that settled nothing (an
 *   unknown `Claim`, a bare `null` or `'unknown'`) disputes nothing.
 * - A BARE DOUBT SETTLES NOTHING. A value claimed where the tool settled only
 *   `null` or `'unknown'` has nothing to agree with (`settled-doubt`), and
 *   doubt on both sides verifies nothing (`doubt-on-both-sides`). An absence
 *   a tool DECLARED (`known(null)`) is a settled value: agreeing with it is
 *   `agrees`, a value against it is `contradicts`.
 * - VALUES COMPARE UNDER THE DECLARED NORMALIZATION (`evaluate.ts` ·
 *   `compareClaimValues`), never by exact JSON: `'Settled '` agrees with
 *   `'settled'`, `42.5` with `'42.50'`. Kinds that cannot be compared safely
 *   (a list against a scalar, a unit against a bare number) are
 *   `incomparable`, never `contradicts`.
 */

import { participates } from '../assertion/types.js';
import type { ClaimComparison, ClaimLedgerRow } from './check.js';
import { compareClaimValues } from './evaluate.js';

/** One delivered claim's verdict. Only `contradicts` accuses; nothing here verifies. */
export type DeliveredClaim =
  /** The answer does not state the field. */
  | 'omitted'
  /** The answer declines it (`null`, `'unknown'`, an unknown `Claim`) where the run settled a value. */
  | 'declined'
  /** No row of this run settled the fact. */
  | 'uncollected'
  /** This run's rows for the fact disagree. */
  | 'disputed'
  /** The latest row settled the fact as an unknown `Claim`. */
  | 'settled-unknown'
  /** The latest row settled only a bare `null` / `'unknown'`, and the answer states a value. */
  | 'settled-doubt'
  /** Bare doubt on both sides. */
  | 'doubt-on-both-sides'
  /** The answer's value agrees with the settled value — agreement, not support. */
  | 'agrees'
  /** The answer's value contradicts the settled value. */
  | 'contradicts'
  /** The two values are of kinds that cannot be compared safely. */
  | 'incomparable';

/** A bare doubt a tool wrote: `null` or the literal `'unknown'` (a `known(...)` wrapper is a declared value). */
const isBareDoubt = (value: unknown): boolean => value === null || value === 'unknown';

/** True when a `known(...)` wrapper carries the value: the tool DECLARED it, `known(null)` included. */
function declaredKnown(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'known'
  );
}

/** Two of the run's readings of one fact that do not agree — or cannot be compared. */
function disputed(rows: readonly ClaimLedgerRow[]): boolean {
  const readings = rows
    .map((row) => row.value)
    .filter((value) => participates(value) && !isBareDoubt(value));
  const first = readings[0];
  return readings.some((value) => compareClaimValues(first, value) !== 'agrees');
}

/**
 * Judge one compared claim for delivery. Pure. Throws what the comparison
 * throws (a ledger value JSON cannot render).
 */
export function judgeDeliveredClaim(comparison: ClaimComparison): DeliveredClaim {
  if (comparison.kind === 'omitted') return 'omitted';
  if (comparison.kind === 'uncollected') return 'uncollected';
  const { evaluation, settledRow, rows, claimed } = comparison;
  // The answer states nothing to check, whatever the rows say.
  if (evaluation === 'doubt-against-value' || evaluation === 'claim-nonparticipating')
    return 'declined';
  if (disputed(rows)) return 'disputed';
  if (evaluation === 'evidence-unavailable') return 'settled-unknown';
  if (evaluation === 'both-doubt') {
    return declaredKnown(settledRow.value) ? 'agrees' : 'doubt-on-both-sides';
  }
  // The answer states a value. Against a bare doubt it has nothing to agree
  // with, and that is not an accusation either.
  if (isBareDoubt(settledRow.value)) return 'settled-doubt';
  return compareClaimValues(settledRow.value, claimed);
}
