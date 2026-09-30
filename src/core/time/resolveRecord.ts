/**
 * core/time/resolveRecord — what the resolver writes down: the candidate and
 * choice shapes, the app's policy (read at `.time()`), and the checks the
 * checkpoint door runs on a filed reading.
 *
 * Pattern: the record half of `resolve.ts`, split from the resolver so the
 *          SYNCHRONOUS doors — `.time({ policy })` (`clock.ts` ·
 *          `readTimeOptions`) and `validateCheckpoint` (`rows.ts` ·
 *          `timeRowIsWellFormed`) — reach the shapes and their checks without
 *          the resolver, which only an armed seed loads (`agent/stages/
 *          timeLayer.ts`, through `import()`: the optional-family law of
 *          docs-next's site budget). `resolve.ts` re-exports everything here.
 * Role:    core/ leaf (the time layer). Imports `range.ts` and `zone.ts`
 *          (the window check) only.
 * Emits:   N/A.
 *
 * @example
 * ```ts
 * readPolicy({ dateOrder: 'DMY' }); // { dateOrder: 'DMY', year: 'ask' }
 * readPolicy({ abbreviations: { PST: { zone: 'America/Los_Angeles', offset: '-08:00' } } });
 * // { dateOrder: 'ask', year: 'ask', abbreviations: { PST: { zone: 'America/Los_Angeles', offset: '-08:00' } } }
 * candidateIsWellFormed({ kind: 'range', range: { from: 'x', to: 'y' } }); // false
 * ```
 */

import type { InstantText } from './instant.js';
import type { DurationText } from './duration.js';
import { isTimeRange, type TimeRange } from './range.js';
import { isZoneName, type ZoneName } from './zone.js';
import type { Grain } from './present.js';

// ─── The shapes (time design § 3.2) ──────────────────────────────────────

/** A part of a time a person can say. `duration`: the length of a look-back ("last 40 minutes"). */
export type TimePart =
  | 'year'
  | 'month'
  | 'day'
  | 'hour'
  | 'minute'
  | 'second'
  | 'meridiem'
  | 'zone'
  | 'duration';

/** What was asked, before the clock is applied. */
export type TimeWindow =
  | { readonly kind: 'range'; readonly range: TimeRange }
  /** Always "until the clock's now". */
  | { readonly kind: 'lookback'; readonly duration: DurationText };

/** A library-written note on how a window was read. */
export type TimeNote =
  /**
   * The window's END was widened to the end of its last said grain: "to 8:40"
   * → `08:41`, a day → the next midnight, a lone "9 AM" → `[09:00, 10:00)`.
   * Never on a range end said as an o'clock hour ("8 AM to 9 AM" ends AT
   * `09:00`, § 3.3). Ask {@link widenedGrain}, never `grain` alone.
   */
  | { readonly kind: 'end-of-grain' }
  /** A wall time the clocks go back through: which of its two instants this is (`end`: which end of a range). */
  | {
      readonly kind: 'dst-overlap';
      readonly which: 'earlier' | 'later';
      readonly end?: 'from' | 'to';
    }
  /** A wall time the clocks skip: which of Temporal's two readings this is. */
  | { readonly kind: 'dst-gap'; readonly which: 'earlier' | 'later'; readonly end?: 'from' | 'to' }
  /** The person said a numeric offset, not a zone: the instants carry it; `zone` is the clock's. */
  | { readonly kind: 'offset-said'; readonly offset: string }
  /** A two-digit year, read in the clock's century. */
  | { readonly kind: 'century-implied'; readonly century: number }
  /**
   * The person named the zone in words that are no zone name (`London time`,
   * `PST`): `token` as written, and how the library read it — the one IANA
   * zone the place names (`place`), the app's abbreviation map's zone
   * (`abbreviation`), or the fixed offset the abbreviation spells
   * (`abbreviation-literal`). A proposal like every reading: the person
   * confirms the zone with the window.
   */
  | {
      readonly kind: 'zone-read';
      readonly token: string;
      readonly as: 'place' | 'abbreviation' | 'abbreviation-literal';
    };

/** Which reading of the PARTS produced a candidate, so a policy — or an ask — can choose among them. */
export interface ReadingTags {
  readonly dateOrder?: 'MDY' | 'DMY' | 'YMD';
  /** The meridiem this reading gave a clock time said without one (the `from` end of a range). */
  readonly meridiem?: 'am' | 'pm';
  /** The same, for the `to` end of a range. */
  readonly endMeridiem?: 'am' | 'pm';
  readonly year?: 'said' | 'current' | 'previous';
  /** An abbreviation in the app's map: read as its zone (`zone`) or as its literal offset (`literal`). */
  readonly abbreviation?: 'zone' | 'literal';
}

