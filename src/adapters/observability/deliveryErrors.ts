/**
 * deliveryErrors — where an exporter's failures go when nobody is listening.
 *
 * **Telemetry that fails invisibly is indistinguishable from telemetry that
 * works.** Every network-shipping observability adapter has the same problem:
 * `exportEvent` is sync and non-throwing by contract, so the actual delivery
 * happens later, inside a flush the caller never sees. If that flush fails and
 * nothing is wired up, the process keeps running, the dashboard stays empty,
 * and nobody learns anything until someone goes looking for a run that isn't
 * there.
 *
 * Before 8.11.0 each adapter installed its console fallback lazily, INSIDE its
 * own `_onError` method — so a delivery failure, which read the hook rather
 * than calling the method, found `undefined` and vanished. Every CloudWatch,
 * X-Ray and OTEL delivery failure was silent in the ordinary case.
 *
 * The rule this module encodes: **an unheard failure still gets said out loud,
 * but saying it must not become the second outage.** A backend that has been
 * down for an hour would otherwise produce one `console.error` per flush
 * interval for an hour.
 *
 * Role: leaf helper for `adapters/observability/*`. No imports beyond the
 * event type; composed as a field, never inherited.
 */

import type { AgentfootprintEvent } from '../../events/registry.js';

/** What every adapter's `_onError` looks like. */
export type DeliveryErrorSink = (error: Error, event?: AgentfootprintEvent) => void;

/**
 * The default sink: loud on the first failure, then logarithmically quieter.
 *
 * Reports at failures 1, 2, 4, 8, 16, 32 … and stamps the running count, so an
 * ongoing outage is visible (you can see the number climbing) without flooding
 * the log. A consumer-supplied sink is NOT rate-limited — they asked for every
 * failure and can do their own filtering.
 *
 * @param strategyName the adapter's `name` (e.g. `'cloudwatch'`), used to
 *   prefix the line so a multi-exporter process says which one failed.
 */
export function rateLimitedConsoleSink(strategyName: string): DeliveryErrorSink {
  let failures = 0;
  let reportAt = 1;
  return (error: Error): void => {
    failures++;
    if (failures < reportAt) return;
    // Double the gap each time we speak, so the log cost is logarithmic in
    // the length of the outage.
    reportAt = failures * 2;
    const count = failures > 1 ? ` (delivery failure #${failures})` : '';
    // eslint-disable-next-line no-console
    console.error(`[${strategyName}Observability] delivery failed${count}:`, error.message);
  };
}
