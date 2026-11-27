import { instantOf } from '../instantParser.js';
import { statementTokenPositions, tokensOf } from '../tokens.js';

const MINUTE_MS = 60_000;
export const DAY_MINUTES = 24 * 60;
const SECOND_NS = 1_000_000_000;
const MINUTE_NS = 60_000_000_000;

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
  | { readonly kind: 'unreadable' };

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

/** Do not infer a date or zone. A validation coordinate is never evidence on its own. */
export function timeValue(token: string): TimeValue | undefined {
  const colon = token.indexOf(':');
  if (colon < 1) return undefined;
  const dated = token[4] === '-' && token[7] === '-' && token[10] === 't' && colon === 13;
  const clock = colon <= 2 && /^\d{1,2}:\d/.test(token);
  if (!dated && !clock) return undefined;
  const normalized = dated ? token : '1970-01-01t' + normalizedClock(token);
  const tail = normalized.slice(13);
  const hasOffset = /[zZ]$|[+-]\d{2}:\d{2}$/.test(tail);
  const knownOffset = hasOffset && !tail.endsWith('-00:00');
  const canonical = (hasOffset ? normalized : normalized + 'z').toUpperCase();
  const instant = instantOf(canonical, 'strict');
  if (instant === undefined) return { kind: 'unreadable' };
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
export function statementValues(text: string): readonly string[] {
  if (!text.includes(':')) return tokensOf(text);
  const occurrences = statementTokenPositions(text);
  const values = new Set<string>();
  for (const [index, entry] of occurrences.entries()) {
    const next = occurrences[index + 1];
    const previous = occurrences[index - 1];
    const joinsDate = (date: typeof entry, clock: typeof entry) =>
      /^\d{4}-\d{2}-\d{2}$/.test(date.token) &&
      /^\d{2}:\d/.test(clock.token) &&
      text.slice(date.start, date.end) === date.token &&
      /^[\t ]+$/.test(text.slice(date.end, clock.start));
    if (next !== undefined && joinsDate(entry, next)) continue;
    const date = previous !== undefined && joinsDate(previous, entry) ? previous.token + 't' : '';
    const canTakeZone = /^\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(entry.token);
    const suffix = canTakeZone
      ? /^[\t ]+(utc|am|pm)\b(?![+-])/i
          .exec(text.slice(entry.end, entry.end + 12))?.[1]
          ?.toLowerCase()
      : undefined;
    values.add(date + entry.token + (suffix === 'utc' ? 'z' : suffix ?? ''));
  }
  return [...values];
}
