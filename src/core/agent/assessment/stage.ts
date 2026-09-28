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
import type { FindingsLedger } from '../findings/types.js';
import type { AgentState } from '../types.js';
import { assessAnswer } from './assess.js';
import { assessmentDataOf, standingLineOf, type StandingAssumedValue } from './compose.js';
import type { AnswerAssessment } from './types.js';

/** What the mount hands the stage — build-time facts, never scope. */
export interface AnswerStageDeps {
  /** The committed keys the fold reads — only those this agent's arms can write. */
  readonly reads: readonly string[];
  /** `.answerLayer({ standingLine: true })` — compose the line for the person. */
  readonly standingLine?: true;
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

/** The fold's argument-assumed witnesses that point at a before-tool rewrite, not at a row. */
function rewrittenBehind(assessed: AnswerAssessment): boolean {
  return assessed.reasons.some(
    (r) =>
      r.reason === 'argument-assumed' &&
      r.witness.some((w) => w.kind === 'state' && w.key === 'middlewareDecisions'),
  );
}

/**
 * This turn's assumed values for the line — the "Assumed" block's own reading
 * (`arguments/serve.ts` · `assumedLinesFor`), over the same record the fold
 * read, loaded only when the fold says a value was assumed.
 */
async function assumedValuesOf(
  assessed: AnswerAssessment,
  record: Readonly<Record<string, unknown>>,
): Promise<readonly StandingAssumedValue[]> {
  if (!assessed.reasons.some((r) => r.reason === 'argument-assumed')) return [];
  const ledger = (record.findingsLedger as FindingsLedger | undefined) ?? [];
  const turn = record.turnNumber;
  if (typeof turn !== 'number' || !ledger.some((row) => row.kind === 'argument')) return [];
  const { assumedLinesFor } = await import('../arguments/serve.js');
  const decisions = record.middlewareDecisions;
  return assumedLinesFor(
    ledger,
    turn,
    Array.isArray(decisions) ? () => decisions as readonly unknown[] : undefined,
  );
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
  const assumed = await assumedValuesOf(assessed, record);
  scope.answerStandingLine = standingLineOf(
    assessmentDataOf(assessed),
    assumed,
    rewrittenBehind(assessed),
  );
}
