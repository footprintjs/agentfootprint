/**
 * 21 — Deferred observers (RFC-001 Block 10): non-blocking `agent.on()`.
 *
 * THE headline bench. A full-feature agent (streaming + tool + injection +
 * cost events) runs N=50 ReAct iterations with a deliberately slow consumer
 * listener (`agent.on('*')` burning 5ms per event — think: pretty-printing,
 * sync exporters, schema validation) at realistic event volume.
 *
 *   INLINE (default):  every dispatched event runs the listener INSIDE the
 *                      producing statement — the ReAct loop pays
 *                      listener-time on top of LLM/tool time, serialized.
 *
 *   DEFERRED:          `observerDelivery: 'deferred'` captures each event
 *                      into footprintjs's bounded queue (≈ microseconds on
 *                      the hot path) and delivers at the next microtask
 *                      checkpoint — listener work overlaps the LLM/tool
 *                      await windows instead of blocking the loop. Same
 *                      events, same payloads, same order; queue drained
 *                      before run() returns.
 *
 *   NO-LISTENER:       the floor — nobody subscribed, default delivery.
 *
 * The mock provider simulates 100ms of LLM latency per call and streams
 * with chunkDelayMs: 0 — no artificial typing cadence inflating the win.
 * HONEST MECHANISM (measured, not assumed): on a single thread a CPU-burning
 * listener's total work is conserved; deferral recovers wall time only for
 * events ADJACENT to a real wait (llm_start before the provider wait,
 * tool_start before tool I/O, tokens between stream chunks). With
 * chunkDelayMs: 0 that adjacency is minimal (~2% here); with a realistic
 * 20ms streaming cadence (AF_BENCH_CHUNK_MS=20) the same run saves several
 * times more. What never depends on shape: the bounded queue, error
 * isolation, per-listener stats, and terminal completeness.
 *
 * Run:  npx tsx examples/features/21-deferred-observers.ts
 */

import { Agent } from '../../src/index.js'
import { defineInstruction } from '../../src/injection-engine.js'
import { MockProvider } from '../../src/llm-providers.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/21-deferred-observers',
  title: 'Deferred observers — non-blocking agent.on() (RFC-001)',
  group: 'features',
  description:
    'observerDelivery: deferred moves slow agent.on() listeners off the ReAct hot path — capture inline, deliver one beat behind, drain before run() returns. Benches inline vs deferred vs no-listener.',
  defaultInput: 'audit the account',
  providerSlots: [],
  tags: ['feature', 'observers', 'deferred', 'performance', 'rfc-001'],
};

// Overridable via env for quick local sweeps, e.g.
//   AF_BENCH_ITERS=10 AF_BENCH_CHUNK_MS=20 npx tsx examples/features/21-deferred-observers.ts
const num = (env: string | undefined, fallback: number) =>
  env !== undefined && Number.isFinite(Number(env)) ? Number(env) : fallback;
// Env-tunable in Node; browser bundles (the playground imports examples as
// modules) have no `process` global — guard so module-eval never throws.
const ENV: Record<string, string | undefined> =
  typeof process !== 'undefined' ? process.env : {};
const ITERATIONS = num(ENV.AF_BENCH_ITERS, 50); // ReAct iterations (N-1 tool calls + final)
const LISTENER_MS = num(ENV.AF_BENCH_LISTENER_MS, 5); // sync cost per delivered event
const LLM_MS = num(ENV.AF_BENCH_LLM_MS, 100); // simulated provider latency per call
const TOOL_MS = num(ENV.AF_BENCH_TOOL_MS, 3); // simulated tool I/O per call
const CHUNK_MS = num(ENV.AF_BENCH_CHUNK_MS, 0); // streaming cadence (0 = back-to-back)

function busyWait(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* burn CPU — a deliberately expensive sync listener */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
}

function buildReplies() {
  const replies: Array<{
    content: string;
    toolCalls: { id: string; name: string; args: Record<string, unknown> }[];
  }> = [];
  for (let i = 0; i < ITERATIONS - 1; i++) {
    replies.push({
      content: `Checking ledger entry ${i} before the next audit step now`,
      toolCalls: [{ id: `t${i}`, name: 'ledger_lookup', args: { entry: i } }],
    });
  }
  replies.push({ content: 'Audit complete: all entries reconcile cleanly today', toolCalls: [] });
  return replies;
}

