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

import type {
  LLMCallHooks,
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from '../adapters/types.js';

export interface WithFallbackOptions {
  /**
   * Predicate to decide whether an error from the primary should
   * trigger fallback. Default: every error except AbortError.
   * Override to gate on specific status codes or error types.
   */
  readonly shouldFallback?: (error: unknown) => boolean;
  /**
   * Hook invoked when the primary fails and we're about to call the
   * fallback. Useful for logging in standalone (non-agentfootprint) use.
   *
   * You do NOT need this to get fallback telemetry inside a run: since
   * v7.8 the in-run LLM call sites hand this decorator an `LLMCallHooks`
   * and translate its reports into `agentfootprint.fallback.triggered`
   * events, stamped with the real `runId`/`runtimeStageId`. This hook is
   * the consumer-owned escape hatch and its contract is unchanged.
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

  /**
   * Report the ONE fact this decorator owns: the primary failed and the
   * fallback is being called instead. Uses the pairwise `primary`/
   * `fallback` names — never a composite chain name — so a
   * `fallbackProvider(a, b, c)` right-fold reports honest `a→b`, `b→c`
   * hops.
   */
  function reportFellBack(hooks: LLMCallHooks | undefined, err: unknown): void {
    hooks?.onResilience?.({
      kind: 'fell-back',
      primary: primary.name,
      fallback: fallback.name,
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  const wrapped: LLMProvider = {
    name: `${primary.name}|${fallback.name}`,
    async complete(req: LLMRequest, hooks?: LLMCallHooks): Promise<LLMResponse> {
      try {
        return await primary.complete(req, hooks);
      } catch (err) {
        if (!shouldFallback(err)) throw err;
        onFallback?.(err);
        reportFellBack(hooks, err);
        return fallback.complete(req, hooks);
      }
    },
  };

  // Stream fallback — only if the primary stream fails before any
  // chunk yields. Once a chunk is consumed downstream, restarting
  // would replay tokens. Yields from primary as long as it's working;
  // catches errors in the iteration setup or first chunk only.
  if (primary.stream || fallback.stream) {
    wrapped.stream = async function* fallbackStream(
      req: LLMRequest,
      hooks?: LLMCallHooks,
    ): AsyncIterable<LLMChunk> {
      // No primary stream support → fallback's stream (or its complete-only).
      // Reports NOTHING: nothing failed here, the primary simply has no
      // `stream()`. Calling this a fallback would be a lie.
      if (!primary.stream) {
        if (fallback.stream) yield* fallback.stream(req, hooks);
        else yield* completeAsStream(fallback, req, hooks);
        return;
      }
      let yieldedAny = false;
      try {
        for await (const chunk of primary.stream(req, hooks)) {
          yieldedAny = true;
          yield chunk;
        }
      } catch (err) {
        if (yieldedAny || !shouldFallback(err)) throw err;
        onFallback?.(err);
        reportFellBack(hooks, err);
        if (fallback.stream) yield* fallback.stream(req, hooks);
        else yield* completeAsStream(fallback, req, hooks);
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
async function* completeAsStream(
  provider: LLMProvider,
  req: LLMRequest,
  hooks?: LLMCallHooks,
): AsyncIterable<LLMChunk> {
  const response = await provider.complete(req, hooks);
  yield {
    tokenIndex: 0,
    content: '',
    done: true,
    response,
  };
}
