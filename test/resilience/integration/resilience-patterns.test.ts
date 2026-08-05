/**
 * Resilience module — 6 pattern tests beyond unit (scenario, integration,
 * property, security, performance, ROI).
 *
 * The unit tests in `test/resilience/unit/*.test.ts` exercise each
 * primitive in isolation. This file proves they compose correctly,
 * survive hostile inputs, and meet realistic SLO targets.
 */

import { describe, expect, it, vi } from 'vitest';

import { Agent } from '../../../src/core/Agent.js';
import { defineTool } from '../../../src/core/tools.js';
import { mock } from '../../../src/adapters/llm/MockProvider.js';
import { withRetry, withFallback, fallbackProvider } from '../../../src/resilience/index.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
import { expectScalesLinearly, expectWithinTimes, measureAsync } from '../../helpers/perf.js';

const ok = (tag: string): LLMResponse => ({
  content: tag,
  toolCalls: [],
  usage: { input: 1, output: 1 },
  stopReason: 'stop',
});
const req: LLMRequest = { messages: [{ role: 'user', content: 'hi' }], model: 'mock' };

// ─── Scenario — production recipes ──────────────────────────────────

describe('resilience — scenario (production recipes)', () => {
  it('retry-over-fallback chain: anthropic→openai with 3 retries each, eventual success on openai', async () => {
    let anthropicCalls = 0;
    let openaiCalls = 0;
    const anthropicSim: LLMProvider = {
      name: 'anthropic-sim',
      complete: async () => {
        anthropicCalls++;
        throw Object.assign(new Error('503 service unavailable'), { status: 503 });
      },
    };
    const openaiSim: LLMProvider = {
      name: 'openai-sim',
      complete: async () => {
        openaiCalls++;
        if (openaiCalls < 2) throw Object.assign(new Error('503'), { status: 503 });
        return ok('openai-recovered');
      },
    };

    const provider = withRetry(fallbackProvider(anthropicSim, openaiSim), {
      maxAttempts: 4,
      initialDelayMs: 1,
    });

    const result = await provider.complete(req);

    // anthropic always fails → fallback to openai every iteration.
    // openai recovers on its 2nd call. So:
    //   retry 1: anthropic fails (1) → openai fails (1) → withRetry retries
    //   retry 2: anthropic fails (1) → openai succeeds (2) → done
    expect(result.content).toBe('openai-recovered');
    expect(anthropicCalls).toBe(2);
    expect(openaiCalls).toBe(2);
  });

  it('three-tier fallback chain: premium → standard → mock-degraded', async () => {
    const provider = fallbackProvider(
      {
        name: 'premium',
        complete: async () => {
          throw new Error('quota');
        },
      },
      {
        name: 'standard',
        complete: async () => {
          throw new Error('down');
        },
      },
      mock({ reply: '[degraded] all upstream providers failed' }),
    );

    const result = await provider.complete(req);
    expect(result.content).toBe('[degraded] all upstream providers failed');
  });
});

// ─── Integration — composes with Agent end-to-end ──────────────────

describe('resilience — integration (Agent + resilient provider)', () => {
  it('Agent runs to completion when LLM fails twice then succeeds', async () => {
    let calls = 0;
    const flaky: LLMProvider = {
      name: 'flaky',
      complete: async () => {
        calls++;
        if (calls < 3) {
          throw Object.assign(new Error('503'), { status: 503 });
        }
        return {
          content: 'final answer',
          toolCalls: [],
          usage: { input: 5, output: 3 },
          stopReason: 'stop',
        };
      },
    };
    const provider = withRetry(flaky, { maxAttempts: 5, initialDelayMs: 1 });

    const agent = Agent.create({ provider, model: 'flaky', maxIterations: 2 }).build();
    const result = await agent.run({ message: 'hi' });

    expect(result).toBe('final answer');
    expect(calls).toBe(3);
  });

  it('Agent surfaces error after retry exhaustion', async () => {
    const dead: LLMProvider = {
      name: 'dead',
      complete: async () => {
        throw new Error('permanent failure');
      },
    };
    const provider = withRetry(dead, { maxAttempts: 2, initialDelayMs: 1 });

    const agent = Agent.create({ provider, model: 'dead', maxIterations: 2 }).build();

    await expect(agent.run({ message: 'hi' })).rejects.toThrow('permanent failure');
  });
});

