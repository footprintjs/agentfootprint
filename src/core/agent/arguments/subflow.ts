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
 *
 * ## Declared sources (`.inputsLayer({ argumentSources: true })`, `.findings({ argumentSources: true })`)
 *
 * Present only under the arm: `deps.sources` reads each call's `from` entries
 * through the ONE reader of `_findings` (`findings/reserved.ts` ·
 * `readDeclaration`, handed in as a closure, so this folder still never
 * imports `findings/`), and Verify builds the corpora the checks read from the
 * raw pieces the mount handed in (`sourceInputs`) — loaded on first use, never
 * on a plain agent's graph. Every stage re-reads the entries rather than
 * staging a second copy of the model's quotes.
 */

import type { TypedScope } from 'footprintjs';

import { turnWindowsOf } from '../../time/bind.js';
import type { CallWindowRow, ClockRow, TimeReadingRow } from '../../time/rows.js';
import type { ZoneName } from '../../time/zone.js';
import type { SourceCorpus } from './checks.js';
import type { KeptAnswer } from './kept.js';
import type { ArgumentRow } from './rows.js';
import {
  callWindowRowsOf,
  declareBatch,
  resolutionsOf,
  rowsOf,
  timeDecisionsOf,
  verifyPlan,
  type ArgumentResolution,
  type BatchCall,
  type CheckedArgument,
  type PlannedCall,
  type SourcesArm,
  type TimeArm,
  type ToolOf,
} from './resolve.js';
import type { CallSources } from './sources.js';

/**
 * The raw pieces the declared-sources corpora are built from — what the mount
 * hands the layer under the arm (`honesty/mounts.ts` · `mountInputsLayer`),
 * read by `honesty/sourceCorpus.ts` · `sourceCorpusOf`. Never the whole
 * ledger: only the rows the checks read.
 */
export interface SourceInputs {
  /** The history the model was served for this batch — the person's, the results', the app's words. */
  readonly history: readonly unknown[];
  /** The composed system prompt's records — the app's own text. */
  readonly systemPromptInjections?: readonly unknown[];
  /** The ledger's standing rows and `answered` argument rows — never the whole ledger. */
  readonly ledger?: readonly unknown[];
  /** The previous batch's results, by id and tool name (`AgentState.toolResults`). */
  readonly previousBatch?: readonly {
    readonly toolCallId: string;
    readonly toolName?: string;
  }[];
  /** The run's message came from a composition, not a person (`AgentInput.messageFrom`). */
  readonly composed?: true;
}

/**
 * Under `.time()`: the rows of THIS turn the time layer reads — the turn's
 * `clock` row and its `time-reading` rows (`core/time/bind.ts` ·
 * `turnWindowsOf`). Handed by the mount only under the arm, for a batch with
 * calls, and only once the turn has a clock.
 */
export interface TimeInputs {
  readonly clock: ClockRow;
  readonly readings: readonly TimeReadingRow[];
}

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
  /** Under declared sources only: the raw pieces the corpora are built from. */
  readonly sourceInputs?: SourceInputs;
  /** Under `.time()` only: this turn's clock and readings. */
  readonly timeInputs?: TimeInputs;
  // ── staged by the four stages ──
  argumentPlan?: readonly PlannedCall[];
  argumentChecks?: readonly CheckedArgument[];
  argumentRows?: readonly ArgumentRow[];
  /** Under `.time()` only: one `call-window` row per call to a tool whose period declares forms. */
  argumentWindowRows?: readonly CallWindowRow[];
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
  /**
   * Present exactly under `.time()`: the stages read `timeInputs` and a tool
   * whose period declares forms is filled, bound or recorded against the
   * turn's windows (`resolve.ts` · `timeDecisionsOf`).
   */
  readonly time?: {
    /** The app's `.time({ zone })` — the zone of a form declaring `wallZone: 'app'`. */
    readonly appZone?: ZoneName;
  };
  /** Present exactly under declared sources (either door: `.inputsLayer({ argumentSources: true })`
   *  or `.findings({ argumentSources: true })`). */
  readonly sources?: {
    /**
     * A tool the agent registers carries an arguments view — present only
     * then: no quote is shown on a row or an ask (`resolve.ts` · `quotesMayShow`).
     */
    readonly argumentViews?: true;
    /** Each call's `from` entries, through the one reader of `_findings`. */
    readonly declaredOf: (calls: readonly BatchCall[]) => readonly CallSources[];
    /** The corpora the checks read, from the pieces the mount handed in (loaded on first use). */
    readonly corpusOf: (
      inputs: SourceInputs,
      calls: readonly BatchCall[],
      turn: number,
    ) => Promise<SourceCorpus>;
  };
}

/** The calls' declared sources, by call id — `undefined` when the arm is off. */
function declaredOf(
  deps: InputsLayerDeps,
  calls: readonly BatchCall[],
): ReadonlyMap<string, CallSources> | undefined {
  if (deps.sources === undefined) return undefined;
  return new Map(deps.sources.declaredOf(calls).map((d) => [d.toolCallId, d]));
}

/**
 * The arm as the pure steps take it — the entries, and (from Verify on) the
 * corpora and whether a tool in reach can hide arguments (the agent's
 * build-time fact: a registered tool with an argument view, or a ToolProvider).
 */
function armOf(
  declared: ReadonlyMap<string, CallSources> | undefined,
  corpus?: SourceCorpus,
  argumentViews?: true,
): SourcesArm | undefined {
  if (declared === undefined) return undefined;
  return {
    declared,
    ...(corpus !== undefined && { corpus }),
    ...(argumentViews === true && { argumentViews }),
  };
}

