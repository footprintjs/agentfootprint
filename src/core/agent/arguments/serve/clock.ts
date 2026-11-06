/** Lens: the unchanged clock, time-limit and one-opening line composers. */
import type { TimeLimitLines } from '../../../../semantics/coverage/answer.js';
import type { TimeLimitFacts } from '../../../../semantics/coverage/timeLimitFacts.js';
import { renderTimeLimits } from '../../../../semantics/coverage/timeLimits.js';
import { LIBRARY_NOTE_OPENING } from '../../../../lib/saidByPerson.js';
import type { ZoneName } from '../../../../time/zone.js';
import { presentInstant } from '../../../../time/present.js';
import type { InstantText } from '../../../../time/instant.js';

/**
 * The served time limits from the Tools mount's `timeLimits` FACTS
 * (`semantics/coverage/timeLimitFacts.ts` · `TimeLimitFacts`): rendered for the MODEL
 * (`semantics/coverage/timeLimits.ts` · `renderTimeLimits` — the one composer the
 * limits block asks too), then {@link timeLimitsSentence}. The facts cross
 * the mount unrendered so the renderer loads here, under the arm, and never
 * on the graph a plain agent loads.
 *
 * @example
 * ```ts
 * timeLimitsLine(undefined); // undefined — the turn's reads match what was asked
 * ```
 */
export function timeLimitsLine(facts: TimeLimitFacts | undefined): string | undefined {
  return timeLimitsSentence(renderTimeLimits(facts, 'model'));
}

// LENS · late-line · request-ephemeral
// reads: the turn's `period` rows whose result checks hold and its `source-clock` rows, composed by
//        the ONE owner of the limits lines (`semantics/coverage/timeLimits.ts` · `timeLimitLinesOf`,
//        audience `model`) — the same lines the limits block prints for the person after the answer
// law: the library's CONCLUSION about what each call READ against what it ASKED (step T8), both
//      ranges in the person's zone, and what an answer built on it states; it names what the record
//      holds for calls that already ran and promises nothing a later call can break. A source that
//      holds none or part of the asked time is named with ITS span in the person's zone (`held`):
//      the zone conversion is the library's, never the model's.
/**
 * The time limits an answer states (time step T8's serving placement): the
 * result checks that hold this turn — a read narrower, wider or shifted from
 * what was asked, a window older than the source keeps, sources on different
 * clocks — served to the MODEL as the library's conclusion, LATE, at the
 * decision point, in the ONE served time line (TQ13) after the windows'
 * halves. The step-7b bench showed why: raw facts on a result are not
 * compared by the model, a conclusion served at the decision point is.
 *
 * `undefined` when nothing holds — a turn whose reads match what was asked
 * serves no sentence at all. It carries no opening: {@link timeLine} opens
 * the served line once with {@link TIME_LINE_SOURCE}.
 *
 * @example
 * ```ts
 * timeLimitsSentence({ period: ['client_activity read less than was asked — asked: …; read: …'], clocks: [] });
 * // 'The time the tools read is not the time asked about — client_activity read less than was
 * //  asked — asked: …; read: …. So the answer to the person states the time each result read and
 * //  claims nothing about time no result read.'
 * ```
 */
export function timeLimitsSentence(lines: TimeLimitLines | undefined): string | undefined {
  if (lines === undefined) return undefined;
  const parts: string[] = [];
  if (lines.period.length > 0) {
    parts.push(
      `the time the tools read is not the time asked about — ${lines.period.join('; ')}. So ` +
        `the answer to the person states the time each result read and claims nothing about ` +
        `time no result read.`,
    );
  }
  // A source that holds none or only part of the asked time (take 3): the spans in the person's
  // zone, so the answer names what the source holds without converting a UTC instant itself.
  if (lines.held !== undefined && lines.held.length > 0) {
    parts.push(
      `what the sources hold is not all of the time asked about — ${lines.held.join('; ')}. So ` +
        `the answer to the person states what each source holds and claims nothing about the ` +
        `time it does not hold.`,
    );
  }
  if (lines.clocks.length > 0) {
    parts.push(`Clocks: ${lines.clocks.join('; ')}.`);
  }
  if (parts.length === 0) return undefined;
  const capital = (part: string): string => part.charAt(0).toUpperCase() + part.slice(1);
  return parts.map(capital).join(' ');
}

/** What a line says when the run's clock zone is unknown (G15) — the zone is never guessed. */
export const UNKNOWN_ZONE_CLAUSE = "the person's time zone is not known";

/** The run clock the served line names (`agent/buildAgentChart.ts` · `timeClockArg`, off the turn's `clock` row). */
export interface ServedClock {
  readonly now: InstantText;
  /** The person's zone — or, with `zoneUnknown`, only the UTC spelling (G15). */
  readonly zone: ZoneName;
  readonly zoneUnknown?: true;
}

