/**
 * throttleRetry — when an MCP server refuses a request before running it, wait
 * and ask again.
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
 * The loop takes its question as a {@link RetryDecision}, so the one other
 * refusal a service DOCUMENTS as pre-execution — AgentCore Runtime's "session
 * operation in progress" — reuses this loop rather than growing a second one.
 * That decision is applied only by that vendor's own transport; what
 * `mcpClient` and `retryingFetch` retry is still a 429 and nothing else.
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
 * ── The loop is footprintjs's attempt runner, one series per call ────────────
 * Each call runs ONE `attempt()` series (footprintjs, used as it ships). An
 * attempt sends the request once. A response a rule's decision recognises is
 * thrown as a refusal that names its kind, and the policy's `retryOn` accepts
 * those refusals and nothing else — so a 5xx, a dropped connection or a timeout
 * ends the series on the attempt it happened in, as it always did. When the
 * series ends on a refusal (attempts spent, a ceiling reached, no time left),
 * the refusal's response is delivered as the server sent it: the caller sees
 * the 429, never an error of ours.
 *
 * ── A fetch that already retries is JOINED, never wrapped ────────────────────
 * A transport whose own fetch runs a series (AgentCore Runtime's session-busy
 * retry) says how to rebuild itself with one more rule (`joinableRetry`).
 * `retryingFetch` over such a fetch — what `mcpClient` applies to every http
 * transport — adds its 429 rule to THAT series instead of starting a second
 * one around it. One series means one attempt count, one waiting total and one
 * deadline per call, by construction: the layers can never multiply requests.
 * The series' FIRST rule holds the call's budget — its `maxAttempts`,
 * `maxWaitMs` and `maxElapsedMs` bound every attempt and wait, whatever the
 * reason. A rule that joins keeps its own values as limits on its own kind:
 * they can stop its retries sooner, never make the call longer.
 *
 * ── The wait: a stated one wins, whole ───────────────────────────────────────
 * Each retry's wait is `statedWaitFirst(retry-after, (n) => min(maxDelayMs,
 * exponentialBackoff(spec)(n)))`: the server's `Retry-After` when it sent one,
 * else our jittered backoff capped at `maxDelayMs`. The cap is on the SCHEDULE
 * only — never on a stated wait — so the footprintjs policy's `maxBackoffMs`,
 * which would cut every wait and send the request again before the server
 * said it may, is left unset. A stated wait too long for `maxWaitMs` or the
 * deadline is never shortened either: the series stops, and the 429 is
 * delivered as the server sent it.
 *
 * Pattern: Decorator over `fetch`. Role: Layer-3 tool transport.
 */

import {
  attempt,
  type AttemptContext,
  type AttemptOptions,
  type AttemptRecord,
  type RetryPolicy,
} from 'footprintjs';

import { abortErrorOf, eitherSignal, linkedController } from '../lib/abort.js';
import { exponentialBackoff, statedWaitFirst, type BackoffFunction } from './backoff.js';

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

/**
 * Which refusal a retry answers: HTTP 429 (`'throttle'`), or AgentCore
 * Runtime's "session operation in progress" (`'session-busy'`).
 */
export type RetryKind = 'throttle' | 'session-busy';

