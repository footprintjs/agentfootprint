/**
 * adapters/hosting/responsesWire — the Responses protocol, as an `HttpWire`.
 *
 * ── What this is, and what it deliberately is not ────────────────────────────
 * This file speaks the **Responses** wire protocol: a request carries `input`
 * as text or as message items, a reply is a `response` object with an id and a
 * status, and a stream is a LIFECYCLE of named events that open the response,
 * announce output, carry deltas, and close each part before closing the
 * response itself.
 *
 * That protocol is nobody's product. It is the shape a Responses-speaking
 * client sends and expects, and several hosted runtimes speak it. So it lives
 * here as a dialect on its own, and the runtimes that CONFIGURE it — their
 * paths, their ports, their probe bodies, their session aliases — live in their
 * own files beside this one. Keeping the split means the next runtime that
 * speaks Responses is a configuration rather than a copy, and it means no
 * vendor's spelling ends up in the protocol.
 *
 * ── The subset ───────────────────────────────────────────────────────────────
 * A text turn, streamed or not, with a session. Deliberately not the whole
 * Responses API: tool calls, reasoning items, image/file input, structured
 * output and function-call output are NOT carried, and each is REFUSED by name
 * rather than dropped — a request whose content this dialect cannot represent
 * is answered 400 before a turn is paid for, never answered 200 with the parts
 * it happened to understand.
 *
 * @example  A host that speaks Responses on paths of its own choosing
 *   httpHost({
 *     name: 'myResponsesHost',
 *     wire: responsesWire({ defaultModel: 'my-agent' }),
 *     invokePath: '/responses',
 *     healthPath: '/health',
 *   });
 */

import { randomUUID } from 'node:crypto';

import { WireRequestRefusal } from '../../hosting/errors.js';
import type {
  FailureOrigin,
  HttpRequestFacts,
  HttpWire,
  StreamFrame,
  StreamFraming,
} from '../../hosting/httpHost.js';

/** Body fields that may carry a session id, in the order they are consulted. */
export const DEFAULT_SESSION_FIELDS: readonly string[] = ['conversation', 'session_id'];

/**
 * What a caller is told when a handler THREW.
 *
 * A thrown error's message is the author's note to their own logs — a query, a
 * path, a token in a connection string — and none of it is the caller's. A
 * handler that CHOSE to fail chose its words for the caller, so those travel
 * unchanged. The host tells this dialect which happened; it never guesses from
 * the message.
 */
export const PUBLIC_FAILURE_MESSAGE = 'The agent could not complete this request.';

const DEFAULT_MODEL = 'agentfootprint';

export interface ResponsesWireOptions {
  /** Model label echoed in `response` objects when the request names none. */
  readonly defaultModel?: string;
  /**
   * Body fields that carry a session id, in precedence order. The first one
   * present and non-empty wins. Default `['conversation', 'session_id']`.
   *
   * A runtime with its own spelling passes its own list — that is the seam a
   * hosting contract configures rather than forks this file for.
   */
  readonly sessionFields?: readonly string[];
  /** Body for the health probe. Default `{ status: 'ok' }`. */
  readonly health?: unknown;
}

type JsonObject = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * The text of one message's content, or a refusal naming what was in it.
 *
 * Every non-text part is refused rather than skipped: a resume with an attached
 * image, silently reduced to the text around it, is a wrong answer delivered
 * confidently.
 */
function inputTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) {
    throw new WireRequestRefusal(
      'unsupported_input',
      'message content must be text or an array of input_text parts',
    );
  }
  const text: string[] = [];
  for (const part of content) {
    if (!isRecord(part) || part.type !== 'input_text' || typeof part.text !== 'string') {
      const kind = isRecord(part) && typeof part.type === 'string' ? part.type : 'unknown';
      throw new WireRequestRefusal(
        'unsupported_input',
        `this dialect carries text input only; '${kind}' input is not supported`,
      );
    }
    text.push(part.text);
  }
  return text.join('');
}

