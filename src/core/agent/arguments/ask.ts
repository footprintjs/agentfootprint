import { timeReplyRow } from '../../../time/rows.js';
/**
 * arguments/ask — the ONE typed ask per batch for the values `ask` rules need:
 * its fields, its declaration, the binding of the person's answer, the re-ask.
 *
 * Pattern: Walker, pure. Every function here is a function of what it is
 *          handed — the batch's calls, the rules of the implementation that
 *          will run (`ToolOf`), the ask's own state — and nothing reads a
 *          clock, a model or scope. The stage glue (`stages/argumentAsk.ts`)
 *          reads and writes scope and raises the pause.
 * Role:    core/ layer leaf of the inputs layer (honesty layer 2). Imports
 *          nothing from `findings/` (the folder's one-way law).
 * Emits:   N/A.
 *
 * ## One ask for the whole batch, before anything in it runs
 *
 * The layer's Resolve stage names, per call, the `ask` arguments it left out
 * (`ArgumentResolution.ask`). They become ONE typed ask (`tools/inputRequest.ts`,
 * the door `requestInput` uses): one field per distinct (tool, argument), bound
 * to every call of the batch that needs it. Two PERIOD arguments of different
 * tools share one field when their spellings convert (`lookback` ↔
 * `signed-lookback`) and their choices are the same periods — asking twice for
 * one period would ask the person what they already answered. An `iso-range`
 * never merges.
 *
 * - **Field ids are positional** (`f1`, `f2`, …) per declaration — never a
 *   joined `tool.argument` string, which two pairs could spell alike (the
 *   injective-key law). The (tool, argument, calls) behind each id rides the
 *   declaration's `context` under the library's reserved key.
 * - **A value the model READ into the person's words** (declared sources: the
 *   quote was found in the person's messages, the value is not in it) is asked
 *   too, and its field's `context` entry carries those words as `quoted` —
 *   the person's own words, never the model's value, and never while a tool
 *   in reach can hide arguments (`resolve.ts` · `quotesMayShow`).
 * - **A fixed library question.** Each author's question is its field's
 *   `description`; joined questions could break the 4096-character bound at
 *   pause time although each passed it at definition.
 * - **Nothing the model proposed rides the ask** — no `supplied`, no value, no
 *   choice the model wrote.
 * - **More than 32 fields** (the typed ask's limit) go in rounds of 32.
 *
 * ## The answer, re-checked, and a bounded re-ask
 *
 * The typed ask checks type and enum only, so an integer asked as a number can
 * come back `2.5`, and a string can break its `pattern`. Each answer is judged
 * against the PROPERTY's own schema of every argument it binds to, read off the
 * implementation that will run, through the one validator's honest subset
 * (`toolArgsValidation.ts` · `validatePropertyValue`: type, integer, enum,
 * `pattern`, `minLength`, `maxLength` — numeric `minimum` / `maximum` are NOT
 * judged, there or anywhere). One that fails is not bound: its rows say
 * `asked: 'invalid-answer'` and the field is asked again with a second fixed
 * question — at most `MAX_ASK_ROUNDS` times per field; after that, the calls
 * that needed it are refused.
 */

import type { AskWaiting } from './pendingPrivateAsk.js';
export type { AskWaiting } from './pendingPrivateAsk.js';
import {
  applyInputResponse,
  InputRequestError,
  type AwaitingInput,
  type InputValue,
} from '../../../tools/inputRequest.js';
import { callWindowRow } from '../../../time/rowsBuild.js';
import { timeAnswerRow } from '../../../time/rows.js';
import { isArgumentAskContext } from './askMarker.js';
import type { ArgumentFill, ArgumentResolution, BatchCall, ToolOf } from './resolve.js';
import { askedRowOf } from './rows.js';
import { answeredRows, memberCalls, memberValue, windowAnsweredRows } from './answerRows.js';
import { MAX_ASK_FIELDS, MAX_ASK_ROUNDS } from './ask/constants.js';
import type { ArgumentAskState, AskField, AskTime, BoundAnswer, SettledCall } from './ask/types.js';
import { checkAnswer, pairsBroken } from './ask/validation.js';
import { bindWindowReply } from './ask/windowReply.js';

