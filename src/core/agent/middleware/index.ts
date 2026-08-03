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
  ToolMiddleware,
  ToolMiddlewareContext,
  ToolOutcome,
} from './types.js';
