/**
 * The agent's own answer checks as rows of an answer-validation report
 * (`AnswerValidationOptions.agentChecks`).
 *
 * Pattern: pure adapters, one verdict in, `AnswerCheck` rows out.
 * Role:    the one place the library's own checks speak the report's
 *          vocabulary. `claimChecksOf` judges the candidate this validation
 *          delivers through the claim seam's own selection
 *          (`integrity/unsupported-claim/check.ts` · `compareClaim`) and its
 *          delivery verdict (`integrity/unsupported-claim/delivered.ts` ·
 *          `judgeDeliveredClaim`), so a row can never accuse where the
 *          detector does not. `evidenceCheckOf` reads the evidence gate's
 *          verdict on that same candidate — asked of it through an
 *          `EvidenceJudge`, never the verdict on the model's draft, which an
 *          output transform may have changed.
 *
 * One law above all, from the standing fold (`core/agent/assessment/assess.ts`):
 * an agent row can WITHHOLD an answer and never VERIFY one. No row here is
 * ever `checked-pass` (`validate.ts` refuses one), so only the app's own
 * checks can make a report `passed`, which the fold reads as "known":
 *   - The gate's clean verdict is a membership pass: `not-applicable`.
 *   - A claim that agrees with the settled fact is `not-applicable` too. The
 *     contract is unscoped — rows for `(entity, field)` from any tool, with no
 *     scope or age check — so agreement verifies nothing. A contradiction
 *     still fails the row.
 *   - A reading can only withhold (`delivered.ts`): with no reading the claim
 *     is not checked (`not-applicable`), and one more reading never makes the
 *     row more permissive, so a forged or stale row can at most withhold.
 *   - Doubt is never support. A field the answer leaves out, or declines
 *     (`null` / `'unknown'`), is `not-applicable`. A value beside a reading
 *     that settled nothing, doubt on both sides, a fact the run read two
 *     ways, and anything not well formed are `unreachable`: enforce
 *     withholds, observe delivers "not sure".
 *
 * And one from the redaction law: a row carries counts and the FIELD names the
 * app declared (the answer field, the fact's field), never a value from the
 * answer or from a tool result — and never the contract's `entity`, which an
 * app may build per user. `answerValidation` is not a name the redaction
 * vocabulary keeps out; the values stay on the records a policy already names
 * (`unsupportedValues`, `claimFacts`, the `integrity.context_error` event).
 */
import {
  compareClaim,
  type ClaimLedgerRow,
  type DeclaredClaim,
} from '../integrity/unsupported-claim/check.js';
import {
  judgeDeliveredClaim,
  type DeliveredClaim,
} from '../integrity/unsupported-claim/delivered.js';
import type { Disposition } from '../integrity/disposition/types.js';
import type { AnswerCheck } from './types.js';

/** Every agent row's id starts with this; a host check id may not while rows are on. */
export const AGENT_CHECK_PREFIX = 'agent:';

/** The evidence gate's verdict on the delivered candidate: counts and flags only. */
export interface EvidenceCheckInput {
  /** Values the gate looked up in the tool results (exempt values excluded). */
  readonly lookedUp: number;
  /** Values no tool result this run read carried. */
  readonly unsupported: number;
  /** The evidence index hit its ceiling: an unfound value may sit past the cut. */
  readonly truncated: boolean;
  /** The answer's words and numbers past the gate's reading ceiling, never looked up. */
  readonly unread: number;
  /** The gate's one repair turn ran before this verdict. */
  readonly revised: boolean;
}

/**
 * The evidence gate bound to the evidence a run read: judges ONE text, the
 * canonical candidate a validation is about to deliver.
 */
export type EvidenceJudge = (text: string) => EvidenceCheckInput;

/**
 * The `'names-and-numbers'` row. `undefined` (the gate never ran on the
 * run's final answer, so no judge was filed) is `unreachable`: a listed check
 * that did not run never reads as clean.
 */
