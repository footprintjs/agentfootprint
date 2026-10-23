/**
 * request — an AG-UI request (`RunAgentInput`) read as UNTRUSTED browser input,
 * and the one turn it may ask for.
 *
 * Three steps. The first is the app's to replace; the other two are the CORE,
 * and run whichever reader produced the request — so a reader can map another
 * body onto a turn, and never weaken a rule:
 *
 *   the READER         a body → an {@link AgUiTurnRequest}. The default takes
 *                      the body as an AG-UI `RunAgentInput`; a gateway that
 *                      sends its own body shape passes its own
 *                      ({@link AgUiRequestReader}). Mapping only — it decides
 *                      nothing below;
 *   readAgUiRequest    what a custom reader produced, copied as plain JSON (so
 *                      a getter or a proxy cannot answer the check one way and
 *                      the plan another; the default reader's body is parsed
 *                      JSON already and is read as it is), then
 *   readAgUiRunInput   its SHAPE, field by field, and
 *                      the ids' FORMAT and length — nothing here is trusted,
 *                      nothing the server holds is read;
 *   planAgUiTurn       the turn, from the request AND what the server holds
 *                      for the bound conversation.
 *
 * The core's steps refuse by NAME (a `WireRequestRefusal`: its own status and
 * code; the field named, the value never quoted back).
 *
 * WHAT A REQUEST MAY DECIDE, and what it may not:
 *   - the newest USER message is the run's message. Nothing else the browser
 *     sends is ever conversation: its assistant and tool messages are its own
 *     copy of what the server said, and the server's copy is the one kept
 *     (`sessions`, or the agent's memory under the bound session). A system or
 *     developer message is refused — the agent's instructions are its own;
 *   - an ANSWER is taken only for the pause the server is keeping, matched to
 *     the ids that pause handed out (`AgUiSuspension`): a resume entry naming
 *     its interrupt, or the tool message answering the frontend tool call it is
 *     waiting on. Any other tool result is refused — never folded in. A
 *     decision answering a consent gate's interrupt is named for the request
 *     that interrupt stands for (`answeringRequest`) — the page never sees the
 *     request id, and the matched interrupt is what binds its answer;
 *   - a frontend tool runs only when the app allow-listed its NAME — with the
 *     app's own description and schema, never the page's (a description the
 *     model reads is an instruction) — and only on a host that keeps the paused
 *     run until the page answers;
 *   - `state` and `context` reach the agent only through the app's validators;
 *     without one, a request carrying either is refused;
 *   - identity, credentials and redaction never come from a request: the host
 *     binds the thread to the caller the app authenticates (`ThreadBinder`).
 * `forwardedProps` is never read.
 */

import { looksLikeDecision } from '../core/checkin.js';
import { WireRequestRefusal } from '../hosting/errors.js';
import type {
  HeldConversation,
  PlanFacts,
  ProtocolPlan,
  ProtocolRequestFacts,
  ProtocolTurn,
  ThreadBinding,
} from '../hosting/protocolAdapter.js';
import type { Tool } from '../tools/tools.js';
import type {
  AgUiContentPart,
  AgUiMessage,
  AgUiResumeEntry,
  AgUiRunInput,
  AgUiSuspendedCall,
  AgUiSuspension,
} from './types.js';

/** The longest thread or run id read — longer is refused, never truncated. */
export const AG_UI_MAX_ID_LENGTH = 128;

/**
 * The thread and run id alphabet: letters, digits and `._:-`, starting with a
 * letter or digit — every id an AG-UI SDK mints (a UUID, a ULID) and nothing
 * that could carry markup, a path or a control character into a log line.
 */
const ID_FORMAT = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** The longest message, tool-call or interrupt id read. */
const MAX_ITEM_ID_LENGTH = 400;

/** A tool name the page may declare — the provider-portable alphabet. */
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

const ROLES: ReadonlySet<string> = new Set([
  'user',
  'assistant',
  'tool',
  'system',
  'developer',
  'reasoning',
  'activity',
]);

/** A refusal of the request's shape — names the field, never its value. */
const malformed = (what: string): WireRequestRefusal =>
  new WireRequestRefusal('ERR_INVALID_RUN_INPUT', `AG-UI: ${what}`, 400);

