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
 * (`ArgumentResolution.ask`). They become ONE typed ask (`core/inputRequest.ts`,
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

import {
  applyInputResponse,
  InputRequestError,
  type AwaitingInput,
  type InputField,
  type InputRequestDeclaration,
  type InputValue,
} from '../../inputRequest.js';
import { shownArgsOf } from '../../toolShownArgs.js';
import { validatePropertyValue } from '../toolArgsValidation.js';
import {
  convertSpelling,
  isRefused,
  rulesOf,
  type PeriodSpelling,
  type RuledArgument,
} from './declare.js';
import { ARGUMENT_ASK_KIND, ASK_CONTEXT_KEY, isArgumentAskContext } from './askMarker.js';
import type { ArgumentFill, BatchCall, ToolOf } from './resolve.js';
import { isMissing } from './declare.js';
import { HIDDEN_VALUE, answeredRowOf, askedRowOf, shownQuote, type ArgumentRow } from './rows.js';

// The reserved key and its kind have ONE owner (`askMarker.ts`), which a
// reader on every agent's graph can load without loading this module.
export { ARGUMENT_ASK_KIND, ASK_CONTEXT_KEY };

// ─── The bounds and the fixed words ─────────────────────────────────────

/** How many times one field may be put to the person before its calls are refused. */
export const MAX_ASK_ROUNDS = 3;
/** Fields per declaration — the typed ask's own limit (`core/inputRequest.ts`). */
export const MAX_ASK_FIELDS = 32;
/** The declaration's `context` bound — the typed ask's own. */
export const ASK_CONTEXT_CHARS = 16384;
/** The declaration id — the author's reusable id; each round is stamped with its own `requestId`. */
export const ARGUMENT_ASK_ID = 'agentfootprint.arguments';

// LENS · person-facing · the typed ask's question
// reads: nothing — one fixed sentence; each field's description is its author's question
// law: says what is needed and why the fields exist; promises nothing a later path can break.
/** The question of a first ask. Each field's `description` is its author's question. */
export const ARGUMENT_ASK_QUESTION =
  'Before the next step can run, a few values are needed. Each field says what it is for.';

// LENS · person-facing · the typed ask's question
// reads: nothing — one fixed sentence
// law: says what happened to the earlier answer, in the past tense, and what is asked now.
/** The question of a re-ask, after an answer that did not fit the tool's own schema. */
export const ARGUMENT_REASK_QUESTION =
  'One answer did not fit what the tool accepts. Please answer that field again.';

// ─── The fields ─────────────────────────────────────────────────────────

/** One (tool, argument) an ask field's answer binds to, and the calls that need it. */
export interface AskMember {
  readonly toolName: string;
  readonly argument: string;
  /** Set on the argument `Tool.period` names. */
  readonly period?: true;
  /** The member's declared spelling, when its field is a shared period. */
  readonly spelling?: PeriodSpelling;
  /** Every call of the batch that needs this argument asked, in batch order. */
  readonly toolCallIds: readonly string[];
  /**
   * Under declared sources: the person's own words a READING was made of
   * (the first call's that carried one) — shown with the field, never the
   * model's value.
   */
  readonly quoted?: string;
}

/** One field of the batch's ask. */
export interface AskField {
  /** The typed ask's type — `integer` asks as `number`; the re-check judges the integer. */
  readonly type: InputField['type'];
  /** The first member's question — the field's `description`. */
  readonly question: string;
  /** The first member's choices' values — the field's `enum`. Absent: a free field. */
  readonly choices?: readonly InputValue[];
  /** The first member's spelling, when the field is a period shared across spellings. */
  readonly spelling?: PeriodSpelling;
  /** The (tool, argument) pairs the answer binds to; more than one only for a shared period. */
  readonly members: readonly AskMember[];
}

/** Per field (same positions as the fields): how often asked, and how it settled. */
export interface AskProgress {
  /** How many declarations this field has been put in. */
  readonly rounds: number;
  /** The bound answer, raw, in the field's own spelling. */
  readonly answer?: InputValue;
  /** The last answer did not fit the property's schema and the field is to be asked again. */
  readonly invalid?: true;
  /** Asked `MAX_ASK_ROUNDS` times without an answer that fits — its calls are refused. */
  readonly exhausted?: true;
  /** What the last answer that did not fit failed — the property schema's own expectation, never the answer. */
  readonly expected?: string;
}

/** The ask now out, waiting for the person's answer. */
export interface AskWaiting {
  readonly requestId: string;
  /** The positions (into `fields`) of this declaration's fields, in `f1…fn` order. */
  readonly fieldIndexes: readonly number[];
  /** The stamped ask, exactly as the pause carries it — the answer is validated against it. */
  readonly awaiting: AwaitingInput;
}

/**
 * The batch ask's working state (`AgentState.argumentAsk`), written by the
 * dispatch stage only. It holds the RAW answers bound so far, because the calls
 * must run with them — the same class as `argumentResolutions`: never a row, an
 * event or a lens view.
 */
export interface ArgumentAskState {
  /** The batch this ask belongs to — the iteration its calls were emitted in. */
  readonly iteration: number;
  readonly fields: readonly AskField[];
  readonly progress: readonly AskProgress[];
  /** Present exactly while a question is out; absent once every field settled. */
  readonly waiting?: AskWaiting;
}

/** One call's `ask` arguments, as the layer's Resolve stage named them. */
export interface CallAsk {
  readonly toolCallId: string;
  readonly ask: readonly string[];
  /** Under declared sources: the person's words a reading was made of, per argument. */
  readonly quoted?: readonly { readonly argument: string; readonly quote: string }[];
}

const RULED_ASK_TYPES: Readonly<Record<RuledArgument['type'], InputField['type']>> = {
  string: 'string',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
};

/** One ruled argument's `ask` rule, read off the implementation that will answer the name. */
function askRuleOf(
  toolOf: ToolOf,
  toolName: string,
  argument: string,
): { readonly rule: RuledArgument; readonly spelling?: PeriodSpelling } | undefined {
  const rules = rulesOf(toolOf(toolName));
  if (rules === undefined || isRefused(rules)) return undefined;
  const rule = rules.ruled.find((r) => r.argument === argument);
  if (rule === undefined || rule.ask === undefined) return undefined;
  const spelling = rule.period === true ? rules.period?.spelling : undefined;
  return { rule, ...(spelling !== undefined && { spelling }) };
}

// The one conversion between declared period spellings lives beside the
// spellings themselves (`declare.ts` · `convertSpelling`); re-exported here,
// where the batch ask's readers have always found it.
export { convertSpelling };

const CONVERTIBLE: readonly PeriodSpelling[] = ['lookback', 'signed-lookback'];

/**
 * Whether the period field `b` may share `a`'s field: both declare a spelling
 * the library converts, both declare choices, and the choices are the SAME
 * periods under the conversion — so every choice the person can pick is a
 * valid choice of each argument, whichever member's spelling it is read in.
 */
export function periodsShareField(a: AskField, b: AskField): boolean {
  if (a.spelling === undefined || b.spelling === undefined) return false;
  if (!CONVERTIBLE.includes(a.spelling) || !CONVERTIBLE.includes(b.spelling)) return false;
  if (a.choices === undefined || b.choices === undefined) return false;
  if (a.choices.length !== b.choices.length) return false;
  const bSet = new Set(b.choices);
  return a.choices.every((choice) => {
    const converted = convertSpelling(
      choice,
      a.spelling as PeriodSpelling,
      b.spelling as PeriodSpelling,
    );
    return converted !== undefined && bSet.has(converted);
  });
}

/** A field being gathered: its shape, its one member, the calls that need it. */
interface PendingField {
  readonly field: Omit<AskField, 'members'>;
  readonly member: Omit<AskMember, 'toolCallIds' | 'quoted'>;
  readonly ids: string[];
  /** The first reading's words among the calls that need it. */
  quoted?: string;
}

function pendingFieldOf(
  toolName: string,
  argument: string,
  read: { readonly rule: RuledArgument; readonly spelling?: PeriodSpelling },
  toolCallId: string,
): PendingField {
  const ask = read.rule.ask as NonNullable<RuledArgument['ask']>;
  return {
    field: {
      type: RULED_ASK_TYPES[read.rule.type],
      question: ask.question,
      ...(ask.choices !== undefined && { choices: ask.choices }),
      ...(read.spelling !== undefined && { spelling: read.spelling }),
    },
    member: {
      toolName,
      argument,
      ...(read.rule.period === true && { period: true as const }),
      ...(read.spelling !== undefined && { spelling: read.spelling }),
    },
    ids: [toolCallId],
  };
}

/** Each field merged into an earlier one it shares a period with (`periodsShareField`). */
function mergeSharedPeriods(fields: readonly AskField[]): AskField[] {
  const merged: AskField[] = [];
  for (const field of fields) {
    const host = merged.findIndex((f) => periodsShareField(f, field));
    if (host < 0) merged.push(field);
    else merged[host] = { ...merged[host], members: [...merged[host].members, ...field.members] };
  }
  return merged;
}

/**
 * The batch ask's fields: one per distinct (tool, argument) the calls left out,
 * in first-seen batch order, each bound to every call that needs it; then a
 * period field merged into an earlier one it shares (`periodsShareField`). An
 * argument whose rule cannot be read here is left out — the dispatch re-read
 * refuses its call.
 */
export function planAskFields(
  asks: readonly CallAsk[],
  calls: readonly BatchCall[],
  toolOf: ToolOf,
): AskField[] {
  const nameOf = new Map(calls.map((c) => [c.id, c.name]));
  // Keyed by tool, then argument — a map of maps, never a joined key.
  const byTool = new Map<string, Map<string, PendingField>>();
  const order: PendingField[] = [];
  for (const entry of asks) {
    const toolName = nameOf.get(entry.toolCallId);
    if (toolName === undefined) continue;
    const forTool = byTool.get(toolName) ?? new Map<string, PendingField>();
    byTool.set(toolName, forTool);
    for (const argument of entry.ask) {
      const quote = entry.quoted?.find((q) => q.argument === argument)?.quote;
      const seen = forTool.get(argument);
      if (seen !== undefined) {
        if (!seen.ids.includes(entry.toolCallId)) seen.ids.push(entry.toolCallId);
        if (seen.quoted === undefined && quote !== undefined) seen.quoted = quote;
        continue;
      }
      const read = askRuleOf(toolOf, toolName, argument);
      if (read === undefined) continue;
      const pending = pendingFieldOf(toolName, argument, read, entry.toolCallId);
      if (quote !== undefined) pending.quoted = quote;
      forTool.set(argument, pending);
      order.push(pending);
    }
  }
  return mergeSharedPeriods(
    order.map((p) => ({
      ...p.field,
      members: [
        {
          ...p.member,
          toolCallIds: [...p.ids],
          ...(p.quoted !== undefined && { quoted: p.quoted }),
        },
      ],
    })),
  );
}

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
  const fresh = state.progress.flatMap((p, i) => (p.rounds === 0 ? [i] : []));
  if (fresh.length > 0) return { fieldIndexes: fresh.slice(0, MAX_ASK_FIELDS), reask: false };
  return undefined;
}

