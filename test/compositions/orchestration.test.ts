import { describe, it, expect, vi } from 'vitest';
import { withRetry, withFallback, withCircuitBreaker } from '../../src';
import type { RunnerLike } from '../../src';

// ── Helpers ─────────────────────────────────────────────────

function failingRunner(failTimes: number): RunnerLike & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    run: async () => {
      calls++;
      if (calls <= failTimes) throw new Error(`fail-${calls}`);
      return { content: `success on attempt ${calls}` };
    },
  };
}

function successRunner(content = 'ok'): RunnerLike {
  return { run: async () => ({ content }) };
}

function alwaysFailRunner(msg = 'always fails'): RunnerLike {
  return {
    run: async () => {
      throw new Error(msg);
    },
  };
}

// ── withRetry ───────────────────────────────────────────────

describe('withRetry', () => {
  it('succeeds on first attempt (no retries needed)', async () => {
    const runner = successRunner('hello');
    const reliable = withRetry(runner);
    const result = await reliable.run('test');
    expect(result.content).toBe('hello');
  });

  it('retries and succeeds after failures', async () => {
    const runner = failingRunner(2);
    const reliable = withRetry(runner, { maxRetries: 3 });
    const result = await reliable.run('test');
    expect(result.content).toBe('success on attempt 3');
    expect(runner.calls).toBe(3);
  });

  it('throws after max retries exceeded', async () => {
    const runner = alwaysFailRunner();
    const reliable = withRetry(runner, { maxRetries: 2, backoffMs: 0 });
    await expect(reliable.run('test')).rejects.toThrow('always fails');
  });

  it('respects shouldRetry predicate', async () => {
    const runner = failingRunner(5);
    const reliable = withRetry(runner, {
      maxRetries: 5,
      shouldRetry: (err) => (err as Error).message !== 'fail-1',
    });

    // First failure has message 'fail-1', shouldRetry returns false → no retry
    await expect(reliable.run('test')).rejects.toThrow('fail-1');
    expect(runner.calls).toBe(1);
  });

  it('applies backoff between retries', async () => {
    const runner = failingRunner(2);
    const start = Date.now();
    const reliable = withRetry(runner, {
      maxRetries: 3,
      backoffMs: 50,
      backoffMultiplier: 1,
    });

    await reliable.run('test');
    const elapsed = Date.now() - start;
    // 2 retries × 50ms = ~100ms minimum
    expect(elapsed).toBeGreaterThanOrEqual(80);
  });

  it('respects abort signal during backoff', async () => {
    const controller = new AbortController();
    const runner = alwaysFailRunner();
    const reliable = withRetry(runner, { maxRetries: 10, backoffMs: 10000 });

    const promise = reliable.run('test', { signal: controller.signal });
    // Abort after first failure + start of backoff
    setTimeout(() => controller.abort(), 50);
    await expect(promise).rejects.toThrow();
  });
});

// ── withFallback ────────────────────────────────────────────

describe('withFallback', () => {
  it('uses primary when it succeeds', async () => {
    const safe = withFallback(successRunner('primary'), successRunner('fallback'));
    const result = await safe.run('test');
    expect(result.content).toBe('primary');
  });

  it('uses fallback when primary fails', async () => {
    const safe = withFallback(alwaysFailRunner(), successRunner('fallback'));
    const result = await safe.run('test');
    expect(result.content).toBe('fallback');
  });

  it('throws when both fail', async () => {
    const safe = withFallback(
      alwaysFailRunner('primary-error'),
      alwaysFailRunner('fallback-error'),
    );
    await expect(safe.run('test')).rejects.toThrow('fallback-error');
  });

  it('respects shouldFallback predicate', async () => {
    const safe = withFallback(alwaysFailRunner('timeout'), successRunner('fallback'), {
      shouldFallback: (err) => (err as Error).message === 'rate-limited',
    });

    // Error is 'timeout', shouldFallback returns false → rethrow
    await expect(safe.run('test')).rejects.toThrow('timeout');
  });

  it('composes with withRetry', async () => {
    const runner = failingRunner(2);
    const retried = withRetry(runner, { maxRetries: 5, backoffMs: 0 });
    const safe = withFallback(retried, successRunner('fallback'));

    const result = await safe.run('test');
    expect(result.content).toBe('success on attempt 3');
  });
});

// ── withCircuitBreaker ──────────────────────────────────────

describe('withCircuitBreaker', () => {
  it('allows calls when circuit is closed', async () => {
    const wrapped = withCircuitBreaker(successRunner('ok'), { threshold: 3 });
    const result = await wrapped.run('test');
    expect(result.content).toBe('ok');
    expect(wrapped.breaker.getState()).toBe('closed');
  });

  it('opens after threshold failures', async () => {
    const wrapped = withCircuitBreaker(alwaysFailRunner(), {
      threshold: 3,
      resetAfterMs: 60000,
    });

    for (let i = 0; i < 3; i++) {
      await expect(wrapped.run('test')).rejects.toThrow();
    }

    expect(wrapped.breaker.getState()).toBe('open');
    // Next call should fast-fail
    await expect(wrapped.run('test')).rejects.toThrow('Circuit breaker is open');
  });

  it('resets to closed on success', async () => {
    const runner = failingRunner(2);
    const wrapped = withCircuitBreaker(runner, { threshold: 5 });

    // 2 failures
    await expect(wrapped.run('test')).rejects.toThrow();
    await expect(wrapped.run('test')).rejects.toThrow();

    // 3rd call succeeds → resets
    const result = await wrapped.run('test');
    expect(result.content).toContain('success');
    expect(wrapped.breaker.getState()).toBe('closed');
  });

  it('transitions to half-open after resetAfterMs', async () => {
    const wrapped = withCircuitBreaker(alwaysFailRunner(), {
      threshold: 1,
      resetAfterMs: 50,
    });

    await expect(wrapped.run('test')).rejects.toThrow();
    expect(wrapped.breaker.getState()).toBe('open');

    // Wait for reset period
    await new Promise((r) => setTimeout(r, 60));
    expect(wrapped.breaker.getState()).toBe('half_open');
  });

  it('manual reset works', async () => {
    const wrapped = withCircuitBreaker(alwaysFailRunner(), { threshold: 1 });

    await expect(wrapped.run('test')).rejects.toThrow();
    expect(wrapped.breaker.getState()).toBe('open');

    wrapped.breaker.reset();
    expect(wrapped.breaker.getState()).toBe('closed');
  });
});
