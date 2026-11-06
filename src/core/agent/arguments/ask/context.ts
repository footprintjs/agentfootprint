import { physicalPrefix, replyBinding, roundFields } from './replyFields.js';
import type { InputRequestDeclaration } from '../../../../tools/inputRequest.js';
import { ARGUMENT_ASK_KIND, ASK_CONTEXT_KEY } from '../askMarker.js';
import { shownQuote } from '../rows.js';
import {
  ARGUMENT_ASK_ID,
  ARGUMENT_ASK_QUESTION,
  ARGUMENT_REASK_QUESTION,
  ASK_CONTEXT_CHARS,
} from './constants.js';
import type { ArgumentAskState, AskContextObject, AskField } from './types.js';

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
  readonly timeReply?: { readonly version: 1; readonly correction: string };
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
    ...(replyBinding(field, id) !== undefined && { timeReply: replyBinding(field, id) }),
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
  let indexes = physicalPrefix(state, wanted);
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
  const fields = roundFields(state, indexes);
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
