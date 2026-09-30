/**
 * core/time/reader — the port a strategy reads a person's words through, and
 * the checks every reading passes before anything resolves it.
 *
 * Pattern: port + adapter (Duckling's value/resolution split). A strategy
 *          TOKENIZES: it returns the parts it sees and the verbatim quote,
 *          never an instant, never a date order, never a zone. Everything
 *          that turns parts into instants is `resolve.ts`'s, the same way for
 *          every strategy (time design § 5.1).
 * Role:    core/ leaf (the time layer). Imports nothing. The builder's
 *          `.time({ reader })` checks a reader through {@link readerIssue};
 *          seed checks what it returned through {@link checkReading}.
 * Emits:   N/A.
 *
 * ## What is checked — shape, never meaning
 *
 * | Check | A failure |
 * |-------|-----------|
 * | the reader: `id`, `version`, `locale` non-empty strings, `kind` `'rule'` or `'model'`, `read` a function | refused at build |
 * | the reading: `{ mentions: [] }`, at most {@link MAX_MENTIONS} | the reader broke its port — the run fails, naming it |
 * | each mention's `quote`: a non-empty VERBATIM substring of the text read | the mention is refused (`quote-not-in-text`) and keeps no text |
 * | each mention's parts: the {@link TimeParts} shape, every field in range, no unknown key, at most {@link MAX_PARSES} | the mention is refused (`malformed`) |
 *
 * None of these checks what a word MEANS: a model that reads "yesterday" as
 * the wrong day passes every one of them. That is why a `kind: 'model'`
 * reading is never the person's words (`resolve.ts` · `chooseReading`).
 *
 * @example
 * ```ts
 * const fixture: TimeReader = {
 *   id: 'fixture', version: '1.0.0', locale: 'en-US', kind: 'rule',
 *   read: () => ({ mentions: [{ quote: '10/09/26', parses: [{ date: { kind: 'numeric', fields: [10, 9, 26] } }] }] }),
 * };
 * readerIssue(fixture); // undefined — a well-formed reader
 * checkReading('errors on 10/09/26', fixture.read('', { locale: 'en-US' }), 'fixture');
 * // [{ quote: '10/09/26', parses: [{ date: { kind: 'numeric', fields: [10, 9, 26] } }] }]
 * ```
 */

// ─── The port ────────────────────────────────────────────────────────────

/** What a reader is told besides the text: a hint for its tokenizer — no clock, no zone, no map. */
export interface TimeReadContext {
  readonly locale: string;
}

/**
 * A strategy that reads a person's words into zone-less PARTS (time design
 * § 5.1). Armed with `.time({ reader })`; there is no default. It runs once
 * per turn, at the seed, on the message a person wrote, and never again for
 * that message — a resume and a retry read the recorded reading.
 *
 * @example
 * ```ts
 * const reader: TimeReader = {
 *   id: 'my-app/english', version: '1.2.0', locale: 'en-US', kind: 'rule',
 *   read: (text) => ({ mentions: tokenize(text) }),
 * };
 * Agent.create({ provider, model }).time({ zone: 'UTC', reader }).build();
 * ```
 */
export interface TimeReader {
  /** Recorded on every reading with the version, e.g. `'agentfootprint/english'`. */
  readonly id: string;
  readonly version: string;
  /** The language it reads, e.g. `'en-US'`. */
  readonly locale: string;
  /** `'rule'`: deterministic over the text. `'model'`: an LLM or other learned reader — its readings are never the person's words. */
  readonly kind: 'rule' | 'model';
  read(text: string, context: TimeReadContext): TimeReading | Promise<TimeReading>;
}

/** What a reader returns: every time mention it found, in the order the text wrote them. */
export interface TimeReading {
  readonly mentions: readonly TimeMention[];
}

/** One mention of a time in the text. */
export interface TimeMention {
  /** A VERBATIM substring of the text — the library checks it. */
  readonly quote: string;
  /** Usually one; more only when the TOKENS split two ways. Empty when `problem` is set. */
  readonly parses: readonly TimeParts[];
  /** The reader saw a time here and could not read it. */
  readonly problem?: 'unreadable';
}

/** A date as the text wrote it. */
export type TimeDate =
  /** `'10/09/26'` → `fields: [10, 9, 26]` — the ORDER is not decided by the reader. Two or three fields. */
  | { readonly kind: 'numeric'; readonly fields: readonly number[]; readonly yearDigits?: 2 | 4 }
  /** ISO or a named month: the text fixes the order. */
  | {
      readonly kind: 'fixed';
      readonly year?: number;
      readonly month: number;
      readonly day: number;
    };

