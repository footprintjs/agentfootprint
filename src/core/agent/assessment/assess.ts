/**
 * assess — the answer's standing, folded from the committed record.
 *
 * Pattern: one pure Fold over the Trace. It reads COMMITTED state only — the
 *          run's `sharedState` (the snapshot's, or a paused run's checkpoint's)
 *          and, for a selection omission, the accepted request that witnessed it.
 *          The running agent and later readers apply the same check. No clock, network, model or randomness; the
 *          same inputs give the same bytes; it never writes into the run.
 * Role:    core/ layer, pure. The one owner of the answer's standing: the
 *          `/observe` door publishes it (`assessAnswer`), `Agent.assessment`
 *          reads the last run through it, and the answer account's "How sure"
 *          row renders it (`answer-account/facts/howSure.ts` ·
 *          `readHowSure`).
 * Emits:   N/A.
 *
 * ## The law
 *
 * The standing comes from what the record can check, never from how sure the
 * model sounds — and never "known" from silence. A reason that fires makes it
 * `unknown`; only a TIE check (a passed enforce `.answerValidation()` report for
 * these bytes) SUPPORTS `known`; checks that ran and fired nothing make it
 * `unrefuted` ("consistent with the record"); a record on which nothing could be
 * checked is `not-applicable` ("not assessed"). A membership pass — a value
 * found, a result that came back non-empty — keeps a reason from firing and
 * never supports anything.
 *
 * ## This turn only
 *
 * The turn begins after the last message a person said
 * (`lib/saidByPerson.ts` · `isSaidByPerson`, the one owner of that question): a
 * continued conversation carries earlier turns' results in `history`, and a
 * library frame (a correction, a nudge) is not a person's turn. The fold reads
 * the tool results after that message, every coverage row of the run
 * (`coverageDeclared` is never carried into a next turn), the conflict rows of
 * this turn — one that names one of those calls, or one stamped with this turn
 * whose readings the record does not all place in earlier turns
 * (`conflictOfThisTurn`; the ledger IS carried, so rows about earlier turns'
 * calls are left out), and the answer's own rows (`unsupportedValues`, `stoppedEarly`,
 * `answerValidation`). "Rests on" includes every call of the turn.
 *
 * ## How the turn ended
 *
 * Every pause leaves `pausedToolCallId` in committed state until resume, so
 * a snapshot, checkpoint or recording reads it as `ask`. Readers settle an
 * error before they fold: `Agent.assessment` returns `undefined` and the answer
 * account says the record shows no answer.
 */

import type { OmissionCheck } from '../honesty/sourceOmission.js';
import { foldState } from './chart.js';
import type { RetainedReasonState } from './reasonDetails.js';
import { isRecord } from './recordValues.js';
import type { AnswerAssessment, AssessmentDeclarations, AssessmentRecord } from './types.js';
import { rowsAtProblem } from '../emptiness.js';
import { servedUnderPolicy } from '../../../redaction/marker.js';

export { foldState };

function fail(message: string): never {
  throw new TypeError(`assessAnswer: ${message}`);
}

/** A caller error throws; everything the RECORD holds is read, never refused. */
function checkInputs(record: unknown, declarations: unknown): void {
  if (!isRecord(record)) {
    fail('the record must be an object — a recording, { snapshot }, or { checkpoint }');
  }
  if (declarations === undefined) return;
  if (!isRecord(declarations)) fail('declarations must be an object');
  const tools = declarations.tools;
  if (tools === undefined) return;
  if (!isRecord(tools)) fail('declarations.tools must be an object keyed by tool name');
  for (const [tool, entry] of Object.entries(tools)) {
    if (!isRecord(entry)) fail(`declarations.tools.${tool} must be an object`);
    if (entry.rowsAt === undefined) continue;
    const problem = rowsAtProblem(entry.rowsAt);
    if (problem === 'empty') fail(`declarations.tools.${tool}.rowsAt must be a non-empty key`);
    if (problem === 'nested') {
      fail(`declarations.tools.${tool}.rowsAt must be a top-level key (no "/" or ".")`);
    }
  }
}

/** The committed state: the snapshot's, else the paused run's checkpoint's. */
function stateOf(record: AssessmentRecord): Readonly<Record<string, unknown>> {
  const fromSnapshot = isRecord(record.snapshot) ? record.snapshot.sharedState : undefined;
  if (isRecord(fromSnapshot)) return fromSnapshot;
  const fromCheckpoint = isRecord(record.checkpoint) ? record.checkpoint.sharedState : undefined;
  return isRecord(fromCheckpoint) ? fromCheckpoint : {};
}

/** Fold a saved record using the selection evidence supplied by its reader. */
export function assessAnswer(
  record: AssessmentRecord,
  declarations?: AssessmentDeclarations,
  checkOmission?: OmissionCheck,
): AnswerAssessment {
  checkInputs(record, declarations);
  // A placeholder is a kept-out value only in a snapshot served under a policy
  // (`redaction/marker.ts`); a checkpoint is never served.
  return foldState(
    stateOf(record),
    declarations,
    servedUnderPolicy(record.snapshot),
    undefined,
    undefined,
    record.events,
    undefined,
    checkOmission,
  );
}

/**
 * `assessAnswer` over a runner's LIVE snapshot (`Agent.assessment()`): the
 * state is the run's own heap, never served, so a placeholder string in it is
 * a value. The snapshot's `recorders` row says a policy covered the run — true
 * of its commit log, never of its live state — so it is not consulted here.
 *
 * @internal — `Agent · assessment`'s.
 */
export function assessLive(
  snapshot: unknown,
  declarations?: AssessmentDeclarations,
  retainedHistory?: (history: readonly unknown[]) => unknown,
  retainedReasonState?: RetainedReasonState,
  checkOmission?: OmissionCheck,
): AnswerAssessment {
  checkInputs({ snapshot }, declarations);
  return foldState(
    stateOf({ snapshot }),
    declarations,
    false,
    retainedHistory,
    undefined,
    undefined,
    retainedReasonState ?? (() => undefined),
    checkOmission,
  );
}