/** A refusal of what this agent does not accept from a page — its own code. */
const refused = (code: string, what: string, status = 400): WireRequestRefusal =>
  new WireRequestRefusal(code, `AG-UI: ${what}`, status);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A thread or run id: present, bounded, and in the id alphabet. */
function runId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw malformed(`\`${field}\` must be a non-empty string.`);
  if (value.length > AG_UI_MAX_ID_LENGTH)
    throw malformed(`\`${field}\` is longer than ${AG_UI_MAX_ID_LENGTH} characters.`);
  if (!ID_FORMAT.test(value))
    throw malformed(
      `\`${field}\` must be letters, digits and . _ : - only, starting with a letter or digit.`,
    );
  return value;
}

/** A message, call or interrupt id: present and bounded. */
function itemId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw malformed(`\`${field}\` must be a non-empty string.`);
  if (value.length > MAX_ITEM_ID_LENGTH)
    throw malformed(`\`${field}\` is longer than ${MAX_ITEM_ID_LENGTH} characters.`);
  return value;
}

function list(value: unknown, field: string): readonly unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw malformed(`\`${field}\` must be an array.`);
  return value;
}

function content(value: unknown, at: string, optional = false): void {
  if (value === undefined && optional) return;
  if (typeof value === 'string') return;
  if (!Array.isArray(value))
    throw malformed(`\`${at}.content\` must be a string or a list of parts.`);
  for (const part of value) {
    if (!isRecord(part) || typeof part.type !== 'string')
      throw malformed(`every part of \`${at}.content\` must have a \`type\`.`);
    if (part.type === 'text' && typeof part.text !== 'string')
      throw malformed(`a text part of \`${at}.content\` must carry \`text\`.`);
  }
}

function message(value: unknown, i: number): AgUiMessage {
  const at = `messages[${i}]`;
  if (!isRecord(value)) throw malformed(`\`${at}\` must be an object.`);
  itemId(value.id, `${at}.id`);
  if (typeof value.role !== 'string' || !ROLES.has(value.role))
    throw malformed(`\`${at}.role\` is not an AG-UI role.`);
  switch (value.role) {
    case 'user':
    case 'tool':
      content(value.content, at);
      if (value.role === 'tool') itemId(value.toolCallId, `${at}.toolCallId`);
      break;
    case 'assistant':
      content(value.content, at, true);
      list(value.toolCalls, `${at}.toolCalls`).forEach((call, j) => {
        const where = `${at}.toolCalls[${j}]`;
        if (!isRecord(call) || !isRecord(call.function))
          throw malformed(`\`${where}\` must be a function call.`);
        itemId(call.id, `${where}.id`);
        if (typeof call.function.name !== 'string' || typeof call.function.arguments !== 'string')
          throw malformed(`\`${where}.function\` must carry \`name\` and \`arguments\` strings.`);
      });
      break;
    default:
      break;
  }
  return value as unknown as AgUiMessage;
}

/**
 * Read one AG-UI request body — its shape and its ids — refusing what the
 * protocol does not allow by the field's NAME, never by its value.
 *
 * @throws WireRequestRefusal (400, `ERR_INVALID_RUN_INPUT`)
 */
