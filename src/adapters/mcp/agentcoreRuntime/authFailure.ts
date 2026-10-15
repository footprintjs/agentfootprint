/**
 * authFailure — an authentication or authorization failure is answered with
 * its type and status only, never the service's own message.
 *
 * ── Why ──────────────────────────────────────────────────────────────────────
 * Whatever an MCP answer's body says becomes the MCP client's error text, and a
 * failed tool call hands that text to the model, the conversation history in
 * the run's record, and the `tool_end` event. AWS answers a signature mismatch
 * with "The Canonical String for this request should have been …" — every
 * signed header with its value, the temporary credential's
 * `x-amz-security-token` and both session ids among them. An access-denied
 * message names the caller's role. None of that belongs in a model's context.
 *
 * So a 401, a 403, or an answer typed as one of the auth failures below keeps
 * its status and `x-amzn-errortype`, and its body becomes
 * `{ "message": "<type> (HTTP <status>) …" }`. The one body kept whole is the
 * hosted MCP server's own JSON-RPC error — the server's words, not the
 * platform's echo of the request.
 *
 * Pattern: pure helper. Role: outer ring, vendor fact.
 */

import { awsErrorType } from './errorType.js';

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

/** Is this answer an authentication or authorization failure? */
export function isAuthFailure(status: number, type: string | undefined): boolean {
  if (status === 401 || status === 403) return true;
  return type !== undefined && AUTH_FAILURE_TYPES.has(type);
}

/** The body an auth failure is answered with: what failed, never how. */
export function authFailureBody(status: number, type: string | undefined): string {
  const what = type ?? 'Request refused';
  return JSON.stringify({
    message:
      `${what} (HTTP ${status}). The service's own message is withheld: it can quote the ` +
      'signed request, credentials included. Check the caller’s credentials and its ' +
      'permission to invoke this runtime.',
  });
}

/**
 * Is this parsed body ONE JSON-RPC reply carrying an error object — the hosted
 * server's own answer, which is delivered whole?
 */
export function isJsonRpcError(body: unknown): boolean {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false;
  const error = (body as { readonly error?: unknown }).error;
  return error !== null && typeof error === 'object';
}

/**
 * A fetched answer, with an auth failure's message withheld (see the module
 * note). Every other answer is returned as it is, unread.
 */
export async function quietAuthFailure(response: Response): Promise<Response> {
  const type = awsErrorType(response.headers);
  if (!isAuthFailure(response.status, type)) return response;
  let text = '';
  try {
    text = await response.text();
  } catch {
    // An unreadable body is withheld like any other.
  }
  if (isJsonRpcError(parseJson(text))) {
    return new Response(text, { status: response.status, headers: answerHeaders(type) });
  }
  return new Response(authFailureBody(response.status, type), {
    status: response.status,
    headers: answerHeaders(type),
  });
}

/** The headers an auth failure keeps: a JSON body, and its error type. */
export function answerHeaders(type: string | undefined): Headers {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (type !== undefined) headers.set('x-amzn-errortype', type);
  return headers;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
