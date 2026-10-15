/**
 * safeAnswer — what the MCP client may read of an answer: read ONCE, checked,
 * and handed on as the canonical form of exactly what was checked.
 *
 * ── Why an allow-list ────────────────────────────────────────────────────────
 * Whatever an answer's body says becomes the MCP client's error text, and a
 * failed tool call hands that text to the model, the run's history and
 * `tool_end`. Service text can carry anything the request did: AWS answers a
 * signature mismatch with the whole signed request (the session token among
 * it), its validation errors quote the value they refused, a proxy may echo a
 * header. So a failure is RE-WRITTEN from parts that cannot carry a secret:
 * the status; the AWS error type when it is a plain name; `Retry-After` when
 * it is seconds or a date; and for a JSON-RPC error its integer `code`, the
 * client's own `id`, and its `message` ONLY when it is one of the fixed
 * sentences the MCP SDK and the AgentCore Runtime contract use
 * ({@link KNOWN_ERROR_MESSAGES}).
 *
 * ── Why one reading ──────────────────────────────────────────────────────────
 * A check that reads a body one way and a client that reads the same bytes
 * another is a parser differential: a crafted answer passes the check and is
 * used as something else. So a 2xx answer is never handed on as its raw bytes.
 * It is classified by ONE rule (its media type, exactly `application/json` or
 * `text/event-stream`, UTF-8), decoded strictly, parsed once
 * (`strictJson.ts` — a duplicated key, trailing data or a byte-order mark is
 * refused), checked, and RE-SERIALIZED: the client reads the value that was
 * checked, never the bytes it came from. One message per body or event — a
 * batch is refused. An answer that cannot be read unambiguously is refused by
 * name, as a 502 whose text is this library's.
 *
 * Pattern: pure functions + one TransformStream. Role: outer ring, the
 * transport's one rule for what the client reads.
 */

import { awsErrorType } from './errorType.js';
import { AmbiguousJsonError, parseStrictJson, type JsonValue } from './strictJson.js';

/**
 * JSON-RPC error messages a reply may keep word for word — fixed strings that
 * carry nothing of the request: the JSON-RPC 2.0 standard errors, the MCP
 * Streamable HTTP session error, and the AgentCore Runtime MCP contract's
 * mappings of its exceptions.
 */
export const KNOWN_ERROR_MESSAGES: ReadonlySet<string> = new Set([
  'Parse error',
  'Invalid Request',
  'Method not found',
  'Invalid params',
  'Internal error',
  'Session not found',
  'Session operation in progress, please retry',
  'Resource conflict - Resource already exists',
  'Rate limit exceeded - Too many requests',
  'Authentication error - Invalid credentials',
  'Authorization error - Insufficient permissions',
  'Tool execution error',
]);

/**
 * AWS error types that mean "who you are, or what you may do" — whatever
 * status they arrive with (`IncompleteSignatureException` is a 400).
 */
const AUTH_FAILURE_TYPES: ReadonlySet<string> = new Set([
  'AccessDeniedException',
  'ExpiredTokenException',
  'IncompleteSignatureException',
  'InvalidClientTokenId',
  'InvalidSignatureException',
  'MissingAuthenticationTokenException',
  'SignatureDoesNotMatch',
  'UnauthorizedException',
  'UnrecognizedClientException',
]);

/** An error type that is a plain name — anything else is not repeated. */
const PLAIN_TYPE = /^[A-Za-z][A-Za-z0-9]{0,99}$/;

/** A token the client may read back as it is: a request id, an event id or type, a session header. */
const PLAIN_TOKEN = /^[A-Za-z0-9_.:-]{1,128}$/;

