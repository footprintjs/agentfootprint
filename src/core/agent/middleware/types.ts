/**
 * middleware/types — PUBLIC. The shape of a governance chain.
 *
 * Pattern: Chain of Responsibility (GoF), with the one dangerous answer
 *          removed at the type level.
 * Role:    core/ layer. Two chains, one vocabulary:
 *
 *            `toolMiddleware`     wraps every tool dispatch
 *            `messageMiddleware`  wraps the message boundary — the input
 *                                 before the model sees it, the output
 *                                 before the caller receives it
 *
 * Emits:   N/A. A middleware is a pure decision. It never touches scope,
 *          never emits and never writes — the stage does all of that, so
 *          "record everything that happened" lives in ONE place rather
 *          than being re-implemented per middleware.
 *
 * ## The law that shapes these types
 *
 * **A middleware cannot answer for the tool.** The outcome union has three
 * arms — allow, deny, ask — and no `result` arm. There is no spelling of
 * "here is what the tool would have returned". Whatever the chain decides,
 * the answer the model finally reads is the real tool's output or a
 * refusal. That is not a convention a reviewer has to enforce; it is the
 * absence of a field.
 *
 * **A transform declares itself.** `allow(value, why)` requires a reason
 * whenever it changes something, and the stage commits BOTH the original
 * and the transformed value into the run's ledger. A prompt scrubbed by a
 * middleware that hid its own scrubbing would poison every slice taken
 * afterwards: the trace would show text nobody ever sent.
 *
 * **`ask` exists only where a pause exists.** `ToolOutcome` has it because
 * tool dispatch runs inside a footprintjs pausable stage — the same door
 * `checkIn` and `askHuman` already go through. `MessageOutcome` does not,
 * because the message boundary is a plain stage, and inventing a second
 * pause to give it one would be a worse answer than not offering it.
 */

import type { LLMMessage } from '../../../adapters/types.js';
import type { MemoryIdentity } from '../../../memory/identity/types.js';

// ─── The outcomes ────────────────────────────────────────────────────

/**
 * Let the call through — optionally with a replacement for what the chain
 * carries forward.
 *
 * `allow()` passes the value along untouched. `allow(value, why)` replaces
 * it and says why; the `why` is not decoration, it is the row the ledger
 * shows a person asking "who changed this, and what did it look like
 * before?".
 */
export interface AllowOutcome<T> {
  readonly kind: 'allow';
  /** The replacement value. Absent = pass through unchanged. */
  readonly value?: T;
  /** Why the value changed. Present whenever `value` is. */
  readonly why?: string;
}

/**
 * Refuse the call. For a tool, `reason` reaches the model verbatim as the
 * tool result and the run continues — a denial is data the agent can adapt
 * to, not a crash. For a message, `reason` surfaces as a
 * `MessageDeniedError` at the API boundary.
 */
export interface DenyOutcome {
  readonly kind: 'deny';
  readonly reason: string;
}

/** Suspend the run and put the question to a person. Tool dispatch only. */
export interface AskOutcome {
  readonly kind: 'ask';
  readonly payload: AskPayload;
}

/** What a person is being asked. Carried verbatim to the checkpoint. */
export interface AskPayload {
  /** The question, in your own words. Shown to whoever answers. */
  readonly question: string;
  /** Anything else the answering UI should render. Never interpreted here. */
  readonly detail?: unknown;
}

/**
 * Everything a tool middleware may answer. Closed, and every arm has a
 * home in this codebase: allow rides the normal dispatch, deny rides the
 * synthetic tool result every other gate already uses, ask rides the
 * pausable-stage checkpoint that `checkIn` rides.
 */
export type ToolOutcome =
  | AllowOutcome<Readonly<Record<string, unknown>>>
  | DenyOutcome
  | AskOutcome;

/** Everything a message middleware may answer. No `ask` — see the header. */
export type MessageOutcome = AllowOutcome<string> | DenyOutcome;

// ─── What a middleware is handed ─────────────────────────────────────

