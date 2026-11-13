/**
 * retrySchedule — a retry rule's own backoff schedule, built by footprintjs's
 * `exponentialBackoff`.
 *
 * Pattern: One pure builder. Returns `(attempt) => ms`.
 * Role:    The schedule `throttleRetry.ts` · `boundRule` hands to
 *          `statedWaitFirst`, which lets a server's `Retry-After` win over it.
 *
 * WHY THIS FILE EXISTS. Our options accept two values footprintjs's spec
 * refuses when the schedule is built, and each one already has a meaning here.
 * They are spelled in footprintjs's terms, with the same waits:
 *
 *   - `maxDelayMs: Infinity` — the `retryOnThrottle` default, "no cap on one
 *     wait". footprintjs takes a cap only as a finite number, so no cap is
 *     passed at all (its ceiling then saturates at `Number.MAX_SAFE_INTEGER`).
 *   - a cap below the base — `{ maxDelayMs: 50 }` under the 200 ms default
 *     base. Every ceiling is then the cap, so the schedule is a flat one AT the
 *     cap: `{ baseDelayMs: 50, multiplier: 1, maxDelayMs: 50 }`. Jitter is
 *     still drawn under it (25–50 ms with `'equal'`). footprintjs refuses a cap
 *     below the base because the exponential would never be reached.
 *
 * Every other rule is passed through as written. `test/mcp/retrySeries.test.ts`
 * pins the waits of both cases on the wire.
 */

import { exponentialBackoff, type BackoffFunction } from 'footprintjs';

/** The fields of a retry rule the schedule reads. */
export interface ScheduleRule {
  readonly baseDelayMs: number;
  readonly multiplier: number;
  readonly jitter: 'none' | 'equal' | 'full';
}

/** The rule's schedule under `maxDelayMs` (`Infinity` = no cap), built by footprintjs. */
export function scheduleOf(rule: ScheduleRule, maxDelayMs: number): BackoffFunction {
  const { baseDelayMs, multiplier, jitter } = rule;
  if (maxDelayMs === Infinity) return exponentialBackoff({ baseDelayMs, multiplier, jitter });
  if (maxDelayMs < baseDelayMs) {
    return exponentialBackoff({ baseDelayMs: maxDelayMs, multiplier: 1, jitter, maxDelayMs });
  }
  return exponentialBackoff({ baseDelayMs, multiplier, jitter, maxDelayMs });
}