// LENS · late-line · request-ephemeral
// reads: the turn's `clock` row — its `now` and zone (`zoneSource: 'unknown'` → the UTC spelling)
// law: the library's clock as a CONCLUSION, one short sentence, to the minute, the weekday named
//      (a model re-derives a weekday wrong), the zone always named — and named as not known when
//      it is, never guessed (G15).
/**
 * The run clock, for the model (G16): the turn's `now` to the minute, its
 * weekday and date in the person's zone, the zone named — so the model never
 * answers "today" or "this morning" from its training date. Under `.time()`
 * it is the first part of the ONE served time line on every request; never
 * without it. `undefined` when there is no clock (or it cannot be spelled).
 *
 * @example
 * ```ts
 * clockSentence({ now: '2026-10-09T15:40:00Z', zone: 'America/Los_Angeles' });
 * // "This turn's time: Friday 2026-10-09 08:40 America/Los_Angeles (UTC-07:00)."
 * clockSentence({ now: '2026-10-09T15:40:00Z', zone: 'UTC', zoneUnknown: true });
 * // "This turn's time: Friday 2026-10-09 15:40 UTC (the person's time zone is not known)."
 * ```
 */
export function clockSentence(clock: ServedClock | undefined): string | undefined {
  if (clock === undefined) return undefined;
  const ms = Date.parse(clock.now);
  if (!Number.isFinite(ms)) return undefined;
  try {
    const minute = new Date(Math.floor(ms / 60_000) * 60_000).toISOString() as InstantText;
    const at = presentInstant(minute, { zone: clock.zone });
    const weekday = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      timeZone: clock.zone,
    }).format(ms);
    const unknown = clock.zoneUnknown === true ? ` (${UNKNOWN_ZONE_CLAUSE})` : '';
    return `This turn's time: ${weekday} ${at}${unknown}.`;
  } catch {
    return undefined;
  }
}

/**
 * The ONE served time line's opening: WHO says it — the library, not the
 * person. The line is a request-only `user` message, so an unmarked one reads
 * as the person talking. Measured twice: the T8 bench's first paid round
 * (stopped at 41 runs) — 15 of 15 answers to the limits sentence opened
 * "You're right" / "I apologize", and naming the library alone (round 1,
 * stopped at 46) still drew "Thank you for the clarification"; the T6b paid
 * run, whose windows halves carried no opening — 37 of 37 answers after the
 * unconfirmed-call sentence opened "You're right… I apologize". So it also
 * says the note is no correction, and how an answer uses it. It says nothing
 * about WHEN to answer: the pending half names a call as the next step.
 * Applied once, by {@link timeLine}, whichever halves the line holds.
 *
 * The bytes are the authorship registry's (`lib/saidByPerson.ts` ·
 * `LIBRARY_NOTE_OPENING`, one of `LIBRARY_AUTHORED_PREFIXES`), so the line
 * that is served LAST on every request under `.time()` is never read as the
 * person's words by `isSaidByPerson` — the last `role: 'user'` message of a
 * request is the library's, and "this turn" is not (G17).
 */
export const TIME_LINE_SOURCE: string = LIBRARY_NOTE_OPENING;

// LENS · late-line · request-ephemeral
// reads: the composed halves of the turn's ONE served time line — the person's windows
//        (`timeWindowsLine`) and the time limits (`timeLimitsLine`) — and nothing else
// law: one line, one opening: the source is said ONCE, first, whichever halves are present; no half
//      carries its own, so the opening never repeats inside the line.
/**
 * The ONE served time line (TQ13): its parts in order — the windows' halves,
 * then the limits — opened ONCE with {@link TIME_LINE_SOURCE}. The tools
 * slot's one decoration site (`core/slots/buildToolsSlot.ts` · `commitWire`)
 * calls it, `callLLM` appends the result LAST to the request, and
 * `time-travel/servedView.ts` rebuilds it byte for byte from the same
 * committed `timeLine` key. `undefined` when no part has anything to say — a
 * turn with nothing to say serves no line (and without `.time()` nothing here
 * runs at all).
 *
 * @example
 * ```ts
 * timeLine([undefined, timeLimitsLine(facts)]);
 * // '[A note from the library that runs the tools — …] The time the tools read is not …'
 * timeLine([undefined, undefined]); // undefined
 * ```
 */
export function timeLine(parts: readonly (string | undefined)[]): string | undefined {
  const present = parts.filter((p): p is string => p !== undefined && p.length > 0);
  return present.length === 0 ? undefined : [TIME_LINE_SOURCE, ...present].join(' ');
}
