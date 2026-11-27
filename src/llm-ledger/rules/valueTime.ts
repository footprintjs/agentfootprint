import { instantOf } from '../instantParser.js';
import { statementTokenPositions, tokensOf } from '../tokens.js';

const MINUTE_MS = 60_000;
export const DAY_MINUTES = 24 * 60;
const SECOND_NS = 1_000_000_000;
const MINUTE_NS = 60_000_000_000;
const BARE_CLOCK = /^(?:\d{4}-\d{2}-\d{2}t)?\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const ZONED_CLOCK =
  /^((?:\d{4}-\d{2}-\d{2}t)?\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(am|pm)?([a-z][a-z0-9/_+:.-]*)?$/;

function writtenMeridiem(value: string): boolean {
  return value === 'am' || value === 'pm';
}

function writtenUtc(value: string | undefined): boolean {
  return value === 'z' || value === 'utc' || value === 'gmt';
}

function timeSuffix(text: string, end: number): { word: string; end: number } | undefined {
  // A standalone, adjacent spelling only. An unknown witness never lends its
  // zone to a clock, and a named offset is not an alias for plain UTC.
  const match =
    /^[\t ]+(am|pm|utc|gmt|z)(?![\p{L}\p{N}_+/\-\u2212\u2013\u2014]|\.[\p{L}\p{N}])/iu.exec(
      text.slice(end, end + 32),
    );
  if (match === null || match[1] === undefined) return undefined;
  return { word: match[1].toLowerCase(), end: end + match[0].length };
}

interface TimeParts {
  readonly minute: number;
  /** Position within the minute, at nanosecond precision. */
  readonly part: number;
  /** Size of the smallest written unit, in nanoseconds. */
  readonly unit: number;
}

export type TimeValue =
  | ({ readonly kind: 'anchored' } & TimeParts)
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
  const utc = writtenUtc(zone);
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
  if (instant === undefined) return { kind: 'unreadable' };
  if (unresolvedZone) return { kind: 'unresolved-zone' };
  const minute = Math.floor(instant.ms / MINUTE_MS);
  const part = mod(instant.ms, MINUTE_MS) * 1_000_000 + instant.nanos;
  const fraction = canonical.match(/\.(\d+)/)?.[1];
  const unit =
    instant.precision === 'minute' ? MINUTE_NS : fraction ? 10 ** (9 - fraction.length) : SECOND_NS;
  if (!dated)
    return {
      kind: 'clock',
      // A non-zero suffix can be a range endpoint. Keep the written wall
      // clock as partial evidence; it cannot place an instant without a date.
      minute,
      part,
      unit,
      ...(hasOffset && { offsetMinutes: instant.offsetMinutes }),
      ...(hasOffset && instant.offsetMinutes !== 0 && { unknownOffset: true }),
    };
  return knownOffset
    ? { kind: 'anchored', minute, part, unit }
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
export function statementValues(text: string): readonly string[] {
  if (!text.includes(':')) return tokensOf(text);
  const occurrences = statementTokenPositions(text);
  const values = new Set<string>();
  const joinsDate = (date: (typeof occurrences)[number], clock: (typeof occurrences)[number]) =>
    /^\d{4}-\d{2}-\d{2}$/.test(date.token) &&
    /^\d{2}:\d/.test(clock.token) &&
    text.slice(date.start, date.end) === date.token &&
    /^[\t ]+$/.test(text.slice(date.end, clock.start));
  for (const [index, entry] of occurrences.entries()) {
    const next = occurrences[index + 1];
    const previous = occurrences[index - 1];
    if (next !== undefined && joinsDate(entry, next)) continue;
    const date = previous !== undefined && joinsDate(previous, entry) ? previous.token + 't' : '';
    let value = date + entry.token;
    const attached = clockSpelling(value);
    if (attached.unresolvedZone) {
      values.add(attached.clock);
      continue;
    }
    const attachedMeridiem = /(?:am|pm)$/.test(value);
    const base = attachedMeridiem ? value.slice(0, -2) : value;
    if (BARE_CLOCK.test(base) && text.slice(entry.start, entry.end).toLowerCase() === entry.token) {
      let suffix = timeSuffix(text, entry.end);
      if (!attachedMeridiem && suffix !== undefined && writtenMeridiem(suffix.word)) {
        value += suffix.word;
        suffix = timeSuffix(text, suffix.end);
      }
      if (writtenUtc(suffix?.word)) value += 'z';
    }
    values.add(value);
  }
  return [...values];
}
