/**
 * results/subflow — the four stages of the results layer's subflow
 * (`sf-results`): Declare → Verify → Record → Resolve (honesty layer 3).
 *
 * Pattern: thin stage bodies over three pure steps (`planPeriods`,
 *          `checkPeriods`, `periodRowsOf`). Each stage reads what the one
 *          before it staged on the subflow's own (isolated) scope and stages
 *          its own output; the mount's output mapping (`honesty/mounts.ts` ·
 *          `mountResultsLayer`) merges the rows into the ONE ledger in one
 *          write.
 * Role:    core/ layer, the results layer. Loaded through `import()` by the
 *          mount's stage wrappers — never on a plain agent's graph. Its rules
 *          stay with their data: the period's shape, its rule set and the
 *          verdict are `coverage/period.ts`'s; the ledger's merge and emit
 *          halves are `findings/ledger.ts`'s, handed in as `deps`.
 * Emits:   `agentfootprint.findings.period` — one per row, from the Record
 *          stage, through the ledger's emit half (`deps.emitRows`).
 *
 * ## Where it runs, and what it reads
 *
 * At the LOOP HEAD — ToolCalls' `loopTo` lands on it — so it runs right after
 * every batch and before the next model call, and before any window strategy
 * folds the batch away. It reads the batch ToolCalls just ran (`toolResults`,
 * which still holds it at the loop head: identities only, never a result's
 * bytes) and the periods those calls' results declared (their committed
 * `coverageDeclared` rows of the batch's iteration).
 *
 * ## Each batch once — told apart by its iteration, never by a call id
 *
 * The schema re-ask, the step nudge, the evidence recheck and the wrap-up run
 * no tool and loop back here with the batch still in place. The layer tells
 * the first visit from those by the iteration that DISPATCHED the batch,
 * which ToolCalls stamps beside it (`AgentState.toolResultsIteration`, under
 * the arm): ToolCalls advances the iteration by one and loops straight here,
 * and every other way back advances it again — so the batch is new exactly
 * when the loop head's iteration is the stamp plus one, and the mount hands
 * the batch only then (`honesty/mounts.ts` · `batchToJudge`). A
 * call id cannot say it: a provider's synthetic counter restarts with each
 * provider instance (a resumed leg repeats the ids of the leg that failed,
 * whose rows the conversation checkpoint carries), and nothing stops a
 * provider reusing an id across batches of one run. If that invariant ever
 * broke, a batch would be judged twice — an over-report, never a hidden one.
 * On the first iteration there is no batch, and every stage finds nothing to
 * do.
 *
 * ## One verdict per call
 *
 * A call gets a row when its result declared a period, or its tool declares a
 * `ToolPeriod` (the inputs layer's declaration: which argument sets the
 * period). The verdict is `coverage/period.ts` · `periodVerdict` over the
 * declared period — the LEAST held, when the result declared more than one
 * (`leastHeld`) — or `undeclared` when the tool declares a period argument and
 * this result said nothing about what its read covered: declared silence,
 * recorded as silence. The row names the `ToolPeriod`'s argument, the join
 * key to the inputs layer's row for the same call.
 */

import type { TypedScope } from 'footprintjs';

import {
  copyPeriod,
  leastHeld,
  periodVerdict,
  type DeclaredPeriod,
  type PeriodRow,
} from '../coverage/period.js';

/** One call of the batch ToolCalls just ran — identities only. */
export interface RanCall {
  readonly toolCallId: string;
  readonly toolName: string;
}

/** One period a call's result declared, read off its committed coverage row. */
export interface CallPeriod {
  readonly toolCallId: string;
  readonly period: DeclaredPeriod;
}

/** A call the layer will judge: the periods its result declared, and the argument its tool's `ToolPeriod` names. */
export interface PlannedPeriod {
  readonly toolCallId: string;
  readonly toolName: string;
  /** Every period the call's result declared — empty when it declared none. */
  readonly declared: readonly DeclaredPeriod[];
  /** The argument the tool's `ToolPeriod` names — absent when it declares none. */
  readonly argument?: string;
}

/** A judged call — the verdict, no instants. */
export interface CheckedPeriod {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly verdict: PeriodRow['verdict'];
  readonly argument?: string;
}

/**
 * The argument a tool's `ToolPeriod` names, by tool name — read off the
 * implementation the shared dispatch resolver says answered the name
 * (`stages/toolResolver.ts`), so the layer judges the tool that ran. At the
 * loop head the tools slot has not recomposed yet, so the resolver still
 * answers for the epoch that dispatched the batch.
 */
export type PeriodArgumentOf = (toolName: string) => string | undefined;

/** The subflow's own state — inputs frozen by the mount, then one key per stage. */
export interface ResultsLayerState {
  // ── inputs (the mount's inputMapper; frozen inside the subflow) ──
  /** The batch to judge — empty on a visit with none (the first iteration, or a re-entry). */
  readonly calls: readonly RanCall[];
  /** The periods the batch's results declared — handed only when there are some. */
  readonly periods?: readonly CallPeriod[];
  /** The iteration that dispatched the batch (`honesty/mounts.ts` · `batchToJudge`) — handed only with a batch. */
  readonly batchIteration?: number;
  /** The conversation turn — handed only with a batch. */
  readonly turnNumber?: number;
  // ── staged by the stages ──
  periodPlan?: readonly PlannedPeriod[];
  periodChecks?: readonly CheckedPeriod[];
  periodRows?: readonly PeriodRow[];
}

