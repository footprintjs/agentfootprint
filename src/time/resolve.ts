/**
 * time/resolve — parts + clock + policy → every candidate window, and
 * the one rule for which candidate a reading settles on.
 *
 * Pattern: the hard, universal half of reading time, written once (time
 *          design § 5.1): a strategy tokenizes (`reader.ts`); this module
 *          resolves, the same way for every strategy. It is the one place
 *          zone arithmetic meets the person's words.
 * Role:    L0 leaf (the time layer). Imports `instant.ts`, `zone.ts`,
 *          `range.ts`, `present.ts` (the `Grain` word), `reader.ts` (the
 *          parts) and `resolveRecord.ts` (the shapes, the policy and the
 *          record's checks — split out for the synchronous doors, and
 *          re-exported here). `rowsBuild.ts` · `timeReadingRows` calls it at the
 *          seed, which loads it only under `.time()`.
 * Emits:   N/A.
 *
 * ## Every candidate, then the policy (§ 5.1, § 11)
 *
 * {@link resolveMention} writes EVERY reading of the parts, each tagged with
 * how it read them ({@link ReadingTags}):
 *
 * | Parts | Candidates |
 * |-------|------------|
 * | a numeric date `10/09/26` | up to three: `MDY`, `DMY`, `YMD` — each checked as a calendar day |
 * | a numeric date of two fields `10/09` | `MDY` and `DMY`, each for the clock's year and the one before |
 * | a date with no year | the clock's year (`current`) and the one before (`previous`) |
 * | a two-digit year `26` | the clock's century, noted `century-implied` |
 * | a clock time with no meridiem, hour 1–12 (`8:40`) | am and pm — one when the form is a 24-hour clock (`clock: '24h'`, an ISO instant) |
 * | a wall time the clocks go back through (`01:30`) | both instants, each noted `dst-overlap` |
 * | a wall time the clocks skip (`02:30`) | both readings Temporal names, each noted `dst-gap` |
 * | a day word (`{ day, offset: -1 }`) | the calendar day in the zone, anchored on the clock |
 * | a span (`{ minute, count: 40 }`) | a look-back until the clock's `now` |
 * | a range | one per combination of its sides that agree on date order, year and abbreviation reading, `from` before `to`; a first side with no meridiem takes the second's (`8 to 9 PM` → 8 PM) unless that runs backwards (`11 to 1 PM` → 11 AM); two sides with none share one (`8:45 to 8:55` → AM–AM and PM–PM, never 8:45 AM – 8:55 PM) unless neither runs forward (`11 to 1` → 11 AM – 1 PM, and 11 PM – 1 AM the next day); any range that runs forward on no one day ends the next one, within the half-day (`11 PM to 1 AM`, `23:00 to 1:00`) |
 * | a place named with `time` (`London time`) | the ONE zone the tz database has for it (`zone.ts` · `zoneOfPlace`), noted `zone-read`; none or several → the zone is asked |
 * | any mention that names no zone, while the clock's zone is unknown (`zoneSource: 'unknown'`, G15) | none — the person's zone is asked first (`needsZone`) |
 * | an abbreviation in the app's map (`PST`) | its zone's reading AND its literal offset's, when they name different windows — tagged `abbreviation`, noted `zone-read` |
 *
 * The fixed laws: a time is read to the END OF ITS GRAIN ("to 8:40" is
 * `[08:00, 08:41)`, a lone "9 AM" is `[09:00, 10:00)`, a day ends at the next
 * midnight — each noted `end-of-grain`) EXCEPT a range end said as an
 * o'clock hour, which is a boundary on the clock face and ends AT that
 * instant ("8 AM to 9 AM" is `[08:00, 09:00)`, no note — `endOf`); whether
 * an end was widened is asked of `widenedGrain`, never of `grain`. A day
 * starts at its first instant (Temporal's `startOfDay`: a midnight the
 * clocks skip starts the day at the first wall time that exists); a zone the
 * person did not say is the clock's; a zone they said is an IANA name, a
 * numeric offset, a place named with `time` that the tz database names
 * exactly once, or an abbreviation in the APP's map (`policy.abbreviations`)
 * — any other token (`PST` with no map, `India time`, `Pacific time`)
 * resolves nothing and is ASKED (`zoneReadsOf`, the one owner). Parts v1
 * does not resolve — a part of the day, a calendar span other than a day, a
 * window anchored on the previous one — are named `unsupported`, never
 * guessed.
 *
 * {@link chooseReading} then applies the app's policy (`dateOrder`, `year`)
 * and names what is left: one window (`only`, or `policy` when the policy
 * removed a reading — a choice nobody said, recorded), several (`open`, with
 * the questions an ask must settle), or none. A `kind: 'model'` reader's
 * window is never settled by the library: it stays `open` until the person
 * confirms it (§ 5.5), and its candidates carry `said: []`. Since the
 * owner's decision "Always confirm" (time design TQ29) neither is ANY
 * reading the record files: `rowsBuild.ts` · `timeReadingRows` passes
 * `confirm: true` for every reader's reading, so only the person's answer
 * in the time ask settles a window. The `confirm` parameter's default
 * (`kind === 'model'`) is the unit's, for a caller that resolves parts
 * outside the record.
 *
 * @example
 * ```ts
 * const clock = { now: '2026-10-09T15:40:00Z', zone: 'America/Los_Angeles' };
 * const rule = { id: 'fixture', kind: 'rule' as const };
 * const res = resolveMention([{ date: { kind: 'numeric', fields: [10, 9, 26] } }], clock, rule);
 * res.candidates.map((c) => c.reading.dateOrder); // ['MDY', 'DMY', 'YMD']
 * chooseReading(res, DEFAULT_TIME_POLICY, 'rule');
 * // { by: 'open', remaining: [0, 1, 2], open: ['date-order'] }
 * chooseReading(res, { dateOrder: 'DMY', year: 'ask' }, 'rule');
 * // { by: 'policy', candidate: 1, policy: { dateOrder: 'DMY' } }
 * ```
 */

