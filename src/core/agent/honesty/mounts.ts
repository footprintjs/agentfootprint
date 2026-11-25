import { findingsReferenceRefusal, type FindingsRequest } from '../findings/admission.js';
import { ownsReservedArgument, splitFindings } from '../findings/reserved.js';
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
 * ## Declared sources (`.findings({ argumentSources: true })`, `.inputsLayer({ argumentSources: true })`)
 *
 * Under the arm the mount also hands the layer the RAW pieces its checks read
 * (`sourceInputs`): the served history, the composed system prompt's records,
 * the ledger's standing rows and `answered` argument rows (never the whole
 * ledger), the previous batch's result ids, the run's `userMessageFrom`
 * constant and the receipt of the tickets the library placed (all read by
 * `sourceInputs.ts` · `sourceInputsOf`) — and two closures, both from
 * `honesty/sourceCorpus.ts` (loaded on the first armed batch): the calls'
 * `from` entries through the ONE reader of
 * `_findings` (`sourceCorpus.ts` · `declaredSourcesOf`, over
 * `findings/reserved.ts` · `readDeclaration`), and the corpora
 * (`sourceCorpus.ts` · `sourceCorpusOf`).
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

import { STAGE_IDS, SUBFLOW_IDS, milestoneTagsFor } from '../../../lib/conventions.js';
import { sourceInputsOf } from './sourceInputs.js';
import { timeInputsOf } from './timeInputs.js';
import type { SourceCorpus } from '../arguments/checks.js';
import {
  isRefused,
  periodArgumentOf as periodArgumentNamed,
  periodFactsOf as periodFactsDeclared,
  periodFormsOf as periodFormsDeclared,
  rulesOf,
} from '../../../tools/declare.js';
import { keptThisTurn } from '../arguments/kept.js';
import type { ArgumentRow } from '../arguments/rows.js';
import type { ArgumentResolution, BatchCall, ToolOf } from '../arguments/resolve.js';
import type { InputsLayerDeps, InputsLayerState, SourceInputs } from '../arguments/subflow.js';
import type { PeriodFacts, PeriodForm } from '../../../time/convert.js';
import type { CallWindowRow } from '../../../time/rows.js';

import type { PeriodRow } from '../../../semantics/coverage/period.js';
import { appendRows, emitRow, type FindingsScope } from '../findings/ledger.js';
import type { FindingsRow } from '../findings/types.js';
import type { ResultsLayerDeps, ResultsLayerState } from '../results/subflow.js';
import { resultsLayerInput } from './resultsInput.js';
import type { AnswerFoldKey } from './answerFoldReads.js';
import { willDispatch } from '../stages/route.js';
import type { AgentState } from '../types.js';
import type { InputsMountDeps } from './inputsMountContract.js';
export type { InputsMountDeps } from './inputsMountContract.js';
export { batchToJudge, timeOfBatch } from './resultsInput.js';

type StageModule = typeof import('../arguments/subflow.js');
type CorpusModule = typeof import('./sourceCorpus.js');

let corpusModule: Promise<CorpusModule> | undefined;