/** A JSON object — the shape the host hook must return. */
export type AskContextObject = Readonly<Record<string, unknown>>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/** JSON data all the way down — finite numbers, no functions, no cycles (depth-bounded). */
function isJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((v) => isJsonValue(v, depth + 1));
  return isPlainObject(value) && Object.values(value).every((v) => isJsonValue(v, depth + 1));
}

/**
 * The host's own context for the ask (`AgentOptions.argumentAskContext`),
 * judged: a plain object that does not use the library's reserved key. Refused
 * — a `TypeError` naming the hook — rather than repaired or dropped.
 */
export function judgeAskContextHook(value: unknown): AskContextObject {
  if (!isPlainObject(value) || !isJsonValue(value)) {
    throw new TypeError(
      'argumentAskContext: must return a plain JSON object — its keys are spread into the ' +
        "library's ask `context` beside the reserved key.",
    );
  }
  if (Object.prototype.hasOwnProperty.call(value, ASK_CONTEXT_KEY)) {
    throw new TypeError(
      `argumentAskContext: returned the reserved key '${ASK_CONTEXT_KEY}' — it is the library's ` +
        'marker for its own ask, and a host value there would be read as the library’s. ' +
        'Put the host state under a key of its own.',
    );
  }
  return value as AskContextObject;
}

