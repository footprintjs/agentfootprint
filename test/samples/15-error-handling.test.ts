/**
 * Sample 15: Error Handling with LLMError + Compositions
 *
 * Shows how LLMError normalizes provider errors into a uniform
 * classification system, enabling compositions like withRetry
 * and withFallback to make smart retry decisions.
 *
 * Error codes: auth, rate_limit, context_length, invalid_request,
 *              server, timeout, aborted, network, unknown
 */
import { describe, it, expect } from 'vitest';
import { LLMError, wrapSDKError, classifyStatusCode } from '../../src/types/errors';
import { withRetry, withFallback } from '../../src/compositions';

describe('Sample 15: Error Handling', () => {
  // ── LLMError Classification ───────────────────────────────

  describe('error classification', () => {
    it('classifies HTTP status codes', () => {
      expect(classifyStatusCode(401)).toBe('auth');
      expect(classifyStatusCode(403)).toBe('auth');
      expect(classifyStatusCode(429)).toBe('rate_limit');
      expect(classifyStatusCode(400)).toBe('invalid_request');
      expect(classifyStatusCode(413)).toBe('context_length');
      expect(classifyStatusCode(422)).toBe('context_length');
      expect(classifyStatusCode(500)).toBe('server');
      expect(classifyStatusCode(503)).toBe('server');
    });

    it('marks retryable errors correctly', () => {
      const retryable = new LLMError({
        message: 'rate limited',
        code: 'rate_limit',
        provider: 'openai',
        statusCode: 429,
      });
      expect(retryable.retryable).toBe(true);

      const notRetryable = new LLMError({
        message: 'bad key',
        code: 'auth',
        provider: 'openai',
        statusCode: 401,
      });
      expect(notRetryable.retryable).toBe(false);
    });

    it('wraps unknown SDK errors into LLMError', () => {
      const sdkError = Object.assign(new Error('Too many requests'), { status: 429 });
      const wrapped = wrapSDKError(sdkError, 'anthropic');

      expect(wrapped).toBeInstanceOf(LLMError);
      expect(wrapped.code).toBe('rate_limit');
      expect(wrapped.provider).toBe('anthropic');
      expect(wrapped.statusCode).toBe(429);
      expect(wrapped.retryable).toBe(true);
      expect(wrapped.cause).toBe(sdkError);
    });

    it('detects abort errors', () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      const wrapped = wrapSDKError(abortError, 'openai');

      expect(wrapped.code).toBe('aborted');
      expect(wrapped.retryable).toBe(false);
    });

    it('detects network errors', () => {
      const netError = new Error('fetch failed: ECONNREFUSED');
      const wrapped = wrapSDKError(netError, 'anthropic');

      expect(wrapped.code).toBe('network');
      expect(wrapped.retryable).toBe(true);
    });

    it('detects timeout errors', () => {
      const timeoutError = new Error('Request timeout after 30000ms');
      const wrapped = wrapSDKError(timeoutError, 'openai');

      expect(wrapped.code).toBe('timeout');
      expect(wrapped.retryable).toBe(true);
    });

    it('passes through existing LLMError unchanged', () => {
      const original = new LLMError({
        message: 'already wrapped',
        code: 'auth',
        provider: 'openai',
      });
      const result = wrapSDKError(original, 'openai');
      expect(result).toBe(original); // Same reference
    });
  });

  // ── Compositions Use LLMError ─────────────────────────────

  describe('withRetry — retries on retryable errors', () => {
    // RunnerLike has .run(), not .chat() — create inline runners
    function failingRunner(errors: Error[], finalContent: string) {
      let callIndex = 0;
      return {
        run: async () => {
          if (callIndex < errors.length) {
            const err = errors[callIndex++];
            throw err;
          }
          return { content: finalContent };
        },
      };
    }

    it('retries rate_limit errors then succeeds', async () => {
      const runner = failingRunner(
        [
          new LLMError({ message: 'rate limited', code: 'rate_limit', provider: 'openai' }),
          new LLMError({ message: 'rate limited again', code: 'rate_limit', provider: 'openai' }),
        ],
        'Success on attempt 3',
      );

      const resilient = withRetry(runner, { maxRetries: 3, backoffMs: 0 });
      const result = await resilient.run('Hello');

      expect(result.content).toBe('Success on attempt 3');
    });

    it('does NOT retry auth errors (with shouldRetry predicate)', async () => {
      const runner = failingRunner(
        [new LLMError({ message: 'invalid api key', code: 'auth', provider: 'openai' })],
        'never reached',
      );

      const resilient = withRetry(runner, {
        maxRetries: 3,
        backoffMs: 0,
        shouldRetry: (err) => err instanceof LLMError && err.retryable,
      });

      await expect(resilient.run('Hello')).rejects.toThrow('invalid api key');
    });
  });

  describe('withFallback — falls back on error', () => {
    it('falls back to secondary provider', async () => {
      const primary = {
        run: async () => {
          throw new LLMError({ message: 'server error', code: 'server', provider: 'anthropic' });
        },
      };

      const secondary = {
        run: async () => ({ content: 'Fallback response from OpenAI' }),
      };

      const resilient = withFallback(primary, secondary);
      const result = await resilient.run('Hello');

      expect(result.content).toBe('Fallback response from OpenAI');
    });
  });
});