/** `Retry-After`: delay-seconds, or an HTTP date. */
const RETRY_AFTER = /^(?:\d{1,10}|[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT)$/;

/** The response headers a 2xx answer keeps (besides its canonical content type). */
const KEPT_HEADERS = ['mcp-session-id', 'mcp-protocol-version'] as const;

/** An answer this transport will not hand on, and why — in its own words. */
class Unreadable extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** Is this answer an authentication or authorization failure? */
export function isAuthFailure(status: number, type: string | undefined): boolean {
  if (status === 401 || status === 403) return true;
  return type !== undefined && AUTH_FAILURE_TYPES.has(type);
}

/**
 * The answer the MCP client may read: a failure rewritten from safe parts; a
 * 2xx read once and re-serialized; an answer that cannot be read
 * unambiguously refused (502).
 */
export async function safeAnswer(response: Response): Promise<Response> {
  if (!response.ok) return safeFailure(response);
  try {
    return await safeSuccess(response);
  } catch (err) {
    if (err instanceof Unreadable) return refusal(response.status, err.reason);
    throw err;
  }
}

// ── 2xx ────────────────────────────────────────────────────────────────

async function safeSuccess(response: Response): Promise<Response> {
  const kind = mediaKind(response.headers.get('content-type'));
  if (kind === 'event-stream') return safeStream(response);
  const bytes = response.body === null ? new Uint8Array() : await bytesOf(response);
  if (bytes.length === 0) {
    // An empty answer (a 202 to a notification): nothing to read, nothing handed on.
    const headers = keptHeaders(response.headers, undefined);
    return new Response(null, { status: response.status, headers });
  }
  if (kind !== 'json') {
    throw new Unreadable(
      kind === 'none'
        ? 'a body with no content type'
        : 'a body whose content type is neither application/json nor text/event-stream',
    );
  }
  const message = oneMessage(parseOnce(decodeUtf8(bytes)));
  return new Response(JSON.stringify(canonicalMessage(message)), {
    status: response.status,
    headers: keptHeaders(response.headers, 'application/json'),
  });
}

/** The ONE media type the transport reads a 2xx body as, by one rule. */
function mediaKind(contentType: string | null): 'json' | 'event-stream' | 'none' | 'other' {
  if (contentType === null || contentType.trim() === '') return 'none';
  const [type, ...params] = contentType.split(';').map((part) => part.trim().toLowerCase());
  // Every parameter must be `charset=utf-8`: another charset is another reading.
  const utf8 = params.every((p) => /^charset="?utf-8"?$/.test(p));
  if (!utf8) return 'other';
  if (type === 'application/json') return 'json';
  if (type === 'text/event-stream') return 'event-stream';
  return 'other';
}

async function bytesOf(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}

/** UTF-8, strictly: an invalid sequence or a byte-order mark is refused. */
function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Unreadable('a body that is not UTF-8');
  }
}

function parseOnce(text: string): JsonValue {
  try {
    return parseStrictJson(text);
  } catch (err) {
    if (err instanceof AmbiguousJsonError) throw new Unreadable(err.reason);
    throw err;
  }
}

/** ONE JSON-RPC message — an object; a batch, or anything else, is refused. */
function oneMessage(value: JsonValue): { readonly [key: string]: JsonValue } {
  if (Array.isArray(value)) throw new Unreadable('more than one message in one body');
  if (value === null || typeof value !== 'object') {
    throw new Unreadable('a body that is not a JSON-RPC message');
  }
  return value as { readonly [key: string]: JsonValue };
}

/** The message as the client may read it: an error rewritten, anything else as checked. */
function canonicalMessage(message: { readonly [key: string]: JsonValue }): JsonValue {
  return 'error' in message ? safeErrorReply(message) : message;
}

/** The response headers a 2xx answer keeps, and its canonical content type. */
function keptHeaders(from: Headers, contentType: string | undefined): Headers {
  const headers = new Headers(contentType === undefined ? {} : { 'content-type': contentType });
  for (const name of KEPT_HEADERS) {
    const value = from.get(name);
    if (value !== null && PLAIN_TOKEN.test(value)) headers.set(name, value);
  }
  return headers;
}

/** A 2xx answer the transport cannot read unambiguously — refused in its own words. */
function refusal(status: number, reason: string): Response {
  return new Response(
    JSON.stringify({
      message:
        `Unreadable answer (HTTP ${status}): ${reason}. It was not passed on, because a ` +
        'reading the transport could not check is a reading the model must not get.',
    }),
    { status: 502, headers: { 'content-type': 'application/json' } },
  );
}

// ── failures ───────────────────────────────────────────────────────────

