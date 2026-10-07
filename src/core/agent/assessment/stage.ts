/**
 * assessment/stage — the answer layer's run-time half (honesty layer 4): ONE
 * stage at the head of the final branch that folds the answer's standing from
 * the committed record, files it as data for PrepareFinal, and announces it.
 *
 * Pattern: Fold + Lens over the Trace. The stage reads committed state only —
 *          the keys the one fold reads, value-conditionally (`reads`, decided
 *          at build from the agent's arms) — runs `assessAnswer` over them,
 *          and serves the result three ways: `answerAssessment` for
 *          PrepareFinal's `turn_end.answerAssessment`, one
 *          `agentfootprint.answer.assessed` event, and — under its own arm —
 *          one line for the person (`compose.ts` · `standingLineOf`).
 * Role:    core/ layer. Loaded through `import()` by the mount
 *          (`honesty/mounts.ts` · `startFinalBranch`) on the first armed
 *          answer — the optional-family law — so a plain agent's graph never
 *          carries it, the fold or the composer.
 * Emits:   `agentfootprint.answer.assessed` — once per answer: the value, its
 *          rendering, the reason kinds and the checks that ran. Never a value
 *          or a quote.
 *
 * ## The equality law
 *
 * The in-run standing IS the read-after standing: this stage folds the same
 * committed keys `assessAnswer(recording)` reads afterwards, with the same
 * pure function, at the one moment nothing after it can change them — after
 * the Route decider committed its verdicts and witness rows, before the final
 * branch captures the turn (which writes nothing the fold reads). Pinned by
 * `test/core/agent/assessment/answer-layer-equality.test.ts` across pause and
 * resume, a continued conversation, typed answers, the evidence revision, a
 * limit that cut the turn short, and an agent mounted in a composition.
 *
 * ## Why one stage, and not a subflow
 *
 * The design drew the layer as a subflow heading the final branch. footprintjs
 * starts every chart with a function stage (`FlowChartBuilder.start`), so a
 * subflow cannot be the first node of the final branch without an empty stage
 * before it — and a nested mount would commit a second copy of the history the
 * final branch was handed, in its own seed. The final branch is already an
 * isolated subflow, and the layer's run-time work is one fold: one stage keeps
 * the isolation the design wanted without either cost. Its verdicts are
 * DECLARED and VERIFIED where they always were (the Route decider's checks),
 * RECORDED there too (the witness rows, `witness.ts`), and FOLDED here.
 */

import type { TypedScope } from 'footprintjs';

import { typedEmit } from '../../../recorders/core/typedEmit.js';
import type { AgentState } from '../types.js';
import { validatedAnswerMayDeliver } from '../stages/prepareFinal.js';
import { assessAnswer } from './assess.js';
import {
  assessmentDataOf,
  assumedValuesSourceOf,
  rewrittenBehind,
  standingLineOf,
  type AnswerAssessmentData,
  type StandingAssumedValue,
} from './compose.js';

/** What the mount hands the stage — build-time facts, never scope. */
export interface AnswerStageDeps {
  /** The committed keys the fold reads — only those this agent's arms can write. */
  readonly reads: readonly string[];
  /** `.answerLayer({ standingLine: true })` — compose the line for the person. */
  readonly standingLine?: true;
  /** `.answerValidation()` is armed: an answer its report withholds is never assessed. */
  readonly validated?: true;
}

/**
 * The fold's record, read off the final branch's scope: each key in `reads`
 * that holds a value, as the committed object itself (`$getValue` — never a
 * live proxy; the fold only reads). A key no stage wrote is simply absent, as
 * it is from the snapshot a later reader folds.
 */
function committedRecordOf(
  scope: TypedScope<AgentState>,
  reads: readonly string[],
): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const key of reads) {
    const value = scope.$getValue(key);
    if (value !== undefined) record[key] = value;
  }
  return record;
}

/**
 * This turn's assumed values for the line — the "Assumed" block's own reading
 * (`arguments/serve.ts` · `assumedLinesFor`), over the same record the fold
 * read, from the source `compose.ts` · `assumedValuesSourceOf` chooses (the
 * answer account rebuilds the line from the same choice). The reader loads
 * only when the fold says a value was assumed.
 */
async function assumedValuesOf(
  data: AnswerAssessmentData,
  record: Readonly<Record<string, unknown>>,
): Promise<readonly StandingAssumedValue[]> {
  const source = assumedValuesSourceOf(data.reasons, record);
  if (source === undefined) return [];
  const { assumedLinesFor } = await import('../arguments/serve.js');
  return assumedLinesFor(source.ledger, source.turn, source.readDecisions);
}

/**
 * The answer layer's stage: fold, file, announce — and, under its own arm,
 * compose the line. Label only: it never asks, refuses or edits the reply.
 */
export async function assessAnswerStage(
  scope: TypedScope<AgentState>,
  deps: AnswerStageDeps,
): Promise<void> {
  const record = committedRecordOf(scope, deps.reads);
  // An answer answer validation withholds is never delivered, so it is never
  // assessed — decided from the report the fold already read (no other read);
  // PrepareFinal's guard then stops the branch.
  if (
    deps.validated === true &&
    !validatedAnswerMayDeliver(record.answerValidation as AgentState['answerValidation'])
  ) {
    return;
  }
  const assessed = assessAnswer({ snapshot: { sharedState: record } });
  // Filed for PrepareFinal (`turn_end.answerAssessment`), one stage later.
  scope.answerAssessment = assessmentDataOf(assessed);
  // The event carries its own fresh copy — detached plain data, never the
  // object the scope now holds (deferred delivery clones what it captures).
  typedEmit(scope, 'agentfootprint.answer.assessed', {
    turn: scope.turnNumber as number,
    iteration: scope.iteration as number,
    ...assessmentDataOf(assessed),
  });
  if (deps.standingLine !== true) return;
  const data = assessmentDataOf(assessed);
  const assumed = await assumedValuesOf(data, record);
  scope.answerStandingLine = standingLineOf(data, assumed, rewrittenBehind(assessed));
}