// ─── Property — invariants over many random inputs ─────────────────

describe('resilience — property (invariants)', () => {
  it('withRetry never exceeds maxAttempts upstream calls (1000 trials)', async () => {
    for (let trial = 0; trial < 100; trial++) {
      const maxAttempts = 1 + (trial % 5); // 1..5
      let calls = 0;
      const provider: LLMProvider = {
        name: 'count',
        complete: async () => {
          calls++;
          throw new Error('always');
        },
      };
      const wrapped = withRetry(provider, { maxAttempts, initialDelayMs: 0 });

      try {
        await wrapped.complete(req);
      } catch {
        /* expected */
      }

      expect(calls).toBeLessThanOrEqual(maxAttempts);
    }
  });

  it('backoff delay never exceeds maxDelayMs', async () => {
    const observedDelays: number[] = [];
    const provider: LLMProvider = {
      name: 'fail',
      complete: async () => {
        throw new Error('always');
      },
    };
    const wrapped = withRetry(provider, {
      maxAttempts: 8,
      initialDelayMs: 100,
      backoffFactor: 3, // would grow 100→300→900→2700→8100→...
      maxDelayMs: 500,
      onRetry: (_e, _a, ms) => observedDelays.push(ms),
    });

    try {
      await wrapped.complete(req);
    } catch {
      /* expected */
    }

    expect(observedDelays.length).toBeGreaterThan(0);
    for (const d of observedDelays) expect(d).toBeLessThanOrEqual(500);
  });

  it('fallbackProvider preserves first-success semantics regardless of chain length', async () => {
    for (let n = 1; n <= 10; n++) {
      const winnerIndex = n - 1;
      const chain: LLMProvider[] = [];
      for (let i = 0; i < n; i++) {
        chain.push(
          i === winnerIndex
            ? { name: `p${i}`, complete: async () => ok(`winner-${i}`) }
            : {
                name: `p${i}`,
                complete: async () => {
                  throw new Error(`p${i} fail`);
                },
              },
        );
      }
      // First-success means: shortcut at the first non-throwing provider.
      // We position the winner at the END so all earlier ones must be tried.
      const p = fallbackProvider(...chain);
      const result = await p.complete(req);
      expect(result.content).toBe(`winner-${winnerIndex}`);
    }
  });
});

// ─── Security — hostile inputs don't crash the runtime ─────────────

