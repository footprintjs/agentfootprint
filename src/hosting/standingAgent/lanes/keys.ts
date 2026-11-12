/**
 * The keys this composer invents live in a namespace no client string can
 * reach (recheck RB1 / N9). A session id is whatever a caller sent — `#` and
 * all — so every key built FROM one is prefixed `session:`, and every key the
 * host mints for a request with no session is spelled without that prefix. The
 * two spaces are disjoint by construction, not by what a wire happens to send.
 *
 *  - {@link laneKeyOf} — the pool key: `session:<id>`, or {@link ANONYMOUS_LANE}.
 *  - {@link latchKeyOf} — the concurrency latch: `session:<id>`, or
 *    `anonymous:<n>` (unique per request).
 */
const ANONYMOUS_LANE = 'anonymous';

export function laneKeyOf(sessionId: string | undefined): string {
  return sessionId === undefined ? ANONYMOUS_LANE : `session:${sessionId}`;
}
