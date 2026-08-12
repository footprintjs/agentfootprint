/**
 * toolSessions — the end-signal a tool can be handed, and the tier that fires it.
 *
 * Pattern: Registrar + Template Method for the firing matrix.
 * Role:    core primitive. `ToolExecutionContext.onTeardown` registers here;
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
 *  2. **Idempotent by `(tool, scope, key)`, first wins.** A second registration
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
 * Zero-cost when unused: no tool registers → the runner never builds a tier →
 * the terminal path is one `undefined` check.
 */

import { fnv1a } from '../lib/fnv1a.js';
import { lazyRequire } from '../lib/lazyRequire.js';
import type { ToolExecutionContext } from './tools.js';

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
   * Dedup key within `(tool, scope)`. Omitted → the tool gets one registration
   * per scope, which is right for a tool that holds exactly one thing.
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

/**
 * Derive the isolation key a tool should hold a session under.
 *
 * ONE implementation, exported, because the derivation is the security
 * boundary. Returns `undefined` when the facts the scope needs are absent —
 * which is a refusal to guess, not a failure: the caller decides whether to
 * narrow the scope loudly or refuse the call.
 *
 * ```
 * session →  t=<tenant|_>/p=<principal|_>/s=<sessionId>     requires sessionId
 * run     →  t=<tenant|_>/p=<principal|_>/r=<runId>         requires runId
 * call    →  c=<toolCallId>                                 always available
 * ```
 *
 * **`sessionId` alone must never key a live session.** The hosting port says
 * why in its own words: a `sessionId` "is not identity and must never be
 * trusted as identity on its own: anyone who can reach the host can put any
 * string here, including someone else's." A code interpreter keyed on
 * `sessionId` alone hands a live sandbox — files, environment, half-run state —
 * to anyone who guesses one. Tenant and principal are in the key whenever they
 * exist; a deployment that has no principal is thereby STATING it is
 * single-principal rather than quietly assuming it.
 *
 * `'shutdown'` is not a key scope: it is when everything goes, not a thing to
 * hold one session under. Ask for it and you get `undefined`.
 *
 * @example
 *   const key = toolSessionKey(ctx, 'run');
 *   if (!key) throw new Error("run_code: scope 'run' needs a run …");
 */
export function toolSessionKey(
  ctx: Pick<ToolExecutionContext, 'toolCallId' | 'runId' | 'sessionId' | 'identity'>,
  scope: TeardownScope,
): string | undefined {
  if (scope === 'call') return `c=${ctx.toolCallId}`;
  if (scope === 'shutdown') return undefined;
  const tenant = ctx.identity?.tenant || '_';
  const principal = ctx.identity?.principal || '_';
  const prefix = `t=${tenant}/p=${principal}`;
  if (scope === 'session') {
    return ctx.sessionId ? `${prefix}/s=${ctx.sessionId}` : undefined;
  }
  return ctx.runId ? `${prefix}/r=${ctx.runId}` : undefined;
}

/**
 * A short, stable digest of an isolation key.
 *
 * The key carries tenant, principal and the hosting `sessionId`. Publishing it
 * on the event wire would put a user identifier into every exporter's payload —
 * so the wire carries this instead, which is enough to JOIN two rows and not
 * enough to name whose they are. `meta.sessionId` already carries the session
 * legitimately (9.4.0); the payload does not repeat it.
 *
 * SHA-256, first 12 hex chars, wherever `node:crypto` resolves. In a browser
 * bundle, where it does not, this falls back to the package's non-cryptographic
 * FNV-1a digest — stated here rather than implied, because a fallback nobody
 * documented is how "hashed" comes to mean less than a reader assumed.
 */
export function hashSessionKey(key: string): string {
  const crypto = loadCrypto();
  if (crypto) return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
  return fnv1a(key);
}

type NodeCryptoModule = typeof import('node:crypto');
let cryptoModule: NodeCryptoModule | undefined | null;