export function readAgUiRunInput(body: unknown): AgUiRunInput {
  if (!isRecord(body)) throw malformed('the body must be a RunAgentInput object.');
  runId(body.threadId, 'threadId');
  runId(body.runId, 'runId');
  if (body.parentRunId !== undefined) runId(body.parentRunId, 'parentRunId');
  if (!Array.isArray(body.messages)) throw malformed('`messages` must be an array.');
  const messages = body.messages.map(message);
  const tools = list(body.tools, 'tools');
  const named = new Set<string>();
  tools.forEach((tool, i) => {
    if (!isRecord(tool) || typeof tool.name !== 'string' || !TOOL_NAME.test(tool.name))
      throw malformed(`\`tools[${i}].name\` must be a tool name (letters, digits, _ and -).`);
    if (named.has(tool.name))
      throw malformed(`\`tools[${i}].name\` repeats a tool already declared.`);
    named.add(tool.name);
  });
  const context = list(body.context, 'context');
  context.forEach((entry, i) => {
    if (
      !isRecord(entry) ||
      typeof entry.description !== 'string' ||
      typeof entry.value !== 'string'
    )
      throw malformed(`\`context[${i}]\` must carry \`description\` and \`value\` strings.`);
  });
  const resume = list(body.resume, 'resume');
  resume.forEach((entry, i) => {
    if (!isRecord(entry)) throw malformed(`\`resume[${i}]\` must be an object.`);
    itemId(entry.interruptId, `resume[${i}].interruptId`);
    if (entry.status !== 'resolved' && entry.status !== 'cancelled')
      throw malformed(`\`resume[${i}].status\` must be 'resolved' or 'cancelled'.`);
  });
  return {
    ...(body as unknown as AgUiRunInput),
    messages,
    tools: tools as AgUiRunInput['tools'],
    context: context as AgUiRunInput['context'],
    ...(resume.length > 0 && { resume: resume as readonly AgUiResumeEntry[] }),
  };
}

/**
 * What a request reader hands the core: the one turn a request asks for, in
 * AG-UI's terms. `AgUiRunInput` is one (a `RunAgentInput` as sent); a reader
 * for another body builds one from it — `tools` and `context` may be left out.
 *
 * It carries no identity, credential or redaction setting, and the core reads
 * nothing else a reader adds: the caller is bound by the host's `ThreadBinder`,
 * a credential reaches a run only through the host's `sealRequest`.
 */
export interface AgUiTurnRequest {
  /** The conversation the request NAMES — format-checked, never a key. */
  readonly threadId: string;
  /** The run id the stream names this run by — format-checked. */
  readonly runId: string;
  readonly parentRunId?: string;
  /**
   * The messages, newest last. Only the newest is read — a user message (the
   * run's message), or the `tool` message answering the frontend tool call a
   * paused run waits on. A system or developer message anywhere is refused.
   */
  readonly messages: readonly AgUiMessage[];
  /** The frontend tools the caller offers — run only when the app allow-listed the name. */
  readonly tools?: AgUiRunInput['tools'];
  /** Reaches the agent only through the app's `accept.context` validator. */
  readonly context?: AgUiRunInput['context'];
  /** Reaches the agent only through the app's `accept.state` validator. */
  readonly state?: unknown;
  /** Answers to the interrupt a paused run waits on — matched to the server's own record. */
  readonly resume?: readonly AgUiResumeEntry[];
}

/**
 * What a request reader is given: the request as the host read it — UNTRUSTED.
 * The host port's own `ProtocolRequestFacts` (the parsed body, the headers).
 */
export type AgUiRequestFacts = ProtocolRequestFacts;

/**
 * The request-reading strategy: a body → the turn it asks for. Mapping only;
 * every rule runs after it, in the core. Refuse a body it cannot read by
 * throwing a `WireRequestRefusal` (its status and code reach the caller);
 * anything else it throws is refused as a malformed request, in fixed words.
 *
 * @example A gateway that sends `{ conversationId, requestId, text }`
 * ```ts
 * const reader: AgUiRequestReader = ({ body }) => {
 *   const b = body as { conversationId?: unknown; requestId?: unknown; text?: unknown };
 *   return {
 *     threadId: String(b.conversationId),
 *     runId: String(b.requestId),
 *     messages: [{ id: 'gateway-turn', role: 'user', content: String(b.text) }],
 *   };
 * };
 * ```
 */
export type AgUiRequestReader = (request: AgUiRequestFacts) => AgUiTurnRequest;

/** The default reader: the body IS an AG-UI `RunAgentInput`. */
export const runAgentInputReader: AgUiRequestReader = ({ body }) => body as AgUiTurnRequest;

/**
 * The core's read of one request: `reader` maps the body, and what it produced
 * is checked by {@link readAgUiRunInput} — whichever reader it was. A custom
 * reader's answer is copied as plain JSON first; the default reader's is the
 * parsed body itself, read exactly as before readers were replaceable.
 *
 * @throws WireRequestRefusal — the reader's own refusal, or the core's by name
 *   (400, `ERR_INVALID_RUN_INPUT`).
 */
