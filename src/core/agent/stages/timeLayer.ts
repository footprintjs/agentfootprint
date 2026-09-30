/**
 * stages/timeLayer — the time layer's half of seed and ToolCalls, in the ONE
 * module a plain agent never loads.
 *
 * Pattern: the stage bodies `.time()` adds — seed's clock stamp and reading
 *          of the person's words, ToolCalls' dispatch moment (the `call` row,
 *          the drift redraw, `ctx.time`) and a resume's `clock-on-resume`
 *          row — moved out of the two stages verbatim, each taking the
 *          stage's own scope and deps.
 * Role:    core/ layer leaf of the time layer. seed (`stages/seed.ts`) and
 *          ToolCalls (`stages/toolCalls.ts`) load it through `import()` only
 *          when the agent armed `.time()` (`deps.timeClock`, `deps.timeReader`,
 *          `deps.time`) — the optional-family law of docs-next's site budget
 *          (`scripts/check-site-budget.mjs`; the `arguments/dispatch.ts`
 *          precedent), so the resolver, the conversion forms and the drift
 *          check are not on the graph `import { Agent }` loads.
 * Emits:   N/A (rows go through the ledger's one writer).
 *
 * @example
 * ```ts
 * if (deps.time !== undefined) (await import('./timeLayer.js')).recordClockOnResume(scope, deps.time);
 * ```
 */

import type { TypedScope } from 'footprintjs';
import type { LLMMessage } from '../../../adapters/types.js';
import { isSaidByPerson } from '../../../lib/saidByPerson.js';
import { completeClock } from '../../time/clock.js';
import { granularityMsOf } from '../../time/convert.js';
import { driftAtDispatch } from '../../time/drift.js';
import { checkReading, type TimeReading } from '../../time/reader.js';
import { callWindowOfCall, clockOf, readingsOf } from '../../time/rows.js';
import { callRow, clockOnResumeRow, clockRow, timeReadingRows } from '../../time/rowsBuild.js';
import { timeContextOf, type TimeContext } from '../../time/wire.js';
import { tzdataVersion, type ZoneName } from '../../time/zone.js';
import {
  isRefused,
  periodFactsOf,
  periodFormsOf,
  rulesOf,
  type RuledToolLike,
} from '../arguments/declare.js';
import { recordFindings } from '../findings/ledger.js';
import type { FindingsLedger } from '../findings/types.js';
import type { AgentInput, AgentState } from '../types.js';
import type { SeedStageDeps } from './seed.js';
import type { ToolCallsHandlerDeps } from './toolCalls.js';

// ─── seed ────────────────────────────────────────────────────────────────

/**
 * The turn's clock stamp (the time layer) — filed LAST in seed, after the
 * turn number is final (`anchorTurnNumber` may raise it), so the row names
 * the turn every later row of this turn names. One row per run; the clock is
 * a run constant from here on and is never written again this turn (a
 * resume keeps it — `stages/toolCalls.ts` records a differing `time` as
 * `clock-on-resume`). No accessor, or no draft → nothing is written.
 */
export function stampClock(scope: TypedScope<AgentState>, deps: SeedStageDeps): void {
  const draft = deps.timeClock?.();
  if (draft === undefined) return;
  const clock = completeClock(draft, scope.turnStartMs as number);
  recordFindings(scope, [
    clockRow(
      clock,
      { turn: scope.turnNumber as number, iteration: scope.iteration as number },
      draft.window,
    ),
  ]);
}

/**
 * The person's words, read for time (the time layer's reader) — right after
 * the turn's clock, which the reading resolves against. Reads ONLY this
 * turn's entry, and only when a person wrote it: a message this library
 * authored in a person's voice, a delivered injection and a composed run's
 * message (another runner's output) are never read. A turn that already
 * has its rows (a `resumeOnError` retry re-seeds the same turn) is read
 * back, never re-read: a model-backed reader must not answer differently
 * the second time. A sync reader keeps seed's shape; an async one makes it
 * wait. A reader that throws fails the run.
 */
export function readTimeWords(
  scope: TypedScope<AgentState>,
  deps: SeedStageDeps,
): void | Promise<void> {
  const armed = deps.timeReader;
  if (armed === undefined) return;
  if (scope.$getArgs<AgentInput>().messageFrom === 'composed') return;
  const ledger = scope.findingsLedger as FindingsLedger | undefined;
  const turn = scope.turnNumber as number;
  if (readingsOf(ledger, turn).length > 0) return;
  const clock = clockOf(ledger);
  const history = scope.history as readonly LLMMessage[];
  const entry = history[history.length - 1];
  if (clock === undefined || entry === undefined || !isSaidByPerson(entry)) return;
  const text = entry.content;
  const { reader, policy } = armed;
  const file = (reading: TimeReading): void => {
    const mentions = checkReading(text, reading, reader.id);
    recordFindings(
      scope,
      timeReadingRows({
        mentions,
        clock,
        policy,
        reader,
        tzdata: tzdataVersion(),
        at: { turn, iteration: scope.iteration as number },
      }),
    );
  };
  const reading = reader.read(text, { locale: reader.locale });
  if (reading !== null && typeof (reading as { then?: unknown }).then === 'function') {
    return Promise.resolve(reading).then(file);
  }
  file(reading as TimeReading);
}

// ─── ToolCalls ───────────────────────────────────────────────────────────

