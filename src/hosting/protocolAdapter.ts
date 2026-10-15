/**
 * protocolAdapter — the port a wire protocol implements to speak for a run.
 *
 * OUR side of the port is the run's typed event stream, exactly as the record
 * serves it (every listener's view: the placeholder wherever a redaction policy
 * selected a value), and how the run settled. A protocol adapter turns that
 * into its own events; a framing strategy (`stream.ts` · `SseFraming`) turns
 * each of those into bytes. AG-UI (`agentfootprint/ag-ui`) is one adapter; a
 * future protocol is one more, with no change to the runner, the event stream
 * or the framing seam.
 *
 * An adapter reads the SERVED stream only. That is the whole redaction story
 * for every protocol at once: what a policy hides never reaches an adapter, so
 * no adapter can put it on a wire.
 */

import type { AgentfootprintEvent } from '../events/registry.js';

/** How a run ended, as an adapter is told — once, after its last event. */
export type RunSettlement =
  /** `run()` resolved with an answer. */
  | { readonly kind: 'finished' }
  /** `run()` resolved with a pause: the run waits on a person (its `pause.request` came first). */
  | { readonly kind: 'paused' }
  /** The run was stopped by whoever was running it, and did not fail. */
  | { readonly kind: 'cancelled' }
  /**
   * `run()` rejected. `error` is the rejection AS THROWN — the caller's own
   * value, never served — so an adapter takes only its `code` from it (a name
   * the library or a provider chose, not data) and states the failure in the
   * words of the record's `error.fatal` event when the run filed one.
   */
  | { readonly kind: 'failed'; readonly error?: unknown };

/**
 * One run's translation into a protocol's events. Opened per run, fed every
 * served event of that run in order, then settled exactly once; whatever it
 * must remember between events (open messages, ids it minted) lives in it.
 */
export interface RunTranslation<TEvent> {
  /** The protocol events one served event of the run means — zero, one or several. */
  event(event: AgentfootprintEvent): readonly TEvent[];
  /** The closing events. After this, `event` returns nothing. */
  settle(settlement: RunSettlement): readonly TEvent[];
}
