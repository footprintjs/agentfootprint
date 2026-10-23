/**
 * unsupported-claim — the answer's typed claims against the run's settled
 * facts, at the CLAIM seam.
 *
 * Pattern: pure function over (declared contract, ledger rows, parsed
 *          answer); same algebra, last seam.
 * Role:    the check the evidence gate states it cannot do — "a FALSE
 *          CLAIM ASSEMBLED FROM REAL VALUES" passes token grounding. Typed
 *          facts (semantics envelopes) make the contradiction
 *          representable; the DECLARED contract (`.claims()`, the
 *          `argumentsFrom` precedent: the author names the edge, the
 *          checker joins and never infers) makes it decidable.
 *
 * THE FENCES, because they are the check's honesty:
 * - TYPED STRATUM ONLY. The check reads the schema-validated answer
 *   object; prose files nothing, ever.
 * - LATEST SETTLES, EARLIER QUOTES. Only the last ledger row for a fact
 *   asserts; earlier rows ride as `quoted` witnesses — history is
 *   quotation, so claiming a superseded value is a contradiction WITH the
 *   history on the record.
 * - UNCOLLECTED IS UNREACHABLE. A declared claim whose fact no envelope
 *   ever carried is incomparable — never an accusation. Same for a ledger
 *   value that is itself an unknown/not-applicable Claim: honest absence
 *   propagates (`participates`).
 * - DOUBT IS AN ADVISORY, NOT A DEFECT. An answer of `null` or the literal
 *   string 'unknown' where the ledger holds a verified value files a
 *   finding marked `advisory: true` and counted APART — the model
 *   declining to claim is a softer fact than the model claiming wrong.
 * - ONE STATED LENIENCY: a numeric fact answered as its exact string
 *   ('30' for 30) is not a contradiction — models stringify numbers, and
 *   on an accusation boundary a representational difference is not a
 *   difference. One direction only, string-of-number toward number.
 */

import type { Assertion, SubjectRef } from '../assertion/types.js';
import { comparableValueOf } from '../assertion/types.js';
import type { ContextError } from '../finding/types.js';
import type { Disposition } from '../disposition/types.js';
import { evaluateClaimPair, type ClaimPairEvaluation } from './evaluate.js';

/** One entry of the operator's declared contract: answer field → ledger fact. */
export interface DeclaredClaim {
  /** Dot-path into the parsed answer object ('nav_count', 'report.nav_count'). */
  readonly answerField: string;
  readonly entity: string;
  readonly field: string;
}

/** One settled fact extracted from a semantics envelope during the run. */
export interface ClaimLedgerRow {
  readonly entity: string;
  readonly field: string;
  readonly value: unknown;
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  /** The envelope's provenance.measured_at, when it carried one. */
  readonly measuredAt?: string | number;
}

export interface ClaimCheckOutcome {
  readonly findings: readonly ContextError[];
  /** One disposition per declared claim — silence is never an option. */
  readonly dispositions: readonly { claim: string; disposition: Disposition }[];
}