/** Reported to {@link ThrottleRetryOptions.onRetry} before each wait. */
export interface ThrottleRetryInfo {
  /** Which refusal this retry answers. */
  readonly kind: RetryKind;
  /** The attempt about to START. `2` is the first retry. */
  readonly attempt: number;
  /** Ceiling in force for this refusal, including the first attempt. */
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

/**
 * Fine-tuning for {@link McpClientOptions.retryOnThrottle}, and — with its own
 * defaults — for `agentCoreRuntimeMcpTransport`'s `retry`. The defaults below
 * are `retryOnThrottle`'s.
 *
 * Every limit here is the CALL's — unless this retry joins a series a
 * transport already runs (an AgentCore Runtime transport under `mcpClient`).
 * Then the transport's own values are the call's limits, and these limit only
 * the 429 retries inside them: each can stop a 429 retry sooner (a 429 is
 * retried only while the call has made fewer attempts than `maxAttempts`, has
 * waited less than `maxWaitMs`, …), never make the call longer. The deadline
 * that cuts a request in flight is the transport's `maxElapsedMs`.
 */
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
   * A deadline for the whole call, in milliseconds from its start — requests
   * included, not just waits. A wait that would end past it is never begun
   * (the refusal is delivered at once), and a request still waiting for its
   * answer when it passes is cut: the call fails with the deadline's error.
   * Default: none — `maxWaitMs` is the default rail.
   */
  readonly maxElapsedMs?: number;
  /**
   * The ceiling of the first wait our own backoff draws, in milliseconds, when
   * the server stated none. Default 200.
   */
  readonly baseDelayMs?: number;
  /** How much each backoff ceiling grows over the last. Default 2. At least 1. */
  readonly multiplier?: number;
  /**
   * How a backoff wait is drawn below its ceiling: `'equal'` (the default)
   * waits between half the ceiling and all of it, `'full'` anywhere from zero
   * up to it, `'none'` exactly it. Jitter is what keeps clients refused at the
   * same moment from asking again at the same moment.
   */
  readonly jitter?: 'none' | 'equal' | 'full';
  /**
   * The most one of OUR backoff waits may last, in milliseconds. Default: none.
   *
   * It caps the scheduled wait only, never a server's `Retry-After` — unlike
   * footprintjs's `RetryPolicy.maxBackoffMs`, which caps every wait. A stated
   * wait is waited whole; asking sooner than the server said would only spend
   * an attempt on a refusal it already announced.
   */
  readonly maxDelayMs?: number;
  /**
   * Called before each wait. The per-attempt visibility hook, matching the
   * contract `withRetry` and `withCredentialRetry` already use — a decorator
   * at a transport boundary reports to its consumer, and emits no events of
   * its own. It is told the refusal's kind, the attempt about to start and the
   * wait — never the request's arguments or the server's answer.
   *
   * A retried call is not invisible without this: the wait lands inside the
   * tool's `stream.tool_end` `durationMs`, and an exhausted retry still
   * reaches the model with `error: true`. This hook is what turns "that call
   * was slow" into "that call was throttled twice".
   *
   * A throw from it is isolated: the call goes on as if it had returned.
   */
  readonly onRetry?: (info: ThrottleRetryInfo) => void;
}

/**
 * How a throttled request is handled. `true` (the default) means bounded
 * retry with default settings; `false` disables it entirely.
 */
export type RetryOnThrottle = boolean | ThrottleRetryOptions;

// ─── The decision ────────────────────────────────────────────────────

/**
 * What one response says about asking again. `undefined` delivers the response
 * as it is; a verdict waits, then sends the SAME request once more.
 */
export interface RetryVerdict {
  /**
   * How long the server asked for, in milliseconds, when it said. Absent, the
   * loop waits its own jittered backoff.
   */
  readonly retryAfterMs?: number;
}

/**
 * The one question the loop asks of each response.
 *
 * ── The license every decision must hold ─────────────────────────────────────
 * A decision may answer "again" ONLY for a refusal the server made BEFORE it
 * ran anything — the property that makes a 429 safe to repeat (see the module
 * note). A response that could be the record of half-done work is never one.
 * The library holds exactly two such decisions: {@link throttled} below, and
 * AgentCore Runtime's documented "session operation in progress" refusal,
 * which lives with that vendor's adapter (`adapters/mcp/agentcoreRuntime/`).
 * Each stays ONE small function, so a retry has exactly one place it is
 * decided — and each attempt is written down as one footprintjs attempt
 * record.
 */
export type RetryDecision = (
  response: Response,
) => RetryVerdict | undefined | Promise<RetryVerdict | undefined>;

/** HTTP 429, with the server's own `Retry-After` when it sent one. */
export function throttled(response: Response): RetryVerdict | undefined {
  if (response.status !== 429) return undefined;
  const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
  return retryAfterMs === undefined ? {} : { retryAfterMs };
}

// ─── Rules ───────────────────────────────────────────────────────────

/**
 * @internal What a rule's options fall back to. `Infinity` means none: no
 * deadline (`maxElapsedMs`), no cap on the scheduled wait (`maxDelayMs`).
 */
export interface RetryDefaults {
  readonly maxAttempts: number;
  readonly maxWaitMs: number;
  readonly maxElapsedMs: number;
  readonly baseDelayMs: number;
  readonly multiplier: number;
  readonly jitter: 'none' | 'equal' | 'full';
  readonly maxDelayMs: number;
}

/**
 * `retryOnThrottle`'s defaults — unchanged since 8.11.0: 3 attempts, a 200 ms
 * backoff doubling with equal jitter (100–200 ms, then 200–400 ms), never more
 * than 10 s of waiting in total. No deadline and no cap on one wait.
 */
