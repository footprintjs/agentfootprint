/**
 * stages/argumentAsk — the inputs layer's ONE ask per batch, raised by the
 * dispatch stage before anything in the batch runs.
 *
 * Pattern: stage glue over the pure ask (`arguments/ask.ts`): reads the
 *          layer's resolutions and the ask's working state from scope, files
 *          the answered rows through the one writer, and raises the pause.
 * Role:    core/agent/stages. Called by ToolCalls (`stages/toolCalls.ts`) at
 *          the very top of its batch, under the inputs layer's arm, only when
 *          the layer named an argument to ask for on a call of THIS batch.
 * Emits:   `agentfootprint.findings.argument` — one per `answered` /
 *          `invalid-answer` row, through the ledger's writer.
 *
 * ## Why the pause is raised here, and how
 *
 * The layer (`sf-inputs`, after the LLM call and before Route) decides what to
 * ask; the dispatch stage raises it, first thing, through footprintjs's
 * `interrupt()`. A resume then RE-RUNS the dispatch stage from its top: the
 * person's answer comes back out of the same `interrupt()` call, is bound, and
 * the batch dispatches on its ordinary path. ToolCalls is the one stage of the
 * ReAct loop whose resume continues the loop: it is the branch that loops, so
 * the continuation after it IS the loop head. A pause raised inside the
 * layer's own subflow (the design's first placement) resumes into a traversal
 * that cannot reach the loop head — footprintjs 9.26–9.27 resolves the
 * loop-back to its reference stub and the run ends silently after one stage —
 * and, inside a composition, would sit two subflows deep, where a resume
 * re-runs the agent's stages before the mount (a model call included).
 *
 * ## One human question per resume
 *
 * The re-run carries the person's answer, and footprintjs's interrupt
 * re-entry cannot pause by RETURNING a value, so this batch's one human
 * question has been asked: a later call of the SAME batch that needs a person
 * (a middleware `ask`, a check-in, a credential consent, the tool's own
 * pause) is refused by name — the law every resume door already keeps. The
 * answers such a call carried are KEPT (`../arguments/kept.ts`), so when the
 * model proposes it again — leaving the argument out, as the served schema
 * says — the layer fills the kept answer instead of asking the same question
 * again, and the call's own step pauses in that batch, which asked nothing.
 */

import { interrupt, type InterruptPayload, type TypedScope } from 'footprintjs';

import { stampInputRequest, type AwaitingInput } from '../../inputRequest.js';
import {
  argumentAskDeclaration,
  bindAnswer,
  initialAskState,
  judgeAskContextHook,
  nextAskRound,
  planAskFields,
  readAskAnswer,
  settledCalls,
  withWaiting,
  type ArgumentAskState,
  type AskWaiting,
  type CallAsk,
  type WindowAskPlan,
} from '../arguments/ask.js';
import type { ArgumentResolution, BatchCall, ToolOf } from '../arguments/resolve.js';
import { unansweredRefusal } from '../arguments/serve.js';
import { recordFindings } from '../findings/ledger.js';
import type { FindingsLedger } from '../findings/types.js';
import type { AgentState } from '../types.js';
import { answersOf, clockOf, readingsOf, type TimeReadingRow } from '../../time/rows.js';
import type { ZoneName } from '../../time/zone.js';
import type { TimeAskMessages } from '../../time/ask.js';
import { timeAskOf } from '../../time/readingAsk.js';
import { isOpenForPerson } from '../../time/windows.js';
import { spellRange } from '../../time/range.js';
import type { TimePolicy } from '../../time/resolve.js';
import { defaultTimeAskMessages } from '../../../locales/timeAsk.js';
import type { AskTime } from '../arguments/ask.js';

/**
 * Under `.time({ reader })`: this turn's ONE open mention — the row the lazy
 * ask is about: a reading to confirm, a zone to name, or words the library
 * could not read (`windows.ts` · `isOpenForPerson`, the one owner). A mention
 * the person already settled in the time ask (its `time-answer` row) is not
 * open: it is asked once per turn.
 */
function openReadingOf(scope: TypedScope<AgentState>): TimeReadingRow | undefined {
  const ledger = scope.findingsLedger as FindingsLedger | undefined;
  const turn = scope.turnNumber as number;
  const answered = new Set(answersOf(ledger, turn).map((a) => a.mention));
  const open = readingsOf(ledger, turn).filter(
    (row) => isOpenForPerson(row) && !answered.has(row.mention ?? 0),
  );
  return open.length === 1 ? (structuredClone(open[0]) as TimeReadingRow) : undefined;
}

/** The whole catalog: the app's overrides (`.time({ messages })`) over the defaults. */
const catalogOf = (reader: NonNullable<ArgumentAskDeps['time']>['reader']): TimeAskMessages => ({
  ...defaultTimeAskMessages,
  ...(reader?.messages ?? {}),
});

