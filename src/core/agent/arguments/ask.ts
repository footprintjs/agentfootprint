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
import {
  convertExact,
  convertWidened,
  formArguments,
  granularityMsOf,
  periodFactProblem,
  readBack,
  widestMsOf,
  type PeriodFactProblem,
  type PeriodFacts,
} from '../../time/convert.js';
import { instantOf, type InstantText } from '../../time/instant.js';
import { parseRange, spellRange, type TimeRange } from '../../time/range.js';
import {
  chooseReading,
  resolveMention,
  withZoneAnswered,
  type TimePolicy,
} from '../../time/resolve.js';
import type { TimeAskMessages } from '../../time/ask.js';
import { timeAskOf } from '../../time/readingAsk.js';
import { timeAnswerRow, type TimeAnswerRow, type TimeReadingRow } from '../../time/rows.js';
import { fixedOffsetZone, offsetAt, type ZoneName } from '../../time/zone.js';
import { shownArgsOf } from '../../toolShownArgs.js';
import { validatePropertyValue } from '../toolArgsValidation.js';
import {
  convertSpelling,
  isRefused,
  periodFactsOf,
  periodFormsOf,
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
  /**
   * Set on the ONE field that asks which window the person's own words meant
   * (the lazy word-driven ask, time design § 5.2, § 6.3): its members are the
   * period arguments of every call that left its period out while the turn's
   * one mention was still open; the answer is a window (or, first, the zone
   * the person meant by an abbreviation), converted into each call's form.
   */
  readonly window?: WindowAskField;
}

/** One call's values from a bound window — and whether they read a WIDER window (no form held it exactly). */
export interface WindowFill {
  readonly values: Readonly<Record<string, unknown>>;
  readonly wider?: 'reads-more' | 'tool-trims';
}

/** The time half of a window field — the typed ask's `format`, its labels, and the mention asked about. */
export interface WindowAskField {
  readonly format: 'time-range' | 'zone';
  /** One label per choice (`time-range` with choices only), in the reader's locale. */
  readonly labels?: readonly string[];
  /** Per choice, the zone the candidate was read in — a wall or date form is written in it. */
  readonly zones?: readonly ZoneName[];
  /** The mention's index on its `time-reading` row. */
  readonly mention: number;
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
  /**
   * A window field only: the bound window converted into each call's form, by
   * call id — the values the call runs with (raw working state, never a row).
   */
  readonly fills?: Readonly<Record<string, WindowFill>>;
  /** A window field only: the zone was answered and a follow-up question about the same words is to be asked. */
  readonly next?: true;
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
  /** Under `.time({ reader })`: the call left its period out while the turn's one mention was open. */
  readonly window?: true;
}

/**
 * The lazy word-driven ask's plan (time design § 5.2): the question the open
 * mention needs (`core/time/readingAsk.ts` · `timeAskOf`) and its mention index.
 * Handed by the stage glue only when the turn's one mention is open.
 */
export interface WindowAskPlan {
  readonly question: string;
  readonly format: 'time-range' | 'zone';
  readonly choices?: readonly string[];
  readonly labels?: readonly string[];
  readonly zones?: readonly ZoneName[];
  readonly mention: number;
  /** The turn's clock — a choice outside a member tool's declared facts is not offered (§ 6.3). */
  readonly now: InstantText;
}

/**
 * The indexes of the choices EVERY member tool's declared facts allow (§ 6.3:
 * "some readings inside the tool's `direction` → the ones inside as choices")
 * — `undefined` when none is left (several tools that disagree: every choice
 * is offered, and the answer is judged against each tool's facts).
 */
function allowedChoices(
  choices: readonly string[],
  members: readonly { readonly toolName: string }[],
  toolOf: ToolOf,
  now: InstantText,
): number[] | undefined {
  const factsOf = [...new Set(members.map((m) => m.toolName))].map((name) => {
    const rules = rulesOf(toolOf(name));
    return rules === undefined || isRefused(rules) ? {} : periodFactsOf(rules.period);
  });
  const kept = choices.flatMap((value, i) => {
    const range = parseRange(value);
    if (range === undefined) return [];
    return factsOf.every((facts) => periodFactProblem(range, facts, now) === undefined) ? [i] : [];
  });
  return kept.length > 0 ? kept : undefined;
}