export const THROTTLE_RETRY_DEFAULTS: RetryDefaults = Object.freeze({
  maxAttempts: 3,
  maxWaitMs: 10_000,
  maxElapsedMs: Infinity,
  baseDelayMs: 200,
  multiplier: 2,
  jitter: 'equal',
  maxDelayMs: Infinity,
});

/**
 * @internal One refusal a series may retry: the decision that recognises it,
 * the kind it reports as, and the limits and backoff it retries by.
 */
export interface RetryRule {
  readonly kind: RetryKind;
  readonly decide: RetryDecision;
  /** Total attempts while this refusal is the reason to go on. ≥ 1; `Infinity` is no count. */
  readonly maxAttempts: number;
  readonly maxWaitMs: number;
  readonly maxElapsedMs: number;
  readonly maxDelayMs: number;
  readonly baseDelayMs: number;
  readonly multiplier: number;
  readonly jitter: 'none' | 'equal' | 'full';
  readonly onRetry?: (info: ThrottleRetryInfo) => void;
}

/**
 * @internal A rule from a caller's options — `undefined` when retry is off
 * (`false`). An option field left out, or set to `undefined`, takes its
 * default. `maxAttempts` and `maxWaitMs` keep the clamps they always had (below
 * 1 reads as 1, below 0 as 0).
 *
 * @throws TypeError, when the rule is BUILT, for a value the schedule cannot
 *   mean — named by option, never echoing a value that is not a number.
 */
export function retryRule(
  kind: RetryKind,
  decide: RetryDecision,
  config: RetryOnThrottle | undefined,
  defaults: RetryDefaults,
  where: string,
): RetryRule | undefined {
  if (config === false) return undefined;
  const opts: ThrottleRetryOptions = typeof config === 'object' && config !== null ? config : {};
  const option = new OptionReader(where);
  const rule: RetryRule = {
    kind,
    decide,
    maxAttempts: option.atLeast(
      'maxAttempts',
      Math.max(1, opts.maxAttempts ?? defaults.maxAttempts),
    ),
    maxWaitMs: option.atLeast('maxWaitMs', Math.max(0, opts.maxWaitMs ?? defaults.maxWaitMs)),
    maxElapsedMs: option.positive('maxElapsedMs', opts.maxElapsedMs ?? defaults.maxElapsedMs),
    maxDelayMs: option.nonNegative('maxDelayMs', opts.maxDelayMs ?? defaults.maxDelayMs),
    baseDelayMs: option.finite('baseDelayMs', opts.baseDelayMs ?? defaults.baseDelayMs, 0),
    multiplier: option.finite('multiplier', opts.multiplier ?? defaults.multiplier, 1),
    jitter: option.jitter(opts.jitter ?? defaults.jitter),
    ...(opts.onRetry && { onRetry: opts.onRetry }),
  };
  return rule;
}

// ─── The decorator ───────────────────────────────────────────────────

/**
 * Wrap a `fetch` so HTTP 429 responses are retried, honouring `Retry-After`.
 *
 * Returns `inner` untouched when retry is disabled — including `undefined`,
 * so a transport that passed no custom fetch keeps passing none and its
 * behaviour is byte-identical to before this existed.
 *
 * When `inner` already runs a retry series of its own (an AgentCore Runtime
 * transport's fetch), the 429 rule JOINS that series rather than wrapping it,
 * so the two can never multiply requests — see the module note.
 *
 * ── Why this is public ───────────────────────────────────────────────────────
 * `mcpClient({ transport })` applies it for you, ON by default. `mcpClient({
 * connection })` cannot: the library builds no transport on that arm, so there
 * is no `fetch` of its own to wrap — and a browser consumer, who is the main
 * reason that arm exists, would silently lose the 429 handling Node gets for
 * free. That asymmetry is invisible from the outside, which is why the answer
 * is to hand over the same implementation rather than to document the gap:
 *
 * ```ts
 * import { retryingFetch } from 'agentfootprint/providers';
 * import { StreamableHTTPClientTransport }
 *   from '@modelcontextprotocol/sdk/client/streamableHttp.js';
 *
 * const transport = new StreamableHTTPClientTransport(new URL('/mcp', location.href), {
 *   fetch: retryingFetch(undefined, { maxAttempts: 5 }),
 * });
 * ```
 *
 * @param inner the fetch to wrap. `undefined` means the global `fetch`,
 *   resolved at CALL time so a later polyfill still wins.
 * @param config `true` / `undefined` for the defaults, `false` to get `inner`
 *   back unchanged, or an object to tune the ceilings and the backoff.
 * @throws TypeError when an option is outside its range — here, when the fetch
 *   is built, never at the first call.
 */
