/**
 * MessageDeniedError — typed error thrown by `Agent.run()` when a
 * `messageMiddleware` returns `deny(reason)`.
 *
 * Pattern: Typed Error (the `PolicyHaltError` shape, for the same reason).
 * Role:    Surface layer for the message boundary. The stage writes the
 *          refusal to scope; `Agent.finalizeResult` translates it here, so
 *          a caller can `instanceof` it and route on `.phase` / `.middleware`.
 * Emits:   N/A — `agentfootprint.middleware.decision` fires from the stage
 *          at the moment the refusal is decided.
 *
 * ## Why a refusal is not returned as an answer
 *
 * At the `'input'` phase there is no model to tell: the message never
 * reached one, so there is nothing in the run for a denial to become. At
 * the `'output'` phase there IS an answer, and the middleware has just
 * refused to release it — handing the caller a string in its place is the
 * one substitution a caller must never be able to make silently. Both
 * phases therefore raise, exactly the way a policy halt does.
 *
 * ## What it deliberately does not carry
 *
 * Never the refused content. A middleware that suppressed an answer would
 * be undone by an error object that carried the answer out anyway. The
 * content stays where the run put it — in the commit log, under whatever
 * redaction the run configured.
 *
 * @example
 *   try {
 *     await agent.run({ message: userText });
 *   } catch (e) {
 *     if (e instanceof MessageDeniedError) {
 *       console.log(`${e.middleware} refused this ${e.phase}: ${e.reason}`);
 *     } else throw e;
 *   }
 */

export interface MessageDeniedContext {
  /** The refusal text the middleware returned. */
  readonly reason: string;
  /** Which boundary refused. */
  readonly phase: 'input' | 'output';
  /** `name` of the middleware that returned `deny`. */
  readonly middleware: string;
}

export class MessageDeniedError extends Error {
  readonly code = 'ERR_MESSAGE_DENIED' as const;
  readonly reason: string;
  readonly phase: 'input' | 'output';
  readonly middleware: string;

  constructor(ctx: MessageDeniedContext) {
    super(`Message denied at '${ctx.phase}' by '${ctx.middleware}': ${ctx.reason}`);
    this.name = 'MessageDeniedError';
    this.reason = ctx.reason;
    this.phase = ctx.phase;
    this.middleware = ctx.middleware;
  }
}