import { instantOf, spellInstant, type InstantText } from './instant.js';
import { isTimeRange } from './range.js';
import { isZoneName, type ZoneName } from './zone.js';
import type { Grain } from './present.js';
import type { TimeParts, TimeWall } from './reader.js';
import {
  PART_ORDER,
  type MentionResolution,
  type OpenQuestion,
  type ReadingChoice,
  type ReadingTags,
  type ResolveClock,
  type TimeCandidate,
  type TimeNote,
  type TimePart,
  type TimePolicy,
} from './resolveRecord.js';
import { lookbackBuilt } from './resolve/lookback.js';
import { pointsOf, type Point } from './resolve/points.js';
import { offsetFor } from './resolve/wallClock.js';
import { windowKey, withoutAgreeingLiterals } from './resolve/agreement.js';
import type { Built, Unresolved } from './resolve/types.js';
import {
  lookbackZoneReadsOf,
  zoneReadsOf,
  type ZoneRead,
  type ZonePolicy,
} from './resolve/zones.js';
export { placeBeforeTime } from './resolve/zones.js';

export {
  candidateIsWellFormed,
  choiceIsWellFormed,
  DEFAULT_TIME_POLICY,
  readPolicy,
  shownGrain,
  widenedGrain,
} from './resolveRecord.js';
export type {
  MentionResolution,
  OpenQuestion,
  ReadingChoice,
  ReadingTags,
  ResolveClock,
  ResolvedWindow,
  TimeCandidate,
  TimeNote,
  TimePart,
  TimePolicy,
  TimeWindow,
  ZoneAbbreviation,
} from './resolveRecord.js';