function loadCrypto(): NodeCryptoModule | undefined {
  if (cryptoModule !== undefined) return cryptoModule ?? undefined;
  try {
    const mod = lazyRequire<NodeCryptoModule>('node:crypto');
    cryptoModule = typeof mod?.createHash === 'function' ? mod : null;
  } catch {
    cryptoModule = null;
  }
  return cryptoModule ?? undefined;
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
  readonly report?: (report: ToolSessionReport) => void;
  /** Clock seam — tests drive idle and duration without waiting. */
  readonly now?: () => number;
}

interface Registration {
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
  /** One-way. Law 1. */
  fired: boolean;
}

/**
 * The teardown tier for one runner.
 *
 * Holds nothing until a tool registers, and the runner builds one only when
 * that happens — so an agent whose tools hold no sessions pays a single
 * `undefined` check at each terminal and nothing else.
 */
export class ToolSessionTier {
  private readonly registrations = new Map<string, Registration>();
  private readonly timeoutMs: number;
  private readonly idleMs: number;
  private readonly maxLive: number;
  private readonly report: (report: ToolSessionReport) => void;
  private readonly now: () => number;
  private seq = 0;

  constructor(options: ToolSessionTierOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? TOOL_TEARDOWN_TIMEOUT_MS;
    this.idleMs = options.idleMs ?? TOOL_SESSION_IDLE_MS;
    this.maxLive = options.maxLive ?? TOOL_SESSION_MAX_LIVE;
    this.report = options.report ?? ((): void => {});
    this.now = options.now ?? ((): number => Date.now());
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
    this.sweepIdle();
    const scope = options.scope ?? 'run';
    const key = options.key ?? `${scope}:${origin.tool}`;
    const mapKey = `${origin.tool} ${scope} ${key}`;
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
      tool: origin.tool,
      scope,
      key,
      keyHash: hashSessionKey(key),
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
      (r) => r.scope === 'call' && r.origin.toolCallId === toolCallId,
      'call-end',
    ).then(() => undefined);
  }

  /**
   * Fire `'run'`-scoped registrations at a run terminal.
   *
   * Called from `Agent.run`/`resume` at a terminal that is NOT a pause — and
   * deliberately not from a `finally`, which also runs on the two pause shapes.
   *
   * **`runId` is optional, and the Agent omits it.** A `'run'` scope means
   * "release this when the TURN that opened it ends", and a turn is not a
   * runId: a pause and its resume are one turn across two runs (`resume()`
   * builds a fresh executor with a fresh id). Filtering on the id would leave
   * every session a paused turn had opened alive forever — the failure would
   * look like nothing at all, because the run answered fine.
   *
   * Firing all of them is exactly right under the runner's own
   * ONE-IN-FLIGHT-RUN-PER-AGENT invariant: at a terminal there is no other turn
   * whose sessions these could be. An ABANDONED pause is the interesting case
   * and it lands the right way round too — the next completed turn releases
   * what the abandoned one left holding.
   *
   * Pass an id where a caller really does mean one specific run.
   */
  fireRun(runId?: string): Promise<void> {
    return this.fire(
      (r) => r.scope === 'run' && (runId === undefined || r.origin.runId === runId),
      'run-end',
    ).then(() => undefined);
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
      this.report({
        ...base,
        kind: 'closed',
        durationMs: this.now() - startedAt,
      });
    } catch (err) {
      // Law 5: swallowed at the caller, never silent on the wire.
      this.report({
        ...base,
        kind: 'close-failed',
        durationMs: this.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
        ...(err instanceof Error && { errorClass: err.constructor?.name ?? err.name }),
      });
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
 * Run `work`, giving up after `timeoutMs`.
 *
 * The abandoned promise is deliberately NOT cancelled — there is nothing to
 * cancel a vendor's in-flight `Stop` with, and pretending otherwise would be
 * worse than saying we stopped waiting. The timer is unref'd where the runtime
 * allows it, so a pending teardown can never be the reason a process stays up.
 */
async function withTimeout(
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