/**
 * This turn's kept answers as plain data — read only by a stage whose batch
 * left an `ask` argument out, the one case a kept answer can fill.
 */
function keptOf(scope: TypedScope<InputsLayerState>): readonly KeptAnswer[] | undefined {
  const kept = scope.argumentAnswersKept as readonly KeptAnswer[] | undefined;
  return kept === undefined ? undefined : [...kept].map((a) => ({ ...a }));
}

/**
 * The time arm as the pure steps take it — `undefined` when `.time()` is off,
 * or the mount handed no inputs (no call, or a turn with no clock). Read only
 * under the arm: a tracked read of a key a run never writes is a phantom source.
 */
function timeArmOf(
  scope: TypedScope<InputsLayerState>,
  deps: InputsLayerDeps,
): TimeArm | undefined {
  if (deps.time === undefined) return undefined;
  const inputs = scope.timeInputs as TimeInputs | undefined;
  if (inputs === undefined) return undefined;
  // The rows are plain JSON (checked at the checkpoint door); a frozen input read is a live
  // proxy view, which `structuredClone` refuses — so the copy is a JSON round-trip.
  const plain = JSON.parse(
    JSON.stringify({ clock: inputs.clock, readings: [...inputs.readings] }),
  ) as TimeInputs;
  return {
    turn: turnWindowsOf(plain.readings, plain.clock),
    now: plain.clock.now,
    zone: plain.clock.zone,
    ...(deps.time.appZone !== undefined && { appZone: deps.time.appZone }),
  };
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
  scope.argumentPlan = dispatches
    ? declareBatch(calls, deps.toolOf, armOf(declaredOf(deps, calls)))
    : [];
}

/**
 * VERIFY — where each planned ruled value came from (`resolve.ts` ·
 * `verifyPlan`); under declared sources, each present value checked against
 * the source the model declared (`checks.ts` · `checkSource`) over corpora
 * built from the mount's `sourceInputs`. Stages `argumentChecks` (identities,
 * enums and the checks' verdicts — no value, no quote).
 */
export async function verifyArgumentsStage(
  scope: TypedScope<InputsLayerState>,
  deps: InputsLayerDeps,
): Promise<void> {
  const plan = [...((scope.argumentPlan as readonly PlannedCall[] | undefined) ?? [])];
  if (plan.length === 0) {
    scope.argumentChecks = [];
    return;
  }
  const calls = callsOf(scope);
  const declared = declaredOf(deps, calls);
  // Read only under the arm: a tracked read of a key a run never writes is a phantom source.
  const inputs =
    deps.sources !== undefined ? (scope.sourceInputs as SourceInputs | undefined) : undefined;
  const corpus =
    declared !== undefined && deps.sources !== undefined && inputs !== undefined
      ? await deps.sources.corpusOf(detached(inputs), calls, scope.turnNumber as number)
      : undefined;
  scope.argumentChecks = verifyPlan(
    plan,
    calls,
    deps.toolOf,
    leavesAskOut(plan) ? keptOf(scope) : undefined,
    armOf(declared, corpus, deps.sources?.argumentViews),
    timeArmOf(scope, deps),
  );
}

/** The mount's frozen inputs as plain data — a frozen input read is a live view. */
function detached(inputs: SourceInputs): SourceInputs {
  return structuredClone({
    history: [...(inputs.history ?? [])],
    ...(inputs.systemPromptInjections !== undefined && {
      systemPromptInjections: [...inputs.systemPromptInjections],
    }),
    ...(inputs.ledger !== undefined && { ledger: [...inputs.ledger] }),
    ...(inputs.previousBatch !== undefined && { previousBatch: [...inputs.previousBatch] }),
    ...(inputs.composed === true && { composed: true as const }),
  });
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
  const stamp = { turn: scope.turnNumber as number, iteration: scope.iteration as number };
  // Under `.time()`: the windows decide fills, so the decisions are read before the rows.
  const time = timeArmOf(scope, deps);
  const plan =
    time === undefined
      ? []
      : [...((scope.argumentPlan as readonly PlannedCall[] | undefined) ?? [])];
  const calls = checked.length === 0 && plan.length === 0 ? [] : callsOf(scope);
  const decisions = timeDecisionsOf(plan, calls, deps.toolOf, time, armOf(declaredOf(deps, calls)));
  const rows =
    checked.length === 0
      ? []
      : rowsOf(
          checked,
          calls,
          deps.toolOf,
          stamp,
          fillsKept(checked) ? keptOf(scope) : undefined,
          armOf(declaredOf(deps, calls)),
          decisions,
        );
  scope.argumentRows = rows;
  if (rows.length > 0) deps.emitRows(scope, rows);
  if (time !== undefined) scope.argumentWindowRows = callWindowRowsOf(decisions, calls, stamp);
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
  if (plan.length === 0) {
    scope.argumentResolutions = [];
    return;
  }
  // The calls are read only under an arm — a reading's quote rides the ask; a window fills.
  const time = timeArmOf(scope, deps);
  const calls = deps.sources !== undefined || time !== undefined ? callsOf(scope) : undefined;
  const sources = calls !== undefined ? armOf(declaredOf(deps, calls)) : undefined;
  scope.argumentResolutions = resolutionsOf(
    plan,
    checked,
    deps.toolOf,
    scope.iteration as number,
    fillsKept(checked) ? keptOf(scope) : undefined,
    sources,
    time !== undefined && calls !== undefined
      ? timeDecisionsOf(plan, calls, deps.toolOf, time, sources)
      : undefined,
  );
}
