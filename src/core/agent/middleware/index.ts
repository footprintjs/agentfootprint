/**
 * middleware — PUBLIC barrel. The governance chain family.
 *
 * Two chains, one vocabulary:
 *
 *   `.toolMiddleware(...)`     wraps every tool dispatch
 *   `.messageMiddleware(...)`  wraps the message boundary — the input
 *                              before the model sees it, the output before
 *                              the caller receives it
 *
 * Three verbs: `allow`, `deny`, `ask`. There is no fourth, and in
 * particular there is no way to return a result — see `types.ts`.
 *
 * A tool link may speak twice: `onToolCall` about the call, `onToolResult`
 * about the result. The chain is walked forwards for the first and backwards for the
 * second, so the first-declared link has the first word going in and the last
 * word coming out.
 */

export { allow, ask, deny } from './outcomes.js';
export { MessageDeniedError, type MessageDeniedContext } from './errors.js';
export type {
  AllowOutcome,
  AskOutcome,
  AskPayload,
  DenyOutcome,
  MessageMiddleware,
  MessageMiddlewareContext,
  MessageOutcome,
  MiddlewareDecision,
  ToolCallMiddleware,
  ToolMiddleware,
  ToolMiddlewareContext,
  ToolOutcome,
  ToolResultContext,
  ToolResultMiddleware,
  ToolResultOutcome,
} from './types.js';