/** Under `.time()`: the paused turn's clock — the facts check reads it; `undefined` with no clock. */
function askTimeOf(scope: TypedScope<AgentState>, deps: ArgumentAskDeps): AskTime | undefined {
  if (deps.time === undefined) return undefined;
  const clock = clockOf(scope.findingsLedger as FindingsLedger | undefined);
  if (clock === undefined) return undefined;
  const reader = deps.time.reader;
  const row = reader !== undefined ? openReadingOf(scope) : undefined;
  return {
    now: clock.now,
    zone: clock.zone,
    ...(clock.zoneSource === 'unknown' && { zoneUnknown: true as const }),
    ...(deps.time.appZone !== undefined && { appZone: deps.time.appZone }),
    ...(reader !== undefined &&
      row !== undefined && {
        reading: { row, policy: reader.policy, messages: catalogOf(reader) },
      }),
  };
}

/**
 * The lazy word-driven ask's plan (time design § 5.2): the question the
 * turn's one OPEN mention needs, built by the one owner (`core/time/readingAsk.ts` ·
 * `timeAskOf`) — only under the reader's arm, only when a call of the batch
 * left its period out while that mention was open (`ArgumentResolution.window`).
 */
function windowPlanOf(
  scope: TypedScope<AgentState>,
  deps: ArgumentAskDeps,
  asks: readonly CallAsk[],
): WindowAskPlan | undefined {
  const reader = deps.time?.reader;
  if (reader === undefined || !asks.some((a) => a.window === true)) return undefined;
  const clock = clockOf(scope.findingsLedger as FindingsLedger | undefined);
  const row = openReadingOf(scope);
  if (row === undefined || clock === undefined) return undefined;
  const ask = timeAskOf(row, catalogOf(reader));
  if (ask === undefined) return undefined;
  const format = ask.field.format;
  if (format !== 'time-range' && format !== 'zone') return undefined;
  const candidates = row.candidates ?? [];
  const zones = (ask.field.enum ?? []).map(
    (value) => candidates.find((c) => spellRange(c.range) === value)?.zone,
  );
  return {
    question: ask.question,
    format,
    ...(ask.field.enum !== undefined && { choices: ask.field.enum }),
    ...(ask.field.enum !== undefined &&
      zones.every((z) => z !== undefined) && { zones: zones as ZoneName[] }),
    ...(ask.field.labels !== undefined && { labels: ask.field.labels }),
    mention: row.mention ?? 0,
    now: clock.now,
    zone: clock.zone,
    ...(deps.time?.appZone !== undefined && { appZone: deps.time.appZone }),
  };
}

/** What the dispatch stage hands the ask — closures, never scope. */
export interface ArgumentAskDeps {
  /** The implementation that will answer a name — the shared dispatch resolver's. */
  readonly toolOf: ToolOf;
  /** The run id a stamped request id carries; absent → the turn's start time. */
  readonly runId?: () => string | undefined;
  /** The host's own context for the ask (`AgentOptions.argumentAskContext`). */
  readonly hostContext?: () => unknown;
  /**
   * Present exactly under `.time()`: an answer for a period argument is also
   * judged against the tool's declared facts at the turn's clock
   * (`arguments/ask.ts` · `checkAnswer`) — `appZone` is the app's `.time({ zone })`.
   * `reader` is present exactly under `.time({ reader })`: a call that left
   * its period out while the turn's one mention was open is asked THAT
   * mention's window (the lazy word-driven ask) — `policy` re-reads the
   * mention after a zone answer, `messages` are the app's catalog overrides.
   */
  readonly time?: {
    readonly appZone?: ZoneName;
    readonly reader?: {
      readonly policy: TimePolicy;
      readonly messages?: Partial<TimeAskMessages>;
    };
  };
}

/** What the ask hands the batch back. */
export interface AskedBatch {
  /** Per call id, the entry ToolCalls applies: the layer's fills plus the answered ones, or a refusal. */
  readonly resolutions: ReadonlyMap<string, ArgumentResolution>;
  /** This pass carries the person's answer — the batch's one human question has been asked. */
  readonly answered: boolean;
}

/** The pause's data — the typed ask, and its question twice over for the pause readers. */
type AskPauseData = InterruptPayload & {
  readonly question: string;
  readonly awaitingInput: AwaitingInput;
};

function pauseDataOf(waiting: AskWaiting): AskPauseData {
  return {
    reason: waiting.awaiting.question,
    question: waiting.awaiting.question,
    awaitingInput: waiting.awaiting,
  };
}

/** The batch's calls, detached from the live scope view. */
function batchOf(scope: TypedScope<AgentState>): BatchCall[] {
  return [...((scope.llmLatestToolCalls as readonly BatchCall[] | undefined) ?? [])].map((c) => ({
    id: c.id,
    name: c.name,
    args: { ...(c.args ?? {}) },
  }));
}

/**
 * The ask's working state for THIS batch, detached — a state left by another
 * batch is not this one's. Read only when the layer named an argument to ask
 * for on a call of this batch, so the key is read only where it can exist.
 */
function stateFor(scope: TypedScope<AgentState>, iteration: number): ArgumentAskState | undefined {
  const state = scope.$getValue('argumentAsk') as ArgumentAskState | undefined;
  return state !== undefined && state.iteration === iteration
    ? (structuredClone(state) as ArgumentAskState)
    : undefined;
}

