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
import type { PromptCaching } from '../cache/types.js';
import type { ThinkingBlock, ThinkingHandler, ThinkingMode } from '../thinking/types.js';
import { DEFAULT_CARRIES_IN_MESSAGES } from '../adapters/types.js';
import { UnsupportedThinkingError } from '../thinking/errors.js';

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

/**
 * The prompt caching of a pair where either side may serve the call.
 *
 * A COST hint, not a meaning: the pair asks the agent for breakpoints when
 * EITHER side takes them (clamped to the smaller count when both do), and is
 * automatic when either side caches on its own. Each side is then handed only
 * what IT declares (`requestFor`) — a side that declared nothing never sees a
 * `cacheMarkers` field. Usage is reported when either side reports it — a
 * call the other side served then reads as *unmeasured*, never as a zero.
 */
function cachingOfPair(a: LLMProvider, b: LLMProvider): PromptCaching | undefined {
  const sides = [a.promptCaching, b.promptCaching].filter(
    (c): c is PromptCaching => c !== undefined,
  );
  if (sides.length === 0) return undefined;
  const reportsUsage = sides.some((c) => c.reportsUsage);
  const breakpoints = sides.flatMap((c) => (c.mode === 'breakpoints' ? [c.maxBreakpoints] : []));
  if (breakpoints.length > 0) {
    return Object.freeze({
      mode: 'breakpoints',
      maxBreakpoints: Math.min(...breakpoints),
      reportsUsage,
    });
  }
  return Object.freeze({ mode: 'automatic', reportsUsage });
}

/**
 * The request as ONE side can take it: markers only for a side that declares
 * breakpoints, sliced to its own count; stripped for any other side.
 */
function requestFor(side: LLMProvider, req: LLMRequest): LLMRequest {
  const markers = req.cacheMarkers;
  if (markers === undefined) return req;
  const caching = side.promptCaching;
  if (caching?.mode === 'breakpoints') {
    return markers.length <= caching.maxBreakpoints
      ? req
      : { ...req, cacheMarkers: markers.slice(0, caching.maxBreakpoints) };
  }
  const rest: LLMRequest = { ...req };
  delete (rest as { cacheMarkers?: unknown }).cacheMarkers;
  return rest;
}

type Side = 'primary' | 'fallback';

/** Raw thinking of a mixed pair, tagged with the side whose wire produced it. */
interface AnsweredThinking {
  readonly answeredBy: Side;
  readonly raw: unknown;
}

function isAnswered(raw: unknown): raw is AnsweredThinking {
  if (typeof raw !== 'object' || raw === null) return false;
  const by = (raw as { answeredBy?: unknown }).answeredBy;
  return (by === 'primary' || by === 'fallback') && 'raw' in raw;
}

/**
 * The thinking handler of a pair. The same handler on both sides is the
 * pair's. Different handlers (or one side with none) get a DISPATCHING
 * handler: the pair tags each response's `rawThinking` with the side that
 * answered (`AnsweredThinking`), and the handler runs that side's own — one
 * wire's handler on the other's thinking would mis-read it, and dropping
 * both lost the signed blocks the next call must echo.
 */
function thinkingOfPair(a: LLMProvider, b: LLMProvider): ThinkingHandler | undefined {
  const [ha, hb] = [a.thinkingHandler, b.thinkingHandler];
  if (ha === hb) return ha;
  return {
    id: `${ha?.id ?? 'none'}-or-${hb?.id ?? 'none'}`,
    normalize(raw: unknown): readonly ThinkingBlock[] {
      if (!isAnswered(raw)) {
        throw new TypeError(
          "withFallback: this thinking does not say which side answered, so neither side's " +
            'handler can read it',
        );
      }
      const handler = raw.answeredBy === 'primary' ? ha : hb;
      return handler === undefined ? [] : handler.normalize(raw.raw);
    },
  };
}

/** Least to most a pair can promise about a model's thinking. */
const THINKING_PROMISE: readonly ThinkingMode[] = ['none', 'adaptive', 'budget'];

