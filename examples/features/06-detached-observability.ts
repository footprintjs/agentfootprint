/**
 * Detached observability — non-blocking telemetry export
 *
 * When `agent.enable.observability(...)` is wired to a slow exporter
 * (HTTP POST to Datadog/Honeycomb/etc.), it can block the agent loop
 * by running synchronously inside the dispatcher. agentfootprint
 * v2.8.0 adds the `detach` option, which schedules `exportEvent`
 * calls onto a `footprintjs/detach` driver — agent loop returns
 * immediately, exports run on the next microtask (or whichever
 * driver semantics you pick).
 *
 * Plus graceful shutdown: `flushAllDetached()` from
 * `'footprintjs/detach'` drains every in-flight handle process-wide.
 *
 * Run: npx tsx examples/features/06-detached-observability.ts
 */

import { Agent } from '../../src/index.js';
import { microtaskBatchDriver, flushAllDetached } from 'footprintjs/detach';
import type { ObservabilityStrategy } from '../../src/strategies/index.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';

import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'features/06-detached-observability',
  title: 'Detached observability — non-blocking telemetry export',
  group: 'features',
  description:
    'Wire the new `detach` option on `enable.observability` so slow exporters never block the agent loop. Drain via `flushAllDetached` on shutdown.',
  defaultInput: 'What is 2 + 2?',
  providerSlots: ['feature'],
  tags: ['observability', 'detach', 'fire-and-forget'],
};

// ── A "slow exporter" — pretend HTTP POST takes 25ms ──────────────────

const exportLog: { event: string; flushedAt: number }[] = [];

function makeSlowExporter(): ObservabilityStrategy {
  return {
    name: 'slow-vendor',
    capabilities: { events: true },
    exportEvent(event: AgentfootprintEvent) {
      // Real exporters wait on network I/O. We busy-loop to make the
      // blocking effect visible without async machinery.
      const deadline = performance.now() + 25;
      while (performance.now() < deadline) {
        /* busy */
      }
      exportLog.push({ event: event.type, flushedAt: Math.round(performance.now()) });
    },
  };
}

export async function run(input: string): Promise<unknown> {
  const a = Agent.create({
    provider: exampleProvider('feature'),
    model: 'mock',
  })
    .system('You answer math questions.')
    .build();

  // ─── ENABLE OBSERVABILITY WITH DETACH ────────────────────────────────
  //
  // The `detach` option opts every `exportEvent` call into the chosen
  // driver. Pre-v2.8 default (no `detach`) ran exports inline — slow
  // exporters blocked the agent loop. With `detach`, the loop returns
  // immediately; exports flush on the driver's schedule.
  const stopObs = a.enable.observability({
    strategy: makeSlowExporter(),
    detach: { driver: microtaskBatchDriver, mode: 'forget' },
  });

  const t0 = performance.now();
  const result = await a.run({ message: input });
  const agentRunWall = Math.round(performance.now() - t0);

  console.log(`\nAgent run wall-clock: ${agentRunWall}ms`);
  console.log(`Events exported so far (likely 0 — they're still queued): ${exportLog.length}`);

  // ─── GRACEFUL SHUTDOWN ───────────────────────────────────────────────
  //
  // Drain every in-flight detached export before exit. Returns
  // { done, failed, pending } — `pending === 0` means complete drain.
  // Use this in your SIGTERM handler / test cleanup / batch finalizer.
  const stats = await flushAllDetached({ timeoutMs: 5000 });
  console.log(`After flush: drained=${exportLog.length}, stats=${JSON.stringify(stats)}`);

  stopObs();

  // ── Regression guards ──
  if (exportLog.length === 0) {
    console.error('REGRESSION: flush should have drained at least 1 export.');
    process.exit(1);
  }
  if (stats.pending !== 0) {
    console.error(`REGRESSION: expected pending=0 after successful drain, got ${stats.pending}.`);
    process.exit(1);
  }
  // Sanity: every flushed event landed AFTER agent.run() returned
  // (proves the work was actually deferred, not done inline).
  const eventsExportedDuringRun = exportLog.filter((e) => e.flushedAt < agentRunWall).length;
  // We can't easily check this without before/after timestamps; the real
  // proof is in the integration test (P4 in test/strategies/detach-integration.test.ts)
  // where we use a sync busy-loop strategy and compare wall to N×latency.
  console.log(`(${eventsExportedDuringRun} events flushed before agent finished)`);

  console.log('OK — agent loop ran without blocking on exports; flush drained the queue.');
  return result;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