/** The call a tool middleware is deciding about. */
export interface ToolMiddlewareContext {
  readonly toolName: string;
  /** Matches `stream.tool_start.toolCallId` for this dispatch. */
  readonly toolCallId: string;
  /** ReAct iteration this call belongs to. */
  readonly iteration: number;
  /**
   * The args as THIS middleware sees them — every earlier transform in the
   * chain already applied. The first middleware sees what the model asked
   * for; the last sees what the tool is about to receive.
   */
  readonly args: Readonly<Record<string, unknown>>;
  /** Conversation so far, including the assistant turn that made this call. */
  readonly history: readonly LLMMessage[];
  /** Multi-tenant run identity, when the run carried one. */
  readonly identity?: MemoryIdentity;
  /** Abort signal from `run({ env: { signal } })`. */
  readonly signal?: AbortSignal;
}

/** The message a message middleware is deciding about. */
export interface MessageMiddlewareContext {
  /**
   * `'input'` runs at the very top of the run, BEFORE the user's message is
   * committed — so the window strategies, the injections, the slots, the
   * request bytes and every later slice all see the transformed text and
   * agree with each other. `'output'` runs where the final answer is
   * captured, so the record and the caller receive the same string.
   */
  readonly phase: 'input' | 'output';
  /** The content as THIS middleware sees it — earlier transforms applied. */
  readonly content: string;
  /** Conversation so far. Empty at `'input'`. */
  readonly history: readonly LLMMessage[];
  readonly identity?: MemoryIdentity;
  readonly signal?: AbortSignal;
}

// ─── The middlewares ─────────────────────────────────────────────────

/**
 * One link in the tool-dispatch chain.
 *
 * @example
 * ```ts
 * const noProdWrites: ToolMiddleware = {
 *   name: 'no-prod-writes',
 *   onToolCall: (call) =>
 *     call.args.env === 'prod' ? deny('writes to prod need a change ticket') : allow(),
 * };
 * ```
 */
export interface ToolMiddleware {
  /** Identifies this middleware in every ledger row and event it produces. */
  readonly name: string;
  onToolCall(call: ToolMiddlewareContext): ToolOutcome | Promise<ToolOutcome>;
}

/**
 * One link in the message chain. Runs at both phases unless it decides
 * otherwise by reading `msg.phase`.
 *
 * @example
 * ```ts
 * const scrubSSNs: MessageMiddleware = {
 *   name: 'scrub-ssns',
 *   onMessage: (msg) => {
 *     const clean = msg.content.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]');
 *     return clean === msg.content ? allow() : allow(clean, 'masked a US SSN');
 *   },
 * };
 * ```
 */
export interface MessageMiddleware {
  readonly name: string;
  onMessage(msg: MessageMiddlewareContext): MessageOutcome | Promise<MessageOutcome>;
}

// ─── The ledger ──────────────────────────────────────────────────────

/**
 * One row per middleware decision, committed to `scope.middlewareDecisions`.
 *
 * Every decision files a row, including the pass-throughs. A chain that
 * only recorded its refusals would leave you unable to tell "the middleware
 * looked and was fine with it" apart from "the middleware never ran" — and
 * those are different facts about a run.
 */
export interface MiddlewareDecision {
  /** The middleware's `name`. */
  readonly middleware: string;
  /** Which chain this row came from. */
  readonly at: 'tool' | 'message';
  /** Message chain only. */
  readonly phase?: 'input' | 'output';
  /** Tool chain only. */
  readonly toolName?: string;
  /** Tool chain only. */
  readonly toolCallId?: string;
  /** ReAct iteration. `0` for the `'input'` phase, which runs before iter 1. */
  readonly iteration: number;
  readonly outcome: 'allow' | 'deny' | 'ask';
  /** True when this row changed the value the chain carries forward. */
  readonly changed: boolean;
  /** The transform's `why`, the denial's `reason`, or the ask's `question`. */
  readonly why?: string;
  /** The value before this middleware. Present only when `changed`. */
  readonly before?: unknown;
  /** The value after this middleware. Present only when `changed`. */
  readonly after?: unknown;
}