export { memberValue } from './answerRows.js';
export { ARGUMENT_ASK_KIND, ASK_CONTEXT_KEY } from './askMarker.js';
export {
  MAX_ASK_ROUNDS,
  MAX_ASK_FIELDS,
  ASK_CONTEXT_CHARS,
  ARGUMENT_ASK_ID,
  ARGUMENT_ASK_QUESTION,
  ARGUMENT_REASK_QUESTION,
  WINDOW_FORM_EXPECTATION,
  WINDOW_ZONE_EXPECTATION,
} from './ask/constants.js';
export type {
  AskMember,
  AskField,
  WindowFill,
  WindowAskField,
  AskProgress,
  ArgumentAskState,
  CallAsk,
  WindowAskPlan,
  AskContextObject,
  AskTime,
  BoundAnswer,
  SettledCall,
} from './ask/types.js';
export {
  convertSpelling,
  periodsShareField,
  planAskFields,
  confirmationField,
} from './ask/fields.js';
export { judgeAskContextHook, argumentAskDeclaration } from './ask/context.js';
export { checkAnswer, factExpectation } from './ask/validation.js';

// ─── The rounds ─────────────────────────────────────────────────────────

/** A fresh state for a batch's fields: nothing asked yet. */
export function initialAskState(iteration: number, fields: readonly AskField[]): ArgumentAskState {
  return { iteration, fields, progress: fields.map(() => ({ rounds: 0 })) };
}

/**
 * The next declaration's fields: every field to ask AGAIN (an answer that did
 * not fit) first, on their own, under the re-ask question; else the next
 * never-asked fields, up to `MAX_ASK_FIELDS`. `undefined` when every field has
 * settled — bound or exhausted.
 */
export function nextAskRound(
  state: ArgumentAskState,
): { readonly fieldIndexes: readonly number[]; readonly reask: boolean } | undefined {
  const again = state.progress.flatMap((p, i) => (p.invalid === true ? [i] : []));
  if (again.length > 0) return { fieldIndexes: again.slice(0, MAX_ASK_FIELDS), reask: true };
  const fresh = state.progress.flatMap((p, i) => (p.rounds === 0 || p.next === true ? [i] : []));
  if (fresh.length > 0) return { fieldIndexes: fresh.slice(0, MAX_ASK_FIELDS), reask: false };
  return undefined;
}

/** `state` with the round's fields counted as asked and the question out. */
export function withWaiting(state: ArgumentAskState, waiting: AskWaiting): ArgumentAskState {
  const asked = new Set(waiting.fieldIndexes);
  return {
    ...state,
    progress: state.progress.map((p, i) => (asked.has(i) ? { rounds: p.rounds + 1 } : p)),
    waiting,
  };
}

/** Whether a stored library ask is the one this state is waiting on (the reserved marker). */
export function isArgumentAsk(awaiting: AwaitingInput | undefined): boolean {
  return isArgumentAskContext(awaiting?.context);
}

// ─── The answer ─────────────────────────────────────────────────────────

/**
 * The person's answer to the ask now out, as field values by id. Accepts what
 * `Agent.resume` hands the run (`{ status: 'input_received', requestId, values }`,
 * already checked at its door) and a raw `InputResponse` (`{ requestId, values }`)
 * from a runner that resumes the executor directly — both judged by the SAME
 * validator (`tools/inputRequest.ts` · `applyInputResponse`): the request id, the
 * declared fields, their types and choices. Throws `InputRequestError` on a
 * reply to another request or a malformed one, and on a PARTIAL reply (only
 * `Agent.resume`'s door keeps a partial answer, without running anything); a
 * cancellation throws the door's `TypeError`.
 */