export function retryingFetch(
  inner: ThrottleFetch | undefined,
  config: RetryOnThrottle | undefined,
): ThrottleFetch | undefined {
  const rule = retryRule('throttle', throttled, config, THROTTLE_RETRY_DEFAULTS, 'retryOnThrottle');
  if (rule === undefined) return inner;
  const join = inner === undefined ? undefined : JOINS.get(inner);
  return join !== undefined ? join(rule) : retryingFetchFor(inner ?? platformFetch, [rule]);
}

/**
 * Fetches that run their retries in one series, each with the way to rebuild
 * it with one more rule. Module-private: only `joinableRetry` adds to it, so a
 * caller cannot make a fetch claim a series it does not run.
 */
const JOINS = new WeakMap<ThrottleFetch, (rule: RetryRule) => ThrottleFetch>();

/**
 * @internal Declare that `fetch` runs its retries in ONE series, and how to
 * rebuild it with one more rule in that same series. `retryingFetch` joins such
 * a fetch instead of wrapping it. A transport whose public fetch wraps its
 * series (a session applied around it, its answers rewritten after it) uses
 * this so the rule lands INSIDE that wrapping.
 */
export function joinableRetry(
  fetch: ThrottleFetch,
  join: (rule: RetryRule) => ThrottleFetch,
): ThrottleFetch {
  JOINS.set(fetch, join);
  return fetch;
}

/**
 * @internal The one series per call over `inner`, asking `rules` in order —
 * `inner` itself when there are none. The first rule holds the call's budget;
 * see the module note. The result is joinable.
 */
export function retryingFetchFor(inner: ThrottleFetch, rules: readonly RetryRule[]): ThrottleFetch {
  const [owner] = rules;
  if (owner === undefined) return inner;
  const bound = rules.map((rule) => boundRule(rule, owner));
  return joinableRetry(
    (input, init) => new Series(bound, input, init).run(inner),
    (rule) => retryingFetchFor(inner, [...rules, rule]),
  );
}

/** The platform's fetch, looked up at call time so a later polyfill still wins. */
const platformFetch: ThrottleFetch = (input, init) => globalThis.fetch(input, init);

// ─── One call's series ───────────────────────────────────────────────

/** A rule as a series runs it: its limits no looser than the owner's, its wait built. */
interface BoundRule extends RetryRule {
  /** The wait after failed attempt `n`: the stated one, else the capped schedule. */
  readonly backoffMs: BackoffFunction;
}

function boundRule(rule: RetryRule, owner: RetryRule): BoundRule {
  const maxDelayMs = Math.min(rule.maxDelayMs, owner.maxDelayMs);
  const schedule = exponentialBackoff({
    baseDelayMs: rule.baseDelayMs,
    multiplier: rule.multiplier,
    jitter: rule.jitter,
  });
  return {
    ...rule,
    maxAttempts: Math.min(rule.maxAttempts, owner.maxAttempts),
    maxWaitMs: Math.min(rule.maxWaitMs, owner.maxWaitMs),
    maxElapsedMs: Math.min(rule.maxElapsedMs, owner.maxElapsedMs),
    maxDelayMs,
    // The cap is on the schedule only: a stated wait wins, whole.
    backoffMs: statedWaitFirst(retryAfterOf, (n) => Math.min(maxDelayMs, schedule(n))),
  };
}

/** The wait a refusal stated (its parsed `Retry-After`), or none. */
function retryAfterOf(error: unknown): number | undefined {
  return error instanceof RetryableRefusal ? error.retryAfterMs : undefined;
}

/** The latest attempt's refusal: what it threw, the rule that recognised it, the answer it stands for. */
interface Refused {
  readonly refusal: RetryableRefusal;
  readonly rule: BoundRule;
  readonly verdict: RetryVerdict;
  readonly response: Response;
}

/** What a series names its records' target — a name from code, never a value. */
const SERIES_TARGET = 'mcp-request';

/**
 * One call: one `attempt()` series, and what its policy's functions share while
 * it runs — the waiting so far, and the latest refusal.
 */
