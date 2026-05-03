/**
 * 08 — Reliability subsystem: CircuitBreaker + outputFallback + resumeOnError.
 *
 * Demonstrates all 3 pieces of the v2.10.x Reliability subsystem
 * end-to-end. Each piece solves a distinct production failure mode:
 *
 *   1. **CircuitBreaker** — vendor outage detection. Wrap the LLM
 *      provider in `withCircuitBreaker(...)`. After N consecutive
 *      failures, the breaker OPENS and fails fast (sub-µs) so
 *      `withFallback` can route to the secondary provider without
 *      wasting 3 retries × backoff per request.
 *
 *   2. **outputFallback** — schema-validation failure. Pair with
 *      `.outputSchema(parser)`. When the LLM emits malformed JSON
 *      after maxIterations, fall through to the consumer's
 *      `fallback(err, raw)` function, then to the static `canned`
 *      safety net. Agent NEVER throws on output failure when canned
 *      is set.
 *
 *   3. **resumeOnError** — mid-run failure recovery. When LLM 503s
 *      mid-iteration, the agent throws `RunCheckpointError` carrying
 *      the conversation history at the last completed iteration.
 *      Persist the checkpoint to Redis/Postgres/S3, restart the
 *      process, call `agent.resumeOnError(checkpoint)` to continue
 *      from where it failed.
 *
 * Run:  npx tsx examples/features/08-reliability.ts
 */

import { z } from 'zod';
import { Agent, RunCheckpointError } from '../../src/index.js';
import {
  withCircuitBreaker,
  withFallback,
  CircuitOpenError,
} from '../../src/resilience/index.js';
import type { AgentRunCheckpoint } from '../../src/index.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../src/adapters/types.js';
import { mock } from '../../src/adapters/llm/MockProvider.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/08-reliability',
  title: 'Reliability — CircuitBreaker + outputFallback + resumeOnError',
  group: 'features',
  description:
    'End-to-end demo of the v2.10.x Reliability subsystem: vendor-outage circuit breaker, 3-tier output-schema degradation, and fault-tolerant mid-run resume from JSON-serializable checkpoint.',
  defaultInput: 'process refund #1234 for $50',
  providerSlots: ['feature'],
  tags: ['feature', 'reliability', 'circuit-breaker', 'output-fallback', 'resume-on-error'],
};

// ── Schema for the agent's structured output ─────────────────────────

const Refund = z.object({
  amount: z.number().nonnegative(),
  reason: z.string().min(1),
});
type RefundOutput = z.infer<typeof Refund>;

// ── Helper: provider that fails N times then recovers ────────────────

function flakyProvider(failuresBeforeRecovery: number, name = 'flaky'): LLMProvider {
  let calls = 0;
  return {
    name,
    async complete(_req: LLMRequest): Promise<LLMResponse> {
      calls += 1;
      if (calls <= failuresBeforeRecovery) {
        throw new Error(`vendor 503 (call ${calls})`);
      }
      // After recovery: emit valid JSON for the Refund schema.
      return mock({
        replies: [{ content: JSON.stringify({ amount: 50, reason: 'product defect' }) }],
      }).complete(_req);
    },
  };
}

// ── Three demonstrations ─────────────────────────────────────────────

async function demoCircuitBreaker(): Promise<{ primaryCalls: number; fallbackCalls: number }> {
  // Primary that fails forever, fallback that always succeeds.
  let primaryCalls = 0;
  const primary: LLMProvider = {
    name: 'primary',
    async complete(): Promise<LLMResponse> {
      primaryCalls += 1;
      throw new Error('vendor 503');
    },
  };
  let fallbackCalls = 0;
  const fallback: LLMProvider = {
    name: 'fallback',
    async complete(): Promise<LLMResponse> {
      fallbackCalls += 1;
      return mock({
        replies: [{ content: JSON.stringify({ amount: 0, reason: 'fallback path' }) }],
      }).complete({} as LLMRequest);
    },
  };

  // Wrap primary in a breaker; fallback handles any thrown error.
  const provider = withFallback(
    withCircuitBreaker(primary, { failureThreshold: 2, cooldownMs: 60_000 }),
    fallback,
  );

  const agent = Agent.create({ provider, model: 'mock' })
    .system('You answer refund questions.')
    .outputSchema(Refund)
    .build();

  // Run 5 turns. After 2 primary failures, breaker opens; remaining
  // 3 turns route directly to fallback (primary not called).
  for (let i = 0; i < 5; i++) {
    try {
      await agent.runTyped<RefundOutput>({ message: `query ${i}` });
    } catch {
      // Some early turns may surface CircuitOpenError if the order
      // happens to fire before fallback engages — that's fine.
    }
  }
  return { primaryCalls, fallbackCalls };
}

