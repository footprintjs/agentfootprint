/**
 * Unit + Resilience tests for fallbackProvider — multi-provider failover.
 */

import { describe, it, expect, vi } from 'vitest';
import { fallbackProvider } from '../../src/adapters/fallbackProvider';
import type { LLMProvider, LLMResponse } from '../../src/types/llm';

// ── Helpers ──────────────────────────────────────────────────

function makeProvider(name: string, response?: Partial<LLMResponse>): LLMProvider {
  return {
    chat: async () => ({
      content: `response from ${name}`,
      model: name,
      finishReason: 'stop' as const,
      ...response,
    }),
  };
}

function makeFailingProvider(name: string, error: Error): LLMProvider {
  return {
    chat: async () => {
      throw error;
    },
  };
}

// ── Unit: basic fallback ─────────────────────────────────────

describe('fallbackProvider: basic behavior', () => {
  it('uses first provider when it succeeds', async () => {
    const provider = fallbackProvider([makeProvider('primary'), makeProvider('backup')]);

    const result = await provider.chat([]);

    expect(result.content).toBe('response from primary');
    expect(result.model).toBe('primary');
  });

  it('falls back to second when first fails', async () => {
    const provider = fallbackProvider([
      makeFailingProvider('primary', new Error('rate limited')),
      makeProvider('backup'),
    ]);

    const result = await provider.chat([]);

    expect(result.content).toBe('response from backup');
    expect(result.model).toBe('backup');
  });

  it('falls through multiple providers', async () => {
    const provider = fallbackProvider([
      makeFailingProvider('p1', new Error('down')),
      makeFailingProvider('p2', new Error('down')),
      makeProvider('p3'),
    ]);

    const result = await provider.chat([]);

    expect(result.content).toBe('response from p3');
  });

  it('throws last error when all providers fail', async () => {
    const provider = fallbackProvider([
      makeFailingProvider('p1', new Error('error-1')),
      makeFailingProvider('p2', new Error('error-2')),
    ]);

    await expect(provider.chat([])).rejects.toThrow('error-2');
  });

  it('requires at least one provider', () => {
    expect(() => fallbackProvider([])).toThrow('At least one provider');
  });

  it('single provider works without fallback', async () => {
    const provider = fallbackProvider([makeProvider('only')]);

    const result = await provider.chat([]);

    expect(result.model).toBe('only');
  });
});

// ── Unit: onFallback callback ────────────────────────────────

describe('fallbackProvider: onFallback callback', () => {
  it('fires onFallback when falling back', async () => {
    const fallbacks: Array<{ from: number; to: number; error: string }> = [];

    const provider = fallbackProvider(
      [makeFailingProvider('p1', new Error('err-1')), makeProvider('p2')],
      {
        onFallback: (from, to, err) => fallbacks.push({ from, to, error: (err as Error).message }),
      },
    );

    await provider.chat([]);

    expect(fallbacks).toEqual([{ from: 0, to: 1, error: 'err-1' }]);
  });

  it('fires onFallback for each transition', async () => {
    const fallbacks: number[] = [];

    const provider = fallbackProvider(
      [
        makeFailingProvider('p1', new Error('e1')),
        makeFailingProvider('p2', new Error('e2')),
        makeProvider('p3'),
      ],
      { onFallback: (from, to) => fallbacks.push(to) },
    );

    await provider.chat([]);

    expect(fallbacks).toEqual([1, 2]);
  });

  it('does not fire onFallback when primary succeeds', async () => {
    const onFallback = vi.fn();

    const provider = fallbackProvider([makeProvider('primary'), makeProvider('backup')], {
      onFallback,
    });

    await provider.chat([]);

    expect(onFallback).not.toHaveBeenCalled();
  });
});

// ── Unit: shouldFallback predicate ───────────────────────────

describe('fallbackProvider: shouldFallback predicate', () => {
  it('skips fallback when shouldFallback returns false', async () => {
    const provider = fallbackProvider(
      [makeFailingProvider('p1', new Error('auth error')), makeProvider('p2')],
      { shouldFallback: () => false },
    );

    // Should throw instead of falling back
    await expect(provider.chat([])).rejects.toThrow('auth error');
  });

  it('falls back only for specific error types', async () => {
    class RateLimitError extends Error {
      statusCode = 429;
    }
    class AuthError extends Error {
      statusCode = 401;
    }

    const provider = fallbackProvider(
      [
        makeFailingProvider('p1', new RateLimitError('rate limited')),
        makeProvider('p2'),
      ],
      {
        shouldFallback: (err) => err instanceof RateLimitError,
      },
    );

    // Rate limit → falls back
    const result = await provider.chat([]);
    expect(result.model).toBe('p2');

    // Auth error → does NOT fall back
    const provider2 = fallbackProvider(
      [
        makeFailingProvider('p1', new AuthError('unauthorized')),
        makeProvider('p2'),
      ],
      {
        shouldFallback: (err) => err instanceof RateLimitError,
      },
    );

    await expect(provider2.chat([])).rejects.toThrow('unauthorized');
  });
});

// ── Narrative integration ────────────────────────────────────

describe('fallbackProvider: narrative integration', () => {
  it('response.model reflects the provider that actually answered', async () => {
    // This is the key narrative integration: recorders capture model
    // via onLLMCall event, so the narrative shows which provider was used
    const provider = fallbackProvider([
      makeFailingProvider('claude-sonnet', new Error('rate limited')),
      makeProvider('gpt-4o'),
    ]);

    const result = await provider.chat([]);

    // The recorder will see model='gpt-4o' — knows fallback was used
    expect(result.model).toBe('gpt-4o');
  });

  it('onFallback fires during traversal (not post-processing)', async () => {
    const timeline: string[] = [];

    const provider = fallbackProvider(
      [
        {
          chat: async () => {
            timeline.push('primary-attempt');
            throw new Error('fail');
          },
        },
        {
          chat: async () => {
            timeline.push('backup-attempt');
            return { content: 'ok', model: 'backup', finishReason: 'stop' as const };
          },
        },
      ],
      {
        onFallback: () => timeline.push('fallback-event'),
      },
    );

    await provider.chat([]);

    // Events fire IN ORDER during traversal
    expect(timeline).toEqual(['primary-attempt', 'fallback-event', 'backup-attempt']);
  });
});

// ── Resilience: edge cases ───────────────────────────────────

describe('fallbackProvider: resilience edge cases', () => {
  it('passes messages and options through to each provider', async () => {
    const received: any[] = [];

    const spy: LLMProvider = {
      chat: async (msgs, opts) => {
        received.push({ msgs, opts });
        throw new Error('fail');
      },
    };

    const provider = fallbackProvider([spy, makeProvider('backup')]);
    const messages = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }];
    const options = { maxTokens: 100 };

    await provider.chat(messages, options);

    expect(received[0].msgs).toBe(messages);
    expect(received[0].opts).toBe(options);
  });

  it('handles chatStream fallback when provider lacks it', async () => {
    const p1: LLMProvider = { chat: async () => { throw new Error('fail'); } };
    const p2 = makeProvider('backup');

    const provider = fallbackProvider([p1, p2]);

    // Neither has chatStream, so provider shouldn't either
    expect(provider.chatStream).toBeUndefined();
  });
});