export function readAskAnswer(
  waiting: AskWaiting,
  input: unknown,
): Readonly<Record<string, InputValue>> {
  const reply =
    typeof input === 'object' &&
    input !== null &&
    (input as { status?: unknown }).status === 'input_received'
      ? {
          requestId: (input as { requestId?: unknown }).requestId,
          values: (input as { values?: unknown }).values,
        }
      : input;
  const answered = applyInputResponse(waiting.awaiting, reply);
  if ('cancel' in answered) {
    throw new TypeError(
      '[input request] Cancel a hosted request through its host, or abandonPause() before starting another run.',
    );
  }
  if (answered.missing.length > 0) {
    throw new InputRequestError(
      `the library's ask needs every field answered in one reply (missing: ${answered.missing.join(
        ', ',
      )}); ` + 'Agent.resume keeps a partial answer at its door without running anything',
    );
  }
  return answered.supplied;
}

/**
 * Bind the person's answer to the ask now out: each field whose value fits
 * every member's schema is bound (`answered` rows, one per (call, argument),
 * the value in the tool's own argument view, `free` for a free-text string
 * field); each that does not is marked to ask again (`invalid-answer` rows),
 * or — asked `MAX_ASK_ROUNDS` times already — exhausted. The question is no
 * longer out afterwards.
 */
export function bindAnswer(
  state: ArgumentAskState,
  values: Readonly<Record<string, InputValue>>,
  calls: readonly BatchCall[],
  toolOf: ToolOf,
  stamp: { readonly turn: number; readonly iteration: number },
  time?: AskTime,
  baseResolutions?: ReadonlyMap<string, ArgumentResolution>,
): BoundAnswer {
  const waiting = state.waiting;
  if (waiting === undefined) return { state, rows: [] };
  const byId = new Map(calls.map((c) => [c.id, c]));
  const progress = [...state.progress];
  const rowParts: (() => BoundAnswer['rows'])[] = [];
  const filledById = new Map<string, BatchCall['args']>();
  const pairs = pairsBroken(state, values, byId, toolOf, time);
  const fields = [...state.fields];
  waiting.fieldIndexes.forEach((index, k) => {
    const field = state.fields[index];
    const answer = values[`f${k + 1}`];
    const was = progress[index];
    if (field.window !== undefined && (answer !== undefined || field.window.reply !== undefined)) {
      const bound = bindWindowReply(
        field,
        values,
        `f${k + 1}`,
        waiting.awaiting,
        byId,
        toolOf,
        time,
      );
      if (bound.retry !== undefined) fields[index] = bound.retry;
      if (bound.reply !== undefined)
        rowParts.push(() => [timeReplyRow(bound.reply!, stamp, field.window!.mention)]);
      if ('followUp' in bound) {
        fields[index] = bound.followUp;
        progress[index] = { rounds: was.rounds, next: true };
        return;
      }
      if ('fills' in bound) {
        progress[index] = {
          rounds: was.rounds,
          answer: bound.value ?? answer,
          fills: bound.fills,
          ...('refused' in bound && { refused: bound.refused }),
        };
        rowParts.push(() =>
          windowAnsweredRows(field, bound.fills, byId, toolOf, stamp, filledById),
        );
        // The person's window for the mention — the only door a window of words becomes theirs.
        const answerRow = timeAnswerRow(
          { mention: field.window.mention, ...bound.answered },
          stamp,
        );
        rowParts.push(() => [answerRow]);
        // Each filled call's window, as it will run: the person's answer, exactly or WIDER (the
        // covering look-back's `sent` and `extra`) — the call's latest `call-window` row, so the
        // clock at dispatch, `ctx.time` and the result checks read the window the call carries.
        for (const [toolCallId, { toolName, decision }] of Object.entries(bound.filled)) {
          const windowRow = callWindowRow({ toolCallId, toolName }, decision, stamp);
          rowParts.push(() => [windowRow]);
        }
        return;
      }
      if ('outside' in bound) {
        progress[index] = { rounds: was.rounds, exhausted: true, expected: bound.outside };
        rowParts.push(() =>
          memberCalls(field).map((who) => askedRowOf(who, stamp, 'invalid-answer')),
        );
        return;
      }
      progress[index] =
        was.rounds >= MAX_ASK_ROUNDS
          ? { rounds: was.rounds, exhausted: true, expected: bound.expected }
          : { rounds: was.rounds, invalid: true, expected: bound.expected };
      rowParts.push(() =>
        memberCalls(field).map((who) => askedRowOf(who, stamp, 'invalid-answer')),
      );
      return;
    }
    const alone =
      answer === undefined ? { fits: false as const } : checkAnswer(field, answer, toolOf, time);
    // An answer that fits alone can still break a fact with the other bound of its window.
    const pair = pairs.get(index);
    const check = alone.fits && pair !== undefined ? { fits: false, expected: pair } : alone;
    if (answer !== undefined && check.fits) {
      progress[index] = { rounds: was.rounds, answer };
      rowParts.push(() => answeredRows(field, byId, toolOf, stamp, filledById));
      return;
    }
    const expected =
      'expected' in check && check.expected !== undefined ? { expected: check.expected } : {};
    progress[index] =
      was.rounds >= MAX_ASK_ROUNDS
        ? { rounds: was.rounds, exhausted: true, ...expected }
        : { rounds: was.rounds, invalid: true, ...expected };
    rowParts.push(() => memberCalls(field).map((who) => askedRowOf(who, stamp, 'invalid-answer')));
  });
  const { waiting: _settled, ...rest } = state;
  void _settled;
  const settled = { ...rest, fields, progress };
  const fills = settledCalls(settled);
  for (const call of calls) {
    filledById.set(
      call.id,
      Object.assign(
        {},
        call.args,
        Object.fromEntries(
          [
            ...(baseResolutions?.get(call.id)?.fills ?? []),
            ...(fills.get(call.id)?.fills ?? []),
          ].map((fill) => [fill.argument, fill.value]),
        ),
      ),
    );
  }
  return { state: settled, rows: rowParts.flatMap((part) => part()) };
}