/**
 * The time layer at one dispatch: the `call` row (`core/time/rowsBuild.ts` ·
 * `callRow`) — the wall clock read at the moment the library hands the call
 * to the tool — and, for a call that sent a look-back, the clock at dispatch
 * (§ 7.4, `core/time/drift.ts` · `driftAtDispatch`): past the tool's step the
 * library's OWN look-back fill is re-sent as the asked range in the tool's
 * absolute form (`args` comes back redrawn), and any other look-back runs as
 * sent and is recorded shifted. Filed through the one writer; no event (the
 * row is the record).
 */
export function timeAtDispatch(
  scope: TypedScope<AgentState>,
  call: { readonly toolCallId: string; readonly toolName: string },
  iteration: number,
  tool: RuledToolLike | undefined,
  args: Readonly<Record<string, unknown>>,
  appZone: ZoneName | undefined,
): { readonly context: TimeContext | undefined; readonly args: Readonly<Record<string, unknown>> } {
  const atMs = Date.now();
  const dispatchedAt = new Date(atMs).toISOString();
  const ledger = scope.findingsLedger as FindingsLedger | undefined;
  const turn = scope.turnNumber as number;
  const window = callWindowOfCall(ledger, call.toolCallId, turn);
  const clock = clockOf(ledger);
  const rules = window !== undefined && clock !== undefined ? rulesOf(tool) : undefined;
  const drift =
    rules !== undefined && !isRefused(rules) && clock !== undefined
      ? driftAtDispatch(window, periodFormsOf(rules.period), {
          now: clock.now,
          dispatchedAt,
          granularityMs: granularityMsOf(periodFactsOf(rules.period)),
          zone: clock.zone,
          ...(appZone !== undefined && { appZone }),
        })
      : undefined;
  const row = callRow(
    call,
    { turn, iteration },
    atMs,
    drift === undefined
      ? undefined
      : drift.outcome === 'redrawn'
      ? { byMs: drift.byMs, outcome: 'redrawn', form: drift.form }
      : { byMs: drift.byMs, outcome: 'shifted' },
  );
  recordFindings(scope, [row]);
  const redrawn =
    drift?.outcome === 'redrawn' ? redrawnArgs(args, tool, window?.form, drift.values) : args;
  return { context: callTimeContext(scope, call.toolCallId, row.dispatchedAt), args: redrawn };
}

/** `args` with the look-back form's argument dropped and the absolute form's values written — a fresh object. */
function redrawnArgs(
  args: Readonly<Record<string, unknown>>,
  tool: RuledToolLike | undefined,
  lookbackForm: number | undefined,
  values: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const rules = rulesOf(tool);
  const forms = rules === undefined || isRefused(rules) ? [] : periodFormsOf(rules.period);
  const lookback = lookbackForm === undefined ? undefined : forms[lookbackForm];
  const next: Record<string, unknown> = { ...args };
  if (lookback !== undefined && lookback.kind === 'lookback') delete next[lookback.argument];
  return { ...next, ...values };
}

/**
 * `ctx.time` for one call (`core/time/wire.ts` · `TimeContext`, time design
 * § 7.5) — present only when the inputs layer filed a `call-window` row for
 * it this turn (its tool's period declares forms) and the turn has a clock:
 * the range the call asks for, the person's zone, the frozen `now` and the
 * dispatch moment just recorded. Read from the committed ledger, never
 * recomputed.
 */
export function callTimeContext(
  scope: TypedScope<AgentState>,
  toolCallId: string,
  dispatchedAt: string,
): TimeContext | undefined {
  const ledger = scope.findingsLedger as FindingsLedger | undefined;
  const window = callWindowOfCall(ledger, toolCallId, scope.turnNumber as number);
  if (window === undefined) return undefined;
  const clock = clockOf(ledger);
  if (clock === undefined) return undefined;
  return structuredClone(timeContextOf(window, clock, dispatchedAt));
}

/**
 * A resume's passed `time` against the paused turn's kept clock — one
 * `clock-on-resume` row when they differ (`core/time/rowsBuild.ts` ·
 * `clockOnResumeRow`), nothing when nothing was passed, nothing differs, or
 * the paused turn has no clock (a checkpoint written by an agent without the
 * layer: there is no frozen clock to keep, and a resume never starts one
 * mid-turn).
 *
 * Called FIRST at both of this stage's entries, because a resume re-enters
 * through either: the pausable `resume` door (a check-in, a middleware ask, a
 * tool's own pause) or `execute` re-run from its top (the inputs layer's
 * argument ask pauses through footprintjs's `interrupt()`). The passed value
 * is TAKEN (`ToolCallsHandlerDeps.time` · `takePassedOnResume`), so the leg
 * files it once whichever door it came through, and a fresh run — which
 * passed none — files nothing.
 */
export function recordClockOnResume(
  scope: TypedScope<AgentState>,
  time: NonNullable<ToolCallsHandlerDeps['time']>,
): void {
  const passed = time.takePassedOnResume();
  if (passed === undefined) return;
  const kept = clockOf(scope.findingsLedger as FindingsLedger | undefined);
  if (kept === undefined) return;
  const row = clockOnResumeRow(passed, kept, {
    turn: scope.turnNumber as number,
    iteration: scope.iteration as number,
  });
  if (row !== undefined) recordFindings(scope, [row]);
}
