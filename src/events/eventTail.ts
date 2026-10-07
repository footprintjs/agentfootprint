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
 * ── A REPEAT HOLDS NO SLOT ──────────────────────────────────────────────
 * Every model call re-announces what is in its context: each slot's pieces
 * fire `agentfootprint.context.injected` again on every iteration — by
 * design, because that is the per-call record of what the model was shown
 * (`recorders/core/ContextRecorder.ts`, and the answer account reads it as
 * its witness). Counted like any other event, those repeats grow with the
 * square of the iteration count and evicted the START of long runs:
 * measured, a 100-iteration agent run fired ~11,400 events into the default
 * 10,000-event cap and its recording opened at iteration ~33.
 *
 * So the cap counts DISTINCT events. An announcement whose payload is
 * identical, field for field, to one the tail still holds is a REPEAT: it is
 * kept — the stream stays whole and in order — but it holds no slot, and it
 * is stored with the held announcement's payload object (identical content,
 * one copy). What a repeat costs is its envelope. Identity is decided on the
 * full payload (`samePayload`), never on the 32-bit `contentHash`, which only
 * narrows the candidates: two different pieces are never merged. Deciding
 * reads the payload once, `rawContent` included — the same order of work as
 * the content hash the slot already computed to announce it.
 *
 * Eviction is unchanged in kind: the oldest events go first, repeats with
 * them, so the retained events are always ONE contiguous suffix of the
 * stream and `firstRetainedIndex` still says where it starts.
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
  /** Append one event, dropping the oldest if the cap is reached. A repeated
   *  announcement is kept without taking a slot — see the module header. */
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

// FOLD · the one owner of how much of the event stream was retained, how many were dropped, and where the window starts
// consumers read this and never re-derive it: recordRun.ts · toRecording (its `events` field reads tail.snapshot()),
// recordingEnvelope.ts, and the trace toolpack's bounded marker
// detached: yes — snapshot() returns a fresh copy; the tail may keep growing behind the caller.
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
  // The retained window is `events[start…]`; `slot[i]` says whether
  // `events[i]` holds a slot (a repeat does not). Eviction advances `start`
  // rather than shifting the array, and the dead prefix is cut in bulk.
  const events: AgentfootprintEvent[] = [];
  const slot: boolean[] = [];
  let start = 0;
  let held = 0;
  let dropped = 0;
  const announcements = heldAnnouncements();

  const evictOldest = (): void => {
    const event = events[start]!;
    const holdsSlot = slot[start]!;
    events[start] = undefined as never;
    start += 1;
    dropped += 1;
    if (!holdsSlot) return;
    held -= 1;
    if (event.type === ANNOUNCEMENT) announcements.forget(event.payload);
  };

  return {
    push: (event) => {
      const original = event.type === ANNOUNCEMENT ? announcements.find(event.payload) : undefined;
      if (original !== undefined) {
        events.push({ ...event, payload: original } as AgentfootprintEvent);
        slot.push(false);
      } else {
        events.push(event);
        slot.push(true);
        held += 1;
        if (event.type === ANNOUNCEMENT) announcements.hold(event.payload);
      }
      while (held > cap) evictOldest();
      if (start > COMPACT_AT && start * 2 > events.length) {
        events.splice(0, start);
        slot.splice(0, start);
        start = 0;
      }
    },
    get count() {
      return events.length - start;
    },
    get dropped() {
      return dropped;
    },
    get firstRetainedIndex() {
      return dropped;
    },
    snapshot: () => ({ events: events.slice(start), dropped, firstRetainedIndex: dropped }),
  };
}

/** The event a slot re-fires on every call — the one kind a repeat can be. */
const ANNOUNCEMENT = 'agentfootprint.context.injected';

/** Cut the evicted prefix once it is this long and at least half the array. */
const COMPACT_AT = 1024;

/** The announcement payloads the tail holds a slot for, findable by content. */
function heldAnnouncements() {
  // Narrowed by slot + the 32-bit content hash; DECIDED by samePayload.
  const byKey = new Map<string, unknown[]>();
  const keyOf = (payload: unknown): string => {
    const p = payload as { slot?: unknown; contentHash?: unknown };
    return `${String(p?.slot)}\u001F${String(p?.contentHash)}`;
  };
  return {
    find(payload: unknown): unknown {
      return byKey.get(keyOf(payload))?.find((held) => samePayload(held, payload));
    },
    hold(payload: unknown): void {
      const key = keyOf(payload);
      const list = byKey.get(key);
      if (list === undefined) byKey.set(key, [payload]);
      else list.push(payload);
    },
    forget(payload: unknown): void {
      const key = keyOf(payload);
      const list = byKey.get(key);
      if (list === undefined) return;
      const at = list.indexOf(payload);
      if (at !== -1) list.splice(at, 1);
      if (list.length === 0) byKey.delete(key);
    },
  };
}

/**
 * Are two payloads the same data, field for field and in the same key order —
 * so either one serializes to the same bytes? Payloads are detached plain data
 * (the `typedEmit` law), which is what makes this structural walk exact.
 */
function samePayload(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!samePayload(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    const key = keysA[i]!;
    if (key !== keysB[i]) return false;
    if (!samePayload((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
}
