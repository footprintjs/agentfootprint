/**
 * requestGuard — the last check a pooled operation's request meets at every
 * boundary the library controls, and the count of the work under it until
 * that work has settled.
 *
 * Pattern: one object per operation, carried on the request's `init` under a
 *          library-private symbol.
 * Role:    The send gate of the MCP client pool (`mcp/pool/`). The MCP SDK and
 *          the transport wait between a tool call and the network — `send()`
 *          awaits its own headers, a gateway vends a credential inside `fetch`,
 *          the AWS SDK signs inside `send` — so the last check cannot live in
 *          the tool. Each place that waits asks the request's guard after its
 *          wait and before it hands the request on:
 *
 *   - the watched `send` (`requestLedger.ts`) — the last boundary on stdio,
 *     whose `send` writes without waiting;
 *   - the pool's own fetch, before the request enters the transport;
 *   - the retry series, before every attempt (`throttleRetry.ts`);
 *   - the vending fetch, once the credential has arrived (`gatewayTransport.ts`);
 *   - the AWS SDK command, after it is signed and before its request handler
 *     sends it (`adapters/mcp/agentcoreRuntime/invoke.ts`).
 *
 * A refusal there sends nothing. What no guard can recall is a request already
 * handed on: to the network, or to an app's own `fetch`.
 *
 * The same object COUNTS the work under the request: every promise a boundary
 * starts for it — an attempt's `fetch`, a credential vend, an AWS `send` — is
 * tracked until it settles, whatever the caller was told. An abort is a
 * signal, not proof that the work stopped, so the pool keeps an operation
 * charged until this count says it has.
 *
 * The guard rides `init` under a symbol, so a layer that rebuilds `init` with
 * a spread (`{ ...init, headers }`) carries it on, and nothing reaches the
 * wire: `fetch` reads only the fields it knows. A request with no guard — every
 * request of a client the pool did not build — is exactly what it always was.
 */

/** @internal The `init` key a pooled request's guard rides under. */
export const REQUEST_GUARD: unique symbol = Symbol('agentfootprint.mcp.request-guard');

/** What one pooled operation's requests are checked against, and counted by. */
export interface RequestGuard {
  /**
   * Throw the refusal when the request may not be handed on now — its binding
   * went stale, or its operation was aborted or ran out of time. Synchronous:
   * nothing waits between this check and the hand-off it guards.
   */
  check(): void;
  /** Count `work` as work under this request until it settles. Never throws. */
  track(work: PromiseLike<unknown>): void;
  /** What aborts the operation's own work — linked into each request it makes. */
  readonly signal?: AbortSignal;
}

/** An `init` that carries a guard. */
type Guarded = RequestInit & { readonly [REQUEST_GUARD]?: RequestGuard };

/** The guard `init` carries, or `undefined` — a request no pool sent. Never throws. */
export function guardOf(init: RequestInit | undefined): RequestGuard | undefined {
  if (init === undefined || init === null || typeof init !== 'object') return undefined;
  let guard: unknown;
  try {
    guard = (init as Guarded)[REQUEST_GUARD];
  } catch {
    return undefined;
  }
  if (guard === null || typeof guard !== 'object') return undefined;
  return typeof (guard as RequestGuard).check === 'function' &&
    typeof (guard as RequestGuard).track === 'function'
    ? (guard as RequestGuard)
    : undefined;
}

/** `init` carrying `guard`: a new object, every other field in place. */
export function withGuard(init: RequestInit | undefined, guard: RequestGuard): RequestInit {
  return { ...init, [REQUEST_GUARD]: guard } as RequestInit;
}

/**
 * Track `work` under `init`'s guard, when it has one, and hand `work` back
 * unchanged. The one line every boundary uses.
 */
export function trackedBy<T extends PromiseLike<unknown>>(
  init: RequestInit | undefined,
  work: T,
): T {
  guardOf(init)?.track(work);
  return work;
}

// ─── The call's port ─────────────────────────────────────────────────

/**
 * @internal The call-context key a pooled tool hands its guard down under, to
 * the MCP tool it runs (`callLifetime.ts` · `openCall` issues the call with
 * it). Enumerable, so a wrapper that copies the context keeps it.
 */
export const CALL_GUARD: unique symbol = Symbol('agentfootprint.mcp.call-guard');

/** `ctx` carrying `guard` for the MCP tool it is handed to. */
export function withCallGuard<C extends object>(ctx: C, guard: RequestGuard): C {
  return { ...ctx, [CALL_GUARD]: guard };
}

/** The guard a call's context carries, or `undefined`. Never throws, whatever `ctx` is. */
export function callGuardOf(ctx: unknown): RequestGuard | undefined {
  if (ctx === null || typeof ctx !== 'object') return undefined;
  let guard: unknown;
  try {
    guard = (ctx as { readonly [CALL_GUARD]?: unknown })[CALL_GUARD];
  } catch {
    return undefined;
  }
  if (guard === null || typeof guard !== 'object') return undefined;
  return typeof (guard as RequestGuard).check === 'function' &&
    typeof (guard as RequestGuard).track === 'function'
    ? (guard as RequestGuard)
    : undefined;
}