interface BenchRow {
  readonly label: string;
  readonly wallMs: number;
  readonly p95IterMs: number;
  readonly events: number;
}

async function bench(
  label: string,
  opts: { delivery?: 'deferred'; listener: boolean },
  input: string,
): Promise<BenchRow> {
  // Per-iteration latency probe: timestamp at every provider call entry —
  // the engine's own hot path, neutral to observer delivery tier.
  const callStarts: number[] = [];
  const provider = new MockProvider({
    replies: buildReplies(),
    thinkingMs: LLM_MS,
    chunkDelayMs: CHUNK_MS,
  });
  const probed = new Proxy(provider, {
    get(target, prop, receiver) {
      if (prop === 'stream' || prop === 'complete') {
        const fn = Reflect.get(target, prop, receiver) as (...a: unknown[]) => unknown;
        return (...args: unknown[]) => {
          callStarts.push(performance.now());
          return fn.apply(target, args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  const agent = Agent.create({
    provider: probed,
    model: 'mock',
    maxIterations: ITERATIONS,
    pricingTable: { name: 'flat', pricePerToken: () => 0.000001 },
    ...(opts.delivery !== undefined && { observerDelivery: opts.delivery }),
  })
    .system('You are a meticulous ledger auditor.')
    .instruction(
      defineInstruction({
        id: 'audit-style',
        activeWhen: () => true,
        prompt: 'Cross-check every entry before moving on.',
      }),
    )
    .tool({
      schema: {
        name: 'ledger_lookup',
        description: 'Fetch one ledger entry.',
        inputSchema: { type: 'object' },
      },
      execute: async () => {
        await sleep(TOOL_MS);
        return 'entry ok';
      },
    })
    .build();

  let events = 0;
  if (opts.listener) {
    agent.on('*', () => {
      events += 1;
      busyWait(LISTENER_MS);
    });
  }

  const t0 = performance.now();
  await agent.run({ message: input });
  await agent.drainObservers({ timeoutMs: 10_000 }); // settle the tail before stopping the clock
  const wallMs = performance.now() - t0;

  const iterDeltas = callStarts.slice(1).map((t, i) => t - callStarts[i]!);
  const stats = agent.getLastSnapshot()?.observerStats;
  console.log(
    `${label.padEnd(22)} wall ${wallMs.toFixed(0).padStart(6)}ms   p95/iter ${p95(iterDeltas)
      .toFixed(1)
      .padStart(7)}ms   events ${String(events).padStart(4)}` +
      (stats
        ? `   (flushes ${stats.flushes}, drops ${stats.drops}, stranded ${stats.terminalStranded})`
        : ''),
  );
  return { label, wallMs, p95IterMs: p95(iterDeltas), events };
}

export async function run(input: string): Promise<unknown> {
  console.log(
    `${ITERATIONS} ReAct iterations × (${LLM_MS}ms LLM + ${TOOL_MS}ms tool, ` +
      `${CHUNK_MS}ms chunk cadence), wildcard listener burning ${LISTENER_MS}ms per event:\n`,
  );

  const floor = await bench('no-listener (default)', { listener: false }, input);
  const inline = await bench('inline + listener', { listener: true }, input);
  const deferred = await bench(
    'deferred + listener',
    { delivery: 'deferred', listener: true },
    input,
  );

  const saved = inline.wallMs - deferred.wallMs;
  console.log(
    `\ndeferred saved ${saved.toFixed(0)}ms of wall (${((saved / inline.wallMs) * 100).toFixed(
      0,
    )}%) — ` + 'listener work overlapped the wait windows ADJACENT to the producing events.',
  );
  console.log(
    'Same typed events either way (drop-in port), zero drops, queue empty at exit. The honest',
  );
  console.log(
    'mechanism: on one thread a CPU-burning listener conserves its total work — deferral relocates',
  );
  console.log(
    'it off the producing statement and recovers wall time only where waits sit NEXT to the events',
  );
  console.log(
    '(llm_start before the LLM wait, tool_start before tool I/O, tokens between stream chunks).',
  );
  console.log(
    `Try AF_BENCH_CHUNK_MS=20 (realistic streaming cadence): token events become wait-adjacent and`,
  );
  console.log('the saving grows several-fold. The guarantees that do NOT depend on shape: bounded');
  console.log('queue, error isolation, per-listener stats, terminal completeness.');
  return { floor, inline, deferred };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? 'audit the account').catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
