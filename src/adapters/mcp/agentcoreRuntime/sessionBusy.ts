/**
 * sessionBusy — the retry strategy: AgentCore Runtime's "session operation in
 * progress", recognised. One small function, on purpose.
 *
 * ── What the service says, in its own words ──────────────────────────────────
 * The AgentCore Runtime MCP protocol contract maps the runtime's exceptions onto
 * JSON-RPC errors, and exactly one of them is retryable by design:
 *
 *   -32005  RetryableConflictException  HTTP 200  "Session operation in progress, please retry"
 *
 * returned "when a second operation targets a session while the service is
 * provisioning or tearing down that session. Because MCP returns HTTP 200 with
 * the error in the JSON-RPC body, the caller must inspect the response body and
 * retry with short exponential backoff — MCP clients do not auto-retry it."
 *
 * So no status code says it, and the MCP SDK will not wait for it: left alone,
 * it reaches the model as a failed tool call, a moment after the session it was
 * waiting for came up.
 *
 * ── Why asking again is safe ─────────────────────────────────────────────────
 * The refusal is the PLATFORM's, about the session, made before the request
 * reached the MCP server: nothing ran. That is the license a 429 holds, and the
 * only one the retry series accepts (see `mcp/throttleRetry.ts` ·
 * `RetryDecision`).
 *
 * ── What it must NOT match ───────────────────────────────────────────────────
 * `ConflictException` shares the code -32005 ("Resource conflict - Resource
 * already exists") and is not retryable; the contract tells the two apart only
 * by the message, so the message is part of the match. Anything else — another
 * status, an SSE stream, a batch reply, a body that is not JSON — is delivered
 * as it is.
 *
 * ── The API-layer form ───────────────────────────────────────────────────────
 * `InvokeAgentRuntime`'s API reference gives the same exception as an HTTP 409,
 * its type in the `x-amzn-errortype` header (the REST protocol's error-type
 * header; the SigV4 strategy rebuilds exactly that from the SDK's exception,
 * because the transport's SDK client has its own retry off). It is the same
 * refusal, so it is the same decision — matched by the type, never by the 409
 * alone.
 *
 * Pattern: Strategy (a `RetryDecision`). Role: outer ring, vendor fact.
 */

import { bodyChunks } from '../../../lib/abort.js';
import type { RetryVerdict } from '../../../mcp/throttleRetry.js';
import { awsErrorType } from './errorType.js';

/** The JSON-RPC error code the contract gives `RetryableConflictException`. */
export const SESSION_BUSY_CODE = -32005;

/** The exception's name, as the API layer and the SDK both spell it. */
const SESSION_BUSY_TYPE = 'RetryableConflictException';

/**
 * How the contract's message reads. Matched case-insensitively and as a
 * fragment, so a trailing "please retry" reworded does not stop the match;
 * the code is still required, which is what keeps `ConflictException` out.
 */
const SESSION_BUSY_MESSAGE = /session operation in progress/i;

/**
 * Is this response AgentCore Runtime's session-busy refusal — in either form:
 * the MCP contract's HTTP 200 with JSON-RPC -32005, or the API's 409
 * `RetryableConflictException`?
 *
 * Reads a CLONE of the body, so the response is delivered intact either way.
 * Answers `{}` (wait the loop's own backoff, then send the same request again)
 * or `undefined` (deliver it).
 *
 * `signal` is the request's: when it fires mid-read (the call's deadline, the
 * caller's cancellation), the clone's read is cancelled and released, and this
 * rejects with the abort — a stalled body never leaves a reader behind.
 */
export async function sessionBusy(
  response: Response,
  signal?: AbortSignal,
): Promise<RetryVerdict | undefined> {
  if (response.status === 409) {
    return awsErrorType(response.headers) === SESSION_BUSY_TYPE ? {} : undefined;
  }
  if (response.status !== 200) return undefined;
  if (!isJson(response.headers.get('content-type'))) return undefined;
  let text: string;
  try {
    text = await cloneText(response, signal);
  } catch (error) {
    // A stopped request is the caller's word, never "not busy": pass it on.
    if (signal?.aborted) throw error;
    return undefined;
  }
  // A cheap gate before parsing: a large tool result does not contain the
  // code's digits often, and it is the common case.
  if (!text.includes(String(SESSION_BUSY_CODE))) return undefined;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return undefined;
  }
  return isSessionBusyReply(body) ? {} : undefined;
}

/**
 * The match itself, over a parsed body: ONE JSON-RPC reply whose error carries
 * the contract's code and message. A batch is never retried whole — some of
 * its replies may be the record of work that ran.
 */
export function isSessionBusyReply(body: unknown): boolean {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false;
  const error = (body as { readonly error?: unknown }).error;
  if (error === null || typeof error !== 'object') return false;
  const { code, message } = error as { readonly code?: unknown; readonly message?: unknown };
  return (
    code === SESSION_BUSY_CODE && typeof message === 'string' && SESSION_BUSY_MESSAGE.test(message)
  );
}

/**
 * The text of a clone of `response`'s body, read under `signal`: an abort
 * cancels the clone's reader and releases it (`lib/abort.ts` · `bodyChunks`).
 * Decoded as `Response.text()` decodes: UTF-8, a leading BOM dropped.
 */
async function cloneText(response: Response, signal: AbortSignal | undefined): Promise<string> {
  const body = response.clone().body;
  if (body === null) return '';
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of bodyChunks(body, signal)) {
    chunks.push(chunk);
    length += chunk.byteLength;
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** `application/json`, with or without parameters, in any case. */
function isJson(contentType: string | null): boolean {
  if (contentType === null) return false;
  const essence = contentType.split(';')[0]?.trim().toLowerCase();
  return essence === 'application/json';
}