/** What the stages are handed from outside the folder — closures, never scope. */
export interface ResultsLayerDeps {
  readonly periodArgumentOf: PeriodArgumentOf;
  /** The ledger's emit half — one `findings.period` event per row. */
  readonly emitRows: (scope: TypedScope<ResultsLayerState>, rows: readonly PeriodRow[]) => void;
}

// ─── The three pure steps ───────────────────────────────────────────────

/**
 * DECLARE, pure: the calls to judge, in batch order — each call whose result
 * declared a period or whose tool declares a `ToolPeriod`. A call id met twice
 * in ONE batch is judged once, over every period declared under it (the least
 * held wins, so merging can only over-report).
 */
export function planPeriods(
  calls: readonly RanCall[],
  periods: readonly CallPeriod[],
  periodArgumentOf: PeriodArgumentOf,
): PlannedPeriod[] {
  const done = new Set<string>();
  const plan: PlannedPeriod[] = [];
  for (const call of calls) {
    if (done.has(call.toolCallId)) continue;
    done.add(call.toolCallId);
    const declared = periods.filter((p) => p.toolCallId === call.toolCallId).map((p) => p.period);
    const argument = periodArgumentOf(call.toolName);
    if (declared.length === 0 && argument === undefined) continue;
    plan.push({
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      declared,
      ...(argument !== undefined && { argument }),
    });
  }
  return plan;
}

/**
 * VERIFY, pure: one verdict per planned call — the least held of its declared
 * periods, or `undeclared` when it declared none (its tool declares a
 * `ToolPeriod`, or it would not be planned).
 */
export function checkPeriods(plan: readonly PlannedPeriod[]): CheckedPeriod[] {
  return plan.map((p) => ({
    toolCallId: p.toolCallId,
    toolName: p.toolName,
    verdict:
      p.declared.length === 0
        ? 'undeclared'
        : // Non-empty, so `leastHeld` answers.
          (leastHeld(p.declared.map(periodVerdict)) as PeriodRow['verdict']),
    ...(p.argument !== undefined && { argument: p.argument }),
  }));
}

/** RECORD, pure: one `period` row per judged call, stamped with the turn and the batch's iteration. */
export function periodRowsOf(
  checked: readonly CheckedPeriod[],
  stamp: { readonly turn: number; readonly iteration: number },
): PeriodRow[] {
  return checked.map((c) => ({
    kind: 'period',
    turn: stamp.turn,
    toolCallId: c.toolCallId,
    toolName: c.toolName,
    iteration: stamp.iteration,
    verdict: c.verdict,
    ...(c.argument !== undefined && { argument: c.argument }),
  }));
}

// ─── The four stages ────────────────────────────────────────────────────

/** A frozen input read is a live view — copied into plain data once. */
function callsOf(scope: TypedScope<ResultsLayerState>): RanCall[] {
  return [...((scope.calls as readonly RanCall[] | undefined) ?? [])].map((c) => ({
    toolCallId: c.toolCallId,
    toolName: c.toolName,
  }));
}

/**
 * DECLARE — which calls of the batch just run are the layer's: a declared
 * period, or a tool that declares a `ToolPeriod`. Stages `periodPlan`
 * (identities, the declared periods, the argument name).
 */
export function declareResultsStage(
  scope: TypedScope<ResultsLayerState>,
  deps: ResultsLayerDeps,
): void {
  const calls = callsOf(scope);
  if (calls.length === 0) {
    scope.periodPlan = [];
    return;
  }
  const periods = [...((scope.periods as readonly CallPeriod[] | undefined) ?? [])].map((p) => ({
    toolCallId: p.toolCallId,
    period: copyPeriod(p.period),
  }));
  scope.periodPlan = planPeriods(calls, periods, deps.periodArgumentOf);
}

/** VERIFY — the verdict on each planned call's period. Stages `periodChecks` (identities and a word). */
export function verifyResultsStage(scope: TypedScope<ResultsLayerState>): void {
  const plan = [...((scope.periodPlan as readonly PlannedPeriod[] | undefined) ?? [])];
  scope.periodChecks = plan.length === 0 ? [] : checkPeriods(plan);
}

/**
 * RECORD — one `period` row per judged call, stamped with the conversation
 * turn and the batch's iteration; one event per row, fired HERE (inside the
 * subflow). Stages `periodRows`; the mount's output mapping merges them into
 * the ledger in ONE write.
 */
export function recordResultsStage(
  scope: TypedScope<ResultsLayerState>,
  deps: ResultsLayerDeps,
): void {
  const checked = [...((scope.periodChecks as readonly CheckedPeriod[] | undefined) ?? [])];
  const rows =
    checked.length === 0
      ? []
      : periodRowsOf(checked, {
          turn: scope.turnNumber as number,
          iteration: scope.batchIteration as number,
        });
  scope.periodRows = rows;
  if (rows.length > 0) deps.emitRows(scope, rows);
}

/**
 * RESOLVE — FLAG, the one verb a result that has already run admits (the
 * layer contract's clause 4: an ask and an assumption need a call that has
 * not run yet, a refusal one that can still be stopped). The rows Record filed
 * ARE the flags: the answer's standing folds them, and the mount's output
 * mapping returns them. So in this version the stage decides nothing and
 * writes nothing — it is the seat the later reading checks and outcome rows
 * (honesty step 8) resolve in.
 */
export function resolveResultsStage(): void {
  // Deliberately empty — see above.
}
