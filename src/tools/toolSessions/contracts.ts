/** One-job session/key or validation owner; canonical exports remain with its facade. */
import type { ToolCallOwner } from '../toolResourceOwner.js';
import type { RunContext } from '../../bridge/eventMeta.js';
import type { ToolExecutionContext } from '../tools.js';
/**
 * How long a registered cleanup is allowed to live.
 *
 *  - `'call'`     — until `tool.execute` settles (resolve OR throw). Available
 *                   at every door, including `mcpServe`, where a served call is
 *                   the only unit there is.
 *  - `'run'`      — until the run reaches a terminal that is NOT a pause.
 *                   **A pause is not a terminal**: a check-in on a code
 *                   interpreter is a person deciding, and tearing the sandbox
 *                   down there destroys the exact state the resume needs.
 *  - `'session'`  — until the composition root says the hosting session ended
 *                   (`agent.closeToolSessions({ sessionId })`). Nobody but the
 *                   composition root can know that: a request/reply deployment
 *                   has no end-of-session signal, and inventing one would be a
 *                   library guessing about somebody else's protocol.
 *  - `'shutdown'` — until `agent.shutdown()` (which `standingAgent`'s close
 *                   calls). The backstop under all three.
 */
export type TeardownScope = 'call' | 'run' | 'session' | 'shutdown';

/** Why a cleanup ran. Reported on `agentfootprint.tools.session_closed`. */
export type TeardownReason =
  | 'call-end'
  | 'run-end'
  | 'session-end'
  | 'shutdown'
  | 'idle'
  | 'evicted';

/** What a tool says about the cleanup it is registering. */
export interface TeardownOptions {
  /** Default `'run'`. Refused by name when the door cannot honour it — see
   *  {@link ToolExecutionContext.teardownScopes}. */
  readonly scope?: TeardownScope;
  /**
   * Dedup key within `(tool, scope, key)`: session rows are additionally isolated
   * by tenant/principal/session; shutdown rows are process-wide for this tier.
   * Call and run rows also retain their native owner. Omitted → one registration
   * per tool and scope within that boundary.
   *
   * Derive it with {@link toolSessionKey} rather than by hand: a key that is
   * narrower than the identity it isolates is the cross-binding bug, and a key
   * that is wider is a silent latency change.
   */
  readonly key?: string;
  /** The adapter holding the resource — `CodeRunner.id`, say. Reported so a
   *  row names its backend instead of only its tool. */
  readonly runnerId?: string;
  /** One free-form fact about what was opened (the language, the browser
   *  profile). Reported as-is; never a place for user data. */
  readonly label?: string;
}

/** The call a registration came from — what the firing matrix filters on. */
export interface ToolSessionOrigin {
  /** Actual registration-time event context, retained only in memory. */
  readonly runContext?: RunContext;
  /** Private captured parent-run observer channel; never checkpoint data. */
  readonly emit?: (type: string, payload: unknown) => void;
  readonly tool: string;
  readonly toolCallId: string;
  /** Absent when the door has no run (`mcpServe`). */
  readonly runId?: string;
  /** Absent unless the run is bound to a hosting conversation. */
  readonly sessionId?: string;
}

/**
 * What `register()` did — a new session, or a call joining one already held.
 *
 * Returned rather than reported, because the two halves of a session's life
 * happen in different places and only one of them has a stage to be stamped
 * with. A start and a reuse happen INSIDE `tool.execute`, where the caller
 * still holds the scope and can emit with the real `runtimeStageId`; a close
 * happens after the run's last stage committed, where nothing does. Reporting
 * both through one channel would have meant stamping a live, mid-stage event
 * with the teardown pseudo-stage — a small lie, and exactly the kind that makes
 * a trace disagree with itself.
 */
export type RegisterOutcome = 'started' | 'reused';

/**
 * A teardown that happened. The runner turns it into
 * `agentfootprint.tools.session_closed` / `_close_failed`.
 */
export interface ToolSessionReport {
  readonly kind: 'closed' | 'close-failed';
  readonly tool: string;
  readonly scope: TeardownScope;
  /** {@link hashSessionKey} of the isolation key — never the key. */
  readonly keyHash: string;
  readonly runnerId?: string;
  readonly label?: string;
  /** Which firing site ran it. */
  readonly reason: TeardownReason;
  /** Wall-clock from registration to close. */
  readonly durationMs: number;
  /** `close-failed` only. */
  readonly error?: string;
  readonly errorClass?: string;
}

/** Defaults, named so a test and a docstring cannot drift from the code. */
export const TOOL_TEARDOWN_TIMEOUT_MS = 5_000;

/** A session untouched this long is swept on the tier's next interaction. */
export const TOOL_SESSION_IDLE_MS = 900_000;

/** How many live registrations one tier holds before it evicts the coldest. */
export const TOOL_SESSION_MAX_LIVE = 64;

export interface ToolSessionTierOptions {
  /** Per-cleanup ceiling. Default {@link TOOL_TEARDOWN_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** Idle ceiling for the lazy sweep. Default {@link TOOL_SESSION_IDLE_MS}. */
  readonly idleMs?: number;
  /** Live-registration ceiling before LRU eviction. Default
   *  {@link TOOL_SESSION_MAX_LIVE}. */
  readonly maxLive?: number;
  /** Where TEARDOWN reports go. The runner wires this to the typed event
   *  dispatcher. Starts and reuses are the caller's to announce — see
   *  {@link RegisterOutcome}. */
  readonly report?: (report: ToolSessionReport, origin: ToolSessionOrigin) => void;
  /** Clock seam — tests drive idle and duration without waiting. */
  readonly now?: () => number;
}

export interface ToolSessionBinding {
  readonly identity?: ToolExecutionContext['identity'];
  readonly sessionId?: string;
}

export interface ToolSessionView {
  assertActive(): void;
  register(
    call: ToolCallOwner,
    origin: ToolSessionOrigin,
    cleanup: () => void | Promise<void>,
    options?: TeardownOptions,
  ): { readonly outcome: RegisterOutcome; readonly keyHash: string; readonly calls: number };
  fireCall(call: ToolCallOwner): Promise<void>;
  /** Pause retains call/run rows and releases the borrow; terminal joins exact cleanup. */
  finish(paused: boolean): Promise<void>;
}