/** A wall-clock time as the text wrote it — no zone. */
export interface TimeWall {
  readonly h: number;
  readonly m?: number;
  readonly s?: number;
  readonly meridiem?: 'am' | 'pm';
}

/** A time said relative to the message's moment. */
export type TimeRelative =
  /** `'yesterday'` = `{ unit: 'day', offset: -1 }`. */
  | {
      readonly unit: 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';
      readonly offset: number;
    }
  /** `'last 40 minutes'` = `{ unit: 'minute', count: 40 }` — a look-back. */
  | { readonly unit: 'second' | 'minute' | 'hour' | 'day' | 'week'; readonly count: number };

/** Zone-less parts, in the order the text wrote them. Every field present was said. */
export interface TimeParts {
  readonly date?: TimeDate;
  readonly wall?: TimeWall;
  /** As written: `'PST'`, `'-07:00'`, `'America/Los_Angeles'` — `resolve.ts` maps it. */
  readonly zoneToken?: string;
  readonly relative?: TimeRelative;
  /** `'morning'` — a KEY into a table, never hours. */
  readonly partOfDay?: string;
  /** `'the hour before that'` — resolved from the recorded previous window only. */
  readonly anchor?: 'previous';
  /** `'8 AM to 8:40 AM'`. */
  readonly rangeOf?: readonly [TimeParts, TimeParts];
}

// ─── Limits ──────────────────────────────────────────────────────────────

/** The most mentions one reading may hold — a bound on the record, not a guess at language. */
export const MAX_MENTIONS = 16;
/** The most parses one mention may hold. */
export const MAX_PARSES = 4;
const MAX_TOKEN = 64;
const MAX_OFFSET = 1000;
const MAX_COUNT = 100_000;

// ─── The reader ──────────────────────────────────────────────────────────

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 128;

/**
 * Whether `Intl` reads `value` as a BCP 47 language tag — the time ask renders
 * its labels in the reader's locale (`present.ts`), so a tag it cannot read is
 * refused at the builder, never met at the first label.
 */
function isLanguageTag(value: string): boolean {
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

/** Why `value` is not a {@link TimeReader}, or `undefined` when it is one. */
export function readerIssue(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') {
    return 'reader must be a TimeReader — { id, version, locale, kind, read }';
  }
  const r = value as Record<string, unknown>;
  if (!nonEmpty(r.id)) return 'reader.id must be a non-empty string';
  if (!nonEmpty(r.version)) return 'reader.version must be a non-empty string';
  if (!nonEmpty(r.locale) || !isLanguageTag(r.locale)) {
    return "reader.locale must be a language tag such as 'en-US'";
  }
  if (r.kind !== 'rule' && r.kind !== 'model') return "reader.kind must be 'rule' or 'model'";
  if (typeof r.read !== 'function') return 'reader.read must be a function';
  return undefined;
}

// ─── The reading ─────────────────────────────────────────────────────────

/** Why one mention was refused. A refused mention keeps no text: its quote is not the person's words. */
export type MentionRefusal = 'quote-not-in-text' | 'malformed';

/** One mention after the checks. */
export type CheckedMention =
  | {
      readonly quote: string;
      readonly parses: readonly TimeParts[];
      readonly problem?: 'unreadable';
    }
  | { readonly refused: MentionRefusal };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isInt = (value: unknown, lo: number, hi: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= lo && value <= hi;

const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).every((k) => allowed.includes(k) && value[k] !== undefined);

function isDate(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === 'numeric') {
    const fields = value.fields;
    return (
      onlyKeys(value, ['kind', 'fields', 'yearDigits']) &&
      Array.isArray(fields) &&
      (fields.length === 2 || fields.length === 3) &&
      fields.every((f) => isInt(f, 0, 9999)) &&
      (value.yearDigits === undefined || value.yearDigits === 2 || value.yearDigits === 4)
    );
  }
  if (value.kind === 'fixed') {
    return (
      onlyKeys(value, ['kind', 'year', 'month', 'day']) &&
      (value.year === undefined || isInt(value.year, 0, 9999)) &&
      isInt(value.month, 1, 12) &&
      isInt(value.day, 1, 31)
    );
  }
  return false;
}

