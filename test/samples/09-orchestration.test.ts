/**
 * Sample 09: Orchestration — Retry, Fallback, Circuit Breaker
 *
 * Wrap any runner with cross-cutting reliability concerns.
 * These compose naturally — stack as many as you need.
 *
 *   withRetry          → retry on failure with backoff
 *   withFallback       → use backup runner on failure
 *   withCircuitBreaker → fast-fail after repeated failures
 */
import { describe, it, expect } from 'vitest';
import { withRetry, withFallback, withCircuitBreaker } from '../../src/test-barrel';
import type { RunnerLike } from '../../src/test-barrel';

describe('Sample 09: Orchestration', () => {
  it('withRetry — retries a flaky runner', async () => {
    let calls = 0;
    const flakyRunner: RunnerLike = {
      run: async () => {
        calls++;
        if (calls < 3) throw new Error('temporary failure');
        return { content: 'finally worked' };
      },
    };

    const reliable = withRetry(flakyRunner, {
      maxRetries: 5,
      backoffMs: 0, // no delay in tests
    });

    const result = await reliable.run('test');
    expect(result.content).toBe('finally worked');
    expect(calls).toBe(3); // 2 failures + 1 success
  });

  it('withFallback — degrades gracefully', async () => {
    const expensive: RunnerLike = {
      run: async () => {
        throw new Error('GPT-4 rate limited');
      },
    };
    const cheap: RunnerLike = {
      run: async () => ({ content: 'GPT-3.5 response' }),
    };

    const resilient = withFallback(expensive, cheap);
    const result = await resilient.run('test');
    expect(result.content).toBe('GPT-3.5 response');
  });

  it('withCircuitBreaker — fast-fails after threshold', async () => {
    const broken: RunnerLike = {
      run: async () => {
        throw new Error('service down');
      },
    };

    const protected_ = withCircuitBreaker(broken, {
      threshold: 2,
      resetAfterMs: 60000,
    });

    // 2 failures → circuit opens
    await expect(protected_.run('a')).rejects.toThrow('service down');
    await expect(protected_.run('b')).rejects.toThrow('service down');

    // Now circuit is open → fast-fail (no call to runner)
    await expect(protected_.run('c')).rejects.toThrow('Circuit breaker is open');
    expect(protected_.breaker.getState()).toBe('open');
  });

  it('compositions stack: retry inside fallback', async () => {
    let primaryCalls = 0;
    const primary: RunnerLike = {
      run: async () => {
        primaryCalls++;
        if (primaryCalls <= 2) throw new Error('fail');
        return { content: 'primary ok' };
      },
    };

    const fallback: RunnerLike = {
      run: async () => ({ content: 'fallback ok' }),
    };

    // Try primary with 3 retries, fall back if all fail
    const composed = withFallback(withRetry(primary, { maxRetries: 3, backoffMs: 0 }), fallback);

    const result = await composed.run('test');
    // Primary succeeds on 3rd retry
    expect(result.content).toBe('primary ok');
  });

  it('selective retry — only retry certain errors', async () => {
    let calls = 0;
    const runner: RunnerLike = {
      run: async () => {
        calls++;
        if (calls === 1) throw new Error('rate_limited');
        if (calls === 2) throw new Error('invalid_input');
        return { content: 'ok' };
      },
    };

    const selective = withRetry(runner, {
      maxRetries: 5,
      backoffMs: 0,
      shouldRetry: (err) => (err as Error).message === 'rate_limited',
    });

    // First call: rate_limited → retried
    // Second call: invalid_input → NOT retried (shouldRetry returns false)
    await expect(selective.run('test')).rejects.toThrow('invalid_input');
    expect(calls).toBe(2);
  });
});