class Series {
  private readonly owner: BoundRule;
  private readonly startedAt = Date.now();
  private readonly deadline: number | undefined;
  private readonly signal: AbortSignal | undefined;
  private readonly replayable: boolean;
  private attemptNo = 0;
  private waitedMs = 0;
  private plannedWaitMs = 0;
  private latest: Refused | undefined;

  constructor(
    private readonly rules: readonly BoundRule[],
    private readonly input: string | URL,
    private readonly init: RequestInit | undefined,
  ) {
    this.owner = rules[0] as BoundRule;
    this.signal = init?.signal ?? undefined;
    this.replayable = isReplayable(input, init);
    const { maxElapsedMs } = this.owner;
    this.deadline = Number.isFinite(maxElapsedMs) ? this.startedAt + maxElapsedMs : undefined;
  }

  async run(inner: ThrottleFetch): Promise<Response> {
    try {
      return await attempt((t) => this.send(inner, t), this.policy(), this.options());
    } catch (error) {
      return this.settle(error);
    }
  }

  /**
   * The owner's budget as footprintjs reads it; the rest is this series'
   * `retryOn` and backoff. `maxBackoffMs` is deliberately unset: it would cap a
   * stated `Retry-After` too, and send the request before the server said.
   */
  private policy(): RetryPolicy {
    const { maxAttempts } = this.owner;
    return {
      // A whole number for the runner; "no count" is a count no call reaches.
      attempts: Number.isFinite(maxAttempts) ? Math.ceil(maxAttempts) : Number.MAX_SAFE_INTEGER,
      retryOn: (error) => this.retryOn(error),
      // `retryOn` planned the wait — it needs the length to hold the ceilings.
      backoffMs: () => this.plannedWaitMs,
    };
  }

  private options(): AttemptOptions {
    return {
      target: SERIES_TARGET,
      ...(this.signal !== undefined && { signal: this.signal }),
      ...(this.deadline !== undefined && { deadline: this.deadline }),
      onAttempt: (record) => this.report(record),
    };
  }

  /** One attempt: the request, sent once. A refusal a rule recognises is thrown for the runner to decide on. */
  private async send(inner: ThrottleFetch, t: AttemptContext): Promise<Response> {
    this.attemptNo = t.attempt;
    // The previous attempt's refusal will not be delivered: release its body, so
    // a keep-alive connection is not pinned by an unread stream.
    this.supersede();
    const response = await this.fetchFor(inner, t);
    for (const rule of this.rules) {
      const verdict = await rule.decide(response);
      if (verdict === undefined) continue;
      const refusal = new RetryableRefusal(rule.kind, verdict);
      this.latest = { refusal, rule, verdict, response };
      throw refusal;
    }
    return response;
  }

  /**
   * The request. With no deadline of ours it carries the caller's own `init`,
   * exactly as it did before this series existed. Under a deadline the runner
   * can cut the attempt before it answers, and the request is stopped with it —
   * but only until it answers: a response already arriving keeps streaming for
   * as long as the caller's own signal allows.
   */
  private async fetchFor(inner: ThrottleFetch, t: AttemptContext): Promise<Response> {
    if (this.deadline === undefined) return inner(this.input, this.init);
    const cut = linkedController(t.signal);
    try {
      const signal = eitherSignal(this.signal, cut.controller.signal);
      return await inner(this.input, { ...this.init, ...(signal !== undefined && { signal }) });
    } finally {
      cut.unlink();
    }
  }

  /**
   * The runner's `retryOn`: is this attempt's error a refusal worth another
   * attempt? Plans the wait as it answers, because the ceilings need its length.
   */
  private retryOn(error: unknown): boolean {
    this.plannedWaitMs = 0;
    const refused = this.latest;
    // The license: only a refusal made before the server ran anything. A 5xx, a
    // dropped connection or a timeout may be the record of work that ran.
    if (refused === undefined || error !== refused.refusal) return false;
    // A body we cannot send twice makes a retry a different request. Rare for
    // MCP (JSON strings), but silently replaying half a stream would be worse
    // than surfacing the refusal.
    if (!this.replayable) return false;
    const { rule } = refused;
    if (this.attemptNo >= rule.maxAttempts) return false;
    // The stated wait whole, else the schedule under `maxDelayMs`.
    const waitMs = rule.backoffMs(this.attemptNo, error);
    // The rail on Retry-After: never let a server talk us into a wait that
    // breaks the caller's budget. It stops the series; it never shortens the
    // wait. Past the deadline, the runner stops it the same way (`no-time-left`).
    if (this.waitedMs + waitMs > rule.maxWaitMs) return false;
    // A joined rule's own, sooner deadline. The owner's is the runner's to hold.
    if (
      rule.maxElapsedMs < this.owner.maxElapsedMs &&
      this.elapsedAfter(waitMs) > rule.maxElapsedMs
    ) {
      return false;
    }
    this.plannedWaitMs = waitMs;
    return true;
  }

