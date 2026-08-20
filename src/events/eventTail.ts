/**
 * eventTail — a bounded, honest copy of an event stream.
 *
 * Pattern: ring buffer with an explicit drop counter.
 * Role:    the ONE place the library decides how much of a run's event
 *          stream it keeps in memory, and how it tells a reader that it
 *          kept less than everything.
 *
 * Two features hold a tail of the same stream for the same reason — a
 * recording (`recordRun`) and the self-explaining agent's evidence
 * (`SelfExplainBinding`) — and both need the same two properties:
 *
 *   1. BOUNDED. A long-running server must not grow an array per run
 *      forever. Past the cap the OLDEST events go, because the end of a
 *      turn is the part a reader asks about.
 *   2. HONEST. A tail that dropped events says how many. Silently
 *      starting a timeline mid-run is the failure this exists to
 *      prevent — a consumer would read the remainder as the whole run.
 *
 * Written once here rather than twice, because the drift that matters is
 * not the ring buffer (easy) — it is the two features disagreeing about
 * what "dropped" means and one of them forgetting to report it.
 *
 * Internal: not exported from any barrel. Both consumers wrap it in their
 * own surface (`RunRecorder.droppedEvents`, the toolpack's ⚠ marker).
 */

import type { AgentfootprintEvent } from './registry.js';

/**
 * Default retained-event cap — a few hundred KB for a typical turn, and
 * far more than any single turn fires.
 */
export const DEFAULT_MAX_EVENTS = 10_000;

/** A frozen read of the tail: the events kept, and the count of those not. */
export interface EventTailSnapshot {
  /** A fresh copy — the tail may keep growing behind the caller's back. */
  readonly events: readonly AgentfootprintEvent[];
  /** How many events were discarded to stay under the cap. `0` normally. */
  readonly dropped: number;
  /**
   * The ORIGINAL stream position of `events[0]` (9.60.0) — the retained
   * window is `[firstRetainedIndex, firstRetainedIndex + events.length)`
   * of the stream as fired, so `events[i]` was stream event
   * `firstRetainedIndex + i`.
   *
   * Under oldest-first eviction from one stream this is always equal to
   * `dropped` — stated as its own named field because a drop COUNT alone
   * cannot say WHICH range is gone: a reader aligning this tail against
   * another record of the same run (a commit log, a second recording)
   * needs the offset, not just the loss. Before this field, an archived
   * envelope could say "312 events dropped" and nothing could say where
   * the retained window starts.
   */
  readonly firstRetainedIndex: number;
}

/** A bounded tail of one event stream. */
export interface EventTail {
  /** Append one event, dropping the oldest if the cap is reached. */
  push(event: AgentfootprintEvent): void;
  /** How many events are currently retained. */
  readonly count: number;
  /** How many were discarded to stay under the cap. `0` on a normal turn. */
  readonly dropped: number;
  /** Original stream position of the oldest retained event — see
   *  {@link EventTailSnapshot.firstRetainedIndex}. */
  readonly firstRetainedIndex: number;
  /** Freeze the tail — a fresh array plus the drop count beside it. */
  snapshot(): EventTailSnapshot;
}

/**
 * Start a bounded tail.
 *
 * @param maxEvents cap on retained events (default {@link DEFAULT_MAX_EVENTS}).
 *                  Non-finite or non-positive values fall back to the default
 *                  rather than producing a tail that keeps nothing.
 */
export function eventTail(maxEvents: number = DEFAULT_MAX_EVENTS): EventTail {
  const cap =
    Number.isFinite(maxEvents) && maxEvents > 0 ? Math.floor(maxEvents) : DEFAULT_MAX_EVENTS;
  const events: AgentfootprintEvent[] = [];
  let dropped = 0;

  return {
    push: (event) => {
      events.push(event);
      if (events.length > cap) {
        events.shift();
        dropped += 1;
      }
    },
    get count() {
      return events.length;
    },
    get dropped() {
      return dropped;
    },
    get firstRetainedIndex() {
      return dropped;
    },
    snapshot: () => ({ events: events.slice(), dropped, firstRetainedIndex: dropped }),
  };
}
