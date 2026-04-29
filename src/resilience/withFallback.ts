/**
 * withFallback — provider decorator that falls back to a secondary
 * on error.
 *
 * Pattern: Decorator (GoF) — composes two `LLMProvider`s into one.
 * Role:    Outer ring (Hexagonal). Stacks with `withRetry`:
 *          `withRetry(withFallback(primary, fallback))` first retries
 *          the primary, then on exhaustion falls back to the secondary.
 *
 * Common pairings:
 *   • Anthropic primary, OpenAI fallback (vendor outage tolerance)
 *   • Real provider primary, Mock fallback (degrade gracefully in dev)
 *   • Premium model primary, cheaper model fallback (cost ceiling)
 *
 * `stream()` falls back too — if the primary's stream errors before
 * yielding any chunks, we restart on the fallback. Once the primary
 * has yielded chunks the stream is committed — fallback would
 * duplicate the partial output.
 */

import type { LLMChunk, LLMProvider, LLMRequest, LLMResponse } from '../adapters/types.js';

export interface WithFallbackOptions {
  /**
   * Predicate to decide whether an error from the primary should
   * trigger fallback. Default: every error except AbortError.
   * Override to gate on specific status codes or error types.
   */
  readonly shouldFallback?: (error: unknown) => boolean;
  /**
   * Hook invoked when the primary fails and we're about to call the
   * fallback. Useful for emitting `agentfootprint.resilience.fallback`.
   */
  readonly onFallback?: (error: unknown) => void;
}

/**
 * Wrap a primary provider with a fallback. Tries primary first; on
 * error matching the policy, calls the fallback.
 *
 * @example
 *   const provider = withFallback(
 *     anthropic({ apiKey: A }),
 *     openai({ apiKey: O }),
 *     { onFallback: (err) => console.warn('primary failed, falling back:', err) },
 *   );
 */
export function withFallback(
  primary: LLMProvider,
  fallback: LLMProvider,
  options: WithFallbackOptions = {},
): LLMProvider {
  const shouldFallback = options.shouldFallback ?? defaultShouldFallback;
  const onFallback = options.onFallback;

  const wrapped: LLMProvider = {
    name: `${primary.name}|${fallback.name}`,
    async complete(req: LLMRequest): Promise<LLMResponse> {
      try {
        return await primary.complete(req);
      } catch (err) {
        if (!shouldFallback(err)) throw err;
        onFallback?.(err);
        return fallback.complete(req);
      }
    },
  };

  // Stream fallback — only if the primary stream fails before any
  // chunk yields. Once a chunk is consumed downstream, restarting
  // would replay tokens. Yields from primary as long as it's working;
  // catches errors in the iteration setup or first chunk only.
  if (primary.stream || fallback.stream) {
    wrapped.stream = async function* fallbackStream(req: LLMRequest): AsyncIterable<LLMChunk> {
      // No primary stream support → fallback's stream (or its complete-only).
      if (!primary.stream) {
        if (fallback.stream) yield* fallback.stream(req);
        else yield* completeAsStream(fallback, req);
        return;
      }
      let yieldedAny = false;
      try {
        for await (const chunk of primary.stream(req)) {
          yieldedAny = true;
          yield chunk;
        }
      } catch (err) {
        if (yieldedAny || !shouldFallback(err)) throw err;
        onFallback?.(err);
        if (fallback.stream) yield* fallback.stream(req);
        else yield* completeAsStream(fallback, req);
      }
    };
  }

  return wrapped;
}

// ── Defaults ────────────────────────────────────────────────────────

function defaultShouldFallback(err: unknown): boolean {
  if (!err || typeof err !== 'object') return true;
  const e = err as { name?: string; code?: string };
  if (e.name === 'AbortError' || e.code === 'ABORT_ERR') return false;
  return true;
}

/**
 * Synthesize a stream from a non-streaming provider's `complete()`
 * call: one terminal chunk carrying the whole response. Lets the
 * fallback chain still satisfy a `stream()` request even when the
 * fallback only implements `complete()`.
 */
async function* completeAsStream(provider: LLMProvider, req: LLMRequest): AsyncIterable<LLMChunk> {
  const response = await provider.complete(req);
  yield {
    tokenIndex: 0,
    content: '',
    done: true,
    response,
  };
}
