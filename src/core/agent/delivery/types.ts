/**
 * delivery/types — what the `Deliver` stage records about itself.
 *
 * Two shapes, one per outcome, both plain data so they survive
 * `structuredClone` and land in the commit log as-is. Together they are the
 * committed answer to "is my `slot: 'messages'` declaration on the wire, and
 * if not, why not?" — asked of `snapshot.sharedState.messagesDelivery`, or of
 * any commit-log query over the `Deliver` stage's own write.
 */

import type { ContextSource } from '../../../events/types.js';
import type { WireRole } from '../../../adapters/types.js';
import type { DeferralReason } from '../../../lib/injection-engine/messagesSlotRefusal.js';

/** One injection message that entered the window this iteration. */
export interface DeliveredMessage {
  readonly injectionId: string;
  readonly flavor: ContextSource;
  readonly role: WireRole;
  /**
   * Index of the message in `scope.history` — which IS the index in
   * `LLMRequest.messages`, because `callLLM` sends the window verbatim.
   * This is the index a `CacheMarker{field:'messages'}` names.
   */
  readonly wireIndex: number;
  /**
   * The same content hash the messages slot reports as injected and the
   * window stage reports as evicted, so all three name one piece of context
   * by one name.
   */
  readonly contentHash: string;
  /** The stable key that keeps a delivery from happening twice. */
  readonly key: string;
}

/** One injection message that was held back this iteration, and why. */
export interface DeferredMessage {
  readonly injectionId: string;
  readonly flavor: ContextSource;
  readonly role: WireRole;
  readonly reason: DeferralReason;
  /** The full sentence — see `messagesDeferralNote`. */
  readonly note: string;
}

/**
 * The `Deliver` stage's per-iteration record. Overwritten each iteration
 * (the commit log preserves the sequence), like every other per-iteration
 * value in `AgentState`.
 */
export interface MessagesDelivery {
  readonly iteration: number;
  readonly delivered: readonly DeliveredMessage[];
  readonly deferred: readonly DeferredMessage[];
}
