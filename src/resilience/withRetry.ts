/**
 * withRetry — provider decorator that retries failed calls.
 *
 * Pattern: Decorator (GoF) — wraps an `LLMProvider` and adds retry
 *          policy without changing its interface.
 * Role:    Outer ring (Hexagonal). Composable: `withRetry(withFallback(...))`.
 *
 * Retries `complete()` on transient failures with exponential backoff.
 * `stream()` is delegated as-is — once tokens start flowing the
 * pipeline is stateful and cannot safely be restarted. If you need
 * retry semantics for streaming, fall back to `complete()` or
 * implement custom resumability at the consumer.
 *
 * Default policy:
 *   • maxAttempts: 3 (initial + 2 retries)
 *   • backoff:     exponential — 200ms, 400ms, 800ms
 *   • shouldRetry: rejects 4xx-class errors (client mistakes don't
 *                  benefit from retry) and AbortError; retries 5xx,
 *                  network errors, and unknown shapes.
 */

import type {
  LLMCallHooks,
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from '../adapters/types.js';

export interface WithRetryOptions {
  /** Total attempts including the first. Default 3. Must be >= 1. */
  readonly maxAttempts?: number;
  /** Initial delay in ms before the first retry. Default 200. */
  readonly initialDelayMs?: number;
  /** Multiplier between attempts. Default 2 (200ms → 400ms → 800ms). */
  readonly backoffFactor?: number;
  /** Maximum delay cap in ms. Default 10_000. */
  readonly maxDelayMs?: number;
  /**
   * Predicate to decide whether an error is worth retrying. Default
   * skips AbortError + HTTP 4xx; retries everything else. Override
   * to add provider-specific signals (e.g., 429 with Retry-After).
   */
  readonly shouldRetry?: (error: unknown, attempt: number) => boolean;
  /**
   * Hook invoked before each retry. Useful for logging in standalone
   * (non-agentfootprint) use. Receives the attempt number that's about
   * to start (so attempt 2 = first retry).
   *
   * You do NOT need this to get retry telemetry inside a run: since v7.8
   * the in-run LLM call sites hand this decorator an `LLMCallHooks` and
   * translate its reports into `agentfootprint.error.retried` /
   * `agentfootprint.error.recovered` events, stamped with the real
   * `runId`/`runtimeStageId`. This hook is the consumer-owned escape
   * hatch and its contract is unchanged.
   */
  readonly onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Wrap a provider so its `complete()` retries transient failures.
 *
 * @example
 *   import { withRetry } from 'agentfootprint/resilience';
 *   import { anthropic } from 'agentfootprint/llm-providers';
 *
 *   const robust = withRetry(anthropic({ apiKey }), {
 *     maxAttempts: 5,
 *     onRetry: (err, attempt, ms) => console.warn(`retry ${attempt} in ${ms}ms`, err),
 *   });
 */
export function withRetry(provider: LLMProvider, options: WithRetryOptions = {}): LLMProvider {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const initialDelayMs = options.initialDelayMs ?? 200;
  const backoffFactor = options.backoffFactor ?? 2;
  const maxDelayMs = options.maxDelayMs ?? 10_000;
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  const onRetry = options.onRetry;

  const wrapped: LLMProvider = {
    name: `${provider.name}+retry`,
    // A retry calls the SAME wire, so it carries exactly what that wire
    // carries. Forwarded rather than inherited: this object is rebuilt from
    // scratch, and a dropped capability silently narrows to the
    // user/assistant floor — a wrapped OpenAI provider would start refusing
    // system-role delivery it can perfectly well do.
    ...(provider.carriesInMessages !== undefined && {
      carriesInMessages: provider.carriesInMessages,
    }),
    // Same wire, same forced-choice answer. Dropping this one degrades to
    // "not declared", which is a REFUSAL — a wrapped Anthropic provider would
    // start refusing `strategy: 'tool-forced'` it can perfectly well do.
    ...(provider.carriesForcedToolChoice !== undefined && {
      carriesForcedToolChoice: provider.carriesForcedToolChoice,
    }),
    async complete(req: LLMRequest, hooks?: LLMCallHooks): Promise<LLMResponse> {
      let lastError: unknown;
      // t0 for the `recovered` report's totalDurationMs. New
      // instrumentation (the decorator did not measure this before v7.8),
      // not a recovered fact.
      const startedMs = Date.now();
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const res = await provider.complete(req, hooks);
          // Only a success that FOLLOWED a failure is a recovery — a
          // first-try success reports nothing (mirrors the rules loop's
          // guard in reliabilityExecution.ts).
          if (attempt > 1) {
            hooks?.onResilience?.({
              kind: 'recovered',
              attempt,
              totalDurationMs: Date.now() - startedMs,
            });
          }
          return res;
        } catch (err) {
          lastError = err;
          if (attempt >= maxAttempts || !shouldRetry(err, attempt)) {
            throw err;
          }
          const delay = Math.min(maxDelayMs, initialDelayMs * Math.pow(backoffFactor, attempt - 1));
          onRetry?.(err, attempt + 1, delay);
          hooks?.onResilience?.({
            kind: 'retried',
            attempt: attempt + 1,
            maxAttempts,
            lastError: err instanceof Error ? err.message : String(err),
            backoffMs: delay,
            reason: classifyRetryReason(err),
          });
          await sleep(delay, req.signal);
        }
      }
      // Unreachable — last attempt either returned or threw above.
      throw lastError;
    },
  };

  // Pass-through `stream()` if the underlying provider supports it.
  // No retry on streams (mid-stream resumption is provider-specific).
  // `hooks` must still be FORWARDED: a stacked inner decorator (e.g.
  // withRetry(withFallback(...))) would otherwise go dark on the stream
  // path.
  if (provider.stream) {
    wrapped.stream = (req: LLMRequest, hooks?: LLMCallHooks): AsyncIterable<LLMChunk> =>
      // Guarded by `if (provider.stream)` above; assertion safe.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      provider.stream!(req, hooks);
  }

  return wrapped;
}

