/**
 * arguments/subflow — the four stages of the inputs layer's subflow
 * (`sf-inputs`): Declare → Verify → Record → Resolve.
 *
 * Pattern: thin stage bodies over the pure steps in `resolve.ts`. Each reads
 *          what the stage before it staged on the subflow's own (isolated)
 *          scope and stages its own output; the mount's output mapper
 *          (`honesty/mounts.ts`) carries the rows and the resolutions out.
 * Role:    core/ layer, the inputs layer (honesty layer 2). Loaded through
 *          `import()` by the mount's stage wrappers — never on a plain agent's
 *          graph. Everything that is not this folder's arrives as `deps`
 *          (the dispatch resolver, Route's predicate, the ledger's emit half),
 *          so `arguments/` stays a leaf that never imports `findings/` or
 *          `stages/`.
 * Emits:   `agentfootprint.findings.argument` — one per row, from the Record
 *          stage, through the ledger's emit half (`deps.emitRows`).
 *
 * ## Only a batch that will dispatch
 *
 * Declare asks Route's own predicate (`deps.willDispatch`) first: a reply with
 * no tool call, a run out of iterations, a halting cost budget — the batch is
 * going to the final branch, so nothing is planned and every later stage finds
 * an empty plan. The layer never files a row about a call Route will not run.
 */

import type { TypedScope } from 'footprintjs';

import type { KeptAnswer } from './kept.js';
import type { ArgumentRow } from './rows.js';
import {
  declareBatch,
  resolutionsOf,
  rowsOf,
  verifyPlan,
  type ArgumentResolution,
  type BatchCall,
  type CheckedArgument,
  type PlannedCall,
  type ToolOf,
} from './resolve.js';

/** The subflow's own state — inputs frozen by the mount, then one key per stage. */
export interface InputsLayerState {
  // ── inputs (the mount's inputMapper; frozen inside the subflow) ──
  readonly calls: readonly BatchCall[];
  readonly iteration: number;
  readonly maxIterations: number;
  readonly costBudgetHit?: boolean;
  readonly costBudgetOnExceed?: 'warn' | 'halt';
  readonly turnNumber: number;
  /**
   * This turn's answers KEPT for a call the batch that asked could not finish
   * (`kept.ts`) — handed in only when there are some, so a run that never
   * keeps one never carries the key.
   */
  readonly argumentAnswersKept?: readonly KeptAnswer[];
  // ── staged by the four stages ──
  argumentPlan?: readonly PlannedCall[];
  argumentChecks?: readonly CheckedArgument[];
  argumentRows?: readonly ArgumentRow[];
  argumentResolutions?: readonly ArgumentResolution[];
}

/** What the stages are handed from outside the folder — closures, never scope. */
export interface InputsLayerDeps {
  /** The implementation that will answer a name — the shared dispatch resolver's. */
  readonly toolOf: ToolOf;
  /** Route's dispatch test (`stages/route.ts` · `willDispatch`). */
  readonly willDispatch: (values: {
    readonly callCount: number;
    readonly iteration: number;
    readonly maxIterations: number;
    readonly costBudgetHit?: boolean;
    readonly costBudgetOnExceed?: 'warn' | 'halt';
  }) => boolean;
  /** The ledger's emit half — one `findings.argument` event per row. */
  readonly emitRows: (scope: TypedScope<InputsLayerState>, rows: readonly ArgumentRow[]) => void;
}

/**
 * This turn's kept answers as plain data — read only by a stage whose batch
 * left an `ask` argument out, the one case a kept answer can fill.
 */
function keptOf(scope: TypedScope<InputsLayerState>): readonly KeptAnswer[] | undefined {
  const kept = scope.argumentAnswersKept as readonly KeptAnswer[] | undefined;
  return kept === undefined ? undefined : [...kept].map((a) => ({ ...a }));
}

/** Whether a planned batch left an `ask`-ruled argument out — the one case a kept answer can fill. */
const leavesAskOut = (plan: readonly PlannedCall[]): boolean =>
  plan.some((p) => p.ruled.some((r) => r.rule === 'ask' && r.missing));