/** A window field's choices narrowed to `kept` (its labels and zones with them). */
function narrowed(field: AskField, kept: readonly number[] | undefined): AskField {
  const window = field.window;
  if (kept === undefined || field.choices === undefined || window === undefined) return field;
  const pick = <T>(list: readonly T[] | undefined) =>
    list === undefined ? undefined : kept.map((i) => list[i] as T);
  const labels = pick(window.labels);
  const zones = pick(window.zones);
  return {
    ...field,
    choices: pick(field.choices) as readonly InputValue[],
    window: {
      ...window,
      ...(labels !== undefined && { labels }),
      ...(zones !== undefined && { zones }),
    },
  };
}

/** The arguments of every period form a tool declares — what a window fills. */
function formArgumentsOfTool(toolOf: ToolOf, toolName: string): ReadonlySet<string> {
  const rules = rulesOf(toolOf(toolName));
  if (rules === undefined || isRefused(rules)) return new Set();
  return new Set(
    periodFormsOf(rules.period).flatMap((f) => formArguments(f).map((a) => a.argument)),
  );
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
  windowPlan?: WindowAskPlan,
): AskField[] {
  const nameOf = new Map(calls.map((c) => [c.id, c.name]));
  // Keyed by tool, then argument — a map of maps, never a joined key.
  const byTool = new Map<string, Map<string, PendingField>>();
  const order: PendingField[] = [];
  // The lazy word-driven ask: a call's PERIOD arguments join the one window field.
  const windowMembers = new Map<string, Map<string, string[]>>();
  for (const entry of asks) {
    const toolName = nameOf.get(entry.toolCallId);
    if (toolName === undefined) continue;
    const forTool = byTool.get(toolName) ?? new Map<string, PendingField>();
    byTool.set(toolName, forTool);
    const periodArguments =
      windowPlan !== undefined && entry.window === true
        ? formArgumentsOfTool(toolOf, toolName)
        : new Set<string>();
    for (const argument of entry.ask) {
      if (periodArguments.has(argument)) {
        const forWindow = windowMembers.get(toolName) ?? new Map<string, string[]>();
        windowMembers.set(toolName, forWindow);
        const ids = forWindow.get(argument) ?? [];
        if (!ids.includes(entry.toolCallId)) ids.push(entry.toolCallId);
        forWindow.set(argument, ids);
        continue;
      }
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
  const fields = mergeSharedPeriods(
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
  if (windowPlan === undefined || windowMembers.size === 0) return fields;
  const window = windowFieldOf(windowPlan, windowMembers);
  const kept =
    window.choices === undefined
      ? undefined
      : allowedChoices(window.choices as readonly string[], window.members, toolOf, windowPlan.now);
  return [narrowed(window, kept), ...fields];
}

/** The ONE window field: the open mention's question, bound to every call's period arguments. */
function windowFieldOf(
  plan: WindowAskPlan,
  members: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>,
): AskField {
  return {
    type: 'string',
    question: plan.question,
    ...(plan.choices !== undefined && { choices: plan.choices }),
    members: [...members].flatMap(([toolName, byArgument]) =>
      [...byArgument].map(([argument, ids]) => ({
        toolName,
        argument,
        period: true as const,
        toolCallIds: [...ids],
      })),
    ),
    window: {
      format: plan.format,
      ...(plan.labels !== undefined && { labels: plan.labels }),
      ...(plan.zones !== undefined && { zones: plan.zones }),
      mention: plan.mention,
    },
  };
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
  const fresh = state.progress.flatMap((p, i) => (p.rounds === 0 || p.next === true ? [i] : []));
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
      // A window field is a TIME field: the door judges its answer (`core/time/ask.ts`).
      ...(field.window !== undefined && { format: field.window.format }),
      ...(field.window?.labels !== undefined && { labels: [...field.window.labels] }),
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
  time?: AskTime,
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
    const fact = time === undefined ? undefined : factBroken(toolOf, member, value, time);
    if (fact !== undefined)
      return { fits: false, expected: factExpectation(fact.problem, fact.facts) };
  }
  return { fits: true };
}

/** Under `.time()`: the turn's clock and the app's zone — what a period answer is judged against. */
export interface AskTime {
  readonly now: InstantText;
  readonly appZone?: ZoneName;
  /** The turn's clock zone — a window answered with no zone of its own is written in it. */
  readonly zone?: ZoneName;
  /**
   * Under `.time({ reader })`: the open mention's row, the policy and the
   * whole catalog — what a zone answer re-reads the mention with.
   */
  readonly reading?: {
    readonly row: TimeReadingRow;
    readonly policy: TimePolicy;
    readonly messages: TimeAskMessages;
  };
}

/**
 * The tool's declared fact an answer for its period argument breaks (the time
 * layer, step T5a — `core/time/convert.ts` · `periodFactProblem`): the answer,
 * read back through the single-argument form that names the argument, against
 * `direction`, `retention` and `maxRange` at the turn's clock. `undefined` for
 * a tool that declares none of the three, an argument no single-argument form
 * names (one bound of two), or an answer no form reads back.
 */
function factBroken(
  toolOf: ToolOf,
  member: AskMember,
  value: InputValue,
  time: AskTime,
): { readonly problem: PeriodFactProblem; readonly facts: PeriodFacts } | undefined {
  if (member.period !== true) return undefined;
  const rules = rulesOf(toolOf(member.toolName));
  if (rules === undefined || isRefused(rules)) return undefined;
  const facts = periodFactsOf(rules.period);
  if (
    facts.direction === undefined &&
    facts.retention === undefined &&
    facts.maxRange === undefined
  ) {
    return undefined;
  }
  for (const form of periodFormsOf(rules.period)) {
    if (form.kind === 'bounds' || form.kind === 'object' || form.argument !== member.argument)
      continue;
    const range = readBack({ [member.argument]: value }, form, time);
    if (range === undefined) continue;
    const problem = periodFactProblem(range, facts, time.now);
    return problem === undefined ? undefined : { problem, facts };
  }
  return undefined;
}

// LENS · tool-result · persistent-history (through `serve.ts` · `unansweredRefusal`)
// reads: the tool's declared fact the person's answers kept breaking, and its declared value
// law: names the rule, never the answer; a fact about the source, in the present tense of the source.
/**
 * What an answer for a period argument must be, in the words the refusal of
 * an exhausted ask names it (`serve.ts` · `unansweredRefusal`'s `expected`) —
 * the tool's own fact, never the person's answer.
 */
export function factExpectation(problem: PeriodFactProblem, facts: PeriodFacts): string {
  switch (problem) {
    case 'time-future':
      return 'a window that has already happened (the source holds only the past)';
    case 'time-past':
      return 'a window still to come (the source holds only the future)';
    case 'beyond-retention':
      return `a window inside what the source keeps (${facts.retention ?? 'its retention'})`;
    case 'over-max-range':
      return `a window no wider than ${facts.maxRange ?? 'the source reads at once'}`;
  }
}

/** What binding one answer did: the new state and the rows it files. */
export interface BoundAnswer {
  readonly state: ArgumentAskState;
  /**
   * `answered` rows for bound fields; `asked: 'invalid-answer'` rows for fields
   * asked again or exhausted; and, for a bound WINDOW field, the `time-answer`
   * row that settles its mention for the rest of the turn (`core/time/rows.ts`).
   */
  readonly rows: readonly (ArgumentRow | TimeAnswerRow)[];
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
): BoundAnswer {
  const waiting = state.waiting;
  if (waiting === undefined) return { state, rows: [] };
  const byId = new Map(calls.map((c) => [c.id, c]));
  const progress = [...state.progress];
  const rows: (ArgumentRow | TimeAnswerRow)[] = [];
  const fields = [...state.fields];
  waiting.fieldIndexes.forEach((index, k) => {
    const field = state.fields[index];
    const answer = values[`f${k + 1}`];
    const was = progress[index];
    if (field.window !== undefined && answer !== undefined) {
      const bound = bindWindowAnswer(field, answer, byId, toolOf, time);
      if ('followUp' in bound) {
        fields[index] = bound.followUp;
        progress[index] = { rounds: was.rounds, next: true };
        return;
      }
      if ('fills' in bound) {
        progress[index] = { rounds: was.rounds, answer, fills: bound.fills };
        rows.push(...windowAnsweredRows(field, bound.fills, byId, toolOf, stamp));
        // The person's window for the mention — the only door a window of words becomes theirs.
        rows.push(timeAnswerRow({ mention: field.window.mention, ...bound.answered }, stamp));
        return;
      }
      if ('outside' in bound) {
        progress[index] = { rounds: was.rounds, exhausted: true, expected: bound.outside };
        rows.push(...memberCalls(field).map((who) => askedRowOf(who, stamp, 'invalid-answer')));
        return;
      }
      progress[index] =
        was.rounds >= MAX_ASK_ROUNDS
          ? { rounds: was.rounds, exhausted: true, expected: bound.expected }
          : { rounds: was.rounds, invalid: true, expected: bound.expected };
      rows.push(...memberCalls(field).map((who) => askedRowOf(who, stamp, 'invalid-answer')));
      return;
    }
    const check =
      answer === undefined ? { fits: false as const } : checkAnswer(field, answer, toolOf, time);
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
  return { state: { ...rest, fields, progress }, rows };
}

// ─── The window answer (the lazy word-driven ask, time design § 5.2) ────────

/** What an answer to a window field did: bound (the values per call), a follow-up question, or a misfit. */
type WindowBinding =
  | {
      readonly fills: Readonly<Record<string, WindowFill>>;
      /** The window the person settled: the range, its zone, and whether it was the offered reading. */
      readonly answered: {
        readonly range: TimeRange;
        readonly zone: ZoneName;
        readonly how: TimeAnswerRow['how'];
      };
    }
  | { readonly followUp: AskField }
  | { readonly expected: string }
  /** The zone answer left readings none of which a member tool's facts allow: its calls are refused. */
  | { readonly outside: string };

// LENS · tool-result · persistent-history (through `serve.ts` · `unansweredRefusal`)
// reads: nothing — fixed expectations for a window answer a tool's period forms cannot take
// law: names the rule, never the answer.
/** What a window answer must be when no period form of a tool holds it. */
export const WINDOW_FORM_EXPECTATION = "a window one of the tool's declared period forms can hold";
/** What a zone answer must be when the person's words name no time in it. */
export const WINDOW_ZONE_EXPECTATION = 'a time zone in which the time the person wrote exists';

/**
 * Bind one answer to a window field: a `zone` answer re-reads the mention in
 * that zone and asks the follow-up question with the readings as choices —
 * each still a PROPOSAL to confirm (the owner's decision "Always confirm");
 * a `time-range` answer (a choice, or free entry the door already judged) is
 * converted into every member call's forms — exactly, else wider (the fill's
 * own rule) — after each tool's declared facts. A choice the ask offered is
 * `confirmed` (the person's click on the pre-filled reading); any other window
 * is `edited` — both are the person's answer.
 */
function bindWindowAnswer(
  field: AskField,
  answer: InputValue,
  byId: ReadonlyMap<string, BatchCall>,
  toolOf: ToolOf,
  time: AskTime | undefined,
): WindowBinding {
  const window = field.window as WindowAskField;
  if (time === undefined) return { expected: WINDOW_FORM_EXPECTATION };
  if (window.format === 'zone') {
    const reading = time.reading;
    if (reading === undefined || typeof answer !== 'string' || time.zone === undefined) {
      return { expected: WINDOW_ZONE_EXPECTATION };
    }
    const row = reading.row;
    // The re-read stays a PROPOSAL: the zone was the person's, the window is still words.
    const resolution = resolveMention(
      withZoneAnswered(row.parses ?? [], answer, reading.policy),
      { now: time.now, zone: time.zone },
      row.reader,
      true,
      reading.policy,
    );
    const choice = chooseReading(resolution, reading.policy, row.reader.kind, undefined, true);
    if (choice.by === 'open') {
      const ask = timeAskOf(
        { ...row, candidates: resolution.candidates, choice },
        reading.messages,
      );
      if (ask === undefined || ask.field.format !== 'time-range') {
        return { expected: WINDOW_ZONE_EXPECTATION };
      }
      const zones = (ask.field.enum ?? []).map(
        (value) => resolution.candidates.find((c) => spellRange(c.range) === value)?.zone ?? answer,
      );
      const followUp: AskField = {
        ...field,
        question: ask.question,
        ...(ask.field.enum !== undefined && { choices: ask.field.enum }),
        window: {
          format: 'time-range',
          ...(ask.field.labels !== undefined && { labels: ask.field.labels }),
          zones,
          mention: window.mention,
        },
      };
      const choices = (ask.field.enum ?? []) as readonly string[];
      const kept = allowedChoices(choices, field.members, toolOf, time.now);
      if (kept === undefined && field.members.length > 0) {
        // Every reading breaks a member tool's facts: nothing is asked (§ 6.3) — the reason.
        const outside = factOutside(choices, field.members, toolOf, time.now);
        if (outside !== undefined) return { outside };
      }
      return { followUp: narrowed(followUp, kept) };
    }
    return { expected: WINDOW_ZONE_EXPECTATION };
  }
  const range = typeof answer === 'string' ? parseRange(answer) : undefined;
  if (range === undefined) return { expected: WINDOW_FORM_EXPECTATION };
  const at = field.choices?.indexOf(answer) ?? -1;
  const zone =
    at >= 0 ? window.zones?.[at] ?? time.zone : editedZone(range, window.zones, time.zone);
  if (zone === undefined) return { expected: WINDOW_FORM_EXPECTATION };
  const bound = windowFills(field, range, zone, byId, toolOf, time);
  if (!('fills' in bound)) return bound;
  return { fills: bound.fills, answered: { range, zone, how: at >= 0 ? 'confirmed' : 'edited' } };
}

/**
 * The zone a window the person TYPED is recorded in: the first of the
 * offered readings' zones — then the app's — whose offsets at both ends are
 * the ones typed; else the fixed-offset zone the typed offsets spell
 * (`Etc/GMT-1` for `+01:00`, `zone.ts` · `fixedOffsetZone`); else the app's.
 * A London day typed with `+01:00` under an app in Los Angeles is recorded
 * in Europe/London (the zone the mention named), never in the app's zone.
 */
function editedZone(
  range: TimeRange,
  offered: readonly ZoneName[] | undefined,
  appZone: ZoneName | undefined,
): ZoneName | undefined {
  const from = instantOf(range.from, 'lenient');
  const to = instantOf(range.to, 'lenient');
  if (from === undefined || to === undefined) return appZone;
  const shows = (zone: ZoneName): boolean =>
    offsetAt(zone, from.ms) === from.offsetMinutes && offsetAt(zone, to.ms) === to.offsetMinutes;
  const zones = [...(offered ?? []), ...(appZone !== undefined ? [appZone] : [])];
  const match = zones.find(shows);
  if (match !== undefined) return match;
  const fixed =
    from.offsetMinutes === to.offsetMinutes ? fixedOffsetZone(from.offsetMinutes) : undefined;
  return fixed ?? appZone;
}

/** What the first reading breaks, when EVERY reading breaks one member tool's facts — the refusal's words. */
function factOutside(
  choices: readonly string[],
  members: readonly { readonly toolName: string }[],
  toolOf: ToolOf,
  now: InstantText,
): string | undefined {
  for (const name of new Set(members.map((m) => m.toolName))) {
    const rules = rulesOf(toolOf(name));
    if (rules === undefined || isRefused(rules)) continue;
    const facts = periodFactsOf(rules.period);
    const problems = choices.map((value) => {
      const range = parseRange(value);
      return range === undefined ? undefined : periodFactProblem(range, facts, now);
    });
    const first = problems[0];
    if (first !== undefined && problems.every((p) => p !== undefined)) {
      return factExpectation(first, facts);
    }
  }
  return undefined;
}

/** The window written into every member call's forms, after each tool's facts — or what it failed. */
function windowFills(
  field: AskField,
  range: TimeRange,
  zone: ZoneName,
  byId: ReadonlyMap<string, BatchCall>,
  toolOf: ToolOf,
  time: AskTime,
): { readonly fills: Readonly<Record<string, WindowFill>> } | { readonly expected: string } {
  const fills: Record<string, WindowFill> = {};
  for (const member of field.members) {
    const rules = rulesOf(toolOf(member.toolName));
    if (rules === undefined || isRefused(rules)) return { expected: WINDOW_FORM_EXPECTATION };
    const forms = periodFormsOf(rules.period);
    const facts = periodFactsOf(rules.period);
    const problem = periodFactProblem(range, facts, time.now);
    if (problem !== undefined) return { expected: factExpectation(problem, facts) };
    for (const id of member.toolCallIds) {
      if (fills[id] !== undefined || !byId.has(id)) continue;
      const ctx = {
        now: time.now,
        zone,
        ...(time.appZone !== undefined && { appZone: time.appZone }),
        granularityMs: granularityMsOf(facts),
      };
      const exact = convertExact({ range }, forms, ctx);
      const conversion = exact ?? convertWidened({ range }, forms, ctx, widestMsOf(facts));
      if (conversion === undefined) return { expected: WINDOW_FORM_EXPECTATION };
      for (const [argument, value] of Object.entries(conversion.values)) {
        if (typeof value === 'object') continue;
        const verdict = validatePropertyValue(
          value as InputValue,
          propertyOf(toolOf, { ...member, argument }),
        );
        if (!verdict.ok) {
          const expected = verdict.issues[0]?.expected;
          return { expected: expected ?? WINDOW_FORM_EXPECTATION };
        }
      }
      fills[id] = {
        values: conversion.values,
        ...(exact === undefined && {
          wider: facts.filtersToAsked === true ? ('tool-trims' as const) : ('reads-more' as const),
        }),
      };
    }
  }
  return { fills };
}

/** The `answered` rows of a bound window: one per (call, argument) the window filled, in the tool's own view. */
function windowAnsweredRows(
  field: AskField,
  fills: Readonly<Record<string, WindowFill>>,
  byId: ReadonlyMap<string, BatchCall>,
  toolOf: ToolOf,
  stamp: { readonly turn: number; readonly iteration: number },
): ArgumentRow[] {
  const nameOf = new Map(field.members.flatMap((m) => m.toolCallIds.map((id) => [id, m.toolName])));
  return Object.entries(fills).flatMap(([toolCallId, { values }]) => {
    const call = byId.get(toolCallId);
    const toolName = nameOf.get(toolCallId);
    if (call === undefined || toolName === undefined) return [];
    const tool = toolOf(toolName);
    const shown = tool === undefined ? undefined : shownArgsOf(tool, { ...call.args, ...values });
    return Object.keys(values).map((argument) =>
      answeredRowOf(
        {
          toolCallId,
          toolName,
          argument,
          rule: 'ask',
          period: true as const,
          shownValue: shown === undefined ? HIDDEN_VALUE : shown[argument],
        },
        stamp,
      ),
    );
  });
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
    if (field.window !== undefined && p.fills !== undefined) {
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
