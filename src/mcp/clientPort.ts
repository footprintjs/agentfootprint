/**
 * clientPort — what the MCP client pool asks of a client it opens, and what the
 * client hands back beside the ordinary `McpClient`.
 *
 * Pattern: an internal seam, never on a door.
 * Role:    The pool's clients are ordinary `mcpClient`s (`mcpClient.ts`): their
 *          discovery, their per-tool checks (`callChecks.ts`, counted per
 *          client object by `listingGenerations.ts`), their retry series and
 *          their request ledger are the library's, unchanged. A pool needs
 *          four things more, and only a pool does, so they cross here:
 *
 *   - a CONNECT signal apart from the client's lifetime signal: one open runs
 *     under the pool's own signal and open deadline, never a caller's;
 *   - the request guard of whatever the pool is doing on the client
 *     (`requestGuard.ts`), so every request is checked and counted;
 *   - the server's tools-changed notice, heard through the SDK's
 *     `listChanged.tools` with its automatic refresh OFF — a notice can only
 *     make the pool list again, through `listing`, which `mcpClient` counts;
 *   - a port back: a listing under the pool's own signal, a callable tool for a
 *     definition this client did not list (a shared one), and an ending whose
 *     settlement is reported apart from its answer.
 */

import type { Tool } from '../tools/tools.js';
import type { RequestGuard } from './requestGuard.js';
import type { Ending } from './terminate.js';
import type { McpListedTool } from './types.js';
import type { ThrottleFetch } from './throttleRetry.js';

/** @internal What a pool passes when it opens a client. */
export interface PooledClientSeam {
  /** Bounds the connect (`initialize`) only: the pool's signal and its open deadline. */
  readonly connectSignal: AbortSignal;
  /**
   * Wrap the transport's outermost `fetch`. `claim` finds the guard of the
   * pooled tool call a request body belongs to (its ledger), `undefined` for
   * any other request.
   */
  readonly wrapFetch: (
    inner: ThrottleFetch,
    claim: (body: unknown) => RequestGuard | undefined,
  ) => ThrottleFetch;
  /** The guard for a message that is not a pooled tool call — asked at the watched `send`. */
  readonly guardFor: (message: unknown) => RequestGuard | undefined;
  /** The server said its tool list changed. Called by the SDK; must not throw. */
  readonly onToolsChanged: () => void;
}

/** @internal One listing, through the client's own discovery. */
export interface ClientListing {
  /** The tools as `mcpClient` wraps them: each carries the checks of this listing. */
  readonly tools: readonly Tool[];
  /** The definitions as the server listed them, in the same order. */
  readonly listed: readonly McpListedTool[];
}

/** @internal What a pooled client hands the pool. */
export interface ClientPort {
  /** List every page through the client's own discovery, under `signal`. Replaces its cache. */
  listing(signal: AbortSignal | undefined): Promise<ClientListing>;
  /**
   * A callable tool for `listed` on this connection that carries its OWN
   * checks — for a definition this client did not list itself, so the SDK on
   * this connection holds none for it.
   */
  bind(listed: McpListedTool): Tool;
  /** End the remote session and close: the answer by its deadline, the settlement apart. */
  end(): Ending;
}

/**
 * @internal What a pooled open that FAILED leaves behind: the server may have
 * opened a session all the same (its `initialize` answer can land after the
 * open was aborted), so the pool can still end it — once the open's work has
 * settled, it asks `hasSession` and, if so, ends it under the ending rule.
 */
export interface HalfOpen {
  /** Does the transport hold a session id the server issued — read when asked. */
  hasSession(): boolean;
  /** End that session, then close locally. */
  end(): Ending;
}

const HALF_OPENS = new WeakMap<object, HalfOpen>();

/** @internal Remember what `error` (a failed pooled open's) left behind. */
export function rememberHalfOpen(error: unknown, halfOpen: HalfOpen): void {
  if (error !== null && typeof error === 'object') HALF_OPENS.set(error, halfOpen);
}

/** @internal What a failed pooled open left behind, if anything. */
export function halfOpenOf(error: unknown): HalfOpen | undefined {
  return error !== null && typeof error === 'object' ? HALF_OPENS.get(error) : undefined;
}
