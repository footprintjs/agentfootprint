/**
 * throttleRetry — when an MCP server says "too many requests", wait and ask again.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Managed MCP gateways enforce per-principal rate limits. A throttled
 * `tools/call` is not a fault, it is the endpoint working as designed — and
 * before 8.11.0 it arrived at the model as a thrown tool error, which the model
 * reads as **"this tool is broken"**. It then apologises, picks a different
 * tool, or invents an answer. A designed, transient, self-clearing condition
 * was being turned into a wrong answer.
 *
 * ── Why retrying a 429 is safe, and why the policy is 429-ONLY ───────────────
 * **A 429 is a pre-execution rejection.** The rate limiter refused the request
 * at the edge; the server never ran the tool. Retrying therefore cannot
 * double-execute anything — which is exactly what is NOT true of a 500 or a
 * timeout, where the call may have half-run and a retry could charge a card
 * twice.
 *
 * That asymmetry is the whole license for this module, so the policy must never
 * widen. Only HTTP 429 retries here. Not 5xx, not network errors, not timeouts
 * — those belong to a caller who knows whether the specific tool is idempotent,
 * and this seam does not. A property test pins the boundary.
 *
 * ── Why it lives at the fetch seam and not around `Tool.execute` ─────────────
 * Because `Retry-After` is only reachable here. The MCP SDK reads the response,
 * throws `StreamableHTTPError(status, text)` and drops the `Response` — so by
 * the time a throttle reaches `Tool.execute` the header is gone and the status
 * survives only as `err.code`. A retry wrapper around the tool could guess a
 * backoff; only a wrapper around `fetch` can honour the number the server
 * actually asked for. Honouring it is also what keeps a fleet of agents from
 * synchronising into a thundering herd.
 *
 * ── Ordering: retry OUTSIDE, signing and vending INSIDE ──────────────────────
 * The wrapper composes over the caller's `fetch` (a SigV4/DPoP signer) or over
 * `createVendingFetch` (a per-request credential). Sitting outside means every
 * attempt is signed afresh and vended afresh — signatures expire, and a token
 * that would have died during the wait is simply never the one reused. The
 * gateway secrecy invariant is untouched: each attempt vends, applies, drops.
 *
 * Pattern: Decorator over `fetch`. Role: Layer-3 tool transport.
 */

/**
 * The fetch shape the MCP SDK's `fetch` hook uses — deliberately NARROWER
 * than `gatewayTransport`'s `FetchLike` (no `Request` input), because that is
 * exactly what `StreamableHTTPClientTransport` declares and what
 * `McpHttpTransport.fetch` promises a consumer. A wider `FetchLike` still
 * passes in: a function that accepts more inputs satisfies a contract that
 * supplies fewer.
 */
export type ThrottleFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

// ─── Public option shape ─────────────────────────────────────────────

/** Reported to {@link ThrottleRetryOptions.onRetry} before each wait. */
export interface ThrottleRetryInfo {
  /** The attempt about to START. `2` is the first retry. */
  readonly attempt: number;
  /** Ceiling in force for this call, including the first attempt. */
  readonly maxAttempts: number;
  /** How long we are about to wait, in milliseconds. */
  readonly waitMs: number;
  /** What the server's `Retry-After` asked for, when it sent one. Absent
   *  means the wait below is our own jittered backoff. */
  readonly retryAfterMs?: number;
  /** The endpoint being retried. Carries no credential: the URL is the URL
   *  the transport was built with, never a signed or tokenised variant. */
  readonly url: string;
}

/** Fine-tuning for {@link McpClientOptions.retryOnThrottle}. */
export interface ThrottleRetryOptions {
  /** Total attempts including the first. Default 3. Minimum 1. */
  readonly maxAttempts?: number;
  /**
   * Ceiling on the TOTAL time spent waiting across one call, in
   * milliseconds. Default 10000.
   *
   * This is the safety rail on `Retry-After`: a server (or a misconfigured
   * proxy) that asks for a 24-hour wait does not get one — when the next wait
   * would push past this ceiling we stop retrying and let the throttle
   * surface, so the worst case is a slower failure and never a hung agent.
   */
  readonly maxWaitMs?: number;
  /**
   * Called before each wait. The per-attempt visibility hook, matching the
   * contract `withRetry` and `withCredentialRetry` already use — a decorator
   * at a transport boundary reports to its consumer, and emits no events of
   * its own.
   *
   * A retried call is not invisible without this: the wait lands inside the
   * tool's `stream.tool_end` `durationMs`, and an exhausted retry still
   * reaches the model with `error: true`. This hook is what turns "that call
   * was slow" into "that call was throttled twice".
   */
  readonly onRetry?: (info: ThrottleRetryInfo) => void;
}

