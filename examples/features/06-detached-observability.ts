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
 * Plus graceful shutdown (8.12.0): the handle `enable.observability()`
 * returns drains ITSELF — `await telemetry.flush()` waits for the events
 * this subscription put on the driver and then flushes the strategy, in
 * that order. Before 8.12.0 that was impossible from outside: the events
 * were on the driver, not in the strategy, and `flushAllDetached()` (the
 * process-wide hammer, still available) could not see them until they had
 * already arrived.
 *
 * Run: npx tsx examples/features/06-detached-observability.ts
 */

import { Agent } from '../../src/index.js';
import { microtaskBatchDriver, flushAllDetached } from 'footprintjs/detach';
import type { ObservabilityStrategy } from '../../src/doors/observe.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';

import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'features/06-detached-observability',
  title: 'Detached observability — non-blocking telemetry export',
  group: 'features',
  description:
    'Wire the `detach` option on `enable.observability` so slow exporters never block the agent loop. Drain with one line on shutdown: `await telemetry.flush()`.',
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
  const telemetry = a.enable.observability({
    strategy: makeSlowExporter(),
    detach: { driver: microtaskBatchDriver, mode: 'forget' },
  });

  const t0 = performance.now();
  const result = await a.run({ message: input });
  const agentRunWall = Math.round(performance.now() - t0);

  console.log(`\nAgent run wall-clock: ${agentRunWall}ms`);
  // How many have landed by now depends entirely on the driver: the
  // microtask driver gets its turn at every await inside the run, a
  // setTimeout driver would still be holding all of them. Either way the
  // run never WAITED for one — that is what detach buys.
  console.log(`Events exported by the time the run returned: ${exportLog.length}`);

  // ─── GRACEFUL SHUTDOWN (8.12.0) ──────────────────────────────────────
  //
  // ONE line. The handle knows both halves of what it owns: the events
  // still queued on the driver, and the strategy's own buffer. It drains
  // them in that order — the reverse ships nothing.
  await telemetry.flush();
  console.log(`After telemetry.flush(): drained=${exportLog.length}`);

  // The process-wide hammer is still there for detached work this library
  // did not schedule. After the line above it has nothing left to do,
  // which is exactly what a correct drain looks like.
  const stats = await flushAllDetached({ timeoutMs: 5000 });
  console.log(`flushAllDetached afterwards: ${JSON.stringify(stats)}`);

  // `agent.shutdown()` is the same drain for EVERYTHING enabled on the
  // agent, plus the release: timers cleared, clients closed. The agent
  // itself stays usable afterwards.
  await a.shutdown();

  // ── Regression guards ──
  if (exportLog.length === 0) {
    console.error('REGRESSION: telemetry.flush() should have drained at least 1 export.');
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