/** The turn's text: a bare string, or the user message items that carry it. */
export function readResponsesInput(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input === undefined || input === null) {
    throw new WireRequestRefusal('invalid_input', 'input is required');
  }
  if (!Array.isArray(input)) {
    throw new WireRequestRefusal(
      'invalid_input',
      'input must be text or an array of Responses message items',
    );
  }
  const messages: string[] = [];
  for (const item of input) {
    if (!isRecord(item)) {
      throw new WireRequestRefusal('invalid_input', 'each input item must be an object');
    }
    // `type` is optional in the Responses grammar for a plain message.
    if (item.type !== undefined && item.type !== 'message') {
      throw new WireRequestRefusal(
        'unsupported_input',
        `this dialect carries message items only; '${String(item.type)}' items are not supported`,
      );
    }
    if (item.role !== 'user') {
      throw new WireRequestRefusal(
        'unsupported_input',
        `this dialect carries user messages only; role '${String(item.role)}' is not supported`,
      );
    }
    messages.push(inputTextFromContent(item.content));
  }
  return messages.join('\n\n');
}

/** The session this request claims, by whichever of its aliases it used. */
export function readResponsesSession(
  body: JsonObject,
  fields: readonly string[],
): string | undefined {
  for (const field of fields) {
    const value = body[field];
    // `conversation` is an object in the Responses grammar and a bare string in
    // several dialects of it. Both are read, because refusing the spelling a
    // client already sends teaches nothing.
    const found = isRecord(value) ? nonEmptyString(value.id) : nonEmptyString(value);
    if (found !== undefined) return found;
  }
  return undefined;
}

interface ResponseIdentity {
  readonly responseId: string;
  readonly messageId: string;
  readonly createdAt: number;
  readonly model: string;
  readonly sessionId: string | undefined;
}

function identityFor(
  facts: HttpRequestFacts | undefined,
  options: Required<Pick<ResponsesWireOptions, 'defaultModel' | 'sessionFields'>>,
): ResponseIdentity {
  const body = facts?.body ?? {};
  const nonce = randomUUID().replaceAll('-', '');
  return {
    responseId: `resp_${nonce}`,
    messageId: `msg_${nonce}`,
    createdAt: Math.floor(Date.now() / 1000),
    model: nonEmptyString(body.model) ?? options.defaultModel,
    sessionId: readResponsesSession(body, options.sessionFields),
  };
}

function outputPart(text: string): JsonObject {
  return { type: 'output_text', text, annotations: [], logprobs: [] };
}

function outputItem(
  identity: ResponseIdentity,
  text: string,
  status: 'in_progress' | 'completed',
): JsonObject {
  return {
    id: identity.messageId,
    type: 'message',
    status,
    role: 'assistant',
    content: status === 'completed' ? [outputPart(text)] : [],
  };
}

function responseObject(
  identity: ResponseIdentity,
  status: 'in_progress' | 'completed' | 'failed',
  text = '',
  error: JsonObject | null = null,
): JsonObject {
  return {
    id: identity.responseId,
    object: 'response',
    created_at: identity.createdAt,
    status,
    error,
    incomplete_details: null,
    instructions: null,
    parallel_tool_calls: true,
    model: identity.model,
    output: status === 'completed' ? [outputItem(identity, text, 'completed')] : [],
    conversation: identity.sessionId === undefined ? null : { id: identity.sessionId },
    usage: null,
  };
}

/**
 * What a caller may be told about a failure.
 *
 * A refusal this library authored carries a `code` and says what it says. A
 * handler that threw carries none, and its words do not travel.
 */
function errorBody(
  message: string,
  code: string | undefined,
  origin: FailureOrigin | undefined,
): JsonObject {
  if (origin === 'threw') {
    return { code: 'server_error', message: PUBLIC_FAILURE_MESSAGE, type: 'server_error' };
  }
  return code === undefined
    ? { code: 'server_error', message, type: 'server_error' }
    : { code, message, type: 'invalid_request_error' };
}

/**
 * The nine-event lifecycle one streamed response is made of.
 *
 * Holds this response's identity and its sequence counter, which is why it is
 * built per request: two callers sharing a counter would each see a stream that
 * skips numbers, and two sharing an id would see each other's response.
 */
