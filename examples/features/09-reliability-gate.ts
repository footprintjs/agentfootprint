/**
 * 09 — Reliability gate (v2.11.5): rules-based retry / fallback / fail-fast
 * around every LLM call inside an Agent's ReAct loop.
 *
 * Where 08 covers the v2.10.x reliability *primitives* (`withCircuitBreaker`,
 * `.outputFallback`, `agent.resumeOnError`), this example covers the
 * v2.11.5 reliability *gate* — declarative rules wrapping every CallLLM
 * inside the agent's loop:
 *
 *   PreCheck rules    → continue / fail-fast
 *     ↓
 *   provider call     → response or error
 *     ↓
 *   PostDecide rules  → ok / retry / retry-other / fallback / fail-fast
 *
 * Three scenarios run:
 *
 *   1. Happy path    — reliability configured, first call succeeds.
 *                      Agent returns final answer; no rule fires fail-fast.
 *
 *   2. Retry path    — provider throws a transient 5xx once; postDecide's
 *                      `retry` rule fires; second attempt succeeds.
 *
 *   3. Fail-fast     — provider throws; postDecide's `fail-fast` rule
 *                      fires; `agent.run()` throws ReliabilityFailFastError.
 *                      Caller branches on `e.kind` and `e.payload.phase`.
 *
 * Run:  npx tsx examples/features/09-reliability-gate.ts
 */

import { Agent } from '../../src/index.js';
import { ReliabilityFailFastError } from '../../src/reliability/types.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../src/adapters/types.js';

// ─── Test providers ──────────────────────────────────────────────

/** Always succeeds. */
function okProvider(reply: string): LLMProvider {
  return {
    name: 'mock',
    complete: async (): Promise<LLMResponse> => ({
      content: reply,
      toolCalls: [],
      usage: { input: 1, output: 1 },
      stopReason: 'end_turn',
    }),
  };
}

/** Throws `failTimes` times then succeeds. Useful for retry scenarios. */
function flakyProvider(opts: {
  failTimes: number;
  error: Error;
  successReply: string;
}): { provider: LLMProvider; getCalls: () => number } {
  let calls = 0;
  const provider: LLMProvider = {
    name: 'flaky',
    complete: async (_req: LLMRequest): Promise<LLMResponse> => {
      calls += 1;
      if (calls <= opts.failTimes) throw opts.error;
      return {
        content: opts.successReply,
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'end_turn',
      };
    },
  };
  return { provider, getCalls: () => calls };
}

/** Always throws. Useful for fail-fast scenarios. */
function alwaysThrowsProvider(error: Error): LLMProvider {
  return {
    name: 'broken',
    complete: async (): Promise<LLMResponse> => {
      throw error;
    },
  };
}

// ─── Scenario 1: happy path — rules configured, first call succeeds ─

async function happyPath(): Promise<{ result: string }> {
  const agent = Agent.create({ provider: okProvider('all good'), model: 'mock' })
    .system('You echo.')
    .reliability({
      postDecide: [
        // Rule: any error → fail-fast. Doesn't fire here because the
        // call succeeds; the agent returns the LLM's response.
        {
          when: (s) => s.error !== undefined,
          then: 'fail-fast',
          kind: 'unrecoverable',
        },
      ],
    })
    .build();
  const result = (await agent.run({ message: 'hi' })) as string;
  return { result };
}

// ─── Scenario 2: retry — first call fails transient 5xx, second succeeds ─

async function retryPath(): Promise<{ result: string; providerCalls: number }> {
  const transient = new Error('Service Unavailable');
  (transient as Error & { status?: number }).status = 503;
  const flaky = flakyProvider({
    failTimes: 1,
    error: transient,
    successReply: 'recovered',
  });

  const agent = Agent.create({ provider: flaky.provider, model: 'mock' })
    .system('You echo.')
    .reliability({
      postDecide: [
        // Retry up to 3 attempts on 5xx. After that, fail-fast on
        // subsequent errors.
        {
          when: (s) => s.errorKind === '5xx-transient' && s.attempt < 3,
          then: 'retry',
          kind: 'transient-retry',
          label: 'transient 5xx, retrying',
        },
        {
          when: (s) => s.error !== undefined,
          then: 'fail-fast',
          kind: 'unrecoverable',
        },
      ],
    })
    .build();

  const result = (await agent.run({ message: 'go' })) as string;
  return { result, providerCalls: flaky.getCalls() };
}

// ─── Scenario 3: fail-fast — error → typed ReliabilityFailFastError ─

async function failFastPath(): Promise<{
  thrown: boolean;
  kind?: string;
  reason?: string;
  phase?: string;
}> {
  const fatal = new Error('schema violation');
  const agent = Agent.create({ provider: alwaysThrowsProvider(fatal), model: 'mock' })
    .system('You echo.')
    .reliability({
      postDecide: [
        {
          when: (s) => s.error !== undefined,
          then: 'fail-fast',
          kind: 'unrecoverable',
          label: 'unrecoverable error from provider',
        },
      ],
    })
    .build();

  try {
    await agent.run({ message: 'go' });
    return { thrown: false };
  } catch (e) {
    if (e instanceof ReliabilityFailFastError) {
      return {
        thrown: true,
        kind: e.kind,
        reason: e.reason,
        phase: e.payload?.phase,
      };
    }
    throw e;
  }
}

// ─── Entry point ──────────────────────────────────────────────────

export async function run(): Promise<{
  happy: { result: string };
  retry: { result: string; providerCalls: number };
  failFast: { thrown: boolean; kind?: string; reason?: string; phase?: string };
}> {
  const happy = await happyPath();
  const retry = await retryPath();
  const failFast = await failFastPath();
  return { happy, retry, failFast };
}

// Run as a script: regression-guard the example so the CI integration
// test catches drift if the API changes.
if (import.meta.url === `file://${process.argv[1]}`) {
  run()
    .then((out) => {
      console.log('=== reliability gate scenarios ===');
      console.log('happy:    ', out.happy);
      console.log('retry:    ', out.retry);
      console.log('failFast: ', out.failFast);

      // Sanity: each scenario engaged as designed.
      if (out.happy.result !== 'all good') {
        console.error('happy path: unexpected result');
        process.exit(1);
      }
      if (out.retry.providerCalls !== 2 || out.retry.result !== 'recovered') {
        console.error('retry path: unexpected calls/result');
        process.exit(1);
      }
      if (
        !out.failFast.thrown ||
        out.failFast.kind !== 'unrecoverable' ||
        out.failFast.phase !== 'post-decide'
      ) {
        console.error('fail-fast: did not engage as designed');
        process.exit(1);
      }
      console.log('OK');
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