export function readAgUiRequest(
  reader: AgUiRequestReader,
  request: AgUiRequestFacts,
): AgUiRunInput {
  if (reader === runAgentInputReader) return readAgUiRunInput(request.body);
  let answer: unknown;
  let produced: unknown;
  try {
    answer = reader(request);
    if (!isThenable(answer)) produced = plainJson(answer);
  } catch (err) {
    if (err instanceof WireRequestRefusal) throw err;
    // Never the reader's message: it may quote the body it could not read.
    throw malformed('the request reader could not read the body.');
  }
  // An app's mistake, never the caller's: a reader answers at once. (A
  // Promise copied as JSON would be `{}`, refused as the CALLER's fault.)
  if (isThenable(answer))
    throw new TypeError('agUi(): reader must return the turn itself, not a Promise.');
  return readAgUiRunInput(produced);
}

const isThenable = (value: unknown): boolean =>
  typeof (value as { then?: unknown } | null | undefined)?.then === 'function';

/**
 * A custom reader's answer as plain JSON — every value read ONCE, here: a
 * getter, a proxy or a `toJSON` cannot answer the core's check one way and its
 * plan another. JSON's own rules apply (a non-finite number becomes `null`); a
 * value JSON cannot hold (a cycle, a BigInt, nesting too deep to write) is
 * refused as a malformed request.
 */
function plainJson(value: unknown): unknown {
  const text = JSON.stringify(value);
  return text === undefined ? undefined : (JSON.parse(text) as unknown);
}

/** What a page's `state` or `context` is checked by before the agent may see it. */
export type AgUiValidator = (
  value: unknown,
  at: {
    /** The conversation the request was bound to — whose state this claims to be. */
    readonly thread?: ThreadBinding;
    readonly headers: Readonly<Record<string, string>>;
  },
) => unknown;

/** The rules one adapter plans by — built from `agUi()`'s options. */
export interface AgUiTurnRules {
  /** The frontend tools the app allow-listed, by name: each builds the tool the agent is given. */
  readonly frontendTools: ReadonlyMap<string, () => Tool>;
  readonly accept: {
    readonly state?: AgUiValidator;
    readonly context?: AgUiValidator;
  };
}

/**
 * Plan one turn: the request (read by {@link readAgUiRunInput}) against what
 * the server holds for its bound conversation.
 *
 * @throws WireRequestRefusal — by name, for everything a page may not decide.
 */
export function planAgUiTurn(
  input: AgUiRunInput,
  held: HeldConversation,
  facts: PlanFacts,
  rules: AgUiTurnRules,
): ProtocolPlan {
  input.messages.forEach((m, i) => {
    if (m.role === 'system' || m.role === 'developer')
      throw refused(
        'ERR_INSTRUCTIONS_NOT_CARRIED',
        `messages[${i}] is a ${m.role} message. The agent's instructions are its own; a page ` +
          `cannot send them.`,
      );
  });
  const tools = toolsOf(input, facts, rules);
  const accepted: Record<string, unknown> = {};
  const state = validated('state', input.state, rules.accept.state, facts);
  if (state !== undefined) accepted.state = state;
  const context = validated(
    'context',
    input.context.length === 0 ? undefined : input.context,
    rules.accept.context,
    facts,
  );
  if (context !== undefined) accepted.context = context;
  return {
    turn: turnOf(input, held, facts),
    ...(tools.length > 0 && { tools }),
    ...(Object.keys(accepted).length > 0 && { accepted }),
  };
}

/** The frontend tools this request enables: allow-listed by name AND declared by the page. */
function toolsOf(input: AgUiRunInput, facts: PlanFacts, rules: AgUiTurnRules): Tool[] {
  const tools: Tool[] = [];
  input.tools.forEach((declared, i) => {
    const build = rules.frontendTools.get(declared.name);
    if (build === undefined)
      throw refused(
        'ERR_TOOL_NOT_ALLOWED',
        `tools[${i}] names a tool this agent does not let the page run. A frontend tool runs ` +
          `only when the app allow-lists it: agUi({ frontendTools }).`,
      );
    tools.push(build());
  });
  if (tools.length > 0 && !facts.keepsPauses)
    throw refused(
      'ERR_CLIENT_TOOLS_NOT_CARRIED',
      `the page offers frontend tools, and their results arrive in the page's NEXT request — ` +
        `this host keeps no paused run to continue. Serve it with threads and sessions.`,
    );
  return tools;
}

