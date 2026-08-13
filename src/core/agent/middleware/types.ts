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
 * `ToolResultOutcome` does not either — see below.
 *
 * ## The two moments of a tool call
 *
 * A tool middleware may speak twice about one call:
 *
 *   `onToolCall`    BEFORE dispatch — about the call. Three verbs.
 *   `onToolResult`  AFTER the tool ran, before its result enters the history
 *                   or reaches the model — about the result. Two verbs.
 *
 * Each hook is named for what it RECEIVES; the moments they sit at are named
 * `'before-tool'` and `'after-tool'` (and `.act()`'s keys after those).
 *
 * Either hook alone is a whole middleware; a link with only `onToolResult`
 * does not take part in dispatch at all. The chain walks the two moments in **onion
 * order**: the first-declared link sees the CALL first and the RESULT last —
 * first word going in, last word coming out — which is the order that lets an
 * outer rule inspect what every inner rule already did.
 *
 * **There is no `ask` at the after-tool moment.** Not because the machinery is missing —
 * the dispatch loop pauses perfectly well — but because the tool has ALREADY
 * RUN. A person woken to answer a question about a side effect that already
 * happened cannot prevent it; the honest verbs there are "let the result
 * through" and "do not let the model see it", and both are available now. The
 * business cases this was measured against — authorize before, hide from the
 * model, annotate the result, attach a fact through a context trigger — none
 * of them needed a person at that moment. This is a refusal, not an oversight,
 * and it is written here so evidence can promote it later: bring a case that
 * genuinely needs a human at the after-tool moment and the arm can be added, on the
 * pause machinery that already exists.
 */

import type { LLMMessage } from '../../../adapters/types.js';
import type { AskComponent } from '../../askComponent.js';
import type { MemoryIdentity } from '../../../memory/identity/types.js';
import type { LoopMoment } from '../moments.js';

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
  /**
   * Which REGISTERED screen component collects the answer (9.24.0) — ids and
   * props only, never markup. Small props inline; big props as an artifact
   * ref (`propsRef`), validated to resolve at raise time. Absent → the prose
   * `question`, exactly as before.
   */
  readonly component?: AskComponent;
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

/**
 * Everything a tool middleware may answer at the after-tool moment. Two arms,
 * and no `ask` — the tool has already run, so there is nothing left for a
 * person to prevent (see the header).
 *
 * `allow()` lets the real result through. `allow(value, why)` replaces what
 * the MODEL reads while the run commits both versions. `deny(reason)` sends
 * the reason to the model instead of the result — and the run still records
 * the result, because the side effect happened and a record that hid it would
 * be a record that lies.
 *
 * A tool result can be any value, so the transform arm is `unknown`. One
 * sharp edge follows from `allow`'s own rule: `allow(undefined, why)` is a
 * pass-through carrying a reason, not a replacement — there is no spelling of
 * "replace the result with `undefined`". To keep a result away from the model
 * use `deny(reason)`, which says so in the record.
 */
export type ToolResultOutcome = AllowOutcome<unknown> | DenyOutcome;

// ─── What a middleware is handed ─────────────────────────────────────

/** The call a tool middleware is deciding about. */
export interface ToolMiddlewareContext {
  readonly toolName: string;
  /**
   * Where the tool being called came from — `Tool.source`, which `mcpClient`
   * fills with the server's name.
   *
   * **Absent means the agent's own tool.** A name alone is not an identity: two
   * MCP servers may both serve a `call_aws`, and a policy matching the bare
   * name governs whichever one answers — including the one it was never written
   * about. With this, `call.toolSource === 'aws-prod'` is a rule that means what
   * it says, and `call.toolSource === undefined` is the honest way to spell
   * "something we wrote ourselves".
   */
  readonly toolSource?: string;
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

/**
 * The finished call `onToolResult` is deciding about: everything `onToolCall`
 * saw, plus what came back.
 *
 * `args` here are the args the tool ACTUALLY RAN WITH — every before-transform
 * applied — so a rule reading both fields is reading one coherent event rather
 * than the model's proposal beside somebody else's answer.
 */
export interface ToolResultContext extends ToolMiddlewareContext {
  /**
   * What the tool returned. Whatever the tool's own return type is, un-
   * stringified — the conversion to the text the model reads happens after
   * this chain, so a rule can inspect the real object.
   */
  readonly result: unknown;
  /**
   * Present and `true` when the tool THREW and `result` is the error's
   * message. The call still executed, which is why this moment happens at
   * all: a tool that failed halfway may have done half its work.
   */
  readonly error?: true;
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

/** What both arms of {@link ToolMiddleware} carry. */
interface ToolMiddlewareIdentity {
  /** Identifies this middleware in every ledger row and event it produces. */
  readonly name: string;
}

/** A link that decides about the CALL, and may also decide about the result. */
export interface ToolCallMiddleware extends ToolMiddlewareIdentity {
  onToolCall(call: ToolMiddlewareContext): ToolOutcome | Promise<ToolOutcome>;
  onToolResult?(call: ToolResultContext): ToolResultOutcome | Promise<ToolResultOutcome>;
}

/** A link that decides only about the RESULT. It takes no part in dispatch. */
export interface ToolResultMiddleware extends ToolMiddlewareIdentity {
  onToolCall?: never;
  onToolResult(call: ToolResultContext): ToolResultOutcome | Promise<ToolResultOutcome>;
}

/**
 * One link in the tool chain — a rule about the call, about the result, or
 * about both.
 *
 * The union is the point: an object with a `name` and no hook would be a
 * governance rule that silently never runs, so it does not type-check. Which
 * hooks a link has is what decides where it speaks — never which list it was
 * written in.
 *
 * @example
 * ```ts
 * const noProdWrites: ToolMiddleware = {
 *   name: 'no-prod-writes',
 *   onToolCall: (call) =>
 *     call.args.env === 'prod' ? deny('writes to prod need a change ticket') : allow(),
 * };
 *
 * const hideRawPII: ToolMiddleware = {
 *   name: 'hide-raw-pii',
 *   onToolResult: (call) =>
 *     hasSSN(call.result)
 *       ? deny('the record exists but its raw contents are not for the model')
 *       : allow(),
 * };
 * ```
 */
export type ToolMiddleware = ToolCallMiddleware | ToolResultMiddleware;

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
  /**
   * WHERE IN THE LOOP this decision happened — the same five words `.act()`
   * is keyed on, so a row and the door that filed it are read in one
   * vocabulary.
   *
   * `at` and `phase` below say the same thing in the spelling 7.18 shipped
   * with. They are committed state and they are not going anywhere; this is
   * the newer word for the same fact, and the one to narrow on.
   */
  readonly moment: LoopMoment;
  /** Which chain this row came from. The older spelling — see `moment`. */
  readonly at: 'tool' | 'message';
  /** Message chain only. The older spelling — see `moment`. */
  readonly phase?: 'input' | 'output';
  /** Tool chain only. */
  readonly toolName?: string;
  /** Tool chain only. */
  readonly toolCallId?: string;
  /** ReAct iteration. `0` for the `'input'` phase, which runs before iter 1. */
  readonly iteration: number;
  readonly outcome: 'allow' | 'deny' | 'ask';
  /**
   * True when this row changed the value the chain carries forward.
   *
   * A refusal at `'before-tool'` leaves nothing to change — the call does not
   * happen. A refusal at `'after-tool'` DOES change something: the tool ran,
   * and the model is handed the reason instead of what came back. Those rows
   * carry `changed: true` with the real result in `before`.
   */
  readonly changed: boolean;
  /** The transform's `why`, the denial's `reason`, or the ask's `question`. */
  readonly why?: string;
  /**
   * The value before this middleware. Present only when `changed`.
   *
   * At `'after-tool'` this is the tool's REAL result — including on a
   * refusal, where it is the only copy in the run, because the side effect
   * happened and a record that dropped it would be a record that lies. If it
   * must not survive in the commit log, that is footprintjs redaction over
   * this key: the row survives, the value does not.
   */
  readonly before?: unknown;
  /** The value after this middleware. Present only when `changed`. */
  readonly after?: unknown;
  /**
   * The registered component that COLLECTED this decision (9.24.0). Present
   * only on the resume-side rows of an `ask` that carried one — the trace
   * then says which surface the person answered through. Never inferred.
   */
  readonly componentId?: string;
}
