import { localResourceStatus } from './toolSessions/localStatus.js';
/**
 * toolSessions — the end-signal a tool can be handed, and the tier that fires it.
 *
 * Pattern: Registrar + Template Method for the firing matrix.
 * Role:    tools/ layer primitive. `ToolExecutionContext.onTeardown` registers here;
 *          `Agent.run`'s terminals, `RunnerBase.closeToolSessions` and
 *          `RunnerBase.shutdown` fire it.
 * Emits:   nothing itself. `register()` ANSWERS what it did (started/reused) so
 *          the caller — still inside a stage — can emit with a real
 *          `runtimeStageId`, and teardown REPORTS (see {@link ToolSessionReport})
 *          so the runner can emit the two that fire after the last stage.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 * A session-based tool service (a managed code interpreter, a headless browser)
 * is Start → Invoke ×N → Stop. Before 9.7.0 a `Tool` had nowhere to hold the
 * middle of that: `ToolExecutionContext` carried no run or session identity, and
 * nothing in the framework ever said "this is over". So a tool either paid
 * start-up on every call, or held the session in a module-level map — which, in
 * a standing agent serving many people from one process, hands ONE live sandbox
 * to whoever calls next. That is not a leak of memory; it is a leak of a
 * filesystem, an environment and half-run state, across users.
 *
 * ── Why the registration lives on the CONTEXT ───────────────────────────────
 * Not `Tool.dispose()`: a `Tool` is a singleton, built once and shared by every
 * run and every session, so "dispose the tool" cannot mean "dispose this
 * caller's session".
 * Not a lifecycle PORT the consumer wires: that makes the common case (one tool
 * that happens to hold a session) a wiring exercise, and the tool that knows the
 * key is the one that cannot reach the port.
 * `ctx.onTeardown(cleanup, { scope, key })` is the only seam where the key and
 * the resource are both in hand at the same instant.
 *
 * ── The seven laws ──────────────────────────────────────────────────────────
 *  1. **At most once, ever** per registration — the `stopped`-flag mechanism
 *     `strategies/lifecycle.ts` uses for strategies, applied one layer down.
 *  2. **Idempotent within the owner partition (and call for call scope), then `(tool, scope, key)`, first wins.** A second registration
 *     under the same key does not replace the first — the first is the one
 *     holding the live handle; replacing it would drop that handle on the
 *     floor. The repeat is a TOUCH: it refreshes liveness (that is how the
 *     idle sweep and the LRU learn a session is still in use) and answers
 *     `'reused'`.
 *  3. **Reverse order of registration**, settled with `Promise.allSettled`.
 *  4. **Bounded** by `timeoutMs` (default 5s). Teardown is on the SIGTERM path;
 *     an unbounded `stop()` turns a container stop into a wait for SIGKILL.
 *  5. **Never throws into the run** — but **never silent** either. Every
 *     failure, and every timeout, is reported. "Swallowed AND silent" is what
 *     separates a passive recorder from a resource that did not get released.
 *  6. **Tolerates "already gone."** The far side reaps idle sessions on its own
 *     schedule; a `Stop` on a session AWS already collected is a no-op, not an
 *     incident. It still reports, so the difference is visible.
 *  7. **Nothing live is ever persisted.** A checkpoint carries what survives
 *     `structuredClone`; a session handle does not. A resumed run re-opens.
 *
 * Agent component setup registers joined cleanup before effects. Its first
 * tool resource admission borrows this tier before tool code runs, even if that
 * call ultimately registers nothing. Other doors retain their own supported
 * lifetime. No timer or execution queue is introduced.
 */

import {
  readToolOwner,
  readToolCallOwner,
  sameToolBirth,
  type ToolCallOwner,
  type ToolOwnerCarrier,
} from './toolResourceOwner.js';
import '../memory/identity/index.js';
import '../lib/fnv1a.js';
import '../lib/lazyRequire.js';

