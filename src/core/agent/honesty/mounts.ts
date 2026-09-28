/**
 * honesty/mounts — where the honesty layers' subflows mount, in ONE place both
 * chart builders call, so the twin builders cannot drift.
 *
 * Pattern: a conditional mount (the WrapUp precedent): a layer that is not
 *          armed adds nothing — no stage, no key, no event — so the chart is
 *          byte-identical to the one the agent always built.
 * Role:    core/agent. The one module that imports BOTH `findings/` (the
 *          ledger's merge and emit halves) and `arguments/` — which is how
 *          `arguments/` stays a leaf that never imports `findings/`.
 *
 * ## The inputs layer — `sf-inputs`, after the LLM call and before Route
 *
 * A footprintjs decider branch can loop only to a stage declared before the
 * decider and has no continuation of its own (footprintjs's builder,
 * `DeciderList._applyBranchLoop`), so "between CallLLM and ToolCalls" can only
 * mean after the LLM call and before Route. The layer runs once per batch and acts only when Route's own
 * predicate (`stages/route.ts` · `willDispatch`) says the batch dispatches.
 *
 * Handed (the input mapping, frozen inside the subflow): the batch
 * (`llmLatestToolCalls`, raw), the dispatch predicate's values and
 * `turnNumber` — and, only when this turn KEPT an answer the batch that asked
 * could not use (`arguments/kept.ts`), those answers. Never the ledger, never
 * a tool — tools are closures, read through the shared dispatch resolver
 * (`stages/toolResolver.ts`) so the rules checked are the rules of the
 * implementation that will run.
 *
 * Returned (the output mapping, `arrayMerge: Replace` — the loop-crossed mount
 * law): the rows, merged into the ledger in ONE write by the ledger's pure half
 * (`findings/ledger.ts` · `appendRows`), and `argumentResolutions`, one entry
 * per call to fill or refuse. Nothing to return → nothing is written.
 *
 * The stage bodies (`arguments/subflow.ts`) load through `import()` on first
 * use — the optional-family law — so a plain agent's graph never carries them.
 *
 * ## The answer layer — the head of the final branch
 *
 * A footprintjs decider branch is one node with no continuation, so the answer
 * layer cannot sit BETWEEN Route and Final; it heads the final branch instead
 * (adopted Q3). The final branch is a subflow, and footprintjs starts every
 * chart with a function stage, so the layer is that first stage:
 * `assess-answer`, then PrepareFinal (`startFinalBranch`). It reads the
 * committed keys the fold reads — only those the agent's arms can write
 * (`answerFoldReads`, decided at build) — and hands PrepareFinal the standing
 * as data inside the branch. It files no rows of its own: the witness rows it
 * folds are filed by the Route decider (`assessment/witness.ts`), and the
 * branch mount's output mapping receives the branch's RESULT (the answer
 * string every composition that mounts an agent reads), never its scope — so
 * the mapping stays byte-identical when the layer is armed.
 */

import { ArrayMergeMode } from 'footprintjs/advanced';
import { flowChart } from 'footprintjs';
import type { FlowChart, FlowChartBuilder, StructureRecorder, TypedScope } from 'footprintjs';

import { STAGE_IDS, SUBFLOW_IDS, milestoneTagsFor } from '../../../conventions.js';
import { keptThisTurn } from '../arguments/kept.js';
import type { ArgumentRow } from '../arguments/rows.js';
import type { ArgumentResolution, ToolOf } from '../arguments/resolve.js';
import type { InputsLayerDeps, InputsLayerState } from '../arguments/subflow.js';
import { appendRows, emitRow, type FindingsScope } from '../findings/ledger.js';
import type { FindingsRow } from '../findings/types.js';
import { willDispatch } from '../stages/route.js';
import type { AgentState } from '../types.js';

/** What an armed agent hands the inputs layer's mount — closures, never scope. */
export interface InputsMountDeps {
  /** The implementation that will answer a name — the shared dispatch resolver's. */
  readonly toolOf: ToolOf;
  /**
   * A before-tool middleware chain is configured (`.toolMiddleware()`), so a
   * rewrite can supersede one of the layer's rows (the call then ran with the
   * rewrite's value). Read by the final branch's "Assumed" block
   * (`stages/prepareFinal.ts` · `prepareFinalWithLimitsAndAssumedStage`),
   * which then reads `middlewareDecisions`; absent, that key can hold no tool
   * rewrite and is never read. The mount itself does not read it.
   */
  readonly rewrites?: true;
}

type StageModule = typeof import('../arguments/subflow.js');

let stageModule: Promise<StageModule> | undefined;

/** The four stage bodies, loaded once per process on first use. */
function loadStages(): Promise<StageModule> {
  stageModule ??= import('../arguments/subflow.js');
  return stageModule;
}

/** The ledger's emit half, one event per row, from inside the subflow. */
function emitRows(scope: TypedScope<InputsLayerState>, rows: readonly ArgumentRow[]): void {
  for (const row of rows) emitRow(scope as unknown as FindingsScope, row);
}