/**
 * The parts with every zone token this layer cannot read (an abbreviation
 * outside the app's map, `India time`) replaced by the zone the PERSON named
 * when asked (§ 6.3) — the whole mention's and each range side's. A token it
 * can read is kept.
 *
 * @example
 * ```ts
 * withZoneAnswered([{ wall: { h: 8, meridiem: 'am' }, zoneToken: 'PST' }], 'America/Los_Angeles');
 * // [{ wall: { h: 8, meridiem: 'am' }, zoneToken: 'America/Los_Angeles' }]
 * ```
 */
export function withZoneAnswered(
  parses: readonly TimeParts[],
  zone: ZoneName,
  policy?: ZonePolicy,
): TimeParts[] {
  const fix = (parts: TimeParts): TimeParts => {
    if (parts.zoneToken === undefined) return parts;
    const needsZone =
      parts.relative !== undefined && 'count' in parts.relative
        ? !Array.isArray(lookbackZoneReadsOf(parts.zoneToken, zone, policy))
        : zoneReadsOf(parts.zoneToken, zone, policy) === undefined;
    return needsZone ? { ...parts, zoneToken: zone } : parts;
  };
  return parses.map((parts) => {
    const outer = fix(parts);
    return outer.rangeOf === undefined
      ? outer
      : { ...outer, rangeOf: [fix(outer.rangeOf[0]), fix(outer.rangeOf[1])] as const };
  });
}

// ─── Candidates ──────────────────────────────────────────────────────────

const GRAIN_ORDER: readonly Grain[] = ['year', 'month', 'week', 'day', 'hour', 'minute', 'second'];
const finer = (a: Grain, b: Grain): Grain =>
  GRAIN_ORDER.indexOf(a) >= GRAIN_ORDER.indexOf(b) ? a : b;

const partsIn = (parts: readonly TimePart[]): TimePart[] =>
  PART_ORDER.filter((p) => parts.includes(p));

function noteKey(note: TimeNote): string {
  return JSON.stringify(note);
}

