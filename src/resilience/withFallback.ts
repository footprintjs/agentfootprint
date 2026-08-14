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
 *
 * **Status: contract-shaped and tested — independently reproduced against a
 * local harness, 2026-08-13.** Somebody who is not this library's author called
 * a failed primary once and a healthy fallback once, with
 * `agentfootprint.fallback.triggered` on the typed stream; a stream that failed
 * BEFORE its first chunk moved to the fallback, and one that failed AFTER a
 * chunk did not — the stream-pinning law, measured rather than asserted, and
 * the reason no output was duplicated. Both providers were SCRIPTED doubles and
 * the run was deterministic and local (the trial's own words: it *"consumed no
 * GCP credit"*). **No failover between two live providers has been exercised
 * from this repository**, so this is not the field-validated rung.
 */

import type {
  LLMCallHooks,
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  WireRole,
} from '../adapters/types.js';
import { DEFAULT_CARRIES_IN_MESSAGES } from '../adapters/types.js';

/**
 * The message roles BOTH providers carry — the only honest capability for a
 * pair where either one may serve the call. An undeclared provider counts as
 * the user/assistant floor, so pairing with one clamps the result to it.
 */
function carriedByBoth(a: LLMProvider, b: LLMProvider): readonly WireRole[] {
  const left = a.carriesInMessages ?? DEFAULT_CARRIES_IN_MESSAGES;
  const right = new Set(b.carriesInMessages ?? DEFAULT_CARRIES_IN_MESSAGES);
  return Object.freeze(left.filter((role) => right.has(role)));
}

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
    // The INTERSECTION, and only the intersection. Either provider may serve
    // the call, so a role only ONE of them carries is a role the call might
    // drop — and a delivery that lands or vanishes depending on which side
    // answered is precisely the provider-dependent recording this capability
    // exists to prevent. Undeclared means the user/assistant floor on that
    // side, so an undeclared partner clamps the pair to the floor.
    carriesInMessages: carriedByBoth(primary, fallback),
    // AND, for the same reason the roles are an intersection: either side may
    // serve the call, so the pair constrains generation only if BOTH do. One
    // declared partner and one silent one is a pair whose answer is shaped
    // some of the time, which is the shape of guarantee nobody can use.
    carriesForcedToolChoice:
      (primary.carriesForcedToolChoice ?? false) && (fallback.carriesForcedToolChoice ?? false),
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
