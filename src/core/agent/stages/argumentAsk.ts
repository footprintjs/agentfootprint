/**
 * stages/argumentAsk — the inputs layer's ONE ask per batch, raised by the
 * dispatch stage before anything in the batch runs.
 *
 * Pattern: stage glue over the pure ask (`arguments/ask.ts`): reads the
 *          layer's resolutions and the ask's working state from scope, files
 *          the answered rows through the one writer, and raises the pause.
 * Role:    core/agent/stages. Called by ToolCalls (`stages/toolCalls/batch/execute.ts`) at
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
import type { ArgumentAskDeps } from './argumentAskDeps.js';
export type { ArgumentAskDeps } from './argumentAskDeps.js';
import { readToolOwner } from '../../../tools/toolResourceOwner.js';

import { stampInputRequest, type AwaitingInput } from '../../../tools/inputRequest.js';
import {
  argumentAskDeclaration,
  bindAnswer,
  confirmationField,
  initialAskState,
  judgeAskContextHook,
  nextAskRound,
  planAskFields,
  readAskAnswer,
  settledCalls,
  withWaiting,
  withSettled,
  type ArgumentAskState,
  type AskWaiting,
  type CallAsk,
  type WindowAskPlan,
} from '../arguments/ask.js';
import {
  declareBatch,
  timeDecisionsOf,
  callWindowRowsOf,
  type ArgumentResolution,
  type BatchCall,
} from '../arguments/resolve.js';
import { batchAddress, type BatchAddress } from '../arguments/batchAddress.js';
import {
  callsByAddress,
  addressOf,
  memberAddresses,
  restoreAskAddresses,
} from '../arguments/askAddresses.js';
import { timeAskForProof } from './provenWindowAsk.js';
import { withFills } from '../arguments/dispatch.js';
import { markPrivateAsk, requirePrivateQuestionSupport } from '../arguments/privateAnswers.js';
import { privateFieldsInForce, markPrivateFields } from '../../../redaction/runRedaction.js';
import {
  declarePendingPrivateAsk,
  pendingPrivateAskOf,
  pendingPrivateSelections,
  requirePendingPrivateViews,
} from '../arguments/pendingPrivateAsk.js';
import {
  hasOneMaterializedWindow,
  partialOriginOf,
  snapshotPartialState,
  validPartialFields,
  validPartialSnapshot,
  validPartialState,
  type PartialOrigin,
} from '../arguments/partialWindow.js';
import { declaredSourcesOf } from '../honesty/sourceCorpus.js';
import { activeTimeReadings } from '../honesty/timeInputs.js';
import { periodFactsOf, rulesOf, isRefused } from '../../../tools/declare.js';
import { callOccurrenceField } from '../../../lib/callOccurrence.js';
import { timeRefusal, unansweredRefusal } from '../arguments/serve.js';
import { recordFindings } from '../findings/ledger.js';
import type { FindingsLedger } from '../findings/types.js';
import type { AgentState } from '../types.js';
import { answersOf, clockOf, type TimeReadingRow } from '../../../time/rows.js';
import type { ZoneName } from '../../../time/zone.js';
import { timeAskOf } from '../../../time/readingAsk.js';
import { isOpenForPerson, turnWindowsOf } from '../../../time/windows.js';
import { spellRange } from '../../../time/range.js';
import { defaultTimeAskMessages } from '../../../locales/timeAsk.js';
import type { AskTime } from '../arguments/ask.js';

/**
 * Under `.time({ reader })`: this turn's ONE open mention — the row the lazy
 * ask is about: a reading to confirm, a zone to name, or words the library
 * could not read (`time/windows.ts` · `isOpenForPerson`, the one owner). A mention
 * the person already settled in the time ask (its `time-answer` row) is not
 * open: it is asked once per turn.
 */