/**
 * The `sf-inputs` subflow: Declare → Verify → Record → Resolve, four thin
 * stages over the pure steps of `arguments/resolve.ts`.
 */
export function buildInputsSubflow(deps: InputsMountDeps): FlowChart {
  const layer: InputsLayerDeps = { toolOf: deps.toolOf, willDispatch, emitRows };
  type Stage = (scope: TypedScope<InputsLayerState>) => Promise<void>;
  const declare: Stage = async (scope) => (await loadStages()).declareArgumentsStage(scope, layer);
  const verify: Stage = async (scope) => (await loadStages()).verifyArgumentsStage(scope, layer);
  const record: Stage = async (scope) => (await loadStages()).recordArgumentsStage(scope, layer);
  const resolve: Stage = async (scope) => (await loadStages()).resolveArgumentsStage(scope, layer);
  return flowChart<InputsLayerState>('DeclareArguments', declare, STAGE_IDS.DECLARE_ARGUMENTS, {
    description:
      'Which calls of a dispatching batch carry argument rules, and which values are missing',
  })
    .addFunction(
      'VerifyArguments',
      verify as never,
      STAGE_IDS.VERIFY_ARGUMENTS,
      'Where each ruled value came from: the declared default, or the model',
    )
    .addFunction(
      'RecordArguments',
      record as never,
      STAGE_IDS.RECORD_ARGUMENTS,
      'One argument row per ruled argument per call, in the tool’s own argument view',
    )
    .addFunction(
      'ResolveArguments',
      resolve as never,
      STAGE_IDS.RESOLVE_ARGUMENTS,
      'The values the library fills, and the calls it refuses, for ToolCalls to apply',
    )
    .build();
}

/**
 * Mount the inputs layer after the LLM call and before Route — or return the
 * builder untouched when the layer is not armed (`deps === undefined`), so an
 * agent without it builds the chart it always built. Both chart builders call
 * this, at the same place.
 */
export function mountInputsLayer<B extends FlowChartBuilder>(
  builder: B,
  deps: InputsMountDeps | undefined,
): B {
  if (deps === undefined) return builder;
  return builder
    .addSubFlowChartNext(SUBFLOW_IDS.INPUTS, buildInputsSubflow(deps), 'Inputs', {
      inputMapper: (parent: Record<string, unknown>) => {
        // Read under Route's own short-circuit: the budget policy only once a
        // budget was hit (the key exists only on an agent that configured one).
        const costBudgetHit = parent.costBudgetHit as boolean | undefined;
        const costBudgetOnExceed =
          costBudgetHit === true
            ? (parent.costBudgetOnExceed as 'warn' | 'halt' | undefined)
            : undefined;
        // The answers this turn kept for a call it could not finish — the key
        // exists only after such a refusal, so every other run hands nothing.
        const kept = keptThisTurn(parent.argumentAnswersKept, parent.turnNumber as number);
        return {
          calls: (parent.llmLatestToolCalls as readonly unknown[] | undefined) ?? [],
          iteration: parent.iteration as number,
          maxIterations: parent.maxIterations as number,
          ...(costBudgetHit !== undefined && { costBudgetHit }),
          ...(costBudgetOnExceed !== undefined && { costBudgetOnExceed }),
          turnNumber: parent.turnNumber as number,
          ...(kept.length > 0 && { argumentAnswersKept: kept }),
        };
      },
      outputMapper: (sf: Record<string, unknown>, parent: Record<string, unknown>) => {
        const rows = (sf.argumentRows as readonly ArgumentRow[] | undefined) ?? [];
        const resolutions =
          (sf.argumentResolutions as readonly ArgumentResolution[] | undefined) ?? [];
        return {
          // ONE committed copy per layer run — the rows this batch filed,
          // merged by the ledger's pure half; the events already fired inside.
          ...(rows.length > 0 && {
            findingsLedger: appendRows(
              [...((parent.findingsLedger as readonly FindingsRow[] | undefined) ?? [])],
              rows,
            ).ledger,
          }),
          ...(resolutions.length > 0 && { argumentResolutions: [...resolutions] }),
        };
      },
      arrayMerge: ArrayMergeMode.Replace,
    })
    .tag(...milestoneTagsFor(SUBFLOW_IDS.INPUTS));
}

// ─── The answer layer (honesty layer 4) ─────────────────────────────────

/** A committed key the one fold (`assessment/assess.ts` · `assessAnswer`) reads. */
export type AnswerFoldKey =
  | 'history'
  | 'turnNumber'
  | 'pausedToolCallId'
  | 'findingsLedger'
  | 'coverageDeclared'
  | 'stoppedEarly'
  | 'unsupportedValues'
  | 'answerValidation'
  | 'argumentAsk'
  | 'middlewareDecisions';