/** A window read from words, resolved against the clock (§ 3.2). */
export interface ResolvedWindow {
  readonly window: TimeWindow;
  /** Always present: a look-back resolved against the clock. Spelled in the offset the person meant. */
  readonly range: TimeRange;
  /** The zone the person meant, else the clock's. */
  readonly zone: ZoneName;
  /** The finest part the person said. */
  readonly grain: Grain;
  /** The parts the person said — empty for a `model` reader's reading (§ 5.5). */
  readonly said: readonly TimePart[];
  /** The parts this module filled: from the clock, the policy's candidates, the century. */
  readonly implied: readonly TimePart[];
  readonly anchor: 'message' | 'previous-window' | 'none';
  readonly reader: { readonly id: string; readonly kind: 'rule' | 'model' };
  readonly notes: readonly TimeNote[];
}

/** One candidate — produced here, never by a strategy. */
export interface TimeCandidate extends ResolvedWindow {
  readonly reading: ReadingTags;
  /** Which of the mention's parses it came from. */
  readonly parse: number;
}

/**
 * One zone abbreviation the app's people write, as data (§ 11): the zone it
 * stands for, and the fixed offset it literally spells. `PST` in October is
 * both `America/Los_Angeles` (−07:00, what a person on the US west coast
 * usually means) and −08:00 (what the letters say) — so a mismatch offers
 * BOTH readings, never corrects one into the other.
 */
export interface ZoneAbbreviation {
  readonly zone: ZoneName;
  /** `±HH:MM` (or `±HH`, `±HHMM`). */
  readonly offset: string;
}

/** The v1 policy (§ 11): the switches with careful answers. */
export interface TimePolicy {
  /** `'ask'`: a numeric date's readings become choices. Or the one order this app's people write. */
  readonly dateOrder: 'ask' | 'MDY' | 'DMY' | 'YMD';
  /** `'ask'`: a date said without a year is asked. `'current'`: the clock's year, recorded as assumed. */
  readonly year: 'ask' | 'current';
  /**
   * Absent (the default): no abbreviation maps to a zone — `PST` is ASKED as
   * a zone. Present: the abbreviations this app's people write, each read as
   * its zone AND as its literal offset when the two disagree at the instant
   * (both offered in the one confirmation, noted `zone-read`). An
   * abbreviation missing from the map is still asked. No map ships.
   */
  readonly abbreviations?: Readonly<Record<string, ZoneAbbreviation>>;
}

/** No silent MDY, no guessed year. */
export const DEFAULT_TIME_POLICY: TimePolicy = Object.freeze({ dateOrder: 'ask', year: 'ask' });

/** What the clock gives the resolver. */
export interface ResolveClock {
  readonly now: InstantText;
  readonly zone: ZoneName;
}

/** Every candidate of one mention, and what kept a parse from any. */
export interface MentionResolution {
  readonly candidates: readonly TimeCandidate[];
  /** A zone the person said that names no zone this layer can read (`PST`): the zone must be asked. */
  readonly needsZone: boolean;
  /** Parts v1 does not resolve, named. */
  readonly unsupported: readonly string[];
}

/** A question only the person can settle. `abbreviation`: the app's map's zone, or the letters' offset. */
export type OpenQuestion =
  | 'date-order'
  | 'year'
  | 'meridiem'
  | 'dst'
  | 'zone'
  | 'abbreviation'
  | 'parse'
  | 'confirm';

/** How a mention's reading settled — recorded on its `time-reading` row. */
export type ReadingChoice =
  /** Every candidate left names the same window. */
  | { readonly by: 'only'; readonly candidate: number }
  /** The policy removed a reading and one window is left — assumed, recorded. */
  | {
      readonly by: 'policy';
      readonly candidate: number;
      readonly policy: Partial<TimePolicy>;
    }
  /** An ask must settle it (a later step raises it): the candidates left and the questions. */
  | {
      readonly by: 'open';
      readonly remaining: readonly number[];
      readonly open: readonly OpenQuestion[];
      readonly policy?: Partial<TimePolicy>;
    }
  | {
      readonly by: 'none';
      readonly why: 'unreadable' | 'unsupported' | 'no-candidate' | 'excluded-by-policy';
    };