/** The corpus builder, loaded once per process on first use (the optional-family law). */
function loadCorpus(): Promise<CorpusModule> {
  corpusModule ??= import('./sourceCorpus.js');
  return corpusModule;
}

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
  const sources = deps.sources;
  const layerOf = (scope: object): InputsLayerDeps | Promise<InputsLayerDeps> => {
    const toolOf = deps.toolOfFor(scope);
    const base: InputsLayerDeps = {
      toolOf,
      willDispatch,
      emitRows,
      ...(deps.declarationCorrection !== undefined && {
        declarationCorrection: deps.declarationCorrection,
      }),
      ...(deps.time !== undefined && { time: deps.time }),
      ...(deps.toolsOffAfterRevision === true && { toolsOffAfterRevision: true as const }),
    };
    // Declared sources: the reader of each call's `from` and the corpora the checks
    // read live in `sourceCorpus.ts`, loaded on the first armed batch — so neither
    // is on a plain agent's graph.
    if (sources === undefined) return base;
    return loadCorpus().then((corpus) => ({
      ...base,
      sources: {
        ...(sources.argumentViews === true && { argumentViews: true as const }),
        declaredOf: (calls: readonly BatchCall[]) =>
          corpus.declaredSourcesOf(
            calls,
            toolOf,
            sources.basisRows === true || deps.declarationCorrection !== undefined
              ? {
                  ...(sources.basisRows === true && { basisRows: true }),
                  ...(deps.declarationCorrection !== undefined && { declarationCorrection: true }),
                }
              : undefined,
          ),
        corpusOf: async (
          inputs: SourceInputs,
          calls: readonly BatchCall[],
          turn: number,
        ): Promise<SourceCorpus> =>
          corpus.sourceCorpusOf(inputs, calls, turn, {
            toolOf,
            ...(sources.externalGrounds !== undefined && {
              externalGrounds: sources.externalGrounds,
            }),
          }),
      },
    }));
  };
  type Stage = (scope: TypedScope<InputsLayerState>) => Promise<void>;
  const declare: Stage = async (scope) =>
    (await loadStages()).declareArgumentsStage(scope, await layerOf(scope));
  const verify: Stage = async (scope) =>
    (await loadStages()).verifyArgumentsStage(scope, await layerOf(scope));
  const record: Stage = async (scope) =>
    (await loadStages()).recordArgumentsStage(scope, await layerOf(scope));
  const resolve: Stage = async (scope) =>
    (await loadStages()).resolveArgumentsStage(scope, await layerOf(scope));
  return flowChart<InputsLayerState>('DeclareArguments', declare, STAGE_IDS.DECLARE_ARGUMENTS, {
    description:
      'Which calls of a dispatching batch carry argument rules, and which values are missing',
  })
    .addFunction(
      'VerifyArguments',
      verify as never,
      STAGE_IDS.VERIFY_ARGUMENTS,
      sources === undefined
        ? 'Where each ruled value came from: the declared default, or the model'
        : 'Where each value came from: the source the model declared, checked — or the declared default',
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
      inputMapper: (parent: Record<string, unknown>, binding) => {
        if (binding === undefined) throw new TypeError('Inputs require the native parent binding');
        const toolOf = deps.toolOfFor(binding);
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
        const proposed = (parent.llmLatestToolCalls as readonly BatchCall[] | undefined) ?? [];
        const calls =
          deps.findings === true
            ? proposed.filter((call) => {
                const schema = toolOf(call.name)?.schema;
                if (
                  schema !== undefined &&
                  ownsReservedArgument({
                    name: schema.name,
                    description: '',
                    inputSchema: schema.inputSchema ?? {},
                  })
                )
                  return true;
                const declaration = splitFindings(call.args);
                return (
                  findingsReferenceRefusal(
                    declaration.findings,
                    (parent.findingsRequest as readonly [FindingsRequest] | undefined)?.[0],
                    parent.iteration as number,
                    declaration.malformed,
                  ) === undefined
                );
              })
            : proposed;
        // The time layer: this turn's clock and readings — only under the arm, for a batch with calls.
        const timeInputs =
          deps.time !== undefined && calls.length > 0 ? timeInputsOf(parent) : undefined;
        return {
          calls,
          iteration: parent.iteration as number,
          maxIterations: parent.maxIterations as number,
          ...(costBudgetHit !== undefined && { costBudgetHit }),
          ...(costBudgetOnExceed !== undefined && { costBudgetOnExceed }),
          // Route's sixth dispatch value: the key exists only on a run whose
          // tools went off after the evidence revision, so every other run
          // hands nothing new.
          ...(deps.toolsOffAfterRevision === true &&
            parent.toolsOffAfterRevision === true && { toolsOff: true as const }),
          turnNumber: parent.turnNumber as number,
          ...(kept.length > 0 && { argumentAnswersKept: kept }),
          // Declared sources: the pieces the checks read — only under the arm,
          // and only for a batch with calls to check.
          ...(deps.sources !== undefined &&
            calls.length > 0 && { sourceInputs: sourceInputsOf(parent) }),
          ...(timeInputs !== undefined && { timeInputs }),
        };
      },
      outputMapper: (sf: Record<string, unknown>, parent: Record<string, unknown>) => {
        const rows: readonly FindingsRow[] = [
          ...((sf.argumentRows as readonly ArgumentRow[] | undefined) ?? []),
          // The time layer's `call-window` rows ride the same ONE write; they fire no event.
          ...((sf.argumentWindowRows as readonly CallWindowRow[] | undefined) ?? []),
        ];
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
          ...(deps.declarationCorrection !== undefined && {
            argumentSourceOmissionRows: [
              ...((sf.argumentSourceOmissionRows as readonly ArgumentRow[] | undefined) ?? []),
            ],
          }),
        };
      },
      arrayMerge: ArrayMergeMode.Replace,
    })
    .tag(...milestoneTagsFor(SUBFLOW_IDS.INPUTS));
}