function uniqueNotes(notes: readonly TimeNote[]): TimeNote[] {
  const seen = new Set<string>();
  return notes.filter((n) => {
    const key = noteKey(n);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dstNote(dst: Point['dst'], end?: 'from' | 'to'): TimeNote[] {
  if (dst === undefined) return [];
  return [{ kind: dst.kind, which: dst.which, ...(end !== undefined && { end }) }];
}

function spell(ms: number, zone: ZoneRead): InstantText | undefined {
  return spellInstant({ ms, nanos: 0 }, offsetFor(zone, ms));
}

function windowZone(zone: ZoneRead, clock: ResolveClock): ZoneName {
  return zone.kind === 'iana' ? zone.zone : zone.shownIn ?? clock.zone;
}

function fromPoint(point: Point, clock: ResolveClock): Built | undefined {
  const from = spell(point.fromMs, point.zone);
  const to = spell(point.toMs, point.zone);
  if (from === undefined || to === undefined) return undefined;
  const range = { from, to };
  return {
    said: point.said,
    candidate: {
      window: { kind: 'range', range },
      range,
      zone: windowZone(point.zone, clock),
      grain: point.grain,
      implied: partsIn(point.implied),
      anchor: point.anchor,
      notes: uniqueNotes([...point.notes, ...dstNote(point.dst), { kind: 'end-of-grain' }]),
      reading: point.tags,
    },
  };
}

function agrees(a: ReadingTags, b: ReadingTags): boolean {
  const same = (x: unknown, y: unknown): boolean => x === undefined || y === undefined || x === y;
  return (
    same(a.dateOrder, b.dateOrder) && same(a.year, b.year) && same(a.abbreviation, b.abbreviation)
  );
}

/**
 * Where a range's END side ends (§ 3.3): an o'clock hour ("to 9 AM") is a
 * boundary on the clock face and ends AT that instant; any other end — a
 * minute ("to 8:40" → `08:41`), a second, a whole day — runs to the end of
 * its grain. `widened` says which, for the `end-of-grain` note.
 */
function endOf(r: Point): { readonly ms: number; readonly widened: boolean } {
  return r.grain === 'hour' ? { ms: r.fromMs, widened: false } : { ms: r.toMs, widened: true };
}

function fromSides(l: Point, r: Point, clock: ResolveClock): Built | undefined {
  const end = endOf(r);
  if (!agrees(l.tags, r.tags) || !(l.fromMs < end.ms)) return undefined;
  const from = spell(l.fromMs, l.zone);
  const to = spell(end.ms, r.zone);
  if (from === undefined || to === undefined) return undefined;
  const range = { from, to };
  const tags: ReadingTags = {
    ...((l.tags.dateOrder ?? r.tags.dateOrder) !== undefined && {
      dateOrder: l.tags.dateOrder ?? r.tags.dateOrder,
    }),
    ...(l.tags.meridiem !== undefined && { meridiem: l.tags.meridiem }),
    ...(r.tags.meridiem !== undefined && { endMeridiem: r.tags.meridiem }),
    ...((l.tags.year ?? r.tags.year) !== undefined && { year: l.tags.year ?? r.tags.year }),
    ...((l.tags.abbreviation ?? r.tags.abbreviation) !== undefined && {
      abbreviation: l.tags.abbreviation ?? r.tags.abbreviation,
    }),
  };
  return {
    said: [...l.said, ...r.said],
    candidate: {
      window: { kind: 'range', range },
      range,
      zone: windowZone(l.zone, clock),
      grain: finer(l.grain, r.grain),
      implied: partsIn([...l.implied, ...r.implied]),
      anchor: l.anchor === 'message' || r.anchor === 'message' ? 'message' : 'none',
      notes: uniqueNotes([
        ...l.notes,
        ...r.notes,
        ...dstNote(l.dst, 'from'),
        ...dstNote(r.dst, 'to'),
        ...(end.widened ? [{ kind: 'end-of-grain' } as const] : []),
      ]),
      reading: tags,
    },
  };
}

/** A range side with what it takes from the whole mention and the other side: the day, the zone. */
function sideOf(side: TimeParts, outer: TimeParts, other: TimeParts): TimeParts {
  const hasDay = (p: TimeParts): boolean => p.date !== undefined || p.relative !== undefined;
  const day = hasDay(side) ? side : hasDay(outer) ? outer : hasDay(other) ? other : undefined;
  const zoneToken = side.zoneToken ?? outer.zoneToken ?? other.zoneToken;
  return {
    ...(side.wall !== undefined && { wall: side.wall }),
    ...(side.partOfDay !== undefined && { partOfDay: side.partOfDay }),
    ...(side.anchor !== undefined && { anchor: side.anchor }),
    ...(day?.date !== undefined && { date: day.date }),
    ...(day?.relative !== undefined && { relative: day.relative }),
    ...(zoneToken !== undefined && { zoneToken }),
  };
}

const HALF_DAY_MS = 12 * 3_600_000;

/** One forward pair of a range's sides: the window, and the meridiem each side was read with. */
interface Pair {
  readonly built: Built;
  readonly left: 'am' | 'pm' | undefined;
  readonly right: 'am' | 'pm' | undefined;
  /** How long the window is — what an overnight reading is weighed by (`withinHalfDay`). */
  readonly spanMs: number;
}

/** Every combination of a range's sides that runs forward (`fromSides`). */
function forwardPairs(lp: readonly Point[], rp: readonly Point[], clock: ResolveClock): Pair[] {
  const all: Pair[] = [];
  for (const a of lp) {
    for (const b of rp) {
      const built = fromSides(a, b, clock);
      if (built !== undefined) {
        all.push({
          built,
          left: a.tags.meridiem,
          right: b.tags.meridiem,
          spanMs: endOf(b).ms - a.fromMs,
        });
      }
    }
  }
  return all;
}

/**
 * The combinations of a range's sides that run forward. A first side said
 * with no meridiem takes the second side's said one ("8 to 9 PM" is 8 PM –
 * 9 PM, English's own rule), falling back to the other only when that does
 * not run forward ("11 to 1 PM" → 11 AM).
 */
function inheritingPairs(pairs: readonly Pair[], inherits: 'am' | 'pm'): Built[] {
  const same = pairs.filter((x) => x.left === inherits);
  return (same.length > 0 ? same : pairs).map((x) => x.built);
}

/**
 * A range whose two sides say no meridiem SHARES one (G13): "8:45 to 8:55"
 * is 8:45–8:55 AM or 8:45–8:55 PM, never 8:45 AM – 8:55 PM — the half-day is
 * crossed only when no shared reading runs forward, because the right side
 * is earlier on the clock face ("11 to 1", "11:15 to 12:30"): then the range
 * crosses it either way — AM to PM the same day, and PM to AM overnight,
 * the right side read on the next day when its day is the left side's.
 */
function sharedMeridiemPairs(pairs: readonly Pair[], overnight: () => Pair[]): Built[] {
  const shared = pairs.filter((x) => x.left === x.right);
  if (shared.length > 0) return shared.map((x) => x.built);
  const crossing = [
    ...pairs.filter((x) => x.left === 'am' && x.right === 'pm'),
    ...overnight().filter((x) => x.left === 'pm' && x.right === 'am'),
  ];
  return crossing.map((x) => x.built);
}

/** A side that says an hour 1–12 with no meridiem and not on a 24-hour clock — read both ways. */
const saysNoMeridiem = (wall: TimeWall | undefined): wall is TimeWall =>
  wall !== undefined &&
  wall.meridiem === undefined &&
  wall.clock !== '24h' &&
  wall.h >= 1 &&
  wall.h <= 12;

/** The meridiem a first side said with none takes from the second side, when the second said one. */
function inheritedMeridiem(l: TimeParts, r: TimeParts): 'am' | 'pm' | undefined {
  return saysNoMeridiem(l.wall) ? r.wall?.meridiem : undefined;
}

/** A side with its own day — a date or a day word of its own, not the mention's or the other side's. */
const hasOwnDay = (side: TimeParts): boolean =>
  side.date !== undefined || side.relative !== undefined;

/** Whether a mention names a zone anywhere — its own or a range side's. */
const namesZone = (parts: TimeParts): boolean =>
  parts.zoneToken !== undefined ||
  parts.rangeOf?.[0].zoneToken !== undefined ||
  parts.rangeOf?.[1].zoneToken !== undefined;

function builtOf(
  parts: TimeParts,
  clock: ResolveClock,
  nowMs: number,
  policy: ZonePolicy | undefined,
): Built[] | Unresolved {
  // The person's zone is unknown (G15): a mention that names none waits on it — even a
  // look-back, whose window would be shown, confirmed and converted in a zone nobody said.
  if (clock.zoneSource === 'unknown' && !namesZone(parts)) return { needsZone: true };
  return builtOfAll(parts, clock, nowMs, policy);
}

function builtOfAll(
  parts: TimeParts,
  clock: ResolveClock,
  nowMs: number,
  policy: ZonePolicy | undefined,
): Built[] | Unresolved {
  const lookback = lookbackBuilt(parts, clock, policy);
  if (lookback !== undefined) return lookback;
  if (parts.rangeOf === undefined) {
    const points = pointsOf(parts, clock, nowMs, policy);
    if (!Array.isArray(points)) return points;
    return points.map((p) => fromPoint(p, clock)).filter((b): b is Built => b !== undefined);
  }
  if (parts.wall !== undefined || parts.partOfDay !== undefined || parts.anchor !== undefined) {
    return { unsupported: 'a range with a time outside its two sides' };
  }
  const [l, r] = parts.rangeOf;
  const left = sideOf(l, parts, r);
  const right = sideOf(r, parts, l);
  if (
    lookbackBuilt(left, clock, policy) !== undefined ||
    lookbackBuilt(right, clock, policy) !== undefined
  ) {
    return { unsupported: 'a look-back as a range side' };
  }
  const lp = pointsOf(left, clock, nowMs, policy);
  if (!Array.isArray(lp)) return lp;
  const rp = pointsOf(right, clock, nowMs, policy);
  if (!Array.isArray(rp)) return rp;
  const sameDay = forwardPairs(lp, rp, clock);
  // The right side read on the next day — only when its day is the left side's.
  const overnight = (): Pair[] => {
    if (hasOwnDay(r)) return [];
    const next = pointsOf(right, clock, nowMs, policy, true);
    return Array.isArray(next) ? forwardPairs(lp, next, clock) : [];
  };
  if (saysNoMeridiem(l.wall) && saysNoMeridiem(r.wall))
    return sharedMeridiemPairs(sameDay, overnight);
  // A range that runs forward on no one day ends the next one (G13's overnight law, for every
  // spelling): "11 PM to 1 AM", "23:00 to 1:00", "11 to 1 AM".
  const pairs = sameDay.length > 0 ? sameDay : withinHalfDay(overnight());
  const inherits = inheritedMeridiem(l, r);
  if (inherits !== undefined) return inheritingPairs(pairs, inherits);
  return pairs.map((x) => x.built);
}

/**
 * The overnight readings that cross no more than the half-day ("11 PM to 1" → 1 AM, never 1 PM the
 * next day) — the bound the shared-meridiem night keeps too. A longer night is no reading: "11 AM
 * to 1 AM" and "8 AM to 8 AM" name no window, as before.
 */
function withinHalfDay(pairs: readonly Pair[]): Pair[] {
  return pairs.filter((x) => x.spanMs <= HALF_DAY_MS);
}

/**
 * Every candidate window of one mention's parses, resolved against the
 * clock. A reading the person must confirm (`confirm: true` — every reading
 * the record files, TQ29; a `model` reader's by default) carries `said: []`.
 * `policy` is read for its abbreviation map only (`dateOrder` and `year`
 * are {@link chooseReading}'s): absent, no abbreviation names a zone.
 */
export function resolveMention(
  parses: readonly TimeParts[],
  clock: ResolveClock,
  reader: { readonly id: string; readonly kind: 'rule' | 'model' },
  confirm: boolean = reader.kind === 'model',
  policy?: ZonePolicy,
): MentionResolution {
  const now = instantOf(clock.now, 'strict');
  if (now === undefined || !isZoneName(clock.zone)) {
    throw new TypeError(
      'resolveMention: the clock must carry a strict instant and an IANA zone name.',
    );
  }
  const candidates: TimeCandidate[] = [];
  const unsupported: string[] = [];
  let needsZone = false;
  parses.forEach((parts, parse) => {
    const built = builtOf(parts, clock, now.ms, policy);
    if (!Array.isArray(built)) {
      if ('needsZone' in built) {
        needsZone = true;
        if (built.reason !== undefined) unsupported.push(built.reason);
      } else unsupported.push(built.unsupported);
      return;
    }
    for (const b of withoutAgreeingLiterals(built)) {
      if (!isTimeRange(b.candidate.range)) continue;
      candidates.push({
        ...b.candidate,
        said: confirm ? [] : partsIn(b.said),
        reader: { id: reader.id, kind: reader.kind },
        parse,
      });
    }
  });
  return { candidates, needsZone, unsupported };
}

// ─── Choosing ────────────────────────────────────────────────────────────

function openQuestions(candidates: readonly TimeCandidate[], confirm: boolean): OpenQuestion[] {
  const differs = (read: (c: TimeCandidate) => unknown): boolean =>
    new Set(candidates.map((c) => JSON.stringify(read(c) ?? null))).size > 1;
  const open: OpenQuestion[] = [];
  if (differs((c) => c.parse)) open.push('parse');
  if (differs((c) => c.reading.dateOrder)) open.push('date-order');
  if (differs((c) => c.reading.year)) open.push('year');
  if (differs((c) => [c.reading.meridiem, c.reading.endMeridiem])) open.push('meridiem');
  if (differs((c) => c.reading.abbreviation)) open.push('abbreviation');
  if (differs((c) => c.notes.filter((n) => n.kind === 'dst-overlap' || n.kind === 'dst-gap'))) {
    open.push('dst');
  }
  if (confirm) open.push('confirm');
  return open;
}

/**
 * Whether a policy step DECIDED something: it removed a reading whose window
 * none of the kept readings names. A step that removed only same-window
 * readings (`12/12/12` under `DMY` — every order names one day) changed
 * nothing the person would see, so the choice is not recorded as assumed.
 */
function policyDecided(
  all: readonly TimeCandidate[],
  before: readonly number[],
  kept: readonly number[],
): boolean {
  if (kept.length === before.length) return false;
  const keptWindows = new Set(kept.map((i) => windowKey(all[i] as TimeCandidate)));
  return before.some(
    (i) => !kept.includes(i) && !keptWindows.has(windowKey(all[i] as TimeCandidate)),
  );
}

/**
 * How one mention settles under the app's policy (§ 5.1, § 11). The policy
 * only removes readings; it never adds one. A DST choice, a meridiem, a
 * zone the person named that is no zone, and a reading to confirm
 * (`confirm` — every reading the record files, TQ29) are never settled here
 * — they stay `open` for the person.
 */
export function chooseReading(
  resolution: MentionResolution,
  policy: TimePolicy,
  kind: 'rule' | 'model',
  problem?: 'unreadable',
  confirm: boolean = kind === 'model',
): ReadingChoice {
  if (problem === 'unreadable') return { by: 'none', why: 'unreadable' };
  if (resolution.needsZone && resolution.candidates.length === 0) {
    return { by: 'open', remaining: [], open: ['zone'] };
  }
  const all = resolution.candidates;
  if (all.length === 0) {
    return { by: 'none', why: resolution.unsupported.length > 0 ? 'unsupported' : 'no-candidate' };
  }
  const applied: { dateOrder?: TimePolicy['dateOrder']; year?: TimePolicy['year'] } = {};
  let remaining = all.map((_, i) => i);
  if (policy.dateOrder !== 'ask') {
    const kept = remaining.filter((i) => {
      const order = all[i]?.reading.dateOrder;
      return order === undefined || order === policy.dateOrder;
    });
    if (policyDecided(all, remaining, kept)) applied.dateOrder = policy.dateOrder;
    remaining = kept;
  }
  if (policy.year !== 'ask') {
    const kept = remaining.filter((i) => all[i]?.reading.year !== 'previous');
    if (policyDecided(all, remaining, kept)) applied.year = policy.year;
    remaining = kept;
  }
  if (remaining.length === 0) return { by: 'none', why: 'excluded-by-policy' };
  const usedPolicy = Object.keys(applied).length > 0;
  const left = remaining.map((i) => all[i] as TimeCandidate);
  const windows = new Set(left.map(windowKey));
  const zoneOpen: OpenQuestion[] = resolution.needsZone ? ['zone'] : [];
  if (windows.size === 1 && zoneOpen.length === 0) {
    const candidate = remaining[0] as number;
    if (confirm) {
      return { by: 'open', remaining, open: ['confirm'], ...(usedPolicy && { policy: applied }) };
    }
    return usedPolicy ? { by: 'policy', candidate, policy: applied } : { by: 'only', candidate };
  }
  const open = [...zoneOpen, ...openQuestions(left, confirm)];
  return { by: 'open', remaining, open, ...(usedPolicy && { policy: applied }) };
}