function openReadingOf(
  scope: TypedScope<AgentState>,
  allowProven: boolean,
): TimeReadingRow | undefined {
  const ledger = scope.findingsLedger as FindingsLedger | undefined;
  const turn = scope.turnNumber as number;
  const answered = new Set(answersOf(ledger, turn).map((a) => a.mention));
  const open = activeTimeReadings(scope, allowProven).filter(
    (row) => isOpenForPerson(row) && !answered.has(row.mention ?? 0),
  );
  return open.length === 1 ? (structuredClone(open[0]) as TimeReadingRow) : undefined;
}

/** The whole catalog: the app's overrides (`.time({ messages })`) over the defaults. */
const catalogOf = (reader: NonNullable<ArgumentAskDeps['time']>['reader']) => ({
  ...defaultTimeAskMessages,
  ...(reader?.messages ?? {}),
});

/** Under `.time()`: the paused turn's clock — the facts check reads it; `undefined` with no clock. */
function askTimeOf(scope: TypedScope<AgentState>, deps: ArgumentAskDeps): AskTime | undefined {
  if (deps.time === undefined) return undefined;
  const clock = clockOf(scope.findingsLedger as FindingsLedger | undefined);
  if (clock === undefined) return undefined;
  const reader = deps.time.reader;
  const row =
    reader !== undefined ? openReadingOf(scope, deps.time?.allowProven === true) : undefined;
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
 * turn's one OPEN mention needs, built by the one owner (`time/readingAsk.ts` ·
 * `timeAskOf`) — only under the reader's arm, only when a call of the batch
 * left its period out while that mention was open (`ArgumentResolution.window`).
 */
function windowPlanOf(
  scope: TypedScope<AgentState>,
  deps: ArgumentAskDeps,
  asks: readonly CallAsk[],
  partial = false,
): WindowAskPlan | undefined {
  const reader = deps.time?.reader;
  if (reader === undefined || (!partial && !asks.some((a) => a.window === true))) return undefined;
  const clock = clockOf(scope.findingsLedger as FindingsLedger | undefined);
  const row = openReadingOf(scope, deps.time?.allowProven === true);
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
    reply: { version: 1, description: catalogOf(reader)['reply.correction'] },
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

/** What the ask hands the batch back. */
export interface AskedBatch {
  /** Per call, the entry ToolCalls applies: the layer's fills plus the answered ones, or a refusal. */
  readonly resolutions: ReadonlyMap<BatchAddress, ArgumentResolution>;
  /** This pass carries the person's answer — the batch's one human question has been asked. */
  readonly answered: boolean;
  readonly refused?: true;
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
    ...callOccurrenceField(c.callOccurrenceKey),
    args: { ...(c.args ?? {}) },
    ...(c.argumentsFailure !== undefined && { argumentsFailure: c.argumentsFailure }),
  }));
}

/**
 * The ask's working state for THIS batch, detached — a state left by another
 * batch is not this one's. Read only when the layer named an argument to ask
 * for on a call of this batch, so the key is read only where it can exist.
 */