import type {
  TeardownScope,
  TeardownReason,
  TeardownOptions,
  ToolSessionOrigin,
  RegisterOutcome,
  ToolSessionReport,
  ToolSessionTierOptions,
  ToolSessionBinding,
  ToolSessionView,
} from './toolSessions/contracts.js';
export type {
  TeardownScope,
  TeardownReason,
  TeardownOptions,
  ToolSessionOrigin,
  RegisterOutcome,
  ToolSessionReport,
  ToolSessionTierOptions,
  ToolSessionBinding,
  ToolSessionView,
} from './toolSessions/contracts.js';
import {
  TOOL_TEARDOWN_TIMEOUT_MS,
  TOOL_SESSION_IDLE_MS,
  TOOL_SESSION_MAX_LIVE,
} from './toolSessions/contracts.js';
export {
  TOOL_TEARDOWN_TIMEOUT_MS,
  TOOL_SESSION_IDLE_MS,
  TOOL_SESSION_MAX_LIVE,
} from './toolSessions/contracts.js';
import { hashSessionKey, ownerPartition, sessionPartition } from './toolSessions/keys.js';
export { toolSessionKey, hashSessionKey } from './toolSessions/keys.js';

export class ToolResourceBorrowedError extends Error {
  readonly code = 'ERR_TOOL_RESOURCE_BORROWED' as const;
  constructor() {
    super('This tool resource owner already has an active local borrow');
    this.name = 'ToolResourceBorrowedError';
  }
}
export class ToolResourceClosedError extends Error {
  readonly code = 'ERR_TOOL_RESOURCE_CLOSED' as const;
  constructor() {
    super('This tool resource view is retired');
    this.name = 'ToolResourceClosedError';
  }
}

interface Registration {
  readonly partition?: string;
  readonly logicalCall?: string;
  readonly id: number;
  readonly tool: string;
  readonly scope: TeardownScope;
  readonly key: string;
  readonly keyHash: string;
  readonly origin: ToolSessionOrigin;
  readonly cleanup: () => void | Promise<void>;
  readonly runnerId?: string;
  readonly label?: string;
  readonly startedMs: number;
  touchedMs: number;
  calls: number;
  fired: boolean;
}

/** The existing local registration tier; borrows do not confer remote authority. */
export class ToolSessionTier {
  private readonly registrations = new Map<string, Registration>();
  private readonly borrows = new Map<string, object>();
  private readonly timeoutMs: number;
  private readonly idleMs: number;
  private readonly maxLive: number;
  private readonly report: (report: ToolSessionReport, origin: ToolSessionOrigin) => void;
  private readonly now: () => number;
  private seq = 0;

  constructor(options: ToolSessionTierOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? TOOL_TEARDOWN_TIMEOUT_MS;
    this.idleMs = options.idleMs ?? TOOL_SESSION_IDLE_MS;
    this.maxLive = options.maxLive ?? TOOL_SESSION_MAX_LIVE;
    this.report = options.report ?? ((): void => {});
    this.now = options.now ?? ((): number => Date.now());
  }

  localStatus(
    owner: ToolOwnerCarrier,
    facts: ToolSessionBinding,
  ): 'retained' | 'none-known-locally' {
    return localResourceStatus(
      this.registrations.values(),
      ownerPartition(readToolOwner(owner).birth, facts),
      sessionPartition(facts),
    );
  }

  /** Exclusive local resource-pool borrow, never an execution admission lock. */
  borrow(owner: ToolOwnerCarrier, facts: ToolSessionBinding): ToolSessionView {
    const admitted = readToolOwner(owner);
    const partition = ownerPartition(admitted.birth, facts);
    const conversation = sessionPartition(facts);
    if (this.borrows.has(partition)) throw new ToolResourceBorrowedError();
    const token = {};
    this.borrows.set(partition, token);
    let active = true;
    let closedOrdinal =
      admitted.pending === undefined ? admitted.nextDispatch - 1 : admitted.pending.ordinal - 1;
    const current = (): boolean => active && this.borrows.get(partition) === token;
    const assertActive = (): void => {
      if (!current()) throw new ToolResourceClosedError();
    };
    const callKey = (call: ToolCallOwner): { readonly key: string; readonly ordinal: number } => {
      const checked = readToolCallOwner(call);
      if (!sameToolBirth(checked.birth, admitted.birth))
        throw new TypeError('Tool resource call belongs to another turn');
      return { key: JSON.stringify([partition, checked.ordinal]), ordinal: checked.ordinal };
    };
    return {
      assertActive,
      register: (call, origin, cleanup, options = {}) => {
        if (!current()) {
          // Never retain a late handle in an unreachable/successor row.
          this.rejectLate(origin, cleanup, options);
          throw new ToolResourceClosedError();
        }
        const logicalCall = callKey(call);
        if (logicalCall.ordinal <= closedOrdinal) {
          this.rejectLate(origin, cleanup, options);
          throw new ToolResourceClosedError();
        }
        const persistent = options.scope === 'session' || options.scope === 'shutdown';
        return this.registerOwned(
          origin,
          cleanup,
          options,
          persistent ? conversation : partition,
          logicalCall.key,
        );
      },
      fireCall: async (call) => {
        assertActive();
        const logicalCall = callKey(call);
        if (logicalCall.ordinal <= closedOrdinal) return;
        // Claim retirement synchronously, before any asynchronous cleanup.
        closedOrdinal = logicalCall.ordinal;
        await this.fire(
          (r) =>
            r.partition === partition && r.scope === 'call' && r.logicalCall === logicalCall.key,
          'call-end',
        );
      },
      finish: async (paused) => {
        if (!current()) return;
        active = false;
        try {
          if (!paused)
            await this.fire(
              (r) => r.partition === partition && (r.scope === 'call' || r.scope === 'run'),
              'run-end',
            );
        } finally {
          if (this.borrows.get(partition) === token) this.borrows.delete(partition);
        }
      },
    };
  }

