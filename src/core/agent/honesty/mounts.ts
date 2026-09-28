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
 * ledger), the previous batch's result ids and the run's `userMessageFrom`
 * constant — and two closures, both from `honesty/sourceCorpus.ts` (loaded on
 * the first armed batch): the calls' `from` entries through the ONE reader of
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

import type { ExternalGround } from '../../../integrity/unsupported-argument/check.js';
import { STAGE_IDS, SUBFLOW_IDS, milestoneTagsFor } from '../../../conventions.js';
import type { SourceCorpus } from '../arguments/checks.js';
import { isRefused, rulesOf } from '../arguments/declare.js';
import { keptThisTurn } from '../arguments/kept.js';
import type { ArgumentRow } from '../arguments/rows.js';
import type { ArgumentResolution, BatchCall, ToolOf } from '../arguments/resolve.js';
import type { InputsLayerDeps, InputsLayerState, SourceInputs } from '../arguments/subflow.js';
import { copyPeriod, type DeclaredPeriod, type PeriodRow } from '../coverage/period.js';
import { appendRows, emitRow, type FindingsScope } from '../findings/ledger.js';
import type { FindingsRow } from '../findings/types.js';
import type {
  RanCall,
  CallPeriod,
  ResultsLayerDeps,
  ResultsLayerState,
} from '../results/subflow.js';
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
  /**
   * DECLARED SOURCES ARE ARMED (`.findings({ argumentSources: true })` or
   * `.inputsLayer({ argumentSources: true })`) — present only then. The mount hands the layer the pieces its checks read
   * and the closures that read them; `externalGrounds` is the app's own
   * vouched-for values (`AgentOptions.externalGrounds`), an `app` source with
   * its label.
   */
  readonly sources?: {
    readonly externalGrounds?: () => readonly ExternalGround[];
    /**
     * The findings ledger is armed beside declared sources (`.findings()`) —
     * present only then: a call that declares a basis files a BASIS row in
     * ToolCalls, and that row carries the count of dropped `from` entries.
     * Absent (declared sources without the ledger), no basis row is ever
     * filed, so the count rides the call's first argument row
     * (`sourceCorpus.ts` · `declaredSourcesOf`).
     */
    readonly basisRows?: true;
    /**
     * A tool in reach may carry an arguments view — one the agent registers
     * carries one (`core/toolShownArgs.ts` · `carriesArgumentView`), or a
     * ToolProvider is wired (whatever it lists: its list is known only per
     * iteration) — present only then: no quote the model wrote is shown on a
     * row or an ask, since a quote may hold the value such a tool hides
     * (`arguments/resolve.ts` · `quotesMayShow`).
     */
    readonly argumentViews?: true;
  };
}

type StageModule = typeof import('../arguments/subflow.js');
type CorpusModule = typeof import('./sourceCorpus.js');

let corpusModule: Promise<CorpusModule> | undefined;

/** The corpus builder, loaded once per process on first use (the optional-family law). */
function loadCorpus(): Promise<CorpusModule> {
  corpusModule ??= import('./sourceCorpus.js');
  return corpusModule;
}

/**
 * The raw pieces the declared-sources corpora are built from — read off the
 * parent's committed state by the input mapping, only under the arm and only
 * for a batch with calls. Never the whole ledger: its standing rows (the
 * model's current reading of each result) and its `answered` argument rows
 * (the person's earlier answers).
 */
