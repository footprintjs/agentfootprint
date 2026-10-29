/**
 * terminate — ending a client's remote session, and saying what the remote side
 * answered.
 *
 * Pattern: a pass-through `fetch` that reads one status + one bounded procedure.
 * Role:    `McpClient.terminate()` (`mcpClient.ts`). The MCP SDK's
 *          `StreamableHTTPClientTransport.close()` only aborts the requests in
 *          flight; `terminateSession()` is the one method that sends the
 *          Streamable HTTP `DELETE` carrying `Mcp-Session-Id`. It treats a 405
 *          as success, so the status is read here, by a pass-through `fetch`
 *          the library installs on every transport it builds — it changes no
 *          request and reads only a `DELETE`'s answer.
 *
 * The procedure, at most once per client:
 *
 *   1. no session id was ever issued → `'no-session'`, nothing is sent;
 *   2. otherwise the transport's own `terminateSession()`, bounded by
 *      `TOOL_TEARDOWN_TIMEOUT_MS` (the tool-session tier's `withTimeout`, shared):
 *      at the deadline the request is aborted and the outcome is `'timed-out'`;
 *   3. a local close, whatever happened.
 *
 * The caller's answer comes by the deadline; the work's own settlement may come
 * later (a `fetch` that ignores its abort). Both are returned, apart: the MCP
 * client pool keeps an ending charged until `settled`.
 *
 * Never vendor-aware: the one port is the Streamable HTTP `DELETE`. A transport
 * that turns it into something else (AgentCore Runtime's `StopRuntimeSession`)
 * answers it like a server would.
 */

import { eitherSignal } from '../lib/abort.js';
import {
  isLocalSessionHandleLost,
  TOOL_TEARDOWN_TIMEOUT_MS,
  ToolTeardownTimeoutError,
  withTimeout,
} from '../tools/toolSessions.js';
import type { McpClient, McpTerminateOutcome } from './types.js';

/** An `McpClient` that can end its remote session. */
export type TerminableMcpClient = McpClient & {
  terminate(): Promise<McpTerminateOutcome>;
};

/**
 * Can `client` end its remote session? Reads the member, never assumes it —
 * the feature-detection law (`provider-contract/types.ts` · `canStageCodeInputs`).
 * True for `mcpClient()` and `mockMcpClient()`; false for a hand-written client
 * without `terminate`.
 */
export function canTerminate(client: unknown): client is TerminableMcpClient {
  if (client === null || typeof client !== 'object') return false;
  try {
    return typeof (client as { readonly terminate?: unknown }).terminate === 'function';
  } catch {
    return false;
  }
}

/** What ending one client came to: the caller's answer, and when the work under it settled. */
export interface Ending {
  /** Answers by `TOOL_TEARDOWN_TIMEOUT_MS`. Never rejects. */
  readonly outcome: Promise<McpTerminateOutcome>;
  /** Resolves once every piece of work the ending started has settled. Never rejects. */
  readonly settled: Promise<void>;
}

/** The slice of the SDK's Streamable HTTP transport the procedure uses. */
export interface TerminableTransport {
  readonly sessionId?: string;
  terminateSession(): Promise<void>;
}

/**
 * What the pass-through `fetch` saw of a transport's `DELETE` requests: the
 * status of the latest answer, and the signal it links into each one while an
 * ending is under way.
 */
export class DeleteWatch {
  private status: number | undefined;
  private cut: AbortSignal | undefined;

  /** Arm for one ending: forget the last status, link `cut` into its `DELETE`. */
  arm(cut: AbortSignal): void {
    this.status = undefined;
    this.cut = cut;
  }

  /** The status the latest `DELETE` was answered with, if one was. */
  get answered(): number | undefined {
    return this.status;
  }

