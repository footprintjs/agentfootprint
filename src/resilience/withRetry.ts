/**
 * withRetry — provider decorator that retries failed calls.
 *
 * Pattern: Decorator (GoF) — wraps an `LLMProvider` and adds retry
 *          policy without changing its interface.
 * Role:    Outer ring (Hexagonal). Composable: `withRetry(withFallback(...))`.
 *
 * Retries `complete()` on transient failures with exponential backoff.
 * `stream()` is retried under the SAME policy, but only until its first
 * chunk arrives: a stream that fails before it has produced anything
 * (HTTP 429, a 5xx, a reset at connect) is exactly as safe to re-open as a
 * `complete()` is to re-send. Once the first chunk is in hand the stream is
 * committed — the rest is plain delegation with no retry anywhere around it
 * (`openStream` owns the only retry loop and returns WITH that chunk), so a
 * mid-stream failure surfaces exactly as it did before: re-sending would
 * replay tokens the caller has already shown.
 *
 * Default policy:
 *   • maxAttempts: 3 (initial + 2 retries)
 *   • backoff:     exponential — 200ms, 400ms, 800ms
 *   • shouldRetry: rejects 4xx-class errors (client mistakes don't
 *                  benefit from retry), AbortError, and any error that
 *                  declares `retryable: false`; retries 5xx, network
 *                  errors, and unknown shapes.
 *
 * **Status: contract-shaped and tested — independently reproduced against a
 * local harness, 2026-08-13.** Somebody who is not this library's author ran
 * the behaviour end to end and it held: this decorator absorbed two HTTP
 * 503-shaped failures and recovered on call three, with both
 * `agentfootprint.error.retried` and `agentfootprint.error.recovered` on the
 * typed stream, and it made exactly ONE streaming attempt — the limit as it
 * was then designed; a stream is now retried before its first chunk (see
 * above), still never after. What was exercised was a SCRIPTED failing provider — the trial's
 * own note is that those tests *"were local and deterministic, so they consumed
 * no GCP credit"*. **No live provider outage has been retried from this
 * repository**, so this is not the field-validated rung: a real 503 from a real
 * vendor, with a real Retry-After and real latency, remains unexercised.
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
   * skips AbortError, HTTP 4xx (except 429) and an error that declares
   * `retryable: false`; retries everything else. Override
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
 * Wrap a provider so its `complete()` — and its `stream()`, up to the first
 * chunk — retries transient failures.
 *
 * @example
 *   import { withRetry } from 'agentfootprint/resilience';
 *   import { anthropic } from 'agentfootprint/providers';
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
      // t0 for the `recovered` report's totalDurationMs. New
      // instrumentation (the decorator did not measure this before v7.8),
      // not a recovered fact.
      const startedMs = Date.now();
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await provider.complete(req, hooks);
          reportRecovered(hooks, attempt, startedMs);
          return res;
        } catch (err) {
          await backOffOrThrow(err, attempt, req, hooks);
        }
      }
    },
  };

  /**
   * The ONE retry decision both doors share: throw `err` when the budget is
   * spent or the policy says no; otherwise report the retry (consumer hook +
   * in-run hooks channel) and sleep the backoff, honouring `req.signal`.
   */
  async function backOffOrThrow(
    err: unknown,
    attempt: number,
    req: LLMRequest,
    hooks: LLMCallHooks | undefined,
  ): Promise<void> {
    if (attempt >= maxAttempts || !shouldRetry(err, attempt)) throw err;
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

  if (provider.stream) {
    // Guarded by `if (provider.stream)`; bound once so the closures below
    // need no assertion. `hooks` is FORWARDED on every attempt: a stacked
    // inner decorator (withRetry(withFallback(...))) would otherwise go dark
    // on the stream path.
    const innerStream = provider.stream.bind(provider);

    /**
     * Open the inner stream and wait for its FIRST step — the only span a
     * retry can cover. Returns with that step in hand, so by the time the
     * caller sees a chunk this loop has already been left for good.
     */
    const openStream = async (
      req: LLMRequest,
      hooks: LLMCallHooks | undefined,
    ): Promise<{ iterator: AsyncIterator<LLMChunk>; first: IteratorResult<LLMChunk> }> => {
      const startedMs = Date.now();
      for (let attempt = 1; ; attempt++) {
        try {
          const iterator = innerStream(req, hooks)[Symbol.asyncIterator]();
          const first = await iterator.next();
          // The stream got through: its first step arrived. Reported here —
          // not at the terminal chunk — because this is where retrying ends
          // (a consumer that stops reading at `done: true` would otherwise
          // never see it), and so `recovered` lands before the first token.
          reportRecovered(hooks, attempt, startedMs);
          return { iterator, first };
        } catch (err) {
          await backOffOrThrow(err, attempt, req, hooks);
        }
      }
    };

    wrapped.stream = async function* retryingStream(
      req: LLMRequest,
      hooks?: LLMCallHooks,
    ): AsyncGenerator<LLMChunk, void, undefined> {
      const { iterator, first } = await openStream(req, hooks);
      if (first.done === true) return;
      // From here on there is no catch: nothing below can start a retry.
      let delegated = false;
      try {
        yield first.value;
        delegated = true;
        // `yield*` forwards the consumer's return()/throw() to the inner
        // stream, exactly as the old pass-through did.
        yield* { [Symbol.asyncIterator]: () => iterator };
      } finally {
        // A consumer that stopped at the first chunk still closes the wire.
        if (!delegated) await iterator.return?.();
      }
    };
  }

  return wrapped;
}

/**
 * Report a recovery — only a success that FOLLOWED a failure is one; a
 * first-try success reports nothing (mirrors the rules loop's guard in
 * reliabilityExecution.ts).
 */
function reportRecovered(
  hooks: LLMCallHooks | undefined,
  attempt: number,
  startedMs: number,
): void {
  if (attempt === 1) return;
  hooks?.onResilience?.({
    kind: 'recovered',
    attempt,
    totalDurationMs: Date.now() - startedMs,
  });
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
 * Skip retry for AbortError, 4xx-class errors, and an error that declares
 * `retryable: false`. Retry on everything else (network errors, 5xx,
 * unknown shapes). Provider adapters that surface HTTP status should set
 * `error.status` for this to work; the predicate falls back to retrying
 * when status is unknown (better to retry once than to surface a flaky
 * failure).
 *
 * `retryable: false` is how an adapter says a failure with no HTTP status
 * cannot recover by asking again — a refusal raised before any request
 * (no key, no model), or a 2xx answer it could not read, where a re-send
 * may run and bill the model a second time. Only the literal `false` is
 * read: an error that does not declare the field is judged exactly as
 * before, and `retryable: true` does not override a 4xx status.
 *
 * Exported (module-level, NOT on the resilience barrel) as the single
 * source of truth for the decorators' transience policy — shared by
 * `withCredentialRetry` (identity) so "what counts as transient" never
 * drifts between the LLM and credential retry wrappers.
 */
export function defaultShouldRetry(err: unknown, _attempt: number): boolean {
  if (isAbortError(err)) return false;
  if ((err as { retryable?: unknown } | null)?.retryable === false) return false;
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