/** The typed ask for the next round, stamped — the host's context judged first. */
function stampRound(
  scope: TypedScope<AgentState>,
  state: ArgumentAskState,
  round: NonNullable<ReturnType<typeof nextAskRound>>,
  deps: ArgumentAskDeps,
): AskWaiting {
  const host = deps.hostContext !== undefined ? judgeAskContextHook(deps.hostContext()) : undefined;
  const { declaration, fieldIndexes } = argumentAskDeclaration(state, round, host);
  const first = state.fields[fieldIndexes[0]].members[0].toolCallIds[0];
  const requestId =
    `${deps.runId?.() ?? String(scope.turnStartMs)}:arguments:` +
    `${state.iteration}:${state.progress.reduce((n, p) => n + p.rounds, 0) + 1}`;
  const awaiting = stampInputRequest(declaration, requestId, {
    originalRequest: scope.userMessage as string,
    toolCallId: first,
    ...(scope.currentSkillId !== undefined && { skillId: scope.currentSkillId as string }),
    ...(scope.turnRoute?.offered !== undefined && {
      offeredSkillIds: [...(scope.turnRoute.offered as readonly string[])],
    }),
  });
  return { requestId, fieldIndexes, awaiting };
}

/** Each call's entry with the settled ask folded in: the answered fills, or the unanswered refusal. */
function withSettled(
  resolutions: ReadonlyMap<string, ArgumentResolution>,
  state: ArgumentAskState,
  calls: readonly BatchCall[],
): Map<string, ArgumentResolution> {
  const nameOf = new Map(calls.map((c) => [c.id, c.name]));
  const settled = settledCalls(state);
  const merged = new Map<string, ArgumentResolution>();
  for (const [id, entry] of resolutions) {
    const s = settled.get(id);
    if (s === undefined || entry.refused !== undefined) {
      merged.set(id, entry);
      continue;
    }
    if (s.exhausted.length > 0) {
      merged.set(id, {
        toolCallId: id,
        iteration: entry.iteration,
        refused: unansweredRefusal(nameOf.get(id) ?? id, s.exhausted),
      });
      continue;
    }
    // An answered value replaces any earlier fill of the same argument (a window answered for
    // a form whose other argument the tool's rule had assumed).
    const answered = new Set(s.fills.map((f) => f.argument));
    const fills = [...(entry.fills ?? []).filter((f) => !answered.has(f.argument)), ...s.fills];
    merged.set(id, {
      toolCallId: id,
      iteration: entry.iteration,
      ...(fills.length > 0 && { fills }),
    });
  }
  return merged;
}

/**
 * Ask the person, ONCE for the whole batch and before anything in it runs,
 * for every value the layer named — or, on the re-run a resume makes, take the
 * answer out of the same `interrupt()`, bind it (the answered rows), and ask
 * again only for a field whose answer did not fit (bounded). Throws footprintjs's
 * interrupt signal to pause; throws `InputRequestError` on an answer to
 * another request or a malformed one. Returns the entries ToolCalls applies.
 */
export function askBeforeDispatch(
  scope: TypedScope<AgentState>,
  resolutions: ReadonlyMap<string, ArgumentResolution>,
  deps: ArgumentAskDeps,
): AskedBatch {
  const asks: CallAsk[] = [...resolutions.values()].flatMap((r) =>
    r.ask !== undefined && r.ask.length > 0
      ? [
          {
            toolCallId: r.toolCallId,
            ask: r.ask,
            // Declared sources: the person's words a reading was made of, for the field.
            ...(r.quoted !== undefined && { quoted: r.quoted }),
            // The lazy word-driven ask: the period is asked as the open mention's window.
            ...(r.window === true && { window: true as const }),
          },
        ]
      : [],
  );
  if (asks.length === 0) return { resolutions, answered: false };
  const iteration = scope.iteration as number;
  const calls = batchOf(scope);
  const stored = stateFor(scope, iteration);
  let state =
    stored ??
    initialAskState(
      iteration,
      planAskFields(asks, calls, deps.toolOf, windowPlanOf(scope, deps, asks)),
    );
  let answered = false;
  if (state.waiting !== undefined) {
    // The re-run a resume makes: the answer comes back out of the one-shot interrupt.
    const input = interrupt(scope, pauseDataOf(state.waiting));
    const bound = bindAnswer(
      state,
      readAskAnswer(state.waiting, input),
      calls,
      deps.toolOf,
      { turn: scope.turnNumber as number, iteration },
      askTimeOf(scope, deps),
    );
    recordFindings(scope, bound.rows, { turn: scope.turnNumber as number });
    state = bound.state;
    answered = true;
  }
  const round = nextAskRound(state);
  if (round !== undefined) {
    const waiting = stampRound(scope, state, round, deps);
    scope.argumentAsk = withWaiting(state, waiting);
    interrupt(scope, pauseDataOf(waiting)); // the pause: this pass's answer, if any, is spent
  }
  // Settled: the question is no longer out. Cleared only where this pass read a stored state.
  if (stored !== undefined) scope.argumentAsk = undefined;
  return { resolutions: withSettled(resolutions, state, calls), answered };
}
