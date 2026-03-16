/**
 * withFallback — wraps a primary RunnerLike with a fallback.
 *
 * If the primary runner throws, the fallback runner is called instead.
 * Useful for degraded-mode patterns (e.g., expensive LLM → cheap LLM).
 *
 * Usage:
 *   const safe = withFallback(gpt4Agent, gpt35Agent);
 *   const result = await safe.run('Hello');
 */

import type { RunnerLike } from '../types/multiAgent';

export interface FallbackOptions {
  /** Optional predicate — use fallback only if this returns true for the error. */
  readonly shouldFallback?: (error: unknown) => boolean;
}

export function withFallback(
  primary: RunnerLike,
  fallback: RunnerLike,
  options: FallbackOptions = {},
): RunnerLike {
  const { shouldFallback = () => true } = options;

  return {
    run: async (message, runOptions) => {
      try {
        return await primary.run(message, runOptions);
      } catch (err) {
        if (!shouldFallback(err)) throw err;
        return fallback.run(message, runOptions);
      }
    },
    // Narrative/snapshot from whichever runner succeeded
    getNarrative: () => primary.getNarrative?.() ?? fallback.getNarrative?.() ?? [],
    getSnapshot: () => primary.getSnapshot?.() ?? fallback.getSnapshot?.(),
  };
}