// ─── The results layer — `sf-results`, at the loop head (honesty layer 3) ──

/** What an armed agent hands the results layer's mount — closures, never scope. */
export interface ResultsMountDeps {
  /** The implementation that answered a name — the shared dispatch resolver's. */
  readonly toolOfFor: (scope: object) => ToolOf;
}

type ResultsStageModule = typeof import('../results/subflow.js');

let resultsModule: Promise<ResultsStageModule> | undefined;

/** The results layer's stage bodies, loaded once per process on first use. */
function loadResultsStages(): Promise<ResultsStageModule> {
  resultsModule ??= import('../results/subflow.js');
  return resultsModule;
}

/** The ledger's emit half, one `findings.period` event per row, from inside the subflow. */
function emitPeriodRows(scope: TypedScope<ResultsLayerState>, rows: readonly PeriodRow[]): void {
  for (const row of rows) emitRow(scope as unknown as FindingsScope, row);
}

/**
 * The argument a tool's `ToolPeriod` names — read off the implementation that
 * answered the name, by the inputs layer's own reader (`tools/declare.ts` ·
 * `rulesOf`): a `ToolPeriod` is that layer's declaration, and this layer only
 * reads it. A tool whose rules cannot be read declares nothing here (its calls
 * were refused, never run).
 */
function periodArgumentOf(toolOf: ToolOf): (toolName: string) => string | undefined {
  return (toolName) => {
    const rules = rulesOf(toolOf(toolName));
    return rules === undefined || isRefused(rules) ? undefined : periodArgumentNamed(rules.period);
  };
}

/**
 * The facts a tool's `ToolPeriod` declares about its source (`retention`,
 * `granularity`, …) — read by the same reader, for the time layer's result
 * checks (step T8). A tool whose rules cannot be read declares none.
 */
function periodFactsOf(toolOf: ToolOf): (toolName: string) => PeriodFacts | undefined {
  return (toolName) => {
    const rules = rulesOf(toolOf(toolName));
    return rules === undefined || isRefused(rules) ? undefined : periodFactsDeclared(rules.period);
  };
}

/**
 * The forms a tool's `ToolPeriod` declares — read by the same reader, so the
 * result checks know whether a call SENT a look-back (§ 7.4, step T8).
 */
function periodFormsOf(toolOf: ToolOf): (toolName: string) => readonly PeriodForm[] | undefined {
  return (toolName) => {
    const rules = rulesOf(toolOf(toolName));
    return rules === undefined || isRefused(rules) ? undefined : periodFormsDeclared(rules.period);
  };
}

/**
 * The `sf-results` subflow: Declare → Verify → Record → Resolve, four thin
 * stages over the pure steps of `results/subflow.ts`.
 */
export function buildResultsSubflow(deps: ResultsMountDeps): FlowChart {
  const layerOf = (scope: object): ResultsLayerDeps => {
    const toolOf = deps.toolOfFor(scope);
    return {
      periodArgumentOf: periodArgumentOf(toolOf),
      periodFactsOf: periodFactsOf(toolOf),
      periodFormsOf: periodFormsOf(toolOf),
      emitRows: emitPeriodRows,
    };
  };
  type Stage = (scope: TypedScope<ResultsLayerState>) => Promise<void>;
  const declare: Stage = async (scope) =>
    (await loadResultsStages()).declareResultsStage(scope, layerOf(scope));
  const verify: Stage = async (scope) => (await loadResultsStages()).verifyResultsStage(scope);
  const record: Stage = async (scope) =>
    (await loadResultsStages()).recordResultsStage(scope, layerOf(scope));
  const resolve: Stage = async () => (await loadResultsStages()).resolveResultsStage();
  return flowChart<ResultsLayerState>('DeclareResults', declare, STAGE_IDS.DECLARE_RESULTS, {
    description:
      'Which calls of the batch just run declared a period, or come from a tool that declares one',
  })
    .addFunction(
      'VerifyResults',
      verify as never,
      STAGE_IDS.VERIFY_RESULTS,
      'The verdict on each period: covered, partly held, not held, unknown — or undeclared',
    )
    .addFunction(
      'RecordResults',
      record as never,
      STAGE_IDS.RECORD_RESULTS,
      'One period row per judged call, on the one ledger',
    )
    .addFunction(
      'ResolveResults',
      resolve as never,
      STAGE_IDS.RESOLVE_RESULTS,
      'Flag — a result that already ran is never asked about, filled or refused',
    )
    .build();
}

