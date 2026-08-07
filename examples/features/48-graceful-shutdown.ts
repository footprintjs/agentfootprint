/**
 * Graceful shutdown — the last batch is not lost
 *
 * Every exporter worth using BATCHES: it buffers events and ships them
 * when the batch is full or a timer fires. That is what makes it cheap,
 * and it is also what makes a process exit dangerous — whatever is in
 * the buffer when the process ends never happened, as far as your
 * dashboard is concerned.
 *
 * Through 8.11.x nothing in agentfootprint called `flush()`, and the
 * docs said so. Since 8.12.0 there are three doors, and this example
 * runs all three:
 *
 *   1. `telemetry.flush()`   — the handle `enable.observability()`
 *                              returns; drains just this subscription
 *   2. `agent.shutdown()`    — drains AND releases everything enabled
 *                              on the agent; the agent stays usable
 *   3. `flushOn: 'run-end'`  — opt-in per-run drain. It FIRES a flush
 *                              when a run ends; it never gates `run()`
 *
 * And one door deliberately left shut: `agent.run()` never flushes.
 * Telemetry must not become a term in run latency.
 *
 * Run: npx tsx examples/features/48-graceful-shutdown.ts
 */

import { Agent } from '../../src/index.js';
import type { ObservabilityStrategy } from '../../src/doors/observe.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';

import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'features/48-graceful-shutdown',
  title: 'Graceful shutdown — the last batch is not lost',
  group: 'features',
  description:
    'A batching exporter loses its buffer when a process exits. `telemetry.flush()`, `agent.shutdown()` and `flushOn: "run-end"` are the three doors that stop that happening.',
  defaultInput: 'What is 2 + 2?',
  providerSlots: ['feature'],
  tags: ['observability', 'shutdown', 'lifecycle'],
};

// ── A batching exporter, the way every real one works ────────────────
//
// Buffers on the hot path (sync, never blocks the loop), ships on
// flush(). `shipped` stands in for "arrived at the vendor".

interface BatchingExporter extends ObservabilityStrategy {
  readonly shipped: string[];
  bufferedCount(): number;
  flushCalls: number;
  stopped: boolean;
}

function batchingExporter(name: string): BatchingExporter {
  const buffer: AgentfootprintEvent[] = [];
  const shipped: string[] = [];
  return {
    name,
    capabilities: { events: true, logs: true },
    shipped,
    flushCalls: 0,
    stopped: false,
    bufferedCount: () => buffer.length,
    exportEvent(event: AgentfootprintEvent) {
      if (this.stopped) return;
      buffer.push(event);
    },
    async flush(): Promise<void> {
      this.flushCalls += 1;
      // A real one would await the network here.
      await Promise.resolve();
      shipped.push(...buffer.splice(0).map((event) => event.type));
    },
    stop(): void {
      this.stopped = true; // a real one also clears its timer here
    },
  } as BatchingExporter;
}

function buildAgent(): Agent {
  return Agent.create({ provider: exampleProvider('feature'), model: 'mock' })
    .system('You answer arithmetic questions in one short sentence.')
    .build();
}

export async function run(input: string): Promise<unknown> {
  // ─── 1. The handle drains itself ───────────────────────────────────
  //
  // `telemetry` IS the unsubscribe function it has always been. It now
  // also carries flush() and stop().
  const agent = buildAgent();
  const vendor = batchingExporter('vendor-a');
  const telemetry = agent.enable.observability({ strategy: vendor, tier: 'firehose' });

  await agent.run({ message: input });
  const bufferedAfterRun = vendor.bufferedCount();
  console.log(`After run(): ${bufferedAfterRun} events buffered, ${vendor.shipped.length} shipped`);
  console.log('  run() never flushes — telemetry is not a term in run latency.');

  await telemetry.flush();
  console.log(`After telemetry.flush(): ${vendor.shipped.length} shipped`);

  // Detaching is NOT stopping. This is the law that lets one exporter
  // instance be enabled, released and enabled again — an audit sink
  // collecting two runs into one record depends on it.
  telemetry();
  console.log(`After telemetry(): stopped=${vendor.stopped} (detach is not teardown)`);

  // ─── 2. agent.shutdown() — drain and release, in one call ──────────
  const second = batchingExporter('vendor-b');
  agent.enable.observability({ strategy: second, tier: 'firehose' });
  await agent.run({ message: 'And what is 3 + 3?' });

  await agent.shutdown();
  console.log(
    `After agent.shutdown(): ${second.shipped.length} shipped, stopped=${second.stopped}`,
  );

  // The agent survives its own shutdown — nothing about it was destroyed.
  const afterShutdown = await agent.run({ message: 'Still working?' });

  // ─── 3. flushOn: 'run-end' — for scripts that may vanish ───────────
  //
  // Fires a flush when a run ends. It does NOT gate run(): the drain
  // happens alongside, so a process that exits in the same breath can
  // still outrun it. The honest closer is still `await agent.shutdown()`.
  const scripted = buildAgent();
  const lambdaSink = batchingExporter('vendor-c');
  scripted.enable.observability({
    strategy: lambdaSink,
    tier: 'firehose',
    flushOn: 'run-end',
  });
  await scripted.run({ message: input });
  // Give the fired flush its turn (a real script would just exit — which
  // is exactly why this option shrinks the window rather than closing it).
  for (let i = 0; i < 20; i++) await Promise.resolve();
  console.log(
    `flushOn 'run-end': ${lambdaSink.flushCalls} flush(es) fired, ${lambdaSink.shipped.length} shipped`,
  );
  await scripted.shutdown();

  // ── Regression guards ──
  if (bufferedAfterRun === 0) {
    console.error('REGRESSION: run() flushed. It must not — that is the whole point.');
    process.exit(1);
  }
  if (vendor.shipped.length === 0) {
    console.error('REGRESSION: telemetry.flush() shipped nothing.');
    process.exit(1);
  }
  if (vendor.stopped) {
    console.error('REGRESSION: unsubscribing stopped the strategy. It must never.');
    process.exit(1);
  }
  if (second.shipped.length === 0 || !second.stopped) {
    console.error('REGRESSION: agent.shutdown() must drain AND release.');
    process.exit(1);
  }
  if (lambdaSink.shipped.length === 0) {
    console.error("REGRESSION: flushOn 'run-end' fired no flush.");
    process.exit(1);
  }

  console.log('OK — nothing buffered was lost, and nothing was stopped that was still in use.');

  return {
    bufferedAfterRun,
    shippedByHandleFlush: vendor.shipped.length,
    detachDidNotStop: !vendor.stopped,
    shippedByShutdown: second.shipped.length,
    releasedByShutdown: second.stopped,
    agentUsableAfterShutdown: typeof afterShutdown === 'string',
    shippedByRunEnd: lambdaSink.shipped.length,
  };
}

if (isCliEntry(import.meta.url)) {
  const input = process.argv[2] ?? meta.defaultInput ?? 'What is 2 + 2?';
  void run(input).then(printResult);
}
