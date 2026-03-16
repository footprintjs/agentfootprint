/**
 * withRetry — wraps a RunnerLike with retry logic.
 *
 * On failure, retries up to maxRetries times with configurable backoff.
 * Respects AbortSignal for cancellation during wait periods.
 *
 * Usage:
 *   const reliable = withRetry(unreliableAgent, {
 *     maxRetries: 3,
 *     backoffMs: 1000,
 *     backoffMultiplier: 2,
 *   });
 *   const result = await reliable.run('Hello');
 */

import type { RunnerLike } from '../types/multiAgent';

export interface RetryOptions {
  /** Maximum number of retries after the initial attempt. Default: 3. */
  readonly maxRetries?: number;
  /** Initial backoff delay in milliseconds. Default: 0 (no delay). */
  readonly backoffMs?: number;
  /** Multiply backoff by this factor after each retry. Default: 1 (constant). */
  readonly backoffMultiplier?: number;
  /** Optional predicate — retry only if this returns true for the error. */
  readonly shouldRetry?: (error: unknown) => boolean;
}

export function withRetry(runner: RunnerLike, options: RetryOptions = {}): RunnerLike {
  const {
    maxRetries = 3,
    backoffMs = 0,
    backoffMultiplier = 1,
    shouldRetry = () => true,
  } = options;

  return {
    run: async (message, runOptions) => {
      let lastError: unknown;
      let delay = backoffMs;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await runner.run(message, runOptions);
        } catch (err) {
          lastError = err;

          if (attempt >= maxRetries || !shouldRetry(err)) {
            break;
          }

          if (delay > 0) {
            await sleep(delay, runOptions?.signal);
            delay *= backoffMultiplier;
          }
        }
      }

      throw lastError;
    },
    getNarrative: runner.getNarrative?.bind(runner),
    getSnapshot: runner.getSnapshot?.bind(runner),
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('Aborted'));
      },
      { once: true },
    );
  });
}
