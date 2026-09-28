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
 * ## Declared sources (`.findings({ argumentSources: true })`)
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
 */

import { ArrayMergeMode } from 'footprintjs/advanced';
import { flowChart } from 'footprintjs';
import type { FlowChart, FlowChartBuilder, TypedScope } from 'footprintjs';

import type { ExternalGround } from '../../../integrity/unsupported-argument/check.js';
import { STAGE_IDS, SUBFLOW_IDS, milestoneTagsFor } from '../../../conventions.js';
import type { SourceCorpus } from '../arguments/checks.js';
import { keptThisTurn } from '../arguments/kept.js';
import type { ArgumentRow } from '../arguments/rows.js';
import type { ArgumentResolution, BatchCall, ToolOf } from '../arguments/resolve.js';
import type { InputsLayerDeps, InputsLayerState, SourceInputs } from '../arguments/subflow.js';
import { appendRows, emitRow, type FindingsScope } from '../findings/ledger.js';
import type { FindingsRow } from '../findings/types.js';
import { willDispatch } from '../stages/route.js';

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
   * DECLARED SOURCES ARE ARMED (`.findings({ argumentSources: true })`) —
   * present only then. The mount hands the layer the pieces its checks read
   * and the closures that read them; `externalGrounds` is the app's own
   * vouched-for values (`AgentOptions.externalGrounds`), an `app` source with
   * its label.
   */
  readonly sources?: {
    readonly externalGrounds?: () => readonly ExternalGround[];
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
        declaredOf: (calls: readonly BatchCall[]) => corpus.declaredSourcesOf(calls, deps.toolOf),
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