async function demoOutputFallback(): Promise<{
  result: RefundOutput;
  cannedFired: boolean;
}> {
  // LLM emits prose instead of JSON. With outputFallback, the agent
  // tier-2's into the consumer's fallback fn; if THAT fails, tier-3
  // returns the canned safety-net.
  const provider = mock({ replies: [{ content: 'Sorry, I cannot help with that.' }] });
  let cannedFired = false;

  const agent = Agent.create({ provider, model: 'mock' })
    .system('You decide refund amounts.')
    .outputSchema(Refund)
    .outputFallback({
      // Tier 2: try to recover; let's simulate it failing too.
      fallback: () => {
        throw new Error('fallback also failed (simulated)');
      },
      // Tier 3: guaranteed-valid safety net.
      canned: { amount: 0, reason: 'unable to process — please retry' },
    })
    .build();

  // The resilience event is consumer-side / informational — not in
  // the typed AgentfootprintEventMap. Cast to satisfy the typed
  // dispatcher without losing runtime behavior.
  agent.on('agentfootprint.resilience.output_canned_used' as never, () => {
    cannedFired = true;
  });

  // Caller never sees OutputSchemaError; gets a typed Refund either way.
  const result = await agent.runTyped<RefundOutput>({ message: 'refund please' });
  return { result, cannedFired };
}

async function demoResumeOnError(): Promise<{
  failedAt: string;
  resumeResult: string;
  serializedCheckpointBytes: number;
}> {
  // Provider that succeeds on call 1 (tool call), fails on call 2,
  // then succeeds on call 3 (after resume).
  let calls = 0;
  const provider: LLMProvider = {
    name: 'flaky-then-recovers',
    async complete(): Promise<LLMResponse> {
      calls += 1;
      if (calls === 1) {
        return {
          content: '',
          toolCalls: [{ id: 't1', name: 'lookup', args: { id: '1234' } }],
          usage: { input: 1, output: 1 },
          stopReason: 'tool_use',
        };
      }
      if (calls === 2) {
        throw new Error('transient vendor 503 (mid-iteration)');
      }
      return {
        content: 'refund processed: $50 for product defect',
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'end_turn',
      };
    },
  };

  const agent = Agent.create({ provider, model: 'mock' })
    .system('You process refunds.')
    .tool({
      schema: { name: 'lookup', description: '', inputSchema: { type: 'object' } },
      execute: () => 'order #1234 found',
    })
    .build();

  let captured: AgentRunCheckpoint | undefined;
  let failedAt = '';
  try {
    await agent.run({ message: meta.defaultInput ?? 'process refund' });
  } catch (err) {
    if (err instanceof RunCheckpointError) {
      captured = err.checkpoint;
      failedAt = `iteration ${err.checkpoint.failurePoint?.iteration} (${err.checkpoint.failurePoint?.phase})`;
    } else {
      throw err;
    }
  }
  if (!captured) throw new Error('expected checkpoint');

  // Persist the checkpoint anywhere — JSON-serializable, tiny payload.
  const serialized = JSON.stringify(captured);

  // hours / restart / next deploy later: resume from the checkpoint.
  const result = await agent.resumeOnError(captured);
  return {
    failedAt,
    resumeResult: typeof result === 'string' ? result : '(paused)',
    serializedCheckpointBytes: serialized.length,
  };
}

// ── Main runner ──────────────────────────────────────────────────────

export async function run(input: string): Promise<unknown> {
  void input;
  console.log('\n=== Reliability subsystem demo ===\n');

  console.log('1. CircuitBreaker — vendor outage detection');
  const cb = await demoCircuitBreaker();
  console.log(`   primary calls: ${cb.primaryCalls} (capped by breaker)`);
  console.log(`   fallback calls: ${cb.fallbackCalls} (took over after breaker opened)`);
  // Regression guard: breaker MUST cap primary calls
  if (cb.primaryCalls >= 5) {
    console.error('REGRESSION: breaker did not cap primary calls.');
    process.exit(1);
  }

  console.log('\n2. outputFallback — 3-tier degradation on schema failure');
  const of = await demoOutputFallback();
  console.log(`   result: ${JSON.stringify(of.result)}`);
  console.log(`   canned fired: ${of.cannedFired}`);
  // Regression guard: agent must NOT throw, must return canned shape
  if (of.result.amount !== 0 || !of.result.reason.includes('unable')) {
    console.error('REGRESSION: canned safety-net did not engage.');
    process.exit(1);
  }
  if (!of.cannedFired) {
    console.error('REGRESSION: output_canned_used event did not fire.');
    process.exit(1);
  }

  console.log('\n3. resumeOnError — mid-run failure recovery');
  const ro = await demoResumeOnError();
  console.log(`   failed at: ${ro.failedAt}`);
  console.log(`   checkpoint size: ${ro.serializedCheckpointBytes} bytes (JSON)`);
  console.log(`   resume result: ${ro.resumeResult.slice(0, 60)}…`);
  // Regression guard: resume must complete the run
  if (!ro.resumeResult.includes('refund processed')) {
    console.error('REGRESSION: resumeOnError did not complete the run.');
    process.exit(1);
  }
  if (ro.serializedCheckpointBytes < 50) {
    console.error('REGRESSION: checkpoint suspiciously small.');
    process.exit(1);
  }

  // Touch the unused import so it's clearly part of the example
  // surface even when not exercised in this code path (the
  // CircuitOpenError type is what `withCircuitBreaker` throws when
  // the breaker is OPEN; consumers can `instanceof` check it).
  void CircuitOpenError;

  console.log('\nOK — all 3 reliability primitives behaved as documented.');
  return { circuitBreaker: cb, outputFallback: of, resumeOnError: ro };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