function responsesFraming(identity: ResponseIdentity): StreamFraming {
  let sequence = 0;
  let outputStarted = false;
  let streamed = '';
  let sawDelta = false;

  const frame = (event: string, fields: JsonObject): StreamFrame => ({
    event,
    data: { type: event, sequence_number: sequence++, ...fields },
  });

  /**
   * The two frames that must precede any text. Emitted on the first delta
   * rather than at open, because a response that fails before producing a word
   * never opened an output item and should not claim it did.
   */
  const begin = (): StreamFrame[] => {
    if (outputStarted) return [];
    outputStarted = true;
    return [
      frame('response.output_item.added', {
        output_index: 0,
        item: outputItem(identity, '', 'in_progress'),
      }),
      frame('response.content_part.added', {
        item_id: identity.messageId,
        output_index: 0,
        content_index: 0,
        part: outputPart(''),
      }),
    ];
  };

  const delta = (text: string): StreamFrame[] => {
    if (text === '') return [];
    const frames = begin();
    sawDelta = true;
    streamed += text;
    frames.push(
      frame('response.output_text.delta', {
        item_id: identity.messageId,
        output_index: 0,
        content_index: 0,
        delta: text,
        logprobs: [],
      }),
    );
    return frames;
  };

  return {
    open: () => [
      frame('response.created', { response: responseObject(identity, 'in_progress') }),
      frame('response.in_progress', { response: responseObject(identity, 'in_progress') }),
    ],
    chunk: (text) => delta(text),
    complete: (output) => {
      const frames: StreamFrame[] = [];
      // A handler that streamed nothing still owes the caller its text, and one
      // that streamed a PREFIX of it owes the rest. Anything else — a final
      // output that contradicts what was streamed — is left as it was streamed:
      // frames already on the wire cannot be taken back, and re-sending the
      // whole text would duplicate what the caller already rendered.
      if (!sawDelta) frames.push(...delta(output));
      else if (output.startsWith(streamed) && output.length > streamed.length) {
        frames.push(...delta(output.slice(streamed.length)));
      }
      frames.push(...begin());
      // THE COMPLETION IS AUTHORITATIVE — this library's law, and it outranks
      // the protocol's own tidiness. When a handler's chunks were a preview of
      // different final text rather than a prefix of it, the deltas already on
      // the wire cannot be recalled, and this reports the ANSWER rather than
      // the preview. The two then disagree, which is a documented limit of
      // streaming a preview; reporting the preview as the answer would be a
      // wrong answer, which is not.
      const text = output;
      frames.push(
        frame('response.output_text.done', {
          item_id: identity.messageId,
          output_index: 0,
          content_index: 0,
          text,
          logprobs: [],
        }),
        frame('response.content_part.done', {
          item_id: identity.messageId,
          output_index: 0,
          content_index: 0,
          part: outputPart(text),
        }),
        frame('response.output_item.done', {
          output_index: 0,
          item: outputItem(identity, text, 'completed'),
        }),
        frame('response.completed', { response: responseObject(identity, 'completed', text) }),
      );
      return frames;
    },
    failure: (message, code, origin) => [
      frame('response.failed', {
        response: responseObject(identity, 'failed', '', errorBody(message, code, origin)),
      }),
    ],
  };
}

/**
 * An `HttpWire` speaking the Responses protocol.
 *
 * Pair it with `httpHost` and the paths your deployment contract names. The
 * host keeps its own promises — draining, aborting on disconnect, failing a
 * handler that throws or answers nothing — and this supplies only the dialect.
 */
export function responsesWire(options: ResponsesWireOptions = {}): HttpWire {
  const resolved = {
    defaultModel: options.defaultModel ?? DEFAULT_MODEL,
    sessionFields: options.sessionFields ?? DEFAULT_SESSION_FIELDS,
  };
  const health = options.health ?? { status: 'ok' };

  return {
    readRequest(facts) {
      const input = readResponsesInput(facts.body.input);
      if (input.trim() === '') {
        throw new WireRequestRefusal('invalid_input', 'input text must not be empty');
      }
      const sessionId = readResponsesSession(facts.body, resolved.sessionFields);
      return { input, ...(sessionId === undefined ? {} : { sessionId }) };
    },
    // This dialect's callers choose in the body and never touch `Accept`.
    wantsStream: (facts) => facts.body.stream === true,
    stream: (facts) => responsesFraming(identityFor(facts, resolved)),
    health: () => health,
    output: (output, facts) => responseObject(identityFor(facts, resolved), 'completed', output),
    chunk: (text) => ({ type: 'response.output_text.delta', delta: text }),
    failure: (message, code, facts, origin) => {
      // A terminal that ended an ACCEPTED response is reported as a failed
      // response object — that is what the protocol says a response that got
      // as far as running and then stopped looks like. A coded refusal ended
      // the REQUEST before any of that, and gets the error envelope a client
      // reads off a 4xx.
      if (code === undefined) {
        return responseObject(
          identityFor(facts, resolved),
          'failed',
          '',
          errorBody(message, undefined, origin),
        );
      }
      return { error: errorBody(message, code, origin) };
    },
  };
}