  private elapsedAfter(waitMs: number): number {
    return Date.now() - this.startedAt + waitMs;
  }

  /** Each record as the runner ends an attempt: a retry is counted and reported to its rule. */
  private report(record: AttemptRecord): void {
    const refused = this.latest;
    if (record.next !== 'retry' || refused === undefined) return;
    const waitMs = record.delayMs ?? 0;
    this.waitedMs += waitMs;
    const { rule, verdict } = refused;
    rule.onRetry?.({
      kind: rule.kind,
      attempt: record.attempt + 1,
      maxAttempts: rule.maxAttempts,
      waitMs,
      ...(verdict.retryAfterMs !== undefined && { retryAfterMs: verdict.retryAfterMs }),
      url: describeUrl(this.input),
    });
  }

  /** How the call ends when the series did not answer. */
  private settle(error: unknown): Response {
    // The caller's cancellation wins: the call ends with their reason, and the
    // refusal nobody is waiting for any more is released.
    if (this.signal?.aborted) {
      this.supersede();
      throw abortErrorOf(this.signal);
    }
    // The series ended on a refusal — attempts spent, a ceiling reached, no
    // time left. The server's answer is delivered as it sent it.
    if (this.latest !== undefined && error === this.latest.refusal) return this.latest.response;
    throw error;
  }

  private supersede(): void {
    if (this.latest !== undefined) discardBody(this.latest.response);
    this.latest = undefined;
  }
}

/**
 * A response a rule recognised as a refusal made before anything ran, thrown so
 * the attempt runner decides on it. It carries only what an attempt record may
 * keep: a fixed sentence, its kind as `code`, a 429's status and the wait the
 * server stated. Never the server's text, the request or the response — the
 * series holds the response, not the error.
 */
class RetryableRefusal extends Error {
  override readonly name = 'RetryableRefusal';
  readonly code: RetryKind;
  /** A throttle's status, so footprintjs's `errorCategory` reads it as rate-limited. */
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(kind: RetryKind, verdict: RetryVerdict) {
    super(REFUSAL_SENTENCES[kind]);
    this.code = kind;
    this.status = kind === 'throttle' ? 429 : undefined;
    this.retryAfterMs = verdict.retryAfterMs;
  }
}

const REFUSAL_SENTENCES: Readonly<Record<RetryKind, string>> = {
  throttle: 'The server refused the request with HTTP 429 before running it.',
  'session-busy':
    'AgentCore Runtime refused the request while its session was starting or stopping, before running it.',
};

// ─── Helpers ─────────────────────────────────────────────────────────

/** Reads one rule's numeric options, refusing by name what the schedule cannot mean. */
class OptionReader {
  constructor(private readonly where: string) {}

  /** A number that is not NaN (`Infinity` allowed) — the clamps already applied. */
  atLeast(name: string, value: number): number {
    if (typeof value !== 'number' || Number.isNaN(value)) this.refuse(name, 'a number');
    return value;
  }

  /** A number > 0; `Infinity` is none. */
  positive(name: string, value: number): number {
    if (!(typeof value === 'number' && value > 0)) this.refuse(name, 'a number > 0');
    return value;
  }

  /** A number ≥ 0; `Infinity` is none. */
  nonNegative(name: string, value: number): number {
    if (!(typeof value === 'number' && value >= 0)) this.refuse(name, 'a number ≥ 0');
    return value;
  }

  /** A finite number ≥ `min`. */
  finite(name: string, value: number, min: number): number {
    if (!(typeof value === 'number' && Number.isFinite(value) && value >= min)) {
      this.refuse(name, `a finite number ≥ ${min}`);
    }
    return value;
  }

  jitter(value: unknown): 'none' | 'equal' | 'full' {
    if (value === 'none' || value === 'equal' || value === 'full') return value;
    return this.refuse('jitter', "'none', 'equal' or 'full'");
  }

  private refuse(name: string, wanted: string): never {
    throw new TypeError(`${this.where}: \`${name}\` must be ${wanted}.`);
  }
}

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