  private rejectLate(
    origin: ToolSessionOrigin,
    cleanup: () => void | Promise<void>,
    options: TeardownOptions,
  ): void {
    const key = options.key ?? `${options.scope ?? 'run'}:${origin.tool}`;
    const now = this.now();
    const registration: Registration = {
      id: ++this.seq,
      tool: origin.tool,
      scope: options.scope ?? 'run',
      key,
      keyHash: hashSessionKey(key),
      origin,
      cleanup,
      ...(options.runnerId !== undefined && { runnerId: options.runnerId }),
      ...(options.label !== undefined && { label: options.label }),
      startedMs: now,
      touchedMs: now,
      calls: 1,
      fired: true,
    };
    this.report(
      {
        kind: 'close-failed',
        tool: origin.tool,
        scope: registration.scope,
        keyHash: registration.keyHash,
        reason: 'run-end',
        durationMs: 0,
        error: 'Late teardown registration refused after resource-owner retirement',
        errorClass: 'ToolResourceClosedError',
      },
      origin,
    );
    this.detach(this.run(registration, 'run-end'));
  }

  /** Live registrations. Diagnostics and tests. */
  liveCount(): number {
    return this.registrations.size;
  }

  /**
   * Resolve once every teardown this tier started IN THE BACKGROUND has
   * settled.
   *
   * Two firings have no caller to await them: the idle sweep and the LRU
   * eviction, both of which are triggered by a SYNCHRONOUS `register()` inside
   * somebody else's `tool.execute`. They cannot be awaited there without making
   * a cleanup's latency the tool's latency, so they run detached — and this is
   * how a shutdown path, or a test, joins them.
   */
  async settled(): Promise<void> {
    while (this.background.size > 0) {
      await Promise.allSettled([...this.background]);
    }
  }

  /** Fires nobody is awaiting — see {@link settled}. */
  private readonly background = new Set<Promise<unknown>>();

  /** Start a detached fire and keep it joinable. */
  private detach(work: Promise<unknown>): void {
    this.background.add(work);
    void work.finally(() => this.background.delete(work));
  }

  /**
   * Register a cleanup, or TOUCH the one already holding this key (law 2).
   *
   * Synchronous and total: it never throws, because it runs inside somebody
   * else's `tool.execute`. Scope support is judged one layer up, where
   * `teardownScopes` is known.
   *
   * @returns `'started'` for a new session, `'reused'` when this call joined
   *   one already held, with `calls` counting how many have now shared it. The
   *   CALLER announces it, because the caller is the one still inside a stage
   *   and able to stamp a real `runtimeStageId` — see {@link RegisterOutcome}.
   */
  register(
    origin: ToolSessionOrigin,
    cleanup: () => void | Promise<void>,
    options: TeardownOptions = {},
  ): { readonly outcome: RegisterOutcome; readonly keyHash: string; readonly calls: number } {
    return this.registerOwned(origin, cleanup, options);
  }

