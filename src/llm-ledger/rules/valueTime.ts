import { instantOf } from '../instantParser.js';
import { statementTokenPositions, tokensOf } from '../tokens.js';

const MINUTE_MS = 60_000;
export const DAY_MINUTES = 24 * 60;
const SECOND_NS = 1_000_000_000;
const MINUTE_NS = 60_000_000_000;
/** Dateless tokens can be ranges; civil offsets have a narrower grammar than ISO timestamps. */
const MAX_CLOCK_OFFSET_MINUTES = 14 * 60;
const CLOCK_OFFSET_STEP_MINUTES = 15;

const BARE_CLOCK = /^(?:\d{4}-\d{2}-\d{2}t)?\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const ZONED_CLOCK =
  /^((?:\d{4}-\d{2}-\d{2}t)?\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(am|pm)?([a-z][a-z0-9/_+:.-]*)?$/;
/** Lowercase names that unambiguously look like written zones in ordinary prose. */
const LOWERCASE_ZONE = /^(?:[a-z]{2}[sd]t|[ecw]et|cest|eest|west|ist|gmt|zulu|local)$/;

function isMeridiem(text: string): boolean {
  return text === 'am' || text === 'pm';
}

function writtenZone(text: string, end: number): { word: string; end: number } | undefined {
  const match = /^[\t ]+([A-Za-z][A-Za-z0-9/_+-]*)(?![A-Za-z0-9/_+-])/.exec(
    text.slice(end, end + 96),
  );
  if (match === null || match[1] === undefined) return undefined;
  const raw = match[1];
  const word = raw.toLowerCase();
  if (
    word === 'utc' ||
    word === 'z' ||
    isMeridiem(word) ||
    /^[A-Z]{2,5}$/.test(raw) ||
    LOWERCASE_ZONE.test(word) ||
    word.includes('/') ||
    /^(?:utc|gmt)[+-]/.test(word)
  )
    return { word, end: end + match[0].length };
  return undefined;
}

interface TimeParts {
  readonly minute: number;
  /** Position within the minute, at nanosecond precision. */
  readonly part: number;
  /** Size of the smallest written unit, in nanoseconds. */
  readonly unit: number;
}

export type TimeValue =
  | ({ readonly kind: 'anchored'; readonly offsetMinutes: number } & TimeParts)
  | ({ readonly kind: 'floating-date'; readonly unknownOffset?: boolean } & TimeParts)
  | ({
      readonly kind: 'clock';
      readonly offsetMinutes?: number;
      readonly unknownOffset?: boolean;
    } & TimeParts)
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'unresolved-zone' };

export function mod(value: number, period: number): number {
  return ((value % period) + period) % period;
}

/** Fold written separators and 12-hour notation before the canonical calendar check. */
function normalizedClock(text: string): string {
  const suffix = text.endsWith('am') ? 'am' : text.endsWith('pm') ? 'pm' : undefined;
  const colon = text.indexOf(':');
  const hour = Number(text.slice(0, colon));
  if (suffix !== undefined && hour >= 1 && hour <= 12)
    return (
      String((hour % 12) + (suffix === 'pm' ? 12 : 0)).padStart(2, '0') + text.slice(colon, -2)
    );
  return colon === 1 ? '0' + text : text;
}

function clockSpelling(token: string): { clock: string; unresolvedZone: boolean } {
  const lexicalZone = ZONED_CLOCK.exec(token);
  if (lexicalZone === null) return { clock: token, unresolvedZone: false };
  const zone = lexicalZone[3];
  const utc = zone === 'z' || zone === 'utc';
  return {
    clock: lexicalZone[1] + (lexicalZone[2] ?? '') + (utc ? 'z' : ''),
    unresolvedZone: zone !== undefined && !utc,
  };
}