/** Whether the checked batch fills a kept answer anywhere. */
const fillsKept = (checked: readonly CheckedArgument[]): boolean =>
  checked.some((c) => c.filled === true && c.source === 'answered');

/** The batch as plain data — a frozen input read is a live view, spread it once. */
function callsOf(scope: TypedScope<InputsLayerState>): readonly BatchCall[] {
  return [...((scope.calls as readonly BatchCall[] | undefined) ?? [])].map((c) => ({
    id: c.id,
    name: c.name,
    args: { ...(c.args ?? {}) },
  }));
}

/**
 * DECLARE — which calls of a DISPATCHING batch carry rules, read off the
 * implementation that will answer each name, and which ruled values are
 * missing. Stages `argumentPlan` (identities and a flag — no value); an empty
 * plan when the batch will not dispatch or no call is ruled.
 */
export function declareArgumentsStage(
  scope: TypedScope<InputsLayerState>,
  deps: InputsLayerDeps,
): void {
  const calls = callsOf(scope);
  // Read under Route's own short-circuit: the policy only once a budget was hit
  // (the key is handed in only when the agent configured one).
  const costBudgetHit = scope.costBudgetHit as boolean | undefined;
  const costBudgetOnExceed =
    costBudgetHit === true ? (scope.costBudgetOnExceed as 'warn' | 'halt' | undefined) : undefined;
  const dispatches = deps.willDispatch({
    callCount: calls.length,
    iteration: scope.iteration as number,
    maxIterations: scope.maxIterations as number,
    ...(costBudgetHit !== undefined && { costBudgetHit }),
    ...(costBudgetOnExceed !== undefined && { costBudgetOnExceed }),
  });
  scope.argumentPlan = dispatches ? declareBatch(calls, deps.toolOf) : [];
}

/**
 * VERIFY — where each planned ruled value came from (`resolve.ts` ·
 * `verifyPlan`). Stages `argumentChecks` (identities and enums — no value).
 */
export function verifyArgumentsStage(
  scope: TypedScope<InputsLayerState>,
  deps: InputsLayerDeps,
): void {
  const plan = [...((scope.argumentPlan as readonly PlannedCall[] | undefined) ?? [])];
  scope.argumentChecks =
    plan.length === 0
      ? []
      : verifyPlan(
          plan,
          callsOf(scope),
          deps.toolOf,
          leavesAskOut(plan) ? keptOf(scope) : undefined,
        );
}

/**
 * RECORD — one row per checked argument, in the tool's own argument view,
 * stamped with the conversation turn; one event per row, fired HERE (inside the
 * subflow, before the call dispatches). Stages `argumentRows`; the mount's
 * output mapper merges them into the ledger in ONE write.
 */
export function recordArgumentsStage(
  scope: TypedScope<InputsLayerState>,
  deps: InputsLayerDeps,
): void {
  const checked = [...((scope.argumentChecks as readonly CheckedArgument[] | undefined) ?? [])];
  const rows =
    checked.length === 0
      ? []
      : rowsOf(
          checked,
          callsOf(scope),
          deps.toolOf,
          { turn: scope.turnNumber as number, iteration: scope.iteration as number },
          fillsKept(checked) ? keptOf(scope) : undefined,
        );
  scope.argumentRows = rows;
  if (rows.length > 0) deps.emitRows(scope, rows);
}

/**
 * RESOLVE — the fills and refusals ToolCalls applies (`resolve.ts` ·
 * `resolutionsOf`). Stages `argumentResolutions`, each entry stamped with the
 * batch's iteration.
 */
export function resolveArgumentsStage(
  scope: TypedScope<InputsLayerState>,
  deps: InputsLayerDeps,
): void {
  const plan = [...((scope.argumentPlan as readonly PlannedCall[] | undefined) ?? [])];
  const checked = [...((scope.argumentChecks as readonly CheckedArgument[] | undefined) ?? [])];
  scope.argumentResolutions =
    plan.length === 0
      ? []
      : resolutionsOf(
          plan,
          checked,
          deps.toolOf,
          scope.iteration as number,
          fillsKept(checked) ? keptOf(scope) : undefined,
        );
}
