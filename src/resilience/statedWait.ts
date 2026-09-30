/**
 * statedWait — how long a failure SAID to wait before asking again.
 *
 * Pattern: pure reader (no I/O). Role: the ONE place the resilience layer
 * learns a server's stated wait.
 *
 * An error declares it; this module never parses prose or headers. The adapter
 * that knows its wire does that (a `Retry-After` header, a gateway's "Try again
 * in 4 seconds") and puts the answer on the error:
 *
 *   - `retryAfterMs` — the declared field, in milliseconds. Every adapter in
 *     this library that can learn a wait sets it.
 *   - `retryAfterSeconds` — read as a fallback, because errors built outside
 *     this library (and `InvokeModelGatewayError`'s header-only field, which
 *     predates `retryAfterMs`) carry the wait in seconds.
 *
 * A value that is not a finite, non-negative number is treated as absent, so a
 * garbled field degrades to the policy's own schedule rather than to a wrong
 * wait.
 */

/** The wait a failure stated, in ms — or `undefined` when it stated none. */
export function statedRetryAfterMs(err: unknown): number | undefined {
  if (err === null || typeof err !== 'object') return undefined;
  const e = err as { retryAfterMs?: unknown; retryAfterSeconds?: unknown };
  if (isWait(e.retryAfterMs)) return e.retryAfterMs;
  if (isWait(e.retryAfterSeconds)) return e.retryAfterSeconds * 1000;
  return undefined;
}

function isWait(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
