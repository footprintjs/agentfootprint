/**
 * Sample 22: Resilience — Runner Fallback & Retry
 *
 * withRetry retries a runner on transient errors.
 * withFallback tries runners in order until one succeeds.
 * withCircuitBreaker fast-fails after repeated failures.
 *
 * These wrap RunnerLike — so any concept (Agent, LLMCall, RAG) can be made resilient.
 */
import { describe, it, expect } from 'vitest';
import { LLMCall, mock, withRetry, withFallback, LLMError } from '../../src/test-barrel';

// ── Tests ────────────────────────────────────────────────────

describe('Sample 22: Resilience', () => {
  it('withFallback tries backup when primary fails', async () => {
    // Primary always throws
    const primary: any = {
      run: async () => {
        throw new LLMError({ message: 'Down', code: 'server', provider: 'test' });
      },
    };
    // Backup succeeds
    const backup = LLMCall.create({ provider: mock([{ content: 'Backup saved the day!' }]) })
      .system('Backup.')
      .build();

    const resilient = withFallback(primary, backup);
    const result = await resilient.run('hello');
    expect(result.content).toBe('Backup saved the day!');
  });

  it('withRetry retries on transient errors', async () => {
    let attempts = 0;
    const flaky: any = {
      run: async (msg: string) => {
        attempts++;
        if (attempts <= 2)
          throw new LLMError({ message: 'Retry', code: 'server', provider: 'test' });
        return { content: `Success on attempt ${attempts}` };
      },
    };

    const reliable = withRetry(flaky, { maxRetries: 3, backoffMs: 0 });
    const result = await reliable.run('hello');
    expect(result.content).toBe('Success on attempt 3');
  });

  it('stack: withRetry + withFallback = production pattern', async () => {
    let primaryAttempts = 0;
    const flakyPrimary: any = {
      run: async () => {
        primaryAttempts++;
        throw new LLMError({ message: 'Always fails', code: 'server', provider: 'test' });
      },
    };
    const backup = LLMCall.create({ provider: mock([{ content: 'Backup!' }]) })
      .system('Backup.')
      .build();

    // Retry primary 2x, then fall back to backup
    const production = withFallback(
      withRetry(flakyPrimary, { maxRetries: 2, backoffMs: 0 }),
      backup,
    );

    const result = await production.run('hello');
    expect(result.content).toBe('Backup!');
    expect(primaryAttempts).toBe(3); // original + 2 retries
  });
});
