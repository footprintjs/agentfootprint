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
 * `turnNumber`. Never the ledger, never a tool — tools are closures, read
 * through the shared dispatch resolver (`stages/toolResolver.ts`) so the rules
 * checked are the rules of the implementation that will run.
 *
 * Returned (the output mapping, `arrayMerge: Replace` — the loop-crossed mount
 * law): the rows, merged into the ledger in ONE write by the ledger's pure half
 * (`findings/ledger.ts` · `appendRows`), and `argumentResolutions`, one entry
 * per call to fill or refuse. Nothing to return → nothing is written.
 *
 * The stage bodies (`arguments/subflow.ts`) load through `import()` on first
 * use — the optional-family law — so a plain agent's graph never carries them.
 */

import { ArrayMergeMode } from 'footprintjs/advanced';
import { flowChart } from 'footprintjs';
import type { FlowChart, FlowChartBuilder, TypedScope } from 'footprintjs';

import { STAGE_IDS, SUBFLOW_IDS, milestoneTagsFor } from '../../../conventions.js';
import type { ArgumentRow } from '../arguments/rows.js';
import type { ArgumentResolution, ToolOf } from '../arguments/resolve.js';
import type { InputsLayerDeps, InputsLayerState } from '../arguments/subflow.js';
import { appendRows, emitRow, type FindingsScope } from '../findings/ledger.js';
import type { FindingsRow } from '../findings/types.js';
import { willDispatch } from '../stages/route.js';

/** What an armed agent hands the inputs layer's mount — closures, never scope. */
export interface InputsMountDeps {
  /** The implementation that will answer a name — the shared dispatch resolver's. */
  readonly toolOf: ToolOf;
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
        return {
          calls: (parent.llmLatestToolCalls as readonly unknown[] | undefined) ?? [],
          iteration: parent.iteration as number,
          maxIterations: parent.maxIterations as number,
          ...(costBudgetHit !== undefined && { costBudgetHit }),
          ...(costBudgetOnExceed !== undefined && { costBudgetOnExceed }),
          turnNumber: parent.turnNumber as number,
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