/** What an agent with the answer layer armed hands the final branch — build-time facts, never scope. */
export interface AnswerMountDeps {
  /** The committed keys the fold reads — only those this agent's arms can write (`answerFoldReads`). */
  readonly reads: readonly AnswerFoldKey[];
  /** `.answerLayer({ standingLine: true })` — compose one line for a prose answer. */
  readonly standingLine?: true;
}

/**
 * THE READ LIST — which committed keys the answer layer's fold reads, from
 * the agent's arms: a key no arm of this agent can write is never read (a
 * tracked read of a key a run never writes is a phantom context source —
 * honesty law 9). Over-approximates on purpose: a key an arm CAN write is
 * read whether or not this run wrote it, so the in-run fold never misses a row
 * the read-after fold sees (the equality law).
 *
 * - always: `history`, `turnNumber`, `pausedToolCallId` (seed writes them),
 *   `findingsLedger` (the witness rows, and any rows a continued conversation
 *   restores — the restore is wired while a layer is armed) and
 *   `stoppedEarly` — the Route decider writes it on EVERY agent
 *   (`stages/route.ts` · `recordEarlyStop`): a limit cuts a turn short
 *   whenever the model asked for calls, whether or not this agent registered
 *   a tool that could answer them;
 * - a tool surface: `coverageDeclared` (only a tool that ran declares
 *   coverage);
 * - the evidence gate: `unsupportedValues`;
 * - `.answerValidation()`: `answerValidation`;
 * - the inputs layer: `argumentAsk`, and `middlewareDecisions` when a
 *   before-tool chain can rewrite a filled value.
 *
 * Every key's writers were checked against this list: a writer that no arm
 * gates puts its key in the always group — decide by the writer, never by the
 * usual path to it.
 *
 * @example
 * ```ts
 * answerFoldReads({ tools: true, evidenceGate: false, answerValidation: false, inputs: false, toolMiddleware: false });
 * // ['history', 'turnNumber', 'pausedToolCallId', 'findingsLedger', 'stoppedEarly', 'coverageDeclared']
 * ```
 */
export function answerFoldReads(arms: {
  readonly tools: boolean;
  readonly evidenceGate: boolean;
  readonly answerValidation: boolean;
  readonly inputs: boolean;
  readonly toolMiddleware: boolean;
}): readonly AnswerFoldKey[] {
  return [
    'history',
    'turnNumber',
    'pausedToolCallId',
    'findingsLedger',
    'stoppedEarly',
    ...(arms.tools ? (['coverageDeclared'] as const) : []),
    ...(arms.evidenceGate ? (['unsupportedValues'] as const) : []),
    ...(arms.answerValidation ? (['answerValidation'] as const) : []),
    ...(arms.inputs ? (['argumentAsk'] as const) : []),
    ...(arms.inputs && arms.toolMiddleware ? (['middlewareDecisions'] as const) : []),
  ];
}

type AnswerStageModule = typeof import('../assessment/stage.js');

let answerStageModule: Promise<AnswerStageModule> | undefined;

/** The answer layer's stage body, loaded once per process on the first armed answer. */
function loadAnswerStage(): Promise<AnswerStageModule> {
  answerStageModule ??= import('../assessment/stage.js');
  return answerStageModule;
}

/** PrepareFinal's description — one string, whichever stage heads the branch. */
const PREPARE_FINAL_DESCRIPTION = 'Capture turn payload (finalContent + newMessages)';

/**
 * Start the final branch: the answer layer's stage first when it is armed,
 * then PrepareFinal — or PrepareFinal alone when it is not, built exactly as
 * both chart builders always built it (same name, stage id, options and tags),
 * so an agent without the layer builds a byte-identical branch. Both builders
 * call this, so the twins cannot drift.
 */
export function startFinalBranch(
  answer: AnswerMountDeps | undefined,
  prepareFinal: (scope: TypedScope<AgentState>) => void | Promise<void>,
  structureRecorders: readonly StructureRecorder[] | undefined,
): FlowChartBuilder<any, TypedScope<AgentState>> {
  const recorders = structureRecorders !== undefined && {
    structureRecorders: [...structureRecorders],
  };
  if (answer === undefined) {
    return flowChart<AgentState>('PrepareFinal', prepareFinal, STAGE_IDS.PREPARE_FINAL, {
      ...recorders,
      description: PREPARE_FINAL_DESCRIPTION,
      tags: milestoneTagsFor(STAGE_IDS.PREPARE_FINAL),
    });
  }
  const assess = async (scope: TypedScope<AgentState>): Promise<void> =>
    (await loadAnswerStage()).assessAnswerStage(scope, answer);
  return flowChart<AgentState>('AssessAnswer', assess, STAGE_IDS.ASSESS_ANSWER, {
    ...recorders,
    description: "The answer's standing, folded from the run's committed record",
  })
    .addFunction(
      'PrepareFinal',
      prepareFinal as never,
      STAGE_IDS.PREPARE_FINAL,
      PREPARE_FINAL_DESCRIPTION,
    )
    .tag(...milestoneTagsFor(STAGE_IDS.PREPARE_FINAL));
}
