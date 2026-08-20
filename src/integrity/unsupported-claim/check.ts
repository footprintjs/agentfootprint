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
import { comparableValueOf, participates } from '../assertion/types.js';
import { conflictsOf } from '../assertion/conflicts.js';
import type { ContextError } from '../finding/types.js';
import type { Disposition } from '../disposition/types.js';

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

const isDoubt = (value: unknown): boolean => value === null || value === 'unknown';

/** The stated one-direction leniency: '30' claims 30. */
function numericallyEqual(claimed: unknown, settled: unknown): boolean {
  return (
    typeof settled === 'number' &&
    typeof claimed === 'string' &&
    claimed.trim() !== '' &&
    Number(claimed) === settled
  );
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
    const claimed = readPath(answer, claim.answerField);
    if (claimed === undefined) {
      // The schema allowed the absence: the model claimed nothing here.
      dispositions.push({ claim: claim.answerField, disposition: 'not-applicable' });
      continue;
    }
    const rows = ledger.filter((r) => r.entity === claim.entity && r.field === claim.field);
    const settledRow = rows[rows.length - 1];
    if (settledRow === undefined || !participates(settledRow.value)) {
      // Never collected, or collected as an honest unknown — incomparable.
      dispositions.push({ claim: claim.answerField, disposition: 'unreachable' });
      continue;
    }

    const subject: SubjectRef = { kind: 'entity', id: claim.entity };
    const settledValue = comparableValueOf(settledRow.value);
    const ledgerProvenance =
      `${settledRow.toolName} (call ${settledRow.toolCallId}, iteration ` +
      `${String(settledRow.iteration)})` +
      (settledRow.measuredAt !== undefined ? `, measured_at ${String(settledRow.measuredAt)}` : '');

    if (isDoubt(claimed)) {
      // The model declined to claim a fact the run verified — an advisory.
      findings.push({
        kind: 'unsupported-claim',
        seam: 'claim',
        advisory: true,
        subjects: [subject],
        witnesses: [
          {
            subject,
            predicate: claim.field,
            value: settledRow.value,
            epoch,
            stratum: 'asserted',
            provenance: ledgerProvenance,
          },
        ],
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

    if (numericallyEqual(claimed, settledValue)) {
      dispositions.push({ claim: claim.answerField, disposition: 'checked-pass' });
      continue;
    }

    // The algebra decides "contradict" — the fences apply for free.
    const witnesses: Assertion[] = [
      {
        subject,
        predicate: claim.field,
        value: settledRow.value,
        epoch,
        stratum: 'asserted',
        provenance: ledgerProvenance,
      },
      {
        subject,
        predicate: claim.field,
        value: claimed,
        epoch,
        stratum: 'asserted',
        provenance: `answer field '${claim.answerField}'`,
      },
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
    if (conflictsOf(witnesses).length === 0) {
      dispositions.push({ claim: claim.answerField, disposition: 'checked-pass' });
      continue;
    }
    findings.push({
      kind: 'unsupported-claim',
      seam: 'claim',
      subjects: [subject],
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