/** A page value the app's validator accepted, or `undefined` for an empty one. */
function validated(
  name: 'state' | 'context',
  value: unknown,
  validator: AgUiValidator | undefined,
  facts: PlanFacts,
): unknown {
  if (isEmpty(value)) return undefined;
  const upper = name.toUpperCase();
  if (validator === undefined)
    throw refused(
      `ERR_${upper}_NOT_CARRIED`,
      `the request carries \`${name}\`, and this agent accepts none from a page. To accept it, ` +
        `validate it: agUi({ accept: { ${name} } }).`,
    );
  try {
    return validator(value, {
      ...(facts.thread !== undefined && { thread: facts.thread }),
      headers: facts.headers,
    });
  } catch (err) {
    if (err instanceof WireRequestRefusal) throw err;
    // Never the validator's message: it may describe the value it refused.
    throw refused(`ERR_${upper}_REFUSED`, `the app's validator refused \`${name}\`.`);
  }
}

const isEmpty = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (Array.isArray(value) && value.length === 0) ||
  (isRecord(value) && Object.keys(value).length === 0);

/** The turn the request asks for, against what the server holds. */
function turnOf(input: AgUiRunInput, held: HeldConversation, facts: PlanFacts): ProtocolTurn {
  const resume = input.resume ?? [];
  const last = input.messages[input.messages.length - 1];
  const awaiting = held.awaiting;
  if (awaiting === undefined) {
    if (resume.length > 0)
      throw refused(
        'ERR_NO_PENDING_ASK',
        facts.keepsPauses
          ? 'the request answers an interrupt, and this thread is waiting on none.'
          : 'the request answers an interrupt, and this host keeps no paused run to continue.',
        409,
      );
    if (last?.role === 'tool')
      throw refused(
        'ERR_UNKNOWN_TOOL_CALL',
        `messages[${input.messages.length - 1}] answers a tool call this thread is not ` +
          `waiting on. A tool result is taken only for a frontend tool the run is paused on.`,
      );
    return { kind: 'message', message: newestMessage(input, facts) };
  }
  const suspension = readAgUiSuspension(awaiting.suspension);
  if (suspension === undefined)
    throw refused(
      'ERR_AWAITING_DECISION',
      'this thread is waiting on an answer another door asked for; answer it there.',
      409,
    );
  const call = suspension.call;
  if (call?.client === true) return { kind: 'answer', answer: clientResult(input, call) };
  if (resume.length === 0)
    throw refused(
      'ERR_AWAITING_DECISION',
      'this thread is waiting on the answer to its interrupt; send it in `resume`.',
      409,
    );
  const known = resume.findIndex((entry) => entry.interruptId !== suspension.interruptId);
  if (known >= 0 || resume.length !== 1)
    throw refused(
      'ERR_UNKNOWN_INTERRUPT',
      `resume[${Math.max(known, 0)}] does not answer the interrupt this thread is waiting on.`,
    );
  const entry = resume[0] as AgUiResumeEntry;
  if (entry.status === 'cancelled')
    throw refused(
      'ERR_CANCEL_NOT_CARRIED',
      'the request cancels the interrupt, and this agent continues a paused run only with an ' +
        'answer. Answer it — a decline is an answer.',
    );
  return { kind: 'answer', answer: answeringRequest(entry.payload, awaiting.pending) };
}

/**
 * A page's decision, named for the consent request its interrupt stands for.
 *
 * A consent gate's decision must name the request it answers
 * (`core/consentRequest.ts`). An AG-UI page never receives that id — its
 * interrupt carries the question, not the evidence or the request — and it
 * needs none: the interrupt it answered was matched above to the pause this
 * server keeps, and one pause asks one request. So a decision WITHOUT a
 * `requestId` is named here, for that pause's request. A decision that names
 * one keeps it, and the resume holds it to the paused request like any other.
 * Anything that is not a decision passes through unchanged and is refused by
 * the resume as not being one.
 */
