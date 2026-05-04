/**
 * classifyError — pure function mapping a thrown error to one of the
 * coarse `ReliabilityScope.errorKind` categories used by reliability rules.
 *
 * Centralized so rules read structured `errorKind` instead of doing
 * regex on `error.message` themselves. Add new categories ONLY when a
 * new rule needs to discriminate them — keep the taxonomy small.
 *
 * Categories:
 *   • 'ok'             — no error (caller should pass `undefined` or omit)
 *   • 'circuit-open'   — `CircuitOpenError` from the breaker layer
 *   • 'rate-limit'     — HTTP 429 or vendor rate-limit signal
 *   • '5xx-transient'  — HTTP 5xx, ETIMEDOUT, ECONNRESET, ECONNREFUSED
 *   • 'schema-fail'    — `OutputSchemaError` from the schema validator
 *   • 'unknown'        — anything else (default; still routable but
 *                        consumers usually `'fail-fast'` on this)
 */

import type { ReliabilityScope } from './types.js';

type ErrorKind = ReliabilityScope['errorKind'];

interface ErrorLike {
  readonly code?: string;
  readonly status?: number;
  readonly statusCode?: number;
  readonly message?: string;
  readonly name?: string;
}

/**
 * Classify an error into a `ReliabilityScope['errorKind']` category.
 *
 * @param err - The thrown value. May be an Error, a vendor SDK error
 *   shape with `.status`/`.code`, or anything else (`unknown` defaults).
 * @returns the matching coarse category string.
 */
export function classifyError(err: unknown): ErrorKind {
  if (err === undefined || err === null) return 'ok';

  const e = err as ErrorLike;

  // Circuit breaker tripped — most specific check first
  if (e.code === 'ERR_CIRCUIT_OPEN') return 'circuit-open';

  // Output schema validation failure — common after LLM produces
  // malformed JSON when an outputSchema is configured
  if (e.code === 'ERR_OUTPUT_SCHEMA') return 'schema-fail';

  // HTTP status discrimination (status OR statusCode — vendors differ)
  const status = e.status ?? e.statusCode;
  if (typeof status === 'number') {
    if (status === 429) return 'rate-limit';
    if (status >= 500 && status < 600) return '5xx-transient';
  }

  // String-based detection for transient network errors that don't
  // carry a status code (Node's net/dns error shapes)
  const msg = (e.message ?? '').toString();
  if (/(ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up)/i.test(msg)) {
    return '5xx-transient';
  }
  // Some vendor SDKs include "rate limit" in the message even when status
  // is null (e.g., on streaming pipelines that surface errors mid-stream)
  if (/rate.?limit|too many requests/i.test(msg)) return 'rate-limit';

  return 'unknown';
}