/**
 * The thinking mode of a pair, per model: the LEAST either declared side
 * promises — `'none'` if either side's model cannot think (the agent refuses
 * `.thinking()` at build rather than fail on the call the fallback serves),
 * `'adaptive'` if either side would not send the budget, `'budget'` only when
 * both send it. An undeclared side makes no claim. The pair never maps the
 * wire itself: each side's adapter sends ITS model's shape for the same
 * `req.thinking`.
 */
function thinkingModeOfPair(
  a: LLMProvider,
  b: LLMProvider,
): ((model: string) => ThinkingMode) | undefined {
  const [ma, mb] = [a.thinkingMode, b.thinkingMode];
  if (ma === undefined || ma === mb) return mb ?? ma;
  if (mb === undefined) return ma;
  return (model) => {
    const [x, y] = [ma(model), mb(model)];
    // An answer that is not a mode is passed on, so the agent's check refuses
    // the malformed declaration instead of this pair hiding it.
    if (!THINKING_PROMISE.includes(x)) return x;
    if (!THINKING_PROMISE.includes(y)) return y;
    return THINKING_PROMISE.indexOf(x) <= THINKING_PROMISE.indexOf(y) ? x : y;
  };
}

export interface WithFallbackOptions {
  /**
   * Predicate to decide whether an error from the primary should
   * trigger fallback. Default: every error except an AbortError and an
   * `UnsupportedThinkingError` (a request the primary refused before sending).
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

  const promptCaching = cachingOfPair(primary, fallback);
  const thinkingHandler = thinkingOfPair(primary, fallback);
  const thinkingMode = thinkingModeOfPair(primary, fallback);
  const tagsThinking = primary.thinkingHandler !== fallback.thinkingHandler;
  /** A response as the pair returns it: thinking tagged when the sides differ. */
  const answered = (res: LLMResponse, side: Side): LLMResponse =>
    tagsThinking && res.rawThinking !== undefined
      ? { ...res, rawThinking: { answeredBy: side, raw: res.rawThinking } }
      : res;
  async function* answeredStream(chunks: AsyncIterable<LLMChunk>, side: Side) {
    for await (const chunk of chunks) {
      yield chunk.response === undefined
        ? chunk
        : { ...chunk, response: answered(chunk.response, side) };
    }
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
    // The combination, not the intersection — see `cachingOfPair`.
    ...(promptCaching !== undefined && { promptCaching }),
    // The side that answered decides which handler reads its thinking —
    // see `thinkingOfPair`.
    ...(thinkingHandler !== undefined && { thinkingHandler }),
    // The least either side promises for a model — see `thinkingModeOfPair`.
    ...(thinkingMode !== undefined && { thinkingMode }),
    async complete(req: LLMRequest, hooks?: LLMCallHooks): Promise<LLMResponse> {
      try {
        return answered(await primary.complete(requestFor(primary, req), hooks), 'primary');
      } catch (err) {
        if (!shouldFallback(err)) throw err;
        onFallback?.(err);
        reportFellBack(hooks, err);
        return answered(await fallback.complete(requestFor(fallback, req), hooks), 'fallback');
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
      const fallbackReq = requestFor(fallback, req);
      const fromFallback = (): AsyncIterable<LLMChunk> =>
        answeredStream(
          fallback.stream
            ? fallback.stream(fallbackReq, hooks)
            : completeAsStream(fallback, fallbackReq, hooks),
          'fallback',
        );
      if (!primary.stream) {
        yield* fromFallback();
        return;
      }
      let yieldedAny = false;
      try {
        for await (const chunk of answeredStream(
          primary.stream(requestFor(primary, req), hooks),
          'primary',
        )) {
          yieldedAny = true;
          yield chunk;
        }
      } catch (err) {
        if (yieldedAny || !shouldFallback(err)) throw err;
        onFallback?.(err);
        reportFellBack(hooks, err);
        yield* fromFallback();
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
  // A request the primary's adapter refused before sending is a wrong
  // REQUEST, not a failed vendor: it surfaces, rather than every call of the
  // run quietly moving to the other side.
  if (err instanceof UnsupportedThinkingError) return false;
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