/** Minimal dot-path read; `undefined` for any miss along the way. */
function readPath(answer: unknown, path: string): unknown {
  let cursor: unknown = answer;
  for (const key of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

/**
 * One declared claim, compared — the selection and the evaluation every
 * reader of a claim derives from (`unsupportedClaimsOf` here; the delivery
 * verdict in `delivered.ts`, which answer validation's rows read), so a row
 * can never accuse where the detector does not.
 *
 * - `omitted` — the answer does not state the field (the schema allowed it).
 * - `uncollected` — no ledger row settled the declared fact.
 * - `compared` — the latest row asserts, earlier rows ride as `rows`;
 *   `evaluation` is the shared pair evaluator's verdict (`evaluate.ts`).
 */
export type ClaimComparison =
  | { readonly kind: 'omitted' }
  | { readonly kind: 'uncollected' }
  | {
      readonly kind: 'compared';
      readonly evaluation: ClaimPairEvaluation;
      readonly claimed: unknown;
      readonly rows: readonly ClaimLedgerRow[];
      readonly settledRow: ClaimLedgerRow;
      readonly subject: SubjectRef;
      readonly ledgerProvenance: string;
      readonly evidence: Assertion;
      readonly assertion: Assertion;
    };

/**
 * Compare ONE declared claim of the parsed answer against the ledger. Pure.
 * Throws exactly what the pair evaluator throws (a value JSON cannot render).
 */
export function compareClaim(
  claim: DeclaredClaim,
  ledger: readonly ClaimLedgerRow[],
  answer: unknown,
  epoch: number,
): ClaimComparison {
  const claimed = readPath(answer, claim.answerField);
  if (claimed === undefined) return { kind: 'omitted' };
  const rows = ledger.filter((r) => r.entity === claim.entity && r.field === claim.field);
  const settledRow = rows[rows.length - 1];
  if (settledRow === undefined) return { kind: 'uncollected' };

  const subject: SubjectRef = { kind: 'entity', id: claim.entity };
  const ledgerProvenance =
    `${settledRow.toolName} (call ${settledRow.toolCallId}, iteration ` +
    `${String(settledRow.iteration)})` +
    (settledRow.measuredAt !== undefined ? `, measured_at ${String(settledRow.measuredAt)}` : '');

  const evidence: Assertion = {
    subject,
    predicate: claim.field,
    value: settledRow.value,
    epoch,
    stratum: 'asserted',
    provenance: ledgerProvenance,
  };
  const assertion: Assertion = {
    subject,
    predicate: claim.field,
    value: claimed,
    epoch,
    stratum: 'asserted',
    provenance: `answer field '${claim.answerField}'`,
  };
  return {
    kind: 'compared',
    evaluation: evaluateClaimPair(evidence, assertion),
    claimed,
    rows,
    settledRow,
    subject,
    ledgerProvenance,
    evidence,
    assertion,
  };
}

/**
 * Compare the parsed answer's declared claims against the ledger.
 * Pure; the caller files findings and dispositions.
 */
export function unsupportedClaimsOf(
  declared: readonly DeclaredClaim[],
  ledger: readonly ClaimLedgerRow[],
  answer: unknown,
  epoch: number,
): ClaimCheckOutcome {
  const findings: ContextError[] = [];
  const dispositions: { claim: string; disposition: Disposition }[] = [];

  for (const claim of declared) {
    const comparison = compareClaim(claim, ledger, answer, epoch);
    if (comparison.kind === 'omitted') {
      // The schema allowed the absence: the model claimed nothing here.
      dispositions.push({ claim: claim.answerField, disposition: 'not-applicable' });
      continue;
    }
    if (comparison.kind === 'uncollected') {
      // Never collected — incomparable, never an accusation.
      dispositions.push({ claim: claim.answerField, disposition: 'unreachable' });
      continue;
    }
    const {
      evaluation,
      claimed,
      rows,
      settledRow,
      subject,
      ledgerProvenance,
      evidence,
      assertion,
    } = comparison;
    if (evaluation === 'evidence-unavailable') {
      dispositions.push({ claim: claim.answerField, disposition: 'unreachable' });
      continue;
    }
    const settledValue = comparableValueOf(settledRow.value);

    if (evaluation === 'doubt-against-value') {
      // The model declined to claim a fact the run verified — an advisory.
      findings.push({
        kind: 'unsupported-claim',
        seam: 'claim',
        advisory: true,
        subjects: [subject],
        // Two fields of one entity are two disagreements: without the
        // predicate their identities collide and the second is deduplicated
        // away, leaving the event channel disagreeing with the ledger.
        predicate: claim.field,
        witnesses: [evidence],
        epoch,
        message:
          `The answer's '${claim.answerField}' says ${JSON.stringify(claimed)} while the run ` +
          `verified ${claim.field}(${claim.entity}) = ${JSON.stringify(settledValue)} ` +
          `(${ledgerProvenance}). Declining to claim a verified fact is doubt, not ` +
          `contradiction — filed as an advisory, counted apart.`,
      });
      dispositions.push({ claim: claim.answerField, disposition: 'checked-pass' });
      continue;
    }

    if (evaluation !== 'conflict') {
      // Preserve the existing diagnostic mapping, including both-doubt and
      // claim-nonparticipating. checked-pass here is NOT a support certificate.
      dispositions.push({ claim: claim.answerField, disposition: 'checked-pass' });
      continue;
    }

    const witnesses: Assertion[] = [
      evidence,
      assertion,
      // Earlier values ride as QUOTED history: legitimately superseded, on
      // the record so a reader sees the fact's whole life, never firing.
      ...rows.slice(0, -1).map(
        (r): Assertion => ({
          subject,
          predicate: claim.field,
          value: r.value,
          stratum: 'quoted',
          provenance: `${r.toolName} (call ${r.toolCallId}, iteration ${String(r.iteration)})`,
        }),
      ),
    ];
    findings.push({
      kind: 'unsupported-claim',
      seam: 'claim',
      subjects: [subject],
      predicate: claim.field,
      witnesses,
      epoch,
      message:
        `The answer's '${claim.answerField}' claims ${JSON.stringify(claimed)} but the run's ` +
        `settled fact is ${claim.field}(${claim.entity}) = ${JSON.stringify(settledValue)} ` +
        `(${ledgerProvenance}). The record supports the fact, not the claim — nothing here ` +
        `rewrites the answer; it makes the disagreement attributable.`,
    });
    dispositions.push({ claim: claim.answerField, disposition: 'checked-fail' });
  }
  return { findings, dispositions };
}