/**
 * Mount the results layer at the LOOP HEAD — or return the builder untouched
 * when the layer is not armed (`deps === undefined`), so an agent without it
 * builds the chart it always built. Both chart builders call this at the same
 * place — immediately before the window strategy's `Compact` stage (or the
 * loop target that stands there) — and make the mount the loop target
 * (`RESULTS_LOOP_TARGET`), the `Compact` precedent: the layer reads the batch
 * just run before any window strategy folds it away.
 *
 * Returned (the output mapping, `arrayMerge: Replace` — the loop-crossed mount
 * law): the rows, merged into the ledger in ONE write by the ledger's pure
 * half. Nothing to return → nothing is written.
 */
export function mountResultsLayer<B extends FlowChartBuilder>(
  builder: B,
  deps: ResultsMountDeps | undefined,
): B {
  if (deps === undefined) return builder;
  return builder
    .addSubFlowChartNext(SUBFLOW_IDS.RESULTS, buildResultsSubflow(deps), 'Results', {
      inputMapper: resultsLayerInput,
      outputMapper: (sf: Record<string, unknown>, parent: Record<string, unknown>) => {
        const rows = (sf.periodRows as readonly PeriodRow[] | undefined) ?? [];
        return rows.length === 0
          ? {}
          : {
              // ONE committed copy per layer run — the rows this batch filed,
              // merged by the ledger's pure half; the events already fired inside.
              findingsLedger: appendRows(
                [...((parent.findingsLedger as readonly FindingsRow[] | undefined) ?? [])],
                rows,
              ).ledger,
            };
      },
      arrayMerge: ArrayMergeMode.Replace,
    })
    .tag(...milestoneTagsFor(SUBFLOW_IDS.RESULTS));
}

/** The loop target the results layer's mount becomes when armed — `tool-calls` and every re-ask loop back to it. */
export const RESULTS_LOOP_TARGET: string = SUBFLOW_IDS.RESULTS;

// ─── The answer layer (honesty layer 4) ─────────────────────────────────

/** What an agent with the answer layer armed hands the final branch — build-time facts, never scope. */
export interface AnswerMountDeps {
  readonly omissionCheckFor?: (
    scope: object,
  ) => import('./sourceOmission.js').OmissionCheck | undefined;
  /** The committed keys the fold reads — only those this agent's arms can write (`answerFoldReads`). */
  readonly reads: readonly AnswerFoldKey[];
  /**
   * `.answerLayer({ standingLine })` — compose one line for a prose answer, in
   * the answers its mode says it for (`true` is `'always'`).
   */
  readonly standingLine?: import('../assessment/compose.js').StandingLineWhen;
  /** `.answerValidation()` is armed: an answer its report withholds is never assessed. */
  readonly validated?: true;
  /**
   * A tool's `displayName` (the app's words), read through the agent's own
   * tools — present only where a tool can declare one; the line names a
   * reason's calls in those words (`assessment/stage.ts`).
   */
  readonly displayNameOfFor?: (scope: object) => (toolName: string) => string | undefined;
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
  const assess = async (scope: TypedScope<AgentState>): Promise<void> => {
    const { displayNameOfFor, omissionCheckFor, ...declarations } = answer;
    const checkOmission = omissionCheckFor?.(scope);
    const displayNameOf = displayNameOfFor?.(scope);
    await (
      await loadAnswerStage()
    ).assessAnswerStage(scope, {
      ...declarations,
      ...(checkOmission && { checkOmission }),
      ...(displayNameOf !== undefined && { displayNameOf }),
    });
  };
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
