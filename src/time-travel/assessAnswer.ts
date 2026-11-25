import { assessAnswer as foldRecord } from '../core/agent/assessment/assess.js';
import type {
  AnswerAssessment,
  AssessmentDeclarations,
  AssessmentRecord,
} from '../core/agent/assessment/types.js';
import { recordedOmissions } from './selectionWitness.js';

/**
 * Fold one answer's standing from its committed record.
 *
 * The record of a turn that ended in an ANSWER or in a PAUSE (a pause reads
 * `ask`, from the committed state the pause leaves — no checkpoint needed). A
 * turn that ended in an error has no answer, and its committed state does not
 * say so in this version: do not fold it (`agent.assessment()` returns
 * `undefined` for one; the answer account says the record shows no answer).
 *
 * A selection omission needs its accepted request in the snapshot's commit log.
 * A checkpoint alone cannot establish which tool that request left out.
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
  return foldRecord(record, declarations, recordedOmissions(record?.snapshot));
}