/** A failure, rewritten from its status, its type and — for a JSON-RPC error — its code. */
async function safeFailure(response: Response): Promise<Response> {
  const type = plainType(awsErrorType(response.headers));
  const reply = await failureReplyOf(response);
  const body =
    reply !== undefined
      ? safeErrorReply(reply)
      : { message: failureSentence(response.status, type) };
  const headers = new Headers({ 'content-type': 'application/json' });
  if (type !== undefined) headers.set('x-amzn-errortype', type);
  const retryAfter = response.headers.get('retry-after')?.trim();
  if (retryAfter !== undefined && RETRY_AFTER.test(retryAfter)) {
    headers.set('retry-after', retryAfter);
  }
  return new Response(JSON.stringify(body), { status: response.status, headers });
}

/** The JSON-RPC error message a failure's body is — read once, strictly — or `undefined`. */
async function failureReplyOf(
  response: Response,
): Promise<{ readonly [key: string]: JsonValue } | undefined> {
  if (response.body === null || mediaKind(response.headers.get('content-type')) !== 'json') {
    await response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  try {
    const message = oneMessage(parseOnce(decodeUtf8(await bytesOf(response))));
    return 'error' in message ? message : undefined;
  } catch {
    return undefined;
  }
}

/** The fixed sentence a failure with no JSON-RPC reply is answered with. */
export function failureSentence(status: number, type: string | undefined): string {
  if (isAuthFailure(status, type)) {
    return (
      `${type ?? 'Request refused'} (HTTP ${status}). The service's message for this request ` +
      'was not passed on, because AWS can quote the signed request in it, credentials ' +
      'included. Check the caller’s credentials and its permission to invoke this runtime.'
    );
  }
  return (
    `${type ?? 'Request failed'} (HTTP ${status}). The service's message for this request ` +
    'was not passed on, because it can quote what the request carried.'
  );
}

/** A JSON-RPC error reply rebuilt from safe parts only. */
function safeErrorReply(message: { readonly [key: string]: JsonValue }): {
  readonly jsonrpc: '2.0';
  readonly id: number | string | null;
  readonly error: { readonly code: number; readonly message: string };
} {
  const error = message['error'];
  const fields =
    error !== null && typeof error === 'object' && !Array.isArray(error)
      ? (error as { readonly [key: string]: JsonValue })
      : {};
  const rawCode = fields['code'];
  const code = typeof rawCode === 'number' && Number.isInteger(rawCode) ? rawCode : -32603;
  const rawId = message['id'];
  const id =
    typeof rawId === 'number' && Number.isFinite(rawId)
      ? rawId
      : typeof rawId === 'string' && PLAIN_TOKEN.test(rawId)
      ? rawId
      : null;
  const rawMessage = fields['message'];
  const text =
    typeof rawMessage === 'string' && KNOWN_ERROR_MESSAGES.has(rawMessage)
      ? rawMessage
      : `Server error (JSON-RPC ${code}). Its message was not passed on, because it can quote ` +
        'what the request carried.';
  return { jsonrpc: '2.0', id, error: { code, message: text } };
}

function plainType(type: string | undefined): string | undefined {
  return type !== undefined && PLAIN_TYPE.test(type) ? type : undefined;
}

// ── event streams ──────────────────────────────────────────────────────

/**
 * A 2xx event stream, read once as it passes: each event parsed by the SSE
 * rules, its data parsed strictly as ONE JSON-RPC message, and re-emitted in
 * canonical form (`event`, `id` when plain, one `data` line) — an error
 * rewritten. Events still reach the client as they arrive. An event that
 * cannot be read unambiguously ends the stream with a refusal in this
 * library's words.
 */
function safeStream(response: Response): Response {
  const body = response.body;
  if (body === null) {
    return new Response(null, {
      status: response.status,
      headers: keptHeaders(response.headers, undefined),
    });
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const encoder = new TextEncoder();
  const parser = sseParser((event) => encoder.encode(canonicalEvent(event)));
  const stream = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        let text: string;
        try {
          text = decoder.decode(chunk, { stream: true });
        } catch {
          controller.error(new Error(streamRefusal('an event stream that is not UTF-8')));
          return;
        }
        try {
          for (const out of parser.push(text)) controller.enqueue(out);
        } catch (err) {
          controller.error(
            new Error(
              streamRefusal(err instanceof Unreadable ? err.reason : 'an unreadable event'),
            ),
          );
        }
      },
      flush(controller) {
        let tail: string;
        try {
          tail = decoder.decode();
        } catch {
          controller.error(new Error(streamRefusal('an event stream that is not UTF-8')));
          return;
        }
        try {
          for (const out of [...parser.push(tail), ...parser.finish()]) controller.enqueue(out);
        } catch (err) {
          controller.error(
            new Error(
              streamRefusal(err instanceof Unreadable ? err.reason : 'an unreadable event'),
            ),
          );
        }
      },
    }),
  );
  return new Response(stream, {
    status: response.status,
    headers: keptHeaders(response.headers, 'text/event-stream'),
  });
}