// ─── The settled ask ────────────────────────────────────────────────────

/** Per call id, what the settled ask resolved for it (only calls the ask touched). */
export function settledCalls(state: ArgumentAskState): ReadonlyMap<string, SettledCall> {
  const out = new Map<
    string,
    { fills: ArgumentFill[]; exhausted: SettledCall['exhausted'][number][] }
  >();
  const entry = (id: string) => {
    const seen = out.get(id);
    if (seen !== undefined) return seen;
    const fresh = {
      fills: [] as ArgumentFill[],
      exhausted: [] as SettledCall['exhausted'][number][],
    };
    out.set(id, fresh);
    return fresh;
  };
  state.fields.forEach((field, i) => {
    const p = state.progress[i];
    if (field.window?.role !== undefined && field.window.role !== 'confirm-meaning')
      throw new TypeError('argumentAsk: unknown window role');
    if (
      field.window?.role === 'confirm-meaning' &&
      p.answer !== undefined &&
      p.fills === undefined
    ) {
      throw new TypeError('argumentAsk: incomplete meaning progress');
    }
    if (field.window !== undefined && p.fills !== undefined) {
      for (const [id, expected] of Object.entries(p.refused ?? {})) {
        for (const member of field.members.filter((m) => m.toolCallIds.includes(id))) {
          entry(id).exhausted.push({ argument: member.argument, expected });
        }
      }
      for (const [id, fill] of Object.entries(p.fills)) {
        for (const [argument, value] of Object.entries(fill.values)) {
          entry(id).fills.push({
            argument,
            value: value as InputValue | Readonly<Record<string, InputValue>>,
            source: 'answered',
            window: true,
            ...(fill.wider !== undefined && { wider: fill.wider }),
          });
        }
      }
      return;
    }
    for (const m of field.members) {
      for (const id of m.toolCallIds) {
        if (p.answer !== undefined) {
          const value = memberValue(field, m, p.answer);
          if (value !== undefined)
            entry(id).fills.push({ argument: m.argument, value, source: 'answered' });
        } else if (p.exhausted === true) {
          entry(id).exhausted.push({
            argument: m.argument,
            ...(p.expected !== undefined && { expected: p.expected }),
          });
        }
      }
    }
  });
  return out;
}