/**
 * How a throttled request is handled. `true` (the default) means bounded
 * retry with default settings; `false` disables it entirely.
 */
export type RetryOnThrottle = boolean | ThrottleRetryOptions;

// ─── Defaults ────────────────────────────────────────────────────────

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_WAIT_MS = 10_000;
/** First backoff when the server sent no `Retry-After`. */
const BASE_BACKOFF_MS = 200;

interface ResolvedThrottleConfig {
  readonly maxAttempts: number;
  readonly maxWaitMs: number;
  readonly onRetry?: (info: ThrottleRetryInfo) => void;
}

/** `undefined` means "do not retry" — the caller then leaves `fetch` alone. */
function resolveConfig(config: RetryOnThrottle | undefined): ResolvedThrottleConfig | undefined {
  if (config === false) return undefined;
  const opts: ThrottleRetryOptions = config === true || config === undefined ? {} : config;
  return {
    maxAttempts: Math.max(1, opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
    maxWaitMs: Math.max(0, opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS),
    ...(opts.onRetry && { onRetry: opts.onRetry }),
  };
}

// ─── The decorator ───────────────────────────────────────────────────

/**
 * Wrap a `fetch` so HTTP 429 responses are retried, honouring `Retry-After`.
 *
 * Returns `inner` untouched when retry is disabled — including `undefined`,
 * so a transport that passed no custom fetch keeps passing none and its
 * behaviour is byte-identical to before this existed.
 *
 * @param inner the fetch to wrap. `undefined` means the global `fetch`,
 *   resolved at CALL time so a later polyfill still wins.
 * @internal
 */
export function retryingFetch(
  inner: ThrottleFetch | undefined,
  config: RetryOnThrottle | undefined,
): ThrottleFetch | undefined {
  const resolved = resolveConfig(config);
  if (!resolved) return inner;

  const base: ThrottleFetch = inner ?? ((input, init) => globalThis.fetch(input, init));

  return async (input, init) => {
    let totalWaited = 0;

    for (let attempt = 1; ; attempt++) {
      const response = await base(input, init);
      if (response.status !== 429) return response;
      if (attempt >= resolved.maxAttempts) return response;
      // A body we cannot send twice makes a retry a different request. Rare
      // for MCP (JSON strings), but silently replaying half a stream would be
      // worse than surfacing the throttle.
      if (!isReplayable(input, init)) return response;
      if (init?.signal?.aborted) return response;

      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
      const waitMs = retryAfterMs ?? backoffMs(attempt);
      // The rail on Retry-After: never let a server talk us into a wait that
      // breaks the caller's budget.
      if (totalWaited + waitMs > resolved.maxWaitMs) return response;

      // Release the throttle response's body before asking again, so a
      // keep-alive connection is not pinned by an unread stream.
      discardBody(response);

      resolved.onRetry?.({
        attempt: attempt + 1,
        maxAttempts: resolved.maxAttempts,
        waitMs,
        ...(retryAfterMs !== undefined && { retryAfterMs }),
        url: describeUrl(input),
      });

      await sleep(waitMs, init?.signal);
      totalWaited += waitMs;
    }
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * `Retry-After` in either legal form: delta-seconds (`"2"`) or an HTTP-date
 * (`"Wed, 21 Oct 2026 07:28:00 GMT"`). Anything else is treated as absent so a
 * malformed header degrades to our own backoff rather than to a wrong wait.
 */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) return undefined;
  return Math.max(0, when - Date.now());
}

/**
 * Exponential backoff with equal jitter — half fixed, half random. The fixed
 * half keeps the wait meaningful; the random half stops a fleet of agents that
 * were all throttled at the same instant from retrying at the same instant.
 */
function backoffMs(attempt: number): number {
  const ceiling = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

/** Can this exact request be sent again? A stream body cannot be rewound. */
function isReplayable(input: string | URL, init?: RequestInit): boolean {
  // Defensive: the declared type says otherwise, but a `Request` carries its
  // own (possibly already-consumed) body and must never be replayed.
  if (typeof Request !== 'undefined' && (input as unknown) instanceof Request) return false;
  const body = init?.body;
  if (body === undefined || body === null) return true;
  if (typeof body === 'string') return true;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return true;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return true;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return true;
  return false;
}

/** Best-effort release of an unread response body. Never throws. */
function discardBody(response: Response): void {
  try {
    void response.body?.cancel?.();
  } catch {
    // A body that refuses to cancel is not worth failing a retry over.
  }
}

/** The endpoint, for the `onRetry` report. Never a credential. */
function describeUrl(input: string | URL): string {
  return typeof input === 'string' ? input : input.toString();
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
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