function streamRefusal(reason: string): string {
  return (
    `agentCoreRuntimeMcpTransport: the event stream was cut: ${reason}. The rest was not ` +
    'passed on, because a reading the transport could not check is a reading the model must ' +
    'not get.'
  );
}

/** One dispatched event, as the SSE rules build it. */
interface SseEvent {
  readonly type?: string;
  readonly id?: string;
  readonly data: string;
}

/**
 * The SSE line rules (WHATWG `text/event-stream`): lines end in CRLF, LF or CR;
 * a blank line dispatches; `:` starts a comment; `data` lines join with `\n`;
 * one leading space after the colon is dropped; an event with no data is not
 * dispatched.
 */
function sseParser(emit: (event: SseEvent) => Uint8Array): {
  push(text: string): Uint8Array[];
  finish(): Uint8Array[];
} {
  let pending = '';
  let data: string[] = [];
  let type: string | undefined;
  let id: string | undefined;
  const line = (raw: string, out: Uint8Array[]): void => {
    if (raw === '') {
      if (data.length > 0) {
        out.push(
          emit({
            ...(type !== undefined && { type }),
            ...(id !== undefined && { id }),
            data: data.join('\n'),
          }),
        );
      }
      data = [];
      type = undefined;
      return;
    }
    if (raw.startsWith(':')) return;
    const colon = raw.indexOf(':');
    const field = colon === -1 ? raw : raw.slice(0, colon);
    const value = colon === -1 ? '' : raw.slice(colon + 1).replace(/^ /, '');
    if (field === 'data') data.push(value);
    else if (field === 'event') type = value;
    else if (field === 'id' && !value.includes('\0')) id = value;
  };
  return {
    push(text) {
      pending += text;
      const out: Uint8Array[] = [];
      for (;;) {
        const match = /\r\n|\n|\r/.exec(pending);
        if (match === null) break;
        // A CR at the very end may be the first half of a CRLF still to come.
        if (match[0] === '\r' && match.index === pending.length - 1) break;
        line(pending.slice(0, match.index), out);
        pending = pending.slice(match.index + match[0].length);
      }
      return out;
    },
    finish() {
      // The stream ended: a CR held back for a CRLF that never came ends its
      // line. Text with no line end is an unfinished line, and an event with
      // no blank line after it is not dispatched (the SSE rule).
      const out: Uint8Array[] = [];
      if (pending.endsWith('\r')) line(pending.slice(0, -1), out);
      pending = '';
      return out;
    },
  };
}

/** One event in canonical form — its data the ONE message it held, read strictly. */
function canonicalEvent(event: SseEvent): string {
  // An event type that is not a plain token cannot be re-emitted as it was,
  // and re-emitting it as a default `message` would make the client act on an
  // event it would have ignored — so it is dropped.
  if (event.type !== undefined && !PLAIN_TOKEN.test(event.type)) return '';
  const message = oneMessage(parseOnce(event.data));
  const lines: string[] = [];
  if (event.type !== undefined) lines.push(`event: ${event.type}`);
  if (event.id !== undefined && PLAIN_TOKEN.test(event.id)) lines.push(`id: ${event.id}`);
  lines.push(`data: ${JSON.stringify(canonicalMessage(message))}`);
  return `${lines.join('\n')}\n\n`;
}