export function evidenceCheckOf(verdict: EvidenceCheckInput | undefined): AnswerCheck {
  const row = (disposition: Disposition, reason: string): AnswerCheck =>
    Object.freeze({ id: `${AGENT_CHECK_PREFIX}names-and-numbers`, disposition, reason });
  if (verdict === undefined) {
    return row('unreachable', 'the evidence gate did not judge this answer');
  }
  if (verdict.unsupported > 0) {
    return verdict.truncated
      ? row(
          'unreachable',
          `the evidence index hit its ceiling, so ${verdict.unsupported} value(s) the answer ` +
            `states could not be looked up in every tool result`,
        )
      : row(
          'checked-fail',
          `${verdict.unsupported} value(s) the answer states appear in no tool result the run ` +
            `read${verdict.revised ? ', after the one repair turn' : ''}`,
        );
  }
  // What the gate never read it cannot clear: an invented value may sit there.
  if (verdict.unread > 0) {
    return row(
      'unreachable',
      `the answer is longer than the evidence gate reads: ${verdict.unread} more word(s) and ` +
        `number(s) were never looked up`,
    );
  }
  return row(
    'not-applicable',
    verdict.lookedUp === 0
      ? 'the answer states no name or number to look up'
      : `none of the ${verdict.lookedUp} value(s) looked up is unsupported; ` +
          `clearing the gate does not verify the answer`,
  );
}

/**
 * The `'claims'` rows: one per declared claim, in declaration order, judged
 * on `candidate` against this run's ledger rows for each declared fact.
 * Throws what the claim comparison throws (a ledger value JSON cannot render).
 */
export function claimChecksOf(
  declared: readonly DeclaredClaim[],
  ledger: readonly ClaimLedgerRow[],
  candidate: unknown,
  epoch: number,
): AnswerCheck[] {
  return declared.map((claim) =>
    claimRowOf(claim, judgeDeliveredClaim(compareClaim(claim, ledger, candidate, epoch))),
  );
}

function claimRowOf(claim: DeclaredClaim, verdict: DeliveredClaim): AnswerCheck {
  const field = `'${claim.answerField}'`;
  // The fact by its FIELD only: an app may declare the entity per user.
  const fact = `the fact '${claim.field}'`;
  const row = (disposition: Disposition, reason: string): AnswerCheck =>
    Object.freeze({
      id: `${AGENT_CHECK_PREFIX}claims:${claim.answerField}`,
      disposition,
      path: claim.answerField,
      reason,
    });
  switch (verdict) {
    case 'omitted':
      return row('not-applicable', `the answer does not state ${field}`);
    case 'declined':
      return row('not-applicable', `the answer declines to state ${field}`);
    case 'agrees':
      return row(
        'not-applicable',
        `the answer's ${field} agrees with ${fact} a tool settled, but agreement with a fact ` +
          `the contract does not scope is not verification`,
      );
    case 'contradicts':
      return row('checked-fail', `the answer's ${field} contradicts ${fact} a tool settled`);
    case 'contradicts-a-reading':
      return row(
        'checked-fail',
        `the answer's ${field} contradicts one tool result's reading of ${fact} (the readings ` +
          `the run made of it are not all the same)`,
      );
    case 'incomparable':
      return row(
        'unreachable',
        `could not compare the answer's ${field} with ${fact} a tool settled: they are ` +
          `different kinds of value (a list, an object, a number, text, or a number with a unit), ` +
          `or one is not a well-formed value`,
      );
    case 'uncollected':
      // Never more permissive than any reading would be: silent, not withheld.
      return row(
        'not-applicable',
        `no tool result the run read settled ${fact}, so the answer's ${field} is not checked`,
      );
    case 'disputed':
      return row(
        'unreachable',
        `the tool results the run read disagree about ${fact}, so the answer's ${field} cannot ` +
          `be checked against one of them`,
      );
    case 'settled-unknown':
      return row(
        'unreachable',
        `a tool result the run read settled ${fact} as unknown, so the answer's ${field} ` +
          `cannot be compared`,
      );
    case 'settled-doubt':
      return row(
        'unreachable',
        `a tool result the run read settled ${fact} only as null or 'unknown', so the ` +
          `answer's ${field} has nothing to agree with`,
      );
    case 'doubt-on-both-sides':
      return row(
        'unreachable',
        `${fact} was settled only as null or 'unknown', and the answer's ${field} gives no ` +
          `value either: agreement on doubt verifies nothing`,
      );
  }
}