  private registerOwned(
    origin: ToolSessionOrigin,
    cleanup: () => void | Promise<void>,
    options: TeardownOptions,
    partition?: string,
    logicalCall?: string,
  ): { readonly outcome: RegisterOutcome; readonly keyHash: string; readonly calls: number } {
    this.sweepIdle();
    const scope = options.scope ?? 'run';
    const key = options.key ?? `${scope}:${origin.tool}`;
    const mapKey = JSON.stringify([
      partition ?? null,
      scope === 'call' ? logicalCall ?? null : null,
      origin.tool,
      scope,
      key,
    ]);
    const existing = this.registrations.get(mapKey);
    if (existing) {
      // First wins — it is the one holding the live handle. The repeat is what
      // tells the sweep and the LRU that this session is still being used.
      existing.touchedMs = this.now();
      existing.calls += 1;
      return { outcome: 'reused', keyHash: existing.keyHash, calls: existing.calls };
    }
    const nowMs = this.now();
    const registration: Registration = {
      id: ++this.seq,
      ...(partition !== undefined && { partition }),
      ...(logicalCall !== undefined && { logicalCall }),
      tool: origin.tool,
      scope,
      key,
      keyHash: hashSessionKey(partition === undefined ? key : mapKey),
      origin,
      cleanup,
      ...(options.runnerId !== undefined && { runnerId: options.runnerId }),
      ...(options.label !== undefined && { label: options.label }),
      startedMs: nowMs,
      touchedMs: nowMs,
      calls: 1,
      fired: false,
    };
    this.registrations.set(mapKey, registration);
    this.evictOverflow();
    return { outcome: 'started', keyHash: registration.keyHash, calls: 1 };
  }

  /** Fire every `'call'` registration this tool call opened. */
  fireCall(toolCallId: string): Promise<void> {
    return this.fire(
      (r) => r.partition === undefined && r.scope === 'call' && r.origin.toolCallId === toolCallId,
      'call-end',
    ).then(() => undefined);
  }

  /**
   * Fire `'run'`-scoped registrations at a run terminal.
   *
   * Explicit host control for run-scoped rows, optionally restricted to an
   * opening run ID. Ordinary component terminals never use this broad filter.
   * A paused component retains its exact call/run rows through a finite owner
   * reference; its fresh resumed view closes only that owner's rows.
   */
  fireRun(runId?: string): Promise<void> {
    return this.fire(
      (r) => r.scope === 'run' && (runId === undefined || r.origin.runId === runId),
      'run-end',
    ).then(() => undefined);
  }

  /** End run resources for one hosting conversation across pause/resume run IDs. */
  fireSessionRuns(sessionId: string): Promise<number> {
    return this.fire((r) => r.scope === 'run' && r.origin.sessionId === sessionId, 'run-end');
  }

  /**
   * Fire the `'session'` registrations for one hosting session — or, with no
   * `sessionId`, every `'session'` registration there is.
   *
   * Answers how many it closed, so a composition root can log a number instead
   * of hoping.
   */
  fireSession(sessionId?: string, reason: TeardownReason = 'session-end'): Promise<number> {
    return this.fire(
      (r) => r.scope === 'session' && (sessionId === undefined || r.origin.sessionId === sessionId),
      reason,
    );
  }

  /** Fire EVERYTHING, whatever scope it asked for. The backstop. */
  fireShutdown(): Promise<number> {
    return this.fire(() => true, 'shutdown');
  }

  /**
   * Sweep sessions nobody has touched for `idleMs`.
   *
   * LAZY, on the next tier interaction — never a timer. A library that installs
   * an interval keeps the host process alive, which is the same reason
   * `shutdownOn` refuses to grab signals unless asked.
   */
  sweepIdle(): void {
    if (this.registrations.size === 0) return;
    const cutoff = this.now() - this.idleMs;
    const stale = [...this.registrations.values()].filter((r) => r.touchedMs <= cutoff);
    if (stale.length === 0) return;
    this.detach(this.fire((r) => stale.includes(r), 'idle'));
  }

  private evictOverflow(): void {
    if (this.registrations.size <= this.maxLive) return;
    const surplus = this.registrations.size - this.maxLive;
    const coldest = [...this.registrations.values()]
      .sort((a, b) => a.touchedMs - b.touchedMs || a.id - b.id)
      .slice(0, surplus);
    this.detach(this.fire((r) => coldest.includes(r), 'evicted'));
  }

