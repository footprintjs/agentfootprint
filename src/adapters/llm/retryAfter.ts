/**
 * retryAfter — the wait a vendor's response headers state, for an adapter to
 * DECLARE on the error it raises (`retryAfterMs`).
 *
 * Pattern: pure reader (no I/O). Role: outer ring, below the adapters.
 *
 * `withRetry` never reads headers or prose — it reads the declared field
 * (resilience/statedWait.ts · statedRetryAfterMs). Each adapter knows its own
 * wire, so the reading happens here, once, for every adapter that can see
 * headers:
 *
 *   - `retry-after-ms` — milliseconds, sent by the Anthropic and OpenAI APIs
 *     (their own SDKs read it first too);
 *   - `retry-after` — the standard header, delta-seconds or an HTTP-date
 *     (lib/mcp/throttleRetry.ts · parseRetryAfter, the one parser of it).
 *
 * Headers arrive as a fetch `Headers` (anything with `get`) or a plain record
 * (older SDKs, the AWS SDK's `$response.headers`); both are read
 * case-insensitively. Anything unreadable is absent, never a guess.
 */

import { parseRetryAfter } from '../../lib/mcp/throttleRetry.js';

/** The stated wait in ms, or `undefined` when the headers state none. */
export function retryAfterMsFromHeaders(headers: unknown): number | undefined {
  const ms = headerValue(headers, 'retry-after-ms');
  if (ms !== undefined) {
    const value = Number(ms.trim());
    if (ms.trim() !== '' && Number.isFinite(value) && value >= 0) return value;
  }
  return parseRetryAfter(headerValue(headers, 'retry-after'));
}

/**
 * The same wait read off an SDK error: `err.headers` (Anthropic and OpenAI SDK
 * `APIError`) or `err.$response.headers` (AWS SDK v3 exceptions).
 */
export function retryAfterMsFromError(err: unknown): number | undefined {
  if (err === null || typeof err !== 'object') return undefined;
  const e = err as { headers?: unknown; $response?: { headers?: unknown } };
  return retryAfterMsFromHeaders(e.headers) ?? retryAfterMsFromHeaders(e.$response?.headers);
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (headers === null || typeof headers !== 'object') return undefined;
  const getter = (headers as { get?: unknown }).get;
  if (typeof getter === 'function') {
    const value = (getter as (n: string) => unknown).call(headers, name);
    return typeof value === 'string' ? value : undefined;
  }
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() === name && typeof value === 'string') return value;
  }
  return undefined;
}
