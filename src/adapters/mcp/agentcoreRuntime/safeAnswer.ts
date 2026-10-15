/**
 * safeAnswer — what the MCP client may read of a failure: the library's own
 * fixed sentences and safe ids, never the service's text.
 *
 * ── Why an allow-list ────────────────────────────────────────────────────────
 * Whatever an answer's body says becomes the MCP client's error text, and a
 * failed tool call hands that text to the model, the run's history and
 * `tool_end`. Service text can carry anything the request did: AWS answers a
 * signature mismatch with the whole signed request (the session token among
 * it), its validation errors quote the value they refused, a proxy may echo a
 * header. Scrubbing known values out of that text is a block-list — it misses
 * whatever it was not told about. So a failure is RE-WRITTEN instead, from
 * parts that cannot carry a secret:
 *
 *   - the status, and the AWS error type when it is a plain name
 *     (`x-amzn-errortype`, `[A-Za-z][A-Za-z0-9]*`);
 *   - `Retry-After` when it is a number of seconds or an HTTP date — what
 *     `mcpClient`'s 429 retry reads;
 *   - for a JSON-RPC error reply: its `code` (an integer), its `id` when it is
 *     the client's own (a number, or a short plain string), and its `message`
 *     ONLY when it is one of the fixed sentences the MCP SDK and the AgentCore
 *     Runtime contract use ({@link KNOWN_ERROR_MESSAGES}); any other message,
 *     and every `data`, is replaced.
 *
 * Covered: every non-2xx answer; a 2xx JSON body that is one JSON-RPC error
 * reply (the runtime sends some platform errors as an HTTP 200); a 2xx event
 * stream's error events, rewritten as they pass. A `result` is never touched.
 *
 * Pattern: pure functions + one TransformStream. Role: outer ring, the
 * transport's one rule for what the client reads of a failure.
 */

import { awsErrorType } from './errorType.js';

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

/** A request id the client may have chosen — a short plain token. */
const PLAIN_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** `Retry-After`: delay-seconds, or an HTTP date. */
const RETRY_AFTER = /^(?:\d{1,10}|[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT)$/;

/** Is this answer an authentication or authorization failure? */
export function isAuthFailure(status: number, type: string | undefined): boolean {
  if (status === 401 || status === 403) return true;
  return type !== undefined && AUTH_FAILURE_TYPES.has(type);
}

/**
 * The answer the MCP client may read. A failure, a 2xx JSON-RPC error reply and
 * a 2xx event stream are rewritten (see the module note); a 2xx result is
 * handed on as the very object, unread.
 */
export async function safeAnswer(response: Response): Promise<Response> {
  if (!response.ok) return safeFailure(response);
  const contentType = response.headers.get('content-type');
  if (response.body === null || contentType === null) return response;
  if (/^text\/event-stream\b/i.test(contentType.trim())) return safeStream(response);
  if (!/^application\/json\b/i.test(contentType.trim())) return response;
  let text: string;
  try {
    text = await response.clone().text();
  } catch {
    return response;
  }
  // A cheap gate before parsing: a result rarely spells `"error"`, and it is
  // the common case.
  if (!text.includes('"error"')) return response;
  const reply = errorReplyOf(text);
  if (reply === undefined) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(JSON.stringify(safeErrorReply(reply)), {
    status: response.status,
    headers,
  });
}

/** A failure, rewritten from its status, its type and — for a JSON-RPC error — its code. */
async function safeFailure(response: Response): Promise<Response> {
  const type = plainType(awsErrorType(response.headers));
  let text = '';
  try {
    text = response.body === null ? '' : await response.text();
  } catch {
    // An unreadable body is replaced like any other.
  }
  const reply = errorReplyOf(text);
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

/** A JSON-RPC error reply, as the parts that may be repeated. */
interface ErrorReply {
  readonly id: unknown;
  readonly code: unknown;
  readonly message: unknown;
}

/** ONE JSON-RPC error reply in `text`, or `undefined` (a result, a batch, not JSON). */
function errorReplyOf(text: string): ErrorReply | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const { id, error } = parsed as { readonly id?: unknown; readonly error?: unknown };
  if (error === null || typeof error !== 'object' || Array.isArray(error)) return undefined;
  const { code, message } = error as { readonly code?: unknown; readonly message?: unknown };
  return { id, code, message };
}

/** The reply rebuilt from safe parts only. */
function safeErrorReply(reply: ErrorReply): {
  readonly jsonrpc: '2.0';
  readonly id: number | string | null;
  readonly error: { readonly code: number; readonly message: string };
} {
  const code = typeof reply.code === 'number' && Number.isInteger(reply.code) ? reply.code : -32603;
  const id =
    typeof reply.id === 'number' && Number.isFinite(reply.id)
      ? reply.id
      : typeof reply.id === 'string' && PLAIN_ID.test(reply.id)
      ? reply.id
      : null;
  const message =
    typeof reply.message === 'string' && KNOWN_ERROR_MESSAGES.has(reply.message)
      ? reply.message
      : `Server error (JSON-RPC ${code}). Its message was not passed on, because it can quote ` +
        'what the request carried.';
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function plainType(type: string | undefined): string | undefined {
  return type !== undefined && PLAIN_TYPE.test(type) ? type : undefined;
}

// ── Event streams ──────────────────────────────────────────────────────

/**
 * A 2xx event stream with every JSON-RPC error event rewritten as it passes —
 * one event at a time, so events still reach the client as they arrive. Any
 * other event (a result, a notification) is handed on byte for byte.
 */
function safeStream(response: Response): Response {
  const body = response.body;
  if (body === null) return response;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = '';
  const emit = (controller: TransformStreamDefaultController<Uint8Array>, event: string): void => {
    controller.enqueue(encoder.encode(safeEvent(event)));
  };
  const stream = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true });
        let boundary = /\r?\n\r?\n/.exec(pending);
        while (boundary !== null) {
          const end = boundary.index + boundary[0].length;
          emit(controller, pending.slice(0, end));
          pending = pending.slice(end);
          boundary = /\r?\n\r?\n/.exec(pending);
        }
      },
      flush(controller) {
        pending += decoder.decode();
        if (pending !== '') emit(controller, pending);
      },
    }),
  );
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** One event, rewritten when its data is a JSON-RPC error reply; as it was otherwise. */
function safeEvent(event: string): string {
  const lines = event.split(/\r?\n/);
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
  if (data === '' || !data.includes('"error"')) return event;
  const reply = errorReplyOf(data);
  if (reply === undefined) return event;
  const kept = lines.filter((line) => line !== '' && !line.startsWith('data:'));
  const ending = /\r?\n\r?\n$/.exec(event)?.[0] ?? '';
  return [...kept, `data: ${JSON.stringify(safeErrorReply(reply))}`].join('\n') + (ending || '');
}