/** One field as the reserved `context` lists it — names and call ids, never a value. */
interface ContextField {
  readonly id: string;
  readonly tool: string;
  readonly argument: string;
  readonly calls: readonly string[];
  readonly moreCalls?: number;
  /** The person's own words a reading was made of (declared sources) — never the model's value. */
  readonly quoted?: string;
  readonly sharedWith?: readonly {
    readonly tool: string;
    readonly argument: string;
    readonly calls: readonly string[];
  }[];
}

function contextFieldOf(id: string, field: AskField, callLimit: number): ContextField {
  const [first, ...rest] = field.members;
  const calls = first.toolCallIds.slice(0, callLimit);
  const more = first.toolCallIds.length - calls.length;
  const quoted = field.members.find((m) => m.quoted !== undefined)?.quoted;
  return {
    id,
    tool: first.toolName,
    argument: first.argument,
    calls,
    ...(more > 0 && { moreCalls: more }),
    ...(quoted !== undefined && { quoted: shownQuote(quoted) }),
    ...(rest.length > 0 && {
      sharedWith: rest.map((m) => ({
        tool: m.toolName,
        argument: m.argument,
        calls: m.toolCallIds.slice(0, callLimit),
      })),
    }),
  };
}

function contextOf(
  entries: readonly ContextField[],
  host: AskContextObject | undefined,
): Record<string, unknown> {
  return { ...(host ?? {}), [ASK_CONTEXT_KEY]: { ask: ARGUMENT_ASK_KIND, fields: entries } };
}

