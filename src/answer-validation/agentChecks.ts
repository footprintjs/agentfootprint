/**
 * The agent's own answer checks as rows of an answer-validation report
 * (`AnswerValidationOptions.agentChecks`).
 *
 * Pattern: pure adapters, one verdict in, `AnswerCheck` rows out.
 * Role:    the one place the library's own checks speak the report's
 *          vocabulary. `claimChecksOf` judges the candidate this validation
 *          delivers through the claim seam's own comparison
 *          (`integrity/unsupported-claim/check.ts` · `compareClaim`), so the
 *          seam and its row can never compare differently. `evidenceCheckOf`
 *          reads the evidence gate's verdict on that same candidate — asked of
 *          it through an `EvidenceJudge`, never the verdict on the model's
 *          draft, which an output transform may have changed.
 *
 * Two laws, both from the standing fold (`core/agent/assessment/assess.ts`):
 *   - A membership pass never verifies. The gate's clean verdict is
 *     `not-applicable`, so the gate can withhold an answer and can never be
 *     what makes a report `passed` (which the fold reads as "known").
 *   - Declining is not claiming. A field the answer leaves out, or states as
 *     `null` / `'unknown'` where the run settled a value, is `not-applicable`
 *     (null against a settled null is agreement, a pass); the detector's legacy
 *     ledger maps doubt to `checked-pass`, which is no certificate.
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
  type ClaimComparison,
  type ClaimLedgerRow,
  type DeclaredClaim,
} from '../integrity/unsupported-claim/check.js';
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
 * on `candidate` against the ledger's latest row for each declared fact.
 * Throws what the claim comparison throws (a ledger value JSON cannot render).
 */
export function claimChecksOf(
  declared: readonly DeclaredClaim[],
  ledger: readonly ClaimLedgerRow[],
  candidate: unknown,
  epoch: number,
): AnswerCheck[] {
  return declared.map((claim) => claimRowOf(claim, compareClaim(claim, ledger, candidate, epoch)));
}

function claimRowOf(claim: DeclaredClaim, comparison: ClaimComparison): AnswerCheck {
  const field = `'${claim.answerField}'`;
  // The fact by its FIELD only: an app may declare the entity per user.
  const fact = `the fact '${claim.field}'`;
  const row = (disposition: Disposition, reason?: string): AnswerCheck =>
    Object.freeze({
      id: `${AGENT_CHECK_PREFIX}claims:${claim.answerField}`,
      disposition,
      path: claim.answerField,
      ...(reason !== undefined && { reason }),
    });
  if (comparison.kind === 'omitted')
    return row('not-applicable', `the answer does not state ${field}`);
  if (comparison.kind === 'uncollected') {
    return row(
      'unreachable',
      `no tool result the run read settled ${fact}, so the answer's ${field} has nothing to agree with`,
    );
  }
  switch (comparison.evaluation) {
    case 'conflict':
      return row('checked-fail', `the answer's ${field} contradicts ${fact} a tool settled`);
    case 'evidence-unavailable':
      return row(
        'unreachable',
        `the run settled ${fact} as unknown, so the answer's ${field} cannot be compared`,
      );
    case 'doubt-against-value':
    case 'claim-nonparticipating':
      return row('not-applicable', `the answer declines to state ${field}`);
    case 'no-conflict':
    case 'numeric-leniency':
    case 'both-doubt':
      return row('checked-pass');
  }
}