function sourceInputsOf(parent: Record<string, unknown>): SourceInputs {
  const ledger = ((parent.findingsLedger as readonly FindingsRow[] | undefined) ?? []).filter(
    (row) => row.kind === 'standing' || (row.kind === 'argument' && row.source === 'answered'),
  );
  const injections = (parent.systemPromptInjections as readonly unknown[] | undefined) ?? [];
  const previous = ((parent.toolResults as readonly Record<string, unknown>[] | undefined) ?? [])
    .filter((r) => typeof r?.toolCallId === 'string')
    .map((r) => ({
      toolCallId: r.toolCallId as string,
      ...(typeof r.toolName === 'string' && { toolName: r.toolName }),
    }));
  return {
    history: [...((parent.history as readonly unknown[] | undefined) ?? [])],
    ...(injections.length > 0 && { systemPromptInjections: [...injections] }),
    ...(ledger.length > 0 && { ledger }),
    ...(previous.length > 0 && { previousBatch: previous }),
    ...(parent.userMessageFrom === 'composed' && { composed: true as const }),
  };
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
  const base: InputsLayerDeps = { toolOf: deps.toolOf, willDispatch, emitRows };
  // Declared sources: the reader of each call's `from` and the corpora the checks
  // read live in `sourceCorpus.ts`, loaded on the first armed batch — so neither
  // is on a plain agent's graph.
  let armed: Promise<InputsLayerDeps> | undefined;
  const layerOf = (): InputsLayerDeps | Promise<InputsLayerDeps> => {
    if (sources === undefined) return base;
    armed ??= loadCorpus().then((corpus) => ({
      ...base,
      sources: {
        ...(sources.argumentViews === true && { argumentViews: true as const }),
        declaredOf: (calls: readonly BatchCall[]) =>
          corpus.declaredSourcesOf(
            calls,
            deps.toolOf,
            sources.basisRows === true ? { basisRows: true } : undefined,
          ),
        corpusOf: async (
          inputs: SourceInputs,
          calls: readonly BatchCall[],
          turn: number,
        ): Promise<SourceCorpus> =>
          corpus.sourceCorpusOf(inputs, calls, turn, {
            toolOf: deps.toolOf,
            ...(sources.externalGrounds !== undefined && {
              externalGrounds: sources.externalGrounds,
            }),
          }),
      },
    }));
    return armed;
  };
  type Stage = (scope: TypedScope<InputsLayerState>) => Promise<void>;
  const declare: Stage = async (scope) =>
    (await loadStages()).declareArgumentsStage(scope, await layerOf());
  const verify: Stage = async (scope) =>
    (await loadStages()).verifyArgumentsStage(scope, await layerOf());
  const record: Stage = async (scope) =>
    (await loadStages()).recordArgumentsStage(scope, await layerOf());
  const resolve: Stage = async (scope) =>
    (await loadStages()).resolveArgumentsStage(scope, await layerOf());
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
        const calls = (parent.llmLatestToolCalls as readonly unknown[] | undefined) ?? [];
        return {
          calls,
          iteration: parent.iteration as number,
          maxIterations: parent.maxIterations as number,
          ...(costBudgetHit !== undefined && { costBudgetHit }),
          ...(costBudgetOnExceed !== undefined && { costBudgetOnExceed }),
          turnNumber: parent.turnNumber as number,
          ...(kept.length > 0 && { argumentAnswersKept: kept }),
          // Declared sources: the pieces the checks read — only under the arm,
          // and only for a batch with calls to check.
          ...(deps.sources !== undefined &&
            calls.length > 0 && { sourceInputs: sourceInputsOf(parent) }),
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

// ─── The results layer — `sf-results`, at the loop head (honesty layer 3) ──

/** What an armed agent hands the results layer's mount — closures, never scope. */
export interface ResultsMountDeps {
  /** The implementation that answered a name — the shared dispatch resolver's. */
  readonly toolOf: ToolOf;
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
 * answered the name, by the inputs layer's own reader (`arguments/declare.ts` ·
 * `rulesOf`): a `ToolPeriod` is that layer's declaration, and this layer only
 * reads it. A tool whose rules cannot be read declares nothing here (its calls
 * were refused, never run).
 */
function periodArgumentOf(toolOf: ToolOf): (toolName: string) => string | undefined {
  return (toolName) => {
    const rules = rulesOf(toolOf(toolName));
    return rules === undefined || isRefused(rules) ? undefined : rules.period?.argument;
  };
}

/**
 * The `sf-results` subflow: Declare → Verify → Record → Resolve, four thin
 * stages over the pure steps of `results/subflow.ts`.
 */
export function buildResultsSubflow(deps: ResultsMountDeps): FlowChart {
  const layer: ResultsLayerDeps = {
    periodArgumentOf: periodArgumentOf(deps.toolOf),
    emitRows: emitPeriodRows,
  };
  type Stage = (scope: TypedScope<ResultsLayerState>) => Promise<void>;
  const declare: Stage = async (scope) =>
    (await loadResultsStages()).declareResultsStage(scope, layer);
  const verify: Stage = async (scope) => (await loadResultsStages()).verifyResultsStage(scope);
  const record: Stage = async (scope) =>
    (await loadResultsStages()).recordResultsStage(scope, layer);
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * WHICH BATCH the loop head hands the results layer on this visit — the
 * iteration that dispatched it, or `undefined` when there is none to judge.
 *
 * `stamp` is the iteration ToolCalls wrote beside the batch it dispatched
 * (`AgentState.toolResultsIteration`, under the arm); `iteration` is the loop
 * head's. ToolCalls advances the iteration by exactly one and loops straight
 * here; every other way back — the schema re-ask, the step nudge, the evidence
 * recheck, the wrap-up — runs no tool, leaves the batch in place and advances
 * the iteration again. So the batch is new on this visit exactly when
 * `iteration === stamp + 1`: each batch judged ONCE per run.
 *
 * Never by call id. A provider's synthetic counter restarts with each provider
 * instance (`<prefix>-call-${++toolCallSeq}`), so a resumed leg repeats the ids
 * of the leg that failed — whose rows the conversation checkpoint carries — and
 * nothing stops a provider reusing an id across batches of one run. A stamp is
 * per run: no conversation checkpoint carries it, so a resumed leg starts with
 * none. Were the invariant above ever broken, a batch would be judged twice —
 * an over-report, never a hidden verdict.
 */
export function batchToJudge(iteration: number, stamp: unknown): number | undefined {
  return typeof stamp === 'number' && iteration === stamp + 1 ? stamp : undefined;
}

/**
 * What the loop head hands the results layer — the batch's identities, the
 * periods ITS results declared (the coverage rows of the batch's iteration, so
 * a call id an earlier batch also used cannot lend it a period), and the
 * stamps. Only on the first visit after ToolCalls ran the batch
 * (`batchToJudge`); every other visit is handed an empty batch and reads
 * nothing else, so the layer never reads a key the run has not written.
 */
function resultsLayerInput(parent: Record<string, unknown>): ResultsLayerState {
  const batchIteration = batchToJudge(parent.iteration as number, parent.toolResultsIteration);
  if (batchIteration === undefined) return { calls: [] };
  const batch = (parent.toolResults as readonly unknown[] | undefined) ?? [];
  const calls: RanCall[] = [];
  for (const entry of batch) {
    if (!isRecord(entry)) continue;
    if (typeof entry.toolCallId !== 'string' || typeof entry.toolName !== 'string') continue;
    calls.push({ toolCallId: entry.toolCallId, toolName: entry.toolName });
  }
  if (calls.length === 0) return { calls };
  const ids = new Set(calls.map((c) => c.toolCallId));
  const periods: CallPeriod[] = [];
  for (const row of (parent.coverageDeclared as readonly unknown[] | undefined) ?? []) {
    if (!isRecord(row) || row.iteration !== batchIteration || row.period === undefined) continue;
    if (typeof row.toolCallId !== 'string' || !ids.has(row.toolCallId)) continue;
    periods.push({ toolCallId: row.toolCallId, period: copyPeriod(row.period as DeclaredPeriod) });
  }
  return {
    calls,
    batchIteration,
    turnNumber: parent.turnNumber as number,
    ...(periods.length > 0 && { periods }),
  };
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