const fits = (context: Record<string, unknown>): boolean =>
  JSON.stringify(context).length <= ASK_CONTEXT_CHARS;

/**
 * The largest prefix of the round's fields whose reserved `context` fits the
 * bound (the rest go in the next round); when one field alone still does not
 * fit, it lists fewer of its calls and counts the rest (`moreCalls`).
 */
function fittedRound(
  state: ArgumentAskState,
  wanted: readonly number[],
  host: AskContextObject | undefined,
): { readonly indexes: readonly number[]; readonly context: Record<string, unknown> } {
  const contextFor = (list: readonly number[], limit: number) =>
    contextOf(
      list.map((i, k) => contextFieldOf(`f${k + 1}`, state.fields[i], limit)),
      host,
    );
  let indexes = [...wanted];
  while (indexes.length > 1 && !fits(contextFor(indexes, Number.POSITIVE_INFINITY))) {
    indexes = indexes.slice(0, -1);
  }
  let limit = Number.POSITIVE_INFINITY;
  if (!fits(contextFor(indexes, limit))) {
    limit = Math.max(...indexes.map((i) => state.fields[i].members[0].toolCallIds.length));
    while (limit > 1 && !fits(contextFor(indexes, limit))) limit -= 1;
  }
  return { indexes, context: contextFor(indexes, limit) };
}