  /**
   * `inner` (the global `fetch` when `undefined`, looked up at call time),
   * passed through untouched except that a `DELETE`'s answer status is read and
   * an armed ending's signal is linked into it.
   */
  fetch(
    inner: ((input: string | URL, init?: RequestInit) => Promise<Response>) | undefined,
  ): (input: string | URL, init?: RequestInit) => Promise<Response> {
    const send = inner ?? ((input, init) => globalThis.fetch(input, init));
    return async (input, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'DELETE') return send(input, init);
      const signal =
        this.cut === undefined ? init?.signal : eitherSignal(init?.signal ?? undefined, this.cut);
      const response = await send(input, signal === undefined ? init : { ...init, signal });
      this.status = response.status;
      return response;
    };
  }
}

/** The outcome for an ending that sent nothing. */
export function outcomeWithout(
  remote: 'no-session' | 'unavailable',
  durationMs = 0,
): McpTerminateOutcome {
  return { remote, resolved: remote === 'no-session', durationMs };
}

/**
 * End `transport`'s session, then close locally with `close` — the procedure
 * in the module note. `watch` is the `DeleteWatch` installed on the transport's
 * fetch. `now` is the clock the duration is measured with.
 */
export function endSession(
  transport: TerminableTransport,
  watch: DeleteWatch,
  close: () => Promise<void>,
  now: () => number = Date.now,
  timeoutMs: number = TOOL_TEARDOWN_TIMEOUT_MS,
): Ending {
  const startedAt = now();
  if (transport.sessionId === undefined) {
    const closing = settle(close);
    return {
      outcome: closing.then(() => outcomeWithout('no-session', now() - startedAt)),
      settled: closing,
    };
  }
  const deadline = new AbortController();
  watch.arm(deadline.signal);
  // The transport's own termination; its promise is the work this ending
  // waits for, however long the caller is answered before it.
  const work = Promise.resolve().then(() => transport.terminateSession());
  const outcome = withTimeout(() => work, timeoutMs, 'MCP session termination').then(
    () => answered(watch.answered, startedAt, now),
    (error: unknown) => {
      if (error instanceof ToolTeardownTimeoutError) {
        deadline.abort(error);
        return finished('timed-out', startedAt, now);
      }
      return failedWith(error, watch.answered, startedAt, now);
    },
  );
  // Closed locally once the caller has its answer, whatever it is.
  const closing = outcome.then(() => settle(close));
  return {
    outcome: closing.then(() => outcome),
    settled: Promise.allSettled([work, closing]).then(() => undefined),
  };
}

/** `close()`, never rejecting. */
function settle(close: () => Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(close)
    .then(
      () => undefined,
      () => undefined,
    );
}

/** The SDK resolved: a 2xx, or a 405 it treats as success. */
function answered(
  status: number | undefined,
  startedAt: number,
  now: () => number,
): McpTerminateOutcome {
  if (status === 405) return finished('not-offered', startedAt, now, status);
  if (status !== undefined && status >= 200 && status < 300) {
    return finished('terminated', startedAt, now, status);
  }
  // Resolved without an answer this watch saw: nothing was sent.
  return finished('no-session', startedAt, now, status);
}

/** The SDK rejected: a 404, another status, a lost handle, or no answer at all. */
function failedWith(
  error: unknown,
  status: number | undefined,
  startedAt: number,
  now: () => number,
): McpTerminateOutcome {
  if (isLocalSessionHandleLost(error)) {
    return finished('handle-lost', startedAt, now, undefined, classOf(error));
  }
  if (status === 404) return finished('already-gone', startedAt, now, status);
  return finished('failed', startedAt, now, status, classOf(error));
}

function finished(
  remote: McpTerminateOutcome['remote'],
  startedAt: number,
  now: () => number,
  status?: number,
  errorClass?: string,
): McpTerminateOutcome {
  return {
    remote,
    resolved: remote === 'terminated' || remote === 'already-gone' || remote === 'no-session',
    ...(status !== undefined && { status }),
    ...(errorClass !== undefined && { errorClass }),
    durationMs: Math.max(0, now() - startedAt),
  };
}

/** A failure's class name, never its message. */
export function classOf(error: unknown): string {
  if (error instanceof Error) {
    const ctor = (error as { readonly constructor?: { readonly name?: unknown } }).constructor;
    if (typeof ctor?.name === 'string' && ctor.name !== '') return ctor.name;
    return error.name;
  }
  return typeof error;
}