/**
 * Classify the ERROR that caused a retry, for `ResilienceReport.reason`.
 *
 * Reads exactly the fields `defaultShouldRetry` inspects, so the label
 * always describes the same signal the default policy acted on. Note this
 * is a classification of the error, NOT of the predicate's reasoning —
 * `shouldRetry` returns a bare boolean, so a custom predicate's rationale
 * is unknowable here. `'http-4xx'` is only reachable via a custom
 * predicate (the default rejects non-429 4xx), which itself is a useful
 * signal.
 */
function classifyRetryReason(err: unknown): string {
  const status =
    (err as { status?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
  if (typeof status !== 'number') return 'no-status';
  if (status === 429) return 'http-429';
  if (status >= 500) return 'http-5xx';
  if (status >= 400) return 'http-4xx';
  return `http-${status}`;
}

// ── Defaults ────────────────────────────────────────────────────────

/**
 * Skip retry for AbortError + 4xx-class errors. Retry on everything
 * else (network errors, 5xx, unknown shapes). Provider adapters that
 * surface HTTP status should set `error.status` for this to work; the
 * predicate falls back to retrying when status is unknown (better to
 * retry once than to surface a flaky failure).
 *
 * Exported (module-level, NOT on the resilience barrel) as the single
 * source of truth for the decorators' transience policy — shared by
 * `withCredentialRetry` (identity) so "what counts as transient" never
 * drifts between the LLM and credential retry wrappers.
 */
export function defaultShouldRetry(err: unknown, _attempt: number): boolean {
  if (isAbortError(err)) return false;
  const status =
    (err as { status?: number; statusCode?: number })?.status ??
    (err as { statusCode?: number })?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    // 429 Too Many Requests is the one 4xx that benefits from retry.
    return status === 429;
  }
  return true;
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: string };
  return e.name === 'AbortError' || e.code === 'ABORT_ERR';
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Aborted'));
      return;
    }
    const id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(id);
      reject(signal?.reason ?? new Error('Aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