  /**
   * The one firing implementation: select, claim (law 1), reverse (law 3),
   * settle everything (law 5).
   *
   * Selection and claiming happen SYNCHRONOUSLY before the first `await`, so
   * two overlapping fires — a shutdown racing an idle sweep — cannot both take
   * the same registration.
   */
  private async fire(
    match: (registration: Registration) => boolean,
    reason: TeardownReason,
  ): Promise<number> {
    const claimed: Registration[] = [];
    for (const [mapKey, registration] of this.registrations) {
      if (registration.fired || !match(registration)) continue;
      registration.fired = true;
      this.registrations.delete(mapKey);
      claimed.push(registration);
    }
    if (claimed.length === 0) return 0;
    claimed.sort((a, b) => b.id - a.id); // reverse registration order
    await Promise.allSettled(claimed.map((registration) => this.run(registration, reason)));
    return claimed.length;
  }

  /** One cleanup, bounded, reported either way. Never rethrows. */
  private async run(registration: Registration, reason: TeardownReason): Promise<void> {
    const startedAt = this.now();
    const base = {
      tool: registration.tool,
      scope: registration.scope,
      keyHash: registration.keyHash,
      ...(registration.runnerId !== undefined && { runnerId: registration.runnerId }),
      ...(registration.label !== undefined && { label: registration.label }),
      reason,
    } as const;
    try {
      await withTimeout(
        async () => registration.cleanup(),
        this.timeoutMs,
        `${registration.tool} teardown`,
      );
      this.report(
        {
          ...base,
          kind: 'closed',
          durationMs: this.now() - startedAt,
        },
        registration.origin,
      );
    } catch (err) {
      // Law 5: swallowed at the caller, never silent on the wire.
      this.report(
        {
          ...base,
          kind: 'close-failed',
          durationMs: this.now() - startedAt,
          error: err instanceof Error ? err.message : String(err),
          ...(err instanceof Error && { errorClass: err.constructor?.name ?? err.name }),
        },
        registration.origin,
      );
    }
  }
}

/** A teardown that outran its budget. Named so an alert can route on it. */
export class ToolTeardownTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(what: string, timeoutMs: number) {
    super(
      `${what} did not finish within ${timeoutMs}ms and was abandoned. The cleanup may still ` +
        'be running; the runner stopped waiting so a shutdown cannot hang on a vendor call.',
    );
    this.name = 'ToolTeardownTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * This process no longer holds the handle a conversation's session was reached
 * by, so the call was not sent.
 *
 * Not an expiry: nothing was sent and nothing answered. The transport that held
 * the handle forgot it (`evidence`), and the remote session's fate is unknown
 * (`remote`) — it may still run, and it can no longer be ended from here,
 * because its id went with the handle.
 *
 * The message is one fixed sentence; `cause`, when present, is for the app.
 */
export class LocalSessionHandleLostError extends Error {
  readonly code = 'ERR_LOCAL_SESSION_HANDLE_LOST' as const;
  /** What proves the loss: the transport no longer holds the handle. */
  readonly evidence = 'transport-forgot-handle' as const;
  /** What is known of the remote session: nothing. */
  readonly remote = 'unknown' as const;

  constructor(options: { readonly cause?: unknown } = {}) {
    super(
      'The session for the call this result answers could not be reached from here, so that call was not sent.',
      {
        ...(options.cause !== undefined && { cause: options.cause }),
      },
    );
    this.name = 'LocalSessionHandleLostError';
  }
}

/**
 * Is `error` a {@link LocalSessionHandleLostError}? By its code as well as its
 * class, so a second copy of the module (a CJS and an ESM build in one
 * process) is still recognised.
 */
export function isLocalSessionHandleLost(error: unknown): error is LocalSessionHandleLostError {
  return (
    error instanceof LocalSessionHandleLostError ||
    (error !== null &&
      typeof error === 'object' &&
      (error as { readonly code?: unknown }).code === 'ERR_LOCAL_SESSION_HANDLE_LOST')
  );
}

/**
 * Run `work`, giving up after `timeoutMs`.
 *
 * The abandoned promise is deliberately NOT cancelled — there is nothing to
 * cancel a vendor's in-flight `Stop` with, and pretending otherwise would be
 * worse than saying we stopped waiting. The timer is unref'd where the runtime
 * allows it, so a pending teardown can never be the reason a process stays up.
 *
 * Shared, not copied: the MCP client's `terminate()` bounds its wait with it.
 *
 * @throws {@link ToolTeardownTimeoutError} when `timeoutMs` passes first; what
 *   `work` throws, otherwise
 */
export async function withTimeout(
  work: () => Promise<void>,
  timeoutMs: number,
  what: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ToolTeardownTimeoutError(what, timeoutMs)), timeoutMs);
        (timer as { unref?: () => void }).unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