function isWall(value: unknown): boolean {
  return (
    isRecord(value) &&
    onlyKeys(value, ['h', 'm', 's', 'meridiem']) &&
    isInt(value.h, 0, 23) &&
    (value.m === undefined || isInt(value.m, 0, 59)) &&
    (value.s === undefined || (value.m !== undefined && isInt(value.s, 0, 59))) &&
    (value.meridiem === undefined || value.meridiem === 'am' || value.meridiem === 'pm')
  );
}

const OFFSET_UNITS: readonly string[] = ['minute', 'hour', 'day', 'week', 'month', 'year'];
const COUNT_UNITS: readonly string[] = ['second', 'minute', 'hour', 'day', 'week'];

function isRelative(value: unknown): boolean {
  if (!isRecord(value) || typeof value.unit !== 'string') return false;
  if (value.offset !== undefined) {
    return (
      onlyKeys(value, ['unit', 'offset']) &&
      OFFSET_UNITS.includes(value.unit) &&
      isInt(value.offset, -MAX_OFFSET, MAX_OFFSET)
    );
  }
  return (
    onlyKeys(value, ['unit', 'count']) &&
    COUNT_UNITS.includes(value.unit) &&
    isInt(value.count, 1, MAX_COUNT)
  );
}

const PART_KEYS: readonly string[] = [
  'date',
  'wall',
  'zoneToken',
  'relative',
  'partOfDay',
  'anchor',
  'rangeOf',
];

/** Whether `value` is a well-formed {@link TimeParts} — `nested` refuses a range inside a range side. */
export function isTimeParts(value: unknown, nested = false): value is TimeParts {
  if (!isRecord(value) || !onlyKeys(value, PART_KEYS)) return false;
  if (Object.keys(value).length === 0) return false;
  if (value.date !== undefined && !isDate(value.date)) return false;
  if (value.wall !== undefined && !isWall(value.wall)) return false;
  if (value.zoneToken !== undefined && !nonEmptyToken(value.zoneToken)) return false;
  if (value.relative !== undefined && !isRelative(value.relative)) return false;
  if (value.partOfDay !== undefined && !nonEmptyToken(value.partOfDay)) return false;
  if (value.anchor !== undefined && value.anchor !== 'previous') return false;
  if (value.rangeOf !== undefined) {
    const sides = value.rangeOf;
    if (nested || !Array.isArray(sides) || sides.length !== 2) return false;
    if (!sides.every((side) => isTimeParts(side, true))) return false;
  }
  return true;
}

function nonEmptyToken(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_TOKEN;
}

function checkMention(text: string, value: unknown): CheckedMention {
  if (!isRecord(value) || !onlyKeys(value, ['quote', 'parses', 'problem'])) {
    return { refused: 'malformed' };
  }
  const { quote, parses, problem } = value;
  if (!Array.isArray(parses) || parses.length > MAX_PARSES) return { refused: 'malformed' };
  if (problem !== undefined && problem !== 'unreadable') return { refused: 'malformed' };
  // An unreadable mention carries no parses; a readable one carries at least one.
  if ((problem === 'unreadable') !== (parses.length === 0)) return { refused: 'malformed' };
  if (!parses.every((p) => isTimeParts(p))) return { refused: 'malformed' };
  if (typeof quote !== 'string' || quote.length === 0 || !text.includes(quote)) {
    return { refused: 'quote-not-in-text' };
  }
  return {
    quote,
    parses: parses as TimeParts[],
    ...(problem === 'unreadable' && { problem: 'unreadable' as const }),
  };
}

/**
 * A reader's answer for `text`, checked: one {@link CheckedMention} per
 * mention, in order. Throws a `TypeError` naming the reader when the answer
 * is not `{ mentions: [] }` (at most {@link MAX_MENTIONS}) — the reader
 * broke its port, and a run is never read by a guess at what it meant.
 */
export function checkReading(text: string, value: unknown, readerId: string): CheckedMention[] {
  if (!isRecord(value) || !Array.isArray(value.mentions) || value.mentions.length > MAX_MENTIONS) {
    throw new TypeError(
      `TimeReader '${readerId}' returned ${
        isRecord(value) && Array.isArray(value.mentions) ? 'too many mentions' : 'no reading'
      } — read() answers { mentions: [] } with at most ${MAX_MENTIONS} mentions.`,
    );
  }
  return (value.mentions as unknown[]).map((m) => checkMention(text, m));
}