/**
 * The typed ask for one round: the fixed question, one positional field per
 * field of the round, and the reserved `context` listing the (tool, argument,
 * calls) behind each id — within 16384 characters, so a round that would not
 * fit carries fewer fields (the rest go in the next round) and a single field
 * bound to more calls than fit lists the first ones and counts the rest
 * (`moreCalls`). Passes `validateInputDeclaration`.
 */
export function argumentAskDeclaration(
  state: ArgumentAskState,
  round: { readonly fieldIndexes: readonly number[]; readonly reask: boolean },
  host?: AskContextObject,
): { readonly declaration: InputRequestDeclaration; readonly fieldIndexes: readonly number[] } {
  if (host !== undefined && !fits(contextOf([], host))) {
    throw new TypeError(
      `argumentAskContext: the returned object alone exceeds the ask's ${ASK_CONTEXT_CHARS}-` +
        'character context bound — keep the host state small (an id to look up, not the state).',
    );
  }
  const { indexes, context } = fittedRound(state, round.fieldIndexes, host);
  if (host !== undefined && !fits(context)) {
    // One field listing one call still does not fit beside the host's object:
    // the host's state leaves no room for the library's own entry.
    throw new TypeError(
      `argumentAskContext: the returned object leaves no room for the library's own entry ` +
        `within the ask's ${ASK_CONTEXT_CHARS}-character context bound — keep the host state ` +
        'small (an id to look up, not the state).',
    );
  }
  const fields: InputField[] = indexes.map((i, k) => {
    const field = state.fields[i];
    return {
      id: `f${k + 1}`,
      type: field.type,
      required: true,
      description: field.question,
      ...(field.choices !== undefined && { enum: [...field.choices] }),
    };
  });
  return {
    declaration: {
      id: ARGUMENT_ASK_ID,
      question: round.reask ? ARGUMENT_REASK_QUESTION : ARGUMENT_ASK_QUESTION,
      fields,
      context,
    },
    fieldIndexes: indexes,
  };
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
 * validator (`core/inputRequest.ts` · `applyInputResponse`): the request id, the
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

/** The property schema a member's argument is judged against, off the implementation that will run. */
function propertyOf(
  toolOf: ToolOf,
  member: AskMember,
): Readonly<Record<string, unknown>> | undefined {
  const properties = toolOf(member.toolName)?.schema.inputSchema?.properties;
  const property =
    typeof properties === 'object' && properties !== null
      ? (properties as Record<string, unknown>)[member.argument]
      : undefined;
  return typeof property === 'object' && property !== null
    ? (property as Readonly<Record<string, unknown>>)
    : undefined;
}

/** The answer in a member's own spelling — itself, unless the field is a shared period. */
export function memberValue(
  field: AskField,
  member: AskMember,
  answer: InputValue,
): InputValue | undefined {
  if (field.spelling === undefined || member.spelling === undefined) return answer;
  return convertSpelling(answer, field.spelling, member.spelling);
}

/**
 * Whether `answer` fits EVERY member's property schema (in the member's own
 * spelling) — the re-check the typed ask cannot do: an integer asked as a
 * number, a `pattern`, a string length (never a numeric bound — the one
 * validator ignores `minimum` / `maximum`). The rule is re-read through the
 * same resolver.
 * `expected` names what a misfit failed — the schema's expectation, never the
 * answer.
 */
export function checkAnswer(
  field: AskField,
  answer: InputValue,
  toolOf: ToolOf,
): { readonly fits: boolean; readonly expected?: string } {
  for (const member of field.members) {
    const value = memberValue(field, member, answer);
    if (value === undefined) {
      return { fits: false, expected: `a value spelled '${field.spelling ?? 'as declared'}'` };
    }
    const verdict = validatePropertyValue(value, propertyOf(toolOf, member));
    if (!verdict.ok) {
      const expected = verdict.issues[0]?.expected;
      return { fits: false, ...(expected !== undefined && { expected }) };
    }
  }
  return { fits: true };
}

/** What binding one answer did: the new state and the rows it files. */
export interface BoundAnswer {
  readonly state: ArgumentAskState;
  /** `answered` rows for bound fields; `asked: 'invalid-answer'` rows for fields asked again or exhausted. */
  readonly rows: readonly ArgumentRow[];
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
): BoundAnswer {
  const waiting = state.waiting;
  if (waiting === undefined) return { state, rows: [] };
  const byId = new Map(calls.map((c) => [c.id, c]));
  const progress = [...state.progress];
  const rows: ArgumentRow[] = [];
  waiting.fieldIndexes.forEach((index, k) => {
    const field = state.fields[index];
    const answer = values[`f${k + 1}`];
    const was = progress[index];
    const check =
      answer === undefined ? { fits: false as const } : checkAnswer(field, answer, toolOf);
    if (answer !== undefined && check.fits) {
      progress[index] = { rounds: was.rounds, answer };
      rows.push(...answeredRows(field, answer, byId, toolOf, stamp));
      return;
    }
    const expected =
      'expected' in check && check.expected !== undefined ? { expected: check.expected } : {};
    progress[index] =
      was.rounds >= MAX_ASK_ROUNDS
        ? { rounds: was.rounds, exhausted: true, ...expected }
        : { rounds: was.rounds, invalid: true, ...expected };
    rows.push(...memberCalls(field).map((who) => askedRowOf(who, stamp, 'invalid-answer')));
  });
  const { waiting: _settled, ...rest } = state;
  void _settled;
  return { state: { ...rest, progress }, rows };
}

/** Every (call, argument) a field binds to, as a row identity. */
function memberCalls(field: AskField) {
  return field.members.flatMap((m) =>
    m.toolCallIds.map((toolCallId) => ({
      toolCallId,
      toolName: m.toolName,
      argument: m.argument,
      rule: 'ask' as const,
      ...(m.period === true && { period: true as const }),
    })),
  );
}

function answeredRows(
  field: AskField,
  answer: InputValue,
  byId: ReadonlyMap<string, BatchCall>,
  toolOf: ToolOf,
  stamp: { readonly turn: number; readonly iteration: number },
): ArgumentRow[] {
  const free = field.type === 'string' && field.choices === undefined;
  return field.members.flatMap((m) => {
    const value = memberValue(field, m, answer) as InputValue;
    const tool = toolOf(m.toolName);
    return m.toolCallIds.flatMap((toolCallId) => {
      const call = byId.get(toolCallId);
      if (call === undefined) return [];
      // The tool's own view decides what a row may show. A name nothing answers at this moment
      // (its call is refused at dispatch) has no view to ask, so its value is shown as hidden —
      // an omission, never a raw value a view might have hidden.
      const shownValue =
        tool === undefined
          ? HIDDEN_VALUE
          : shownArgsOf(tool, { ...call.args, [m.argument]: value })[m.argument];
      // A value the call CARRIED and the answer replaced (declared sources: an untraced value is
      // asked about) — the model's own, in the same view. Absent when the call left it out.
      const carried = !isMissing(call.args, m.argument);
      const shownProposed = !carried
        ? undefined
        : tool === undefined
        ? HIDDEN_VALUE
        : shownArgsOf(tool, call.args)[m.argument];
      return [
        answeredRowOf(
          {
            toolCallId,
            toolName: m.toolName,
            argument: m.argument,
            rule: 'ask',
            ...(m.period === true && { period: true as const }),
            shownValue,
            ...(shownProposed !== undefined && { shownProposed }),
            ...(free && { free: true as const }),
          },
          stamp,
        ),
      ];
    });
  });
}

// ─── The settled ask ────────────────────────────────────────────────────

/** What the settled ask hands the batch, per call: the answered fills and the exhausted arguments. */
export interface SettledCall {
  readonly fills: readonly ArgumentFill[];
  /** The arguments whose answers never fit — the call is refused — with what they failed. */
  readonly exhausted: readonly { readonly argument: string; readonly expected?: string }[];
}

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
