/**
 * assess — the answer's standing, folded from the committed record.
 *
 * Pattern: one pure Fold over the Trace. It reads COMMITTED state only — the
 *          run's `sharedState` (the snapshot's, or a paused run's checkpoint's)
 *          — and never an event, so the running agent and every later reader
 *          fold the same bytes. No clock, network, model or randomness; the
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

/**
 * Fold one answer's standing from its committed record.
 *
 * The record of a turn that ended in an ANSWER or in a PAUSE (a pause reads
 * `ask`, from the committed state the pause leaves — no checkpoint needed). A
 * turn that ended in an error has no answer, and its committed state does not
 * say so in this version: do not fold it (`agent.assessment()` returns
 * `undefined` for one; the answer account says the record shows no answer).
 *
 * @param record        a recording (`recordRun`), `{ snapshot }`, or a paused
 *                      run's `{ checkpoint }` — its `sharedState` is read when
 *                      no snapshot is given.
 * @param declarations  what the APP declares — any `AnswerAccountDeclarations`
 *                      is accepted as it is: the fold reads only
 *                      `tools[name].rowsAt`, where an object result keeps its
 *                      rows.
 * @throws TypeError only on a caller error (a record that is not an object, a
 *                   malformed `rowsAt`); a record it cannot read yields
 *                   `not-applicable`, never a throw.
 *
 * A REDACTED record (an agent's `redact`): when the fold would read a state key
 * the record keeps out, it gives no verdict — `standing: 'not-assessed'`, with
 * the keys it needed in `keptOut`. A verdict over the placeholder would read a
 * kept-out pause as a pause and a kept-out history as an empty one.
 *
 * @example
 * ```ts
 * import { assessAnswer, recordRun } from 'agentfootprint/observe';
 *
 * const recorder = recordRun(agent);
 * await agent.run({ message: 'Which ports on switch A are down?' });
 * const a = assessAnswer(recorder.toRecording());
 * a.standing; // 'not-sure'
 * a.reasons;  // [{ reason: 'empty-undeclared', layer: 3, witness: [...] }]
 * ```
 */
export function assessAnswer(
  record: AssessmentRecord,
  declarations?: AssessmentDeclarations,
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
  );
}