// ─── The policy ──────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const DATE_ORDERS: readonly string[] = ['ask', 'MDY', 'DMY', 'YMD'];
const YEAR_RULES: readonly string[] = ['ask', 'current'];
const POLICY_KEYS: readonly string[] = ['dateOrder', 'year', 'abbreviations'];

/** `±HH`, `±HHMM`, `±HH:MM` — a colon only between hours and minutes, never trailing. */
const OFFSET_TOKEN = /^([+-])(\d{2})(?::?(\d{2}))?$/;

/**
 * A numeric offset as written (`-07`, `-0700`, `-07:00`) → minutes east of
 * UTC and its `±HH:MM` spelling, or `undefined`. The one reader of an offset
 * token: `resolve.ts` · `zoneReadsOf` (a said offset) and {@link readPolicy} (an
 * abbreviation's literal offset) both ask it.
 */
export function offsetOfToken(
  token: string,
): { readonly minutes: number; readonly spelled: string } | undefined {
  const m = OFFSET_TOKEN.exec(token);
  if (m === null) return undefined;
  const hours = Number(m[2]);
  const minutes = m[3] === undefined ? 0 : Number(m[3]);
  if (hours > 23 || minutes > 59) return undefined;
  const total = (m[1] === '-' ? -1 : 1) * (hours * 60 + minutes);
  return { minutes: total === 0 ? 0 : total, spelled: `${m[1]}${m[2]}:${m[3] ?? '00'}` };
}

/** An abbreviation key: letters only, as the person writes it (`PST`, `CEST`). */
const ABBREVIATION_KEY = /^[A-Za-z]{2,8}$/;
const MAX_ABBREVIATIONS = 256;

function readAbbreviations(value: unknown): Readonly<Record<string, ZoneAbbreviation>> | string {
  const shape =
    "policy.abbreviations must map letters to { zone, offset } — { PST: { zone: 'America/Los_Angeles', offset: '-08:00' } }";
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return shape;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_ABBREVIATIONS) return shape;
  const out: Record<string, ZoneAbbreviation> = {};
  for (const [key, entry] of entries) {
    if (!ABBREVIATION_KEY.test(key) || !isRecord(entry)) return shape;
    if (Object.keys(entry).some((k) => k !== 'zone' && k !== 'offset')) return shape;
    if (!isZoneName(entry.zone)) {
      return `policy.abbreviations.${key}.zone must be an IANA zone name such as 'America/Los_Angeles'`;
    }
    const offset = typeof entry.offset === 'string' ? offsetOfToken(entry.offset) : undefined;
    if (offset === undefined) {
      return `policy.abbreviations.${key}.offset must be a numeric offset such as '-08:00'`;
    }
    out[key] = Object.freeze({ zone: entry.zone, offset: offset.spelled });
  }
  return Object.freeze(out);
}

/**
 * The app's `policy`, read with the v1 defaults filled in — or a problem in
 * words (an unknown key, a value outside its switch). `abbreviations` is kept
 * only when given, so a policy without it reads byte-identical to v1's.
 */
export function readPolicy(value: unknown): TimePolicy | string {
  if (value === undefined) return DEFAULT_TIME_POLICY;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'policy must be an object — { dateOrder?, year?, abbreviations? }';
  }
  const p = value as Record<string, unknown>;
  const extra = Object.keys(p).filter((k) => !POLICY_KEYS.includes(k));
  if (extra.length > 0) {
    return `policy takes { dateOrder?, year?, abbreviations? } — unknown key ${extra
      .map((k) => `'${k}'`)
      .join(', ')}`;
  }
  if (p.dateOrder !== undefined && !DATE_ORDERS.includes(p.dateOrder as string)) {
    return "policy.dateOrder must be 'ask', 'MDY', 'DMY' or 'YMD'";
  }
  if (p.year !== undefined && !YEAR_RULES.includes(p.year as string)) {
    return "policy.year must be 'ask' or 'current'";
  }
  const abbreviations =
    p.abbreviations === undefined ? undefined : readAbbreviations(p.abbreviations);
  if (typeof abbreviations === 'string') return abbreviations;
  return Object.freeze({
    dateOrder: (p.dateOrder as TimePolicy['dateOrder'] | undefined) ?? 'ask',
    year: (p.year as TimePolicy['year'] | undefined) ?? 'ask',
    ...(abbreviations !== undefined && { abbreviations }),
  });
}