function answeringRequest(payload: unknown, pending: HeldPending): unknown {
  const requestId = pending.checkIn?.id ?? pending.ask?.id;
  if (typeof requestId !== 'string' || !looksLikeDecision(payload)) return payload;
  if ((payload as { requestId?: unknown }).requestId !== undefined) return payload;
  return { ...(payload as Readonly<Record<string, unknown>>), requestId };
}

/** What the held pause asked, as {@link answeringRequest} reads it. */
type HeldPending = NonNullable<HeldConversation['awaiting']>['pending'];

/** The page's result for the frontend tool call the run is paused on — the newest message. */
function clientResult(input: AgUiRunInput, call: AgUiSuspendedCall): string {
  const at = input.messages.length - 1;
  const last = input.messages[at];
  if (last?.role === 'tool' && last.toolCallId === call.toolCallId) return textOf(last.content, at);
  if (last?.role === 'tool')
    throw refused(
      'ERR_UNKNOWN_TOOL_CALL',
      `messages[${at}] answers a tool call this thread is not waiting on.`,
    );
  throw refused(
    'ERR_AWAITING_DECISION',
    'this thread is waiting on the result of a tool the page runs; send it as the newest ' +
      'message, a `tool` message for that call.',
    409,
  );
}

/** The newest message — the person's — as the run's message. */
function newestMessage(input: AgUiRunInput, facts: PlanFacts): string {
  const at = input.messages.length - 1;
  const last = input.messages[at];
  if (last === undefined || last.role !== 'user')
    throw refused(
      'ERR_NO_USER_TURN',
      'the newest message must be the person’s (`role: user`) — it is what the agent answers.',
    );
  if (!facts.keepsConversation && at > 0)
    throw refused(
      'ERR_CONVERSATION_NOT_KEPT',
      'the request continues a conversation, and this host keeps none: the page’s copy is ' +
        'never taken as what was said. Serve it with threads (and sessions, or an agent ' +
        'with memory) to continue one.',
    );
  const text = textOf(last.content, at);
  if (text.trim().length === 0) throw refused('ERR_NO_USER_TURN', `messages[${at}] says nothing.`);
  return text;
}

/** A message body as text — a media part refused by name, never dropped. */
function textOf(value: string | readonly AgUiContentPart[] | undefined, at: number): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  let out = '';
  for (const part of value) {
    if (part.type !== 'text')
      throw refused(
        'ERR_MEDIA_NOT_CARRIED',
        `messages[${at}] carries a ${part.type} part; this agent is given text only.`,
      );
    out += (part as { text: string }).text;
  }
  return out;
}

const isText = (value: unknown): value is string => typeof value === 'string';
const texts = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(isText);

/**
 * A stored suspension record, checked — the store holds bytes; a record that
 * is not one this adapter wrote is `undefined`, and nothing is matched to it.
 */
export function readAgUiSuspension(value: unknown): AgUiSuspension | undefined {
  if (!isRecord(value) || value.version !== 1 || !isText(value.runId)) return undefined;
  if (value.interruptId !== undefined && !isText(value.interruptId)) return undefined;
  if (typeof value.rootAgent !== 'boolean' || !Array.isArray(value.scopes)) return undefined;
  const call = value.call;
  if (
    call !== undefined &&
    (!isRecord(call) ||
      !isText(call.toolCallId) ||
      typeof call.client !== 'boolean' ||
      !texts(call.mount))
  )
    return undefined;
  for (const scope of value.scopes as unknown[]) {
    if (!isRecord(scope) || !texts(scope.mount) || !texts(scope.steps)) return undefined;
    if (!Array.isArray(scope.calls)) return undefined;
    for (const open of scope.calls as unknown[])
      if (!isRecord(open) || !isText(open.toolCallId) || typeof open.client !== 'boolean')
        return undefined;
    for (const field of ['subagentRunId', 'name', 'parentSubagentRunId', 'messageId'])
      if (scope[field] !== undefined && !isText(scope[field])) return undefined;
  }
  return value as unknown as AgUiSuspension;
}