function stateFor(
  scope: TypedScope<AgentState>,
  iteration: number,
  pending: boolean,
  calls: readonly BatchCall[],
): ArgumentAskState | undefined {
  if (!pending) return undefined;
  const state = scope.$getValue('argumentAsk') as ArgumentAskState | undefined;
  if (state === undefined || state.iteration !== iteration) return undefined;
  const detached = structuredClone(state) as ArgumentAskState;
  if (detached.partial !== undefined && !validPartialSnapshot(detached)) {
    throw new TypeError('argumentAsk: partial-window state does not match this batch');
  }
  return restoreAskAddresses(detached, calls);
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
  resolutions: ReadonlyMap<BatchAddress, ArgumentResolution>,
  configured: ArgumentAskDeps,
): AskedBatch {
  const iteration = scope.iteration as number;
  const turn = scope.turnNumber as number;
  const calls = batchOf(scope).filter(
    (call) => !configured.excludedCallAddresses?.includes(addressOf(call)),
  );
  const entries = new Map(resolutions);
  const ledger = scope.findingsLedger as FindingsLedger | undefined;
  const answers = answersOf(ledger, turn);
  const deps = timeAskForProof(scope, configured, calls, entries, ledger, answers, iteration);
  const notifyRefusals = (current: ReadonlyMap<BatchAddress, ArgumentResolution>) => {
    if (deps.refusedCalls !== undefined)
      deps.refusedCalls(
        [...current].filter(([, entry]) => entry.refused !== undefined).map(([address]) => address),
      );
  };
  const time = askTimeOf(scope, deps);
  const readings = activeTimeReadings(scope, deps.time?.allowProven === true);
  const open = readings.filter(
    (row) => isOpenForPerson(row) && !answers.some((a) => a.mention === (row.mention ?? 0)),
  );
  const origins: PartialOrigin[] = [];
  const refuse = (call: BatchCall, arguments_: readonly string[], expected: string) => {
    entries.set(addressOf(call), {
      toolCallId: call.id,
      ...callOccurrenceField(call.callOccurrenceKey),
      iteration,
      refused: unansweredRefusal(
        call.name,
        arguments_.map((argument) => ({ argument, expected })),
      ),
    });
  };
  if (
    deps.time?.reader !== undefined &&
    time !== undefined &&
    (open.length > 0 || answers.length > 0)
  ) {
    for (const call of calls) {
      if (entries.get(addressOf(call))?.refused !== undefined) continue;
      const origin = partialOriginOf(call, deps.toolOf, time);
      if (origin === 'ambiguous') {
        refuse(call, ['period'], 'one unambiguous declared period form');
      } else if (origin !== undefined) {
        if (open.length > 1) refuse(call, origin.arguments, 'one unambiguous time mention');
        else {
          origins.push(origin);
          const address = addressOf(call);
          if (!entries.has(address))
            entries.set(address, {
              toolCallId: call.id,
              ...callOccurrenceField(call.callOccurrenceKey),
              iteration,
            });
        }
      }
    }
  }
  notifyRefusals(entries);
  const asks: CallAsk[] = [...entries.values()].flatMap((r) =>
    r.refused === undefined && r.ask !== undefined && r.ask.length > 0
      ? [
          {
            toolCallId: r.toolCallId,
            ...callOccurrenceField(r.callOccurrenceKey),
            ask: r.ask,
            ...(r.quoted !== undefined && { quoted: r.quoted }),
            ...(r.window === true && { window: true as const }),
          },
        ]
      : [],
  );
  const stored = stateFor(scope, iteration, deps.pendingAsk === true, calls);
  if (asks.length === 0 && origins.length === 0 && stored === undefined)
    return { resolutions: entries, answered: false };
  if (deps.refuseMalformedBatch?.() === true)
    return { resolutions: entries, answered: false, refused: true };
  if (
    deps.correctOmissions !== undefined &&
    stored === undefined &&
    origins.length === 0 &&
    ![...entries.values()].some((entry) => entry.refused !== undefined) &&
    !asks.some((ask) => ask.window === true) &&
    deps.correctOmissions?.(asks) === true
  )
    return { resolutions: entries, answered: false, refused: true };
  requirePrivateQuestionSupport(
    scope,
    calls.map((call) => deps.toolOf(call.name)),
  );
  // The admitted resource owner keeps its native birth across SAME and FRESH restore.
  const owner = readToolOwner(scope.$getValue('toolResourceOwner')).birth;
  const mention = open[0]?.mention ?? answers[0]?.mention ?? 0;
  const identity = { owner, turn, iteration, mention, origins };
  if (stored?.partial !== undefined && !validPartialState(stored.partial, identity)) {
    throw new TypeError('argumentAsk: partial-window state does not match this batch');
  }
  if (
    stored?.fields.some((field) => field.window?.role !== undefined) &&
    stored.partial === undefined
  ) {
    throw new TypeError('argumentAsk: meaning role without partial-window owner');
  }
  const partial = origins.length > 0;
  const fillAsks = asks.filter((ask) => ask.window === true);
  const ordinaryAsks = partial ? asks.filter((ask) => ask.window !== true) : asks;
  const ordinaryFields = planAskFields(
    ordinaryAsks,
    calls,
    deps.toolOf,
    partial ? undefined : windowPlanOf(scope, deps, asks),
  );
  let state = stored ?? initialAskState(iteration, ordinaryFields);
  if (partial && state.partial === undefined) {
    state = { ...state, partial: { version: 1, phase: 'complete-arguments', ...identity } };
  }
  if (state.partial !== undefined) {
    const plan = windowPlanOf(scope, deps, asks, true);
    if (
      !validPartialFields(
        state,
        ordinaryFields,
        plan === undefined
          ? undefined
          : confirmationField(plan, origins, fillAsks, calls, deps.toolOf),
      )
    ) {
      throw new TypeError('argumentAsk: invalid partial-window phase');
    }
  }
  let answered = false;
  if (state.waiting !== undefined) {
    const declaration = pendingPrivateAskOf(state, privateFieldsInForce(scope) !== undefined);
    requirePendingPrivateViews(state, declaration, deps.toolOf);
    const selected = pendingPrivateSelections(declaration, state);
    if (selected.length > 0) markPrivateFields(scope, selected);
    const input = interrupt(scope, pauseDataOf(state.waiting));
    const bound = bindAnswer(
      state,
      readAskAnswer(state.waiting, input),
      calls,
      deps.toolOf,
      { turn, iteration },
      time,
      entries,
    );
    markPrivateAsk(scope, bound.state, calls, deps.toolOf, settledCalls(bound.state), entries);
    deps.admitAnswer?.();
    recordFindings(scope, bound.rows, { turn });
    state = bound.state;
    answered = true;
  }
  let round = nextAskRound(state);
  if (round === undefined && state.partial?.phase === 'complete-arguments') {
    const completed = withSettled(entries, state, calls);
    notifyRefusals(completed);
    const eligible = origins.filter(
      (origin) => completed.get(addressOf(origin.call))?.refused === undefined,
    );
    const plan = windowPlanOf(scope, deps, asks, true);
    if ((eligible.length > 0 || fillAsks.length > 0) && open.length > 0) {
      if (plan === undefined) {
        for (const origin of eligible)
          refuse(origin.call, origin.arguments, 'a confirmed time window');
      } else {
        // Existing ordinary fields retain their answers. The new native field has a distinct
        // role: meaning acceptance does not assign its string to an endpoint.
        const field = confirmationField(plan, origins, fillAsks, calls, deps.toolOf);
        state = {
          ...state,
          partial: { ...state.partial, phase: 'confirm-meaning' },
          fields: [...state.fields, field],
          progress: [...state.progress, { rounds: 0 }],
        };
        round = nextAskRound(state);
      }
    }
  }
  if (round !== undefined) {
    const stamped = stampRound(scope, state, round, deps);
    const declaration = declarePendingPrivateAsk(
      withWaiting(state, stamped),
      deps.toolOf,
      privateFieldsInForce(scope) !== undefined,
    );
    const waiting = {
      ...stamped,
      ...(declaration !== undefined && { privateFields: declaration }),
    };
    const next = snapshotPartialState(withWaiting(state, waiting));
    const selected = pendingPrivateSelections(declaration, state);
    if (selected.length > 0) markPrivateFields(scope, selected);
    markPrivateAsk(scope, next, calls, deps.toolOf, settledCalls(next), entries);
    scope.argumentAsk = next;
    deps.saveParties?.();
    if (deps.beforePause !== undefined) {
      const byAddress = callsByAddress(calls);
      deps.beforePause(
        waiting.fieldIndexes.flatMap((index) =>
          next.fields[index].members.flatMap((member) =>
            memberAddresses(member).flatMap((address) => {
              const call = byAddress.get(address);
              return call === undefined
                ? []
                : [
                    {
                      toolCallId: call.id,
                      ...callOccurrenceField(call.callOccurrenceKey),
                      argument: member.argument,
                    },
                  ];
            }),
          ),
        ),
      );
    }
    interrupt(scope, pauseDataOf(waiting));
    throw new TypeError('argumentAsk: replay is missing its original batch state');
  }
  if (stored !== undefined) scope.argumentAsk = undefined;
  deps.settledAsk?.();
  const settled = withSettled(entries, state, calls);
  if (partial && time !== undefined) {
    const currentLedger = scope.findingsLedger as FindingsLedger | undefined;
    const currentAnswers = answersOf(currentLedger, turn);
    const currentReadings = activeTimeReadings(scope, deps.time?.allowProven === true);
    const clock = clockOf(currentLedger);
    const materialized = calls
      .filter((c) => settled.get(addressOf(c))?.refused === undefined)
      .map((c) => ({ ...c, args: withFills(c.args, settled.get(addressOf(c))) }));
    for (const origin of origins) {
      const call = materialized.find((c) => addressOf(c) === addressOf(origin.call));
      if (call === undefined) continue;
      if (
        !hasOneMaterializedWindow(call, deps.toolOf, time) ||
        currentReadings.some(
          (r) => isOpenForPerson(r) && !currentAnswers.some((a) => a.mention === (r.mention ?? 0)),
        )
      ) {
        settled.set(addressOf(call), {
          toolCallId: call.id,
          ...callOccurrenceField(call.callOccurrenceKey),
          iteration,
          refused: unansweredRefusal(
            call.name,
            origin.arguments.map((argument) => ({
              argument,
              expected: 'one readable range and a confirmed time window',
            })),
          ),
        });
      }
    }
    if (clock !== undefined) {
      const sources =
        deps.argumentSources === true
          ? {
              declared: new Map(
                declaredSourcesOf(calls, deps.toolOf).map((source) => [
                  batchAddress(source.toolCallId, source.callOccurrenceKey),
                  source,
                ]),
              ),
            }
          : undefined;
      // Already window-filled members have their canonical filled row from bindAnswer. Rebind
      // preserved partial/complete scopes against the freshly recorded meaning, never their provenance.
      const compare = materialized.filter(
        (c) =>
          settled.get(addressOf(c))?.refused === undefined &&
          !(settled.get(addressOf(c))?.fills ?? []).some(
            (f) => f.source === 'window' || (f.source === 'answered' && f.window === true),
          ),
      );
      const decisions = timeDecisionsOf(
        declareBatch(compare, deps.toolOf, sources),
        compare,
        deps.toolOf,
        {
          now: clock.now,
          zone: clock.zone,
          turn: turnWindowsOf(currentReadings, clock, currentAnswers),
          ...(deps.time?.appZone !== undefined && { appZone: deps.time.appZone }),
        },
        sources,
      );
      recordFindings(scope, callWindowRowsOf(decisions, compare, { turn, iteration }), { turn });
      for (const call of compare) {
        const decision = decisions.get(addressOf(call));
        const rules = rulesOf(deps.toolOf(call.name));
        if (decision?.how === 'refused' && rules !== undefined && !isRefused(rules)) {
          settled.set(addressOf(call), {
            toolCallId: call.id,
            ...callOccurrenceField(call.callOccurrenceKey),
            iteration,
            refused: timeRefusal(
              call.name,
              decision.refused,
              periodFactsOf(rules.period),
              'argument' in decision ? decision.argument : undefined,
            ),
          });
        }
      }
    }
  }
  notifyRefusals(settled);
  return { resolutions: settled, answered };
}
