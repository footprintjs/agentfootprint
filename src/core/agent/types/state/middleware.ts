import type { MiddlewareDecision } from '../../middleware/types.js';

export interface MiddlewareState {
  // ── The middleware ledger (`.toolMiddleware()` / `.messageMiddleware()`) ──
  /** One row per middleware decision, in the order they were decided —
   *  including the pass-throughs, because "the rule looked and was fine with
   *  it" and "the rule never ran" are different facts about a run. A transform
   *  files both the value it received and the value it produced, so a slice
   *  taken later can find the moment the text changed and who changed it.
   *  Written only by an agent that configured a chain; absent otherwise. */
  middlewareDecisions?: readonly MiddlewareDecision[];
  /** Set by the seed / prepare-final stage when a `messageMiddleware` returned
   *  `deny`. Read at the API boundary, where it becomes a `MessageDeniedError`.
   *  Never carries the refused content — see MessageDeniedError. */
  messageDeniedReason?: string;
  messageDeniedPhase?: 'input' | 'output';
  messageDeniedBy?: string;
}