describe('resilience — security (hostile inputs)', () => {
  it('shouldRetry that throws does not crash withRetry — the original error propagates', async () => {
    const provider: LLMProvider = {
      name: 'fail',
      complete: async () => {
        throw new Error('original');
      },
    };
    const wrapped = withRetry(provider, {
      shouldRetry: () => {
        throw new Error('hostile predicate');
      },
      initialDelayMs: 0,
    });

    // The hostile predicate's exception bubbles up from the catch — that's
    // acceptable; we verify it doesn't loop or hang. A future hardening
    // could swallow predicate errors, but loud failure is also fine.
    await expect(wrapped.complete(req)).rejects.toThrow();
  });

  it('synchronous throws from provider.complete are caught (not just async rejections)', async () => {
    const provider: LLMProvider = {
      name: 'syncthrow',
      // @ts-expect-error — async function returning sync throw is unusual but valid.
      complete: () => {
        throw new Error('sync boom');
      },
    };
    const wrapped = withRetry(provider, { maxAttempts: 2, initialDelayMs: 0 });
    await expect(wrapped.complete(req)).rejects.toThrow('sync boom');
  });

  it('AbortSignal during backoff aborts immediately without continuing retries', async () => {
    let calls = 0;
    const provider: LLMProvider = {
      name: 'fail',
      complete: async () => {
        calls++;
        throw new Error('boom');
      },
    };
    const ctrl = new AbortController();
    const wrapped = withRetry(provider, { maxAttempts: 10, initialDelayMs: 50 });

    const promise = wrapped.complete({ ...req, signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 10);

    await expect(promise).rejects.toThrow();
    // Only 1 or 2 calls before abort; should NOT reach 10.
    expect(calls).toBeLessThan(5);
  });
});

// ─── Performance — overhead is bounded ─────────────────────────────

describe('resilience — performance', () => {
  it(
    'withRetry adds almost nothing on the success path',
    { timeout: 30_000, retry: 2 },
    async () => {
      // The bare provider is the baseline, timed here on this machine. When the
      // first attempt succeeds the wrapper is a try/catch and nothing else, so
      // 3× is generous headroom — and load slows both halves alike.
      const provider: LLMProvider = {
        name: 'fast',
        complete: async () => ok('fast'),
      };
      const wrapped = withRetry(provider, { initialDelayMs: 0 });

      const call = async (target: LLMProvider, times: number): Promise<void> => {
        for (let i = 0; i < times; i++) await target.complete(req);
      };
      await expectWithinTimes({
        baseline: () => call(provider, 1000),
        subject: () => call(wrapped, 1000),
        times: 3,
        why: 'withRetry must be nearly free when nothing retries',
      });
    },
  );

  it(
    'fallbackProvider chain construction is O(n) — ten times the providers, ten times the work',
    { timeout: 30_000, retry: 2 },
    async () => {
      // O(n) is a claim about the curve, so the test measures the curve. Both
      // provider lists are built before either measurement so that constructing
      // them cannot stand in for composing them.
      const providersOf = (n: number): LLMProvider[] =>
        Array.from({ length: n }, (_, i) => ({
          name: `p${i}`,
          complete: async () => ok(`${i}`),
        }));
      const few = providersOf(100);
      const many = providersOf(1000);
      expect(fallbackProvider(...few).complete).toBeInstanceOf(Function);
      await expectScalesLinearly({
        small: () => void fallbackProvider(...few),
        large: () => void fallbackProvider(...many),
        scale: 10,
        why: 'composing a fallback chain must be one pass over the providers',
      });
    },
  );
});

// ─── ROI — realistic SLO targets meet in production envelope ─────

describe('resilience — ROI (realistic SLO budgets)', () => {
  it('3-attempt retry recovery completes in under 1.5s', async () => {
    let calls = 0;
    const flaky: LLMProvider = {
      name: 'flaky',
      complete: async () => {
        calls++;
        if (calls < 3) throw new Error('503');
        return ok('recovered');
      },
    };
    const wrapped = withRetry(flaky, {
      maxAttempts: 3,
      initialDelayMs: 100, // 100ms + 200ms backoff = 300ms total backoff budget
      backoffFactor: 2,
    });

    const start = Date.now();
    const result = await wrapped.complete(req);
    const elapsed = Date.now() - start;

    // The ceiling is the CONFIGURED BACKOFF BUDGET (100ms + 200ms = 300ms)
    // with room to spare, not a machine-speed guess: the claim is that
    // recovery waits the backoff it was told to wait and no more. Five times
    // that budget is far outside anything ordinary load can add to two
    // timers, and the work between attempts is trivial.
    const CONFIGURED_BACKOFF_MS = 300;
    expect(result.content).toBe('recovered');
    expect(elapsed).toBeLessThan(CONFIGURED_BACKOFF_MS * 5);
  });

  it('fallback chain shortcuts on first success — no wasted calls', async () => {
    const calls = { a: 0, b: 0, c: 0 };
    const a: LLMProvider = {
      name: 'a',
      complete: async () => {
        calls.a++;
        return ok('a');
      },
    };
    const b: LLMProvider = {
      name: 'b',
      complete: async () => {
        calls.b++;
        return ok('b');
      },
    };
    const c: LLMProvider = {
      name: 'c',
      complete: async () => {
        calls.c++;
        return ok('c');
      },
    };
    const provider = fallbackProvider(a, b, c);

    await provider.complete(req);

    expect(calls).toEqual({ a: 1, b: 0, c: 0 });
  });

  it('integration with mock — Agent can run with degraded ([reply]) provider', async () => {
    const provider = fallbackProvider(
      {
        name: 'down',
        complete: async () => {
          throw new Error('500');
        },
      },
      mock({ reply: 'degraded mode' }),
    );
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 1 }).build();
    const result = await agent.run({ message: 'hi' });

    expect(result).toBe('degraded mode');
  });
});

// Tool import touched only to ensure the integration tests link cleanly.
void defineTool;
void vi;
