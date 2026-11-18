import type { LoopMoment } from './dependencyTypes.js';
import type { FixedPauseReason } from './agent.js';

// error.fatal + pause (always-on from library core)
export interface ErrorFatalPayload {
  readonly error: string;
  readonly stage: string;
  readonly scope: string;
}

export interface PauseRequestPayload {
  readonly reason: FixedPauseReason | (string & Record<never, never>);
  readonly questionPayload: Readonly<Record<string, unknown>>;
}

export interface PauseResumePayload {
  /**
   * The reply the run resumed with. For the inputs layer's own ask
   * (`awaitingInput.context.agentfootprint.ask === 'arguments'`) every
   * answered value reads `'REDACTED'` — the reply's shape (request id, field
   * ids) travels, the person's values do not, because they fill arguments a
   * tool's view may hide; the `answered` argument rows carry what each tool's
   * view allows.
   */
  readonly resumeInput: Readonly<Record<string, unknown>>;
  readonly pausedDurationMs: number;
  /** The registered component the paused ask nominated to collect its answer
   *  (9.24.0) — read from the checkpoint's own pause payload, whichever pause
   *  kind carried it. Absent when the ask was prose-only. */
  readonly componentId?: string;
}

// ─── check-in (evidence-carrying human consent) ───────────────────────
/** A tool declared `checkIn` and it tripped — the run paused to ask a human,
 *  with the evidence pack riding the ask. Emitted BEFORE the tool executes. */
export interface CheckInRequestPayload {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  /** The typed ask + evidence pack (`CheckInRequest`). JSON/clone-safe. */
  readonly request: Readonly<Record<string, unknown>>;
}
/** A human answered a pending check-in. Emitted on resume, BEFORE the tool
 *  runs (approve) or the decline result lands. */
export interface CheckInDecisionPayload {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  /** The request the decision answered — `CheckInRequest.id` of the ask it
   *  closes, so the record joins each decision to the one request it was for. */
  readonly requestId: string;
  readonly approved: boolean;
  readonly by: string;
  readonly note?: string;
  /**
   * The arguments the tool's view hid from the person when they decided — the
   * names the request carried (`CheckInRequest.hiddenArgs`), kept with the
   * pause and bound into the request id, never worked out again from the tool
   * at resume — so a later reader can tell this decision was given without
   * seeing those values. Names only, never values. Absent when the view hid
   * nothing. `'not-recorded'` when the pause was stored before the list
   * existed: the record does not say what was hidden. Under a run's
   * redaction policy the names are served like any string the library did not
   * write: masked, as the tool's name is.
   */
  readonly hiddenArgs?: readonly string[] | 'not-recorded';
  /** The registered component that COLLECTED this decision (9.24.0) — the
   *  `componentId` the ask carried. Absent when the ask was prose-only. The
   *  decision itself is unchanged: a structured fact, never parsed from the
   *  words a screen rendered. */
  readonly componentId?: string;
}

// ─── middleware (the governance chains) ───────────────────────────────
/**
 * One link of a `toolMiddleware` / `messageMiddleware` chain answered.
 *
 * Its own domain rather than a `permission.check` with a different label:
 * a middleware decision is not a permission check, and reporting it as one
 * would make every consumer reading that channel believe a checker they
 * never configured had fired.
 *
 * Deliberately carries no `before` / `after` — the values live in the
 * committed `middlewareDecisions` ledger, under whatever redaction the run
 * configured. An event stream is a fan-out to sinks we do not control, and
 * a scrubbed value should not leave the run through it.
 */
export interface MiddlewareDecisionPayload {
  readonly middleware: string;
  /** Where in the loop this happened — the vocabulary `.act()` is keyed on. */
  readonly moment: LoopMoment;
  /** The 7.18 spelling of the same fact. Narrow on `moment`. */
  readonly at: 'tool' | 'message';
  readonly phase?: 'input' | 'output';
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly iteration: number;
  readonly outcome: 'allow' | 'deny' | 'ask';
  /** True when this link changed the value the chain carries forward. */
  readonly changed: boolean;
  /** The transform's `why`, the denial's `reason`, or the ask's `question`. */
  readonly why?: string;
  /** The registered component that COLLECTED this decision (9.24.0). Present
   *  only on the resume-side rows of an `ask` that carried one. */
  readonly componentId?: string;
}