/** Do not infer a date or zone. A validation coordinate is never evidence on its own. */
export function timeValue(token: string): TimeValue | undefined {
  const { clock: written, unresolvedZone } = clockSpelling(token);
  const colon = written.indexOf(':');
  if (colon < 1) return undefined;
  const dated = written[4] === '-' && written[7] === '-' && written[10] === 't' && colon === 13;
  const clock = colon <= 2 && /^\d{1,2}:\d/.test(written);
  if (!dated && !clock) return undefined;
  const clockText = dated ? written.slice(11) : written;
  const offset = clockText.endsWith('z') ? 'z' : '';
  const bare = offset === '' ? clockText : clockText.slice(0, -1);
  const normalized =
    (dated ? written.slice(0, 11) : '1970-01-01t') + normalizedClock(bare) + offset;
  const tail = normalized.slice(13);
  const hasOffset = /[zZ]$|[+-]\d{2}:\d{2}$/.test(tail);
  const knownOffset = hasOffset && !tail.endsWith('-00:00');
  const canonical = (hasOffset ? normalized : normalized + 'z').toUpperCase();
  const instant = instantOf(canonical, 'strict');
  if (
    instant === undefined ||
    (!dated &&
      (Math.abs(instant.offsetMinutes) > MAX_CLOCK_OFFSET_MINUTES ||
        instant.offsetMinutes % CLOCK_OFFSET_STEP_MINUTES !== 0))
  )
    return { kind: 'unreadable' };
  if (unresolvedZone) return { kind: 'unresolved-zone' };
  const minute = Math.floor(instant.ms / MINUTE_MS);
  const part = mod(instant.ms, MINUTE_MS) * 1_000_000 + instant.nanos;
  const fraction = canonical.match(/\.(\d+)/)?.[1];
  const unit =
    instant.precision === 'minute' ? MINUTE_NS : fraction ? 10 ** (9 - fraction.length) : SECOND_NS;
  if (!dated)
    return {
      kind: 'clock',
      minute,
      part,
      unit,
      ...(knownOffset && { offsetMinutes: instant.offsetMinutes }),
      ...(hasOffset && !knownOffset && { unknownOffset: true }),
    };
  return knownOffset
    ? { kind: 'anchored', minute, part, unit, offsetMinutes: instant.offsetMinutes }
    : { kind: 'floating-date', minute, part, unit, ...(hasOffset && { unknownOffset: true }) };
}

/** Exact equivalence for equal values. Otherwise evidence needs the requested precision. */
export function hasPrecision(subject: TimeParts, evidence: TimeParts): boolean {
  return (
    (evidence.unit <= subject.unit &&
      Math.floor(evidence.part / subject.unit) * subject.unit === subject.part) ||
    (subject.unit < SECOND_NS && evidence.unit < SECOND_NS && subject.part === evidence.part)
  );
}

export function precisionOverlaps(subject: TimeParts, evidence: TimeParts): boolean {
  return (
    subject.part < evidence.part + evidence.unit && evidence.part < subject.part + subject.unit
  );
}

/** Join only adjacent pieces the bounded statement actually wrote; receipt tokens have no positions. */
export function statementValues(text: string, unresolvedZones: Set<string>): readonly string[] {
  if (!text.includes(':')) return tokensOf(text);
  const occurrences = statementTokenPositions(text);
  const values = new Set<string>();
  let joinedUntil = 0;
  const joinsDate = (date: (typeof occurrences)[number], clock: (typeof occurrences)[number]) =>
    /^\d{4}-\d{2}-\d{2}$/.test(date.token) &&
    /^\d{2}:\d/.test(clock.token) &&
    text.slice(date.start, date.end) === date.token &&
    /^[\t ]+$/.test(text.slice(date.end, clock.start));
  for (const [index, entry] of occurrences.entries()) {
    if (entry.start < joinedUntil) continue;
    const next = occurrences[index + 1];
    const previous = occurrences[index - 1];
    if (next !== undefined && joinsDate(entry, next)) continue;
    const date = previous !== undefined && joinsDate(previous, entry) ? previous.token + 't' : '';
    let value = date + entry.token;
    const attached = clockSpelling(value);
    if (attached.unresolvedZone) {
      values.add(attached.clock);
      unresolvedZones.add(attached.clock);
      continue;
    }
    const attachedMeridiem = /(?:am|pm)$/.test(value);
    const base = attachedMeridiem ? value.slice(0, -2) : value;
    if (BARE_CLOCK.test(base) && text.slice(entry.start, entry.end).toLowerCase() === entry.token) {
      let suffix = writtenZone(text, entry.end);
      if (!attachedMeridiem && suffix !== undefined && isMeridiem(suffix.word)) {
        value += suffix.word;
        joinedUntil = suffix.end;
        suffix = writtenZone(text, suffix.end);
      }
      if (suffix !== undefined && !isMeridiem(suffix.word)) {
        if (suffix.word === 'utc' || suffix.word === 'z') value += 'z';
        // The zone's spelling is never a ledger token. Keep only the clock and
        // one bounded, statement-local bit that prevents it from verifying.
        else unresolvedZones.add(value);
        joinedUntil = suffix.end;
      }
    }
    values.add(value);
  }
  return [...values];
}
