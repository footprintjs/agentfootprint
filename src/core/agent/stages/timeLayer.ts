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
 *          ToolCalls (`stages/toolCalls/execution/initialInvocation.ts`) load it through `import()` only
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
import type { LLMMessage } from '../../../provider-contract/types.js';
import { isSaidByPerson } from '../../../lib/saidByPerson.js';
import { callOccurrenceField, readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import { completeClock } from '../../../time/clock.js';
import { granularityMsOf } from '../../../time/convert.js';
import { coverAtDispatch, driftAtDispatch } from '../../../time/drift.js';
import {
  coveringDispatchMatches,
  frozenLookbackDispatchMatches,
} from '../../../time/frozenDispatch.js';
import { runKeepsOut } from '../../../redaction/runRedaction.js';
import { provenLookback } from '../../../time/provenForms/proof.js';
import { provenLookbackOf } from '../../../time/provenForms/qualification.js';
import { checkReading, type TimeReading } from '../../../time/reader.js';
import {
  answeredZoneOf,
  callWindowOfCall,
  clockOf,
  readingsOf,
  type TimeCallIdentity,
} from '../../../time/rows.js';
import { callRow, clockOnResumeRow, clockRow, timeReadingRows } from '../../../time/rowsBuild.js';
import { timeContextOf, type TimeContext } from '../../../time/wire.js';
import { tzdataVersion, type ZoneName } from '../../../time/zone.js';
import {
  isRefused,
  periodFactsOf,
  periodFormsOf,
  rulesOf,
  type RuledToolLike,
} from '../../../tools/declare.js';
import { canDiscloseProvenWindow } from '../honesty/provenWindowVisibility.js';
import { recordFindings } from '../findings/ledger.js';
import type { FindingsLedger } from '../findings/types.js';
import type { AgentInput, AgentState } from '../types.js';
import type { SeedStageDeps } from './seed.js';
import type { ToolCallsHandlerDeps } from './toolCalls/index.js';

// ─── seed ────────────────────────────────────────────────────────────────

/**
 * The turn's clock stamp (the time layer) — filed LAST in seed, after the
 * turn number is final (`anchorTurnNumber` may raise it), so the row names
 * the turn every later row of this turn names. One row per run; the clock is
 * a run constant from here on and is never written again this turn (a
 * resume keeps it — `stages/timeLayer.ts` records a differing `time` as
 * `clock-on-resume`). No accessor, or no draft → nothing is written. A draft
 * whose zone is unknown (G15) takes the zone the person answered in an earlier
 * turn (`time/rows.ts` · `answeredZoneOf`, `zoneSource: 'answered'`), else stays
 * unknown — never the server's.
 */
export function stampClock(scope: TypedScope<AgentState>, deps: SeedStageDeps): void {
  const draft = deps.timeClock?.(scope);
  if (draft === undefined) return;
  const answered =
    draft.zoneSource === 'unknown'
      ? answeredZoneOf(scope.findingsLedger as FindingsLedger | undefined)
      : undefined;
  const clock = completeClock(draft, scope.turnStartMs as number, answered);
  const position =
    deps.timeReader?.skipProvenConfirmation === true ? currentPersonPosition(scope) : undefined;
  recordFindings(scope, [
    clockRow(
      clock,
      { turn: scope.turnNumber as number, iteration: scope.iteration as number },
      draft.window,
      draft.display,
      position,
    ),
  ]);
}

function currentPersonPosition(scope: TypedScope<AgentState>): number | undefined {
  const input = scope.$getArgs<AgentInput>();
  if (
    scope.turnNumber !== 1 ||
    input.message !== scope.userMessage ||
    runKeepsOut(scope, 'history') ||
    runKeepsOut(scope, 'userMessage') ||
    runKeepsOut(scope, 'findingsLedger') ||
    runKeepsOut(scope, 'finalContent')
  ) {
    return undefined;
  }
  const history = scope.history as readonly LLMMessage[];
  const message = history[0];
  return history.length === 1 &&
    message !== undefined &&
    isSaidByPerson(message) &&
    message.content === input.message
    ? 0
    : undefined;
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
  const inputPosition = history.length - 1;
  const entry = history[inputPosition];
  if (clock === undefined || entry === undefined || !isSaidByPerson(entry)) return;
  const text = entry.content;
  const { reader, policy } = armed;
  const file = (reading: TimeReading): void => {
    const mentions = checkReading(text, reading, reader.id);
    const rows = timeReadingRows({
      mentions,
      clock,
      policy,
      reader,
      tzdata: tzdataVersion(),
      at: { turn, iteration: scope.iteration as number },
    });
    const row = rows[0];
    const candidate =
      armed.skipProvenConfirmation === true &&
      clock.turn === turn &&
      clock.provenInputPosition === inputPosition &&
      text === scope.userMessage
        ? provenLookbackOf(reader, text, clock, rows)
        : undefined;
    if (
      row !== undefined &&
      candidate !== undefined &&
      canDiscloseProvenWindow(scope, candidate.range)
    ) {
      recordFindings(scope, [
        {
          ...row,
          choice: { by: 'proven', candidate: 0 },
          qualifiedLookback: {
            receipt: provenLookback.receipt,
            inputPosition,
            clockNow: clock.now,
          },
        },
      ]);
      return;
    }
    recordFindings(scope, rows);
  };
  const reading = reader.read(text, { locale: reader.locale });
  if (reading !== null && typeof (reading as { then?: unknown }).then === 'function') {
    return Promise.resolve(reading).then(file);
  }
  file(reading as TimeReading);
}

// ─── ToolCalls ───────────────────────────────────────────────────────────

/**
 * The time layer at one dispatch: the `call` row (`time/rowsBuild.ts` ·
 * `callRow`) — the wall clock read at the moment the library hands the call
 * to the tool — and, for a call that sent a look-back, the clock at dispatch
 * (§ 7.4, `time/drift.ts` · `driftAtDispatch`): past the tool's step the
 * library's OWN look-back fill is re-sent as the asked range in the tool's
 * absolute form (`args` comes back redrawn), and any other look-back runs as
 * sent and is recorded shifted. Filed through the one writer; no event (the
 * row is the record).
 *
 * `redraw` is the same redraw as a function, for the call's OTHER copy of its
 * arguments — the record's (`CallArguments.chainedArgs`), which
 * `tool_end.changedArgKeys` is judged on. Redrawn, the tool runs with
 * `{ start_time, end_time }` and without `window`, so those are the keys the
 * record must name; not redrawn, it hands back the same object.
 */
export function timeAtDispatch(
  scope: TypedScope<AgentState>,
  call: TimeCallIdentity,
  iteration: number,
  tool: RuledToolLike | undefined,
  args: Readonly<Record<string, unknown>>,
  appZone: ZoneName | undefined,
): {
  readonly context: TimeContext | undefined;
  readonly args: Readonly<Record<string, unknown>>;
  readonly redraw: (args: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>;
} {
  const ledger = scope.findingsLedger as FindingsLedger | undefined;
  const turn = scope.turnNumber as number;
  const key = readCallOccurrenceKey(call);
  const window = callWindowOfCall(
    ledger,
    call.toolCallId,
    turn,
    (row) => key !== null && readCallOccurrenceKey(row) === key,
  );
  const clock = clockOf(ledger);
  const rules = window !== undefined && clock !== undefined ? rulesOf(tool) : undefined;
  if (
    window?.person?.frozenLookback === true &&
    (window.how === 'filled' || window.how === 'bound') &&
    (window.toolName !== call.toolName ||
      rules === undefined ||
      isRefused(rules) ||
      clock?.turn !== turn ||
      !frozenLookbackDispatchMatches(window, args, periodFormsOf(rules.period), clock.now, appZone))
  ) {
    throw new Error(
      'The tool did not run because its final arguments could not preserve the frozen look-back.',
    );
  }
  const atMs = Date.now();
  const dispatchedAt = new Date(atMs).toISOString();
  // A confirmed look-back in a length-only form: lengthened here to still reach the window's
  // start from this moment (the widening law at dispatch), or the call does not run.
  const cover = coversAtDispatch(window, call, turn, rules, clock, args, dispatchedAt);
  const drift =
    cover === undefined && rules !== undefined && !isRefused(rules) && clock !== undefined
      ? driftAtDispatch(
          driftWindowOf(window),
          periodFormsOf(rules.period),
          {
            now: clock.now,
            dispatchedAt,
            granularityMs: granularityMsOf(periodFactsOf(rules.period)),
            zone: clock.zone,
            ...(appZone !== undefined && { appZone }),
          },
          periodFactsOf(rules.period),
        )
      : undefined;
  const row = callRow(
    call,
    { turn, iteration },
    atMs,
    cover !== undefined
      ? { byMs: cover.byMs, outcome: 'covered', form: cover.form, sent: cover.sent }
      : drift === undefined
      ? undefined
      : drift.outcome === 'redrawn'
      ? { byMs: drift.byMs, outcome: 'redrawn', form: drift.form }
      : { byMs: drift.byMs, outcome: 'shifted' },
  );
  recordFindings(scope, [{ ...row, ...callOccurrenceField(call.callOccurrenceKey) }]);
  const redraw =
    cover !== undefined
      ? (sent: Readonly<Record<string, unknown>>) => ({ ...sent, ...cover.values })
      : drift?.outcome === 'redrawn'
      ? (sent: Readonly<Record<string, unknown>>) =>
          redrawnArgs(sent, tool, window?.form, drift.values)
      : (sent: Readonly<Record<string, unknown>>) => sent;
  return {
    context:
      window !== undefined && clock !== undefined
        ? structuredClone(timeContextOf(window, clock, row.dispatchedAt))
        : undefined,
    args: redraw(args),
    redraw,
  };
}

/** The row as the drift decision reads it: whether the turn's window was a confirmed one. */
function driftWindowOf(
  window: ReturnType<typeof callWindowOfCall>,
): Parameters<typeof driftAtDispatch>[0] {
  return window?.person?.endpoint !== undefined
    ? { ...window, confirmedTurn: true as const }
    : window;
}

/**
 * The covering look-back for a call whose `call-window` row says
 * `coversAtDispatch` (`time/drift.ts` · `coverAtDispatch`), or `undefined`
 * for any other call. Throws — the call does not run — when the final
 * arguments no longer hold the library's own look-back (a middleware rewrote
 * it, or added another period argument), or no look-back can cover the
 * window from this moment (it is still running, or the length is past the
 * form's `maxRange`): a confirmed window is never read shorter.
 */
function coversAtDispatch(
  window: ReturnType<typeof callWindowOfCall>,
  call: TimeCallIdentity,
  turn: number,
  rules: ReturnType<typeof rulesOf>,
  clock: ReturnType<typeof clockOf>,
  args: Readonly<Record<string, unknown>>,
  dispatchedAt: string,
): Extract<ReturnType<typeof coverAtDispatch>, { outcome: 'covered' }> | undefined {
  if (window?.coversAtDispatch !== true) return undefined;
  if (
    window.toolName !== call.toolName ||
    rules === undefined ||
    isRefused(rules) ||
    clock === undefined ||
    clock.turn !== turn
  ) {
    throw new Error(
      'The tool did not run because its look-back could not be matched to the confirmed window.',
    );
  }
  const forms = periodFormsOf(rules.period);
  const facts = periodFactsOf(rules.period);
  if (!coveringDispatchMatches(window, args, forms, clock.now, facts)) {
    throw new Error(
      'The tool did not run because its final arguments no longer held the look-back for the confirmed window.',
    );
  }
  const cover = coverAtDispatch(window, forms, { now: clock.now, dispatchedAt }, facts);
  if (cover === undefined || cover.outcome === 'uncoverable') {
    throw new Error(
      cover?.why === 'max-range'
        ? 'The tool did not run because covering the confirmed window from the moment the call was handed over took a longer look-back than the tool reads.'
        : 'The tool did not run because the confirmed window had not ended when the call was handed over, and a look-back ends when the source reads it.',
    );
  }
  return cover;
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
 * A resume's passed `time` against the paused turn's kept clock — one
 * `clock-on-resume` row when they differ (`time/rowsBuild.ts` ·
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
  const passed = time.takePassedOnResume(scope);
  if (passed === undefined) return;
  const kept = clockOf(scope.findingsLedger as FindingsLedger | undefined);
  if (kept === undefined) return;
  const row = clockOnResumeRow(passed, kept, {
    turn: scope.turnNumber as number,
    iteration: scope.iteration as number,
  });
  if (row !== undefined) recordFindings(scope, [row]);
}