/**
 * The grain a candidate's END was widened to, or `undefined` when its `to`
 * is exact — the one answer to "was the end widened?" (§ 3.3). A label
 * renders the end as said only then (`readingAsk.ts` · `timeAskOf`), and
 * the said end is `to − 1 grain` only then (`forms.ts` · `saidEndMs`).
 * `grain` alone is not the answer: "8 AM to 9 AM" is grain `hour` and ends
 * AT `09:00`; a look-back is grain `hour` and ends at the clock's now.
 *
 * @example
 * ```ts
 * widenedGrain({ grain: 'minute', notes: [{ kind: 'end-of-grain' }] }); // 'minute' — [08:00, 08:41)
 * widenedGrain({ grain: 'hour', notes: [] });                          // undefined — [08:00, 09:00)
 * ```
 */
export function widenedGrain(candidate: Pick<TimeCandidate, 'notes' | 'grain'>): Grain | undefined {
  return candidate.notes.some((n) => n.kind === 'end-of-grain') ? candidate.grain : undefined;
}

// ─── The record's checks ─────────────────────────────────────────────────

/** The parts a candidate can name, in the order a record lists them. */
export const PART_ORDER: readonly TimePart[] = [
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'second',
  'meridiem',
  'zone',
  'duration',
];

const GRAINS: readonly string[] = ['second', 'minute', 'hour', 'day', 'week', 'month', 'year'];
const ANCHORS: readonly string[] = ['message', 'previous-window', 'none'];
const OPEN: readonly string[] = [
  'date-order',
  'year',
  'meridiem',
  'dst',
  'zone',
  'abbreviation',
  'parse',
  'confirm',
];

const isIndex = (value: unknown, below: number): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < below;
const isPartList = (value: unknown): boolean =>
  Array.isArray(value) && value.every((p) => PART_ORDER.includes(p as TimePart));

function isNote(value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case 'end-of-grain':
      return true;
    case 'dst-overlap':
    case 'dst-gap':
      return (
        (value.which === 'earlier' || value.which === 'later') &&
        (value.end === undefined || value.end === 'from' || value.end === 'to')
      );
    case 'offset-said':
      return typeof value.offset === 'string';
    case 'century-implied':
      return typeof value.century === 'number';
    case 'zone-read':
      return (
        typeof value.token === 'string' &&
        (value.as === 'place' || value.as === 'abbreviation' || value.as === 'abbreviation-literal')
      );
    default:
      return false;
  }
}

function isWindow(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === 'range') return isTimeRange(value.range);
  return value.kind === 'lookback' && typeof value.duration === 'string';
}

/** Whether `value` is a candidate this module would have written. */
export function candidateIsWellFormed(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const reader = value.reader;
  return (
    isWindow(value.window) &&
    isTimeRange(value.range) &&
    isZoneName(value.zone) &&
    GRAINS.includes(value.grain as string) &&
    isPartList(value.said) &&
    isPartList(value.implied) &&
    ANCHORS.includes(value.anchor as string) &&
    isRecord(reader) &&
    typeof reader.id === 'string' &&
    (reader.kind === 'rule' || reader.kind === 'model') &&
    Array.isArray(value.notes) &&
    value.notes.every(isNote) &&
    isRecord(value.reading) &&
    isIndex(value.parse, 64)
  );
}

function isPolicyUsed(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([k, v]) =>
      (k === 'dateOrder' && DATE_ORDERS.includes(v as string)) ||
      (k === 'year' && YEAR_RULES.includes(v as string)),
  );
}

/** Whether `value` is a choice this module would have written over `count` candidates. */
export function choiceIsWellFormed(value: unknown, count: number): boolean {
  if (!isRecord(value)) return false;
  switch (value.by) {
    case 'only':
      return isIndex(value.candidate, count);
    case 'policy':
      return isIndex(value.candidate, count) && isPolicyUsed(value.policy);
    case 'open':
      return (
        Array.isArray(value.remaining) &&
        value.remaining.every((i) => isIndex(i, count)) &&
        Array.isArray(value.open) &&
        value.open.length > 0 &&
        value.open.every((q) => OPEN.includes(q as string)) &&
        (value.policy === undefined || isPolicyUsed(value.policy))
      );
    case 'none':
      return ['unreadable', 'unsupported', 'no-candidate', 'excluded-by-policy'].includes(
        value.why as string,
      );
    default:
      return false;
  }
}
