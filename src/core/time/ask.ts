/**
 * core/time/ask — the one time ask (time design § 6): what a time field's
 * answer must be, why one is refused, and the choices a reading offers.
 *
 * Pattern: one judge per boundary (the `range.ts` precedent). A typed ask's
 *          `InputField.format` (`core/inputRequest.ts`) names what the answer
 *          is; {@link checkTimeAnswer} is the ONE judge of it — at definition
 *          (a choice, a supplied value) and at the resume door (the person's
 *          answer). A refusal is a CODE with its facts; the sentence is a
 *          catalog entry (`src/locales/timeAsk.ts` · `defaultTimeAskMessages`)
 *          the app may override (`.time({ messages })`), filled here
 *          ({@link refusalReason}) — the library writes a reason only for a
 *          check the app armed by declaring the field (TQ7).
 * Role:    core/ leaf (the time layer). Imports `instant.ts`, `zone.ts`,
 *          `range.ts`, `present.ts` and the row / candidate TYPES only.
 * Emits:   N/A.
 *
 * ## What an answer must be (§ 6.1, § 6.2)
 *
 * | `format` | The answer | Refused as |
 * |----------|------------|------------|
 * | `instant` | an ISO 8601 date-time WITH its offset, strict profile (`2026-10-09T08:00-07:00`) | `not-an-instant`; `no-offset` (a date-time with no zone); `dst-gap` |
 * | `time-range` | an ISO 8601 interval `from/to` of two such instants, `from` before `to` | `not-a-range`; either end's refusal; `out-of-order` |
 * | `zone` | an IANA zone name (`America/Los_Angeles`) — never an abbreviation or a bare offset | `not-a-zone` |
 * | `time-range`, for a tool's period | the same, inside the tool's declared facts | `time-future`; `time-past`; `beyond-retention`; `over-max-range` |
 *
 * A `time-range` answer given for a tool's period is also judged against the
 * tool's declared FACTS (§ 6.2, step T5a — `convert.ts` ·
 * `periodFactProblem`), when the caller hands them with the turn's clock:
 * `time-future` (a `past` source asked for a window after now), `time-past`
 * (a `future` source asked for one that ended), `beyond-retention` (the WHOLE
 * window older than the source keeps — a partial overlap is taken) and
 * `over-max-range` (wider than the source reads at once).
 *
 * `dst-gap` is asked only when the ask knows the person's zone (the run
 * clock's, under `.time()`): a wall time that zone's clocks skip, written with
 * one of the two offsets around the change (`2026-03-08T02:30-08:00` in Los
 * Angeles) names an instant nobody's clock showed. An instant written in some
 * other offset is that instant, and is taken.
 *
 * ## The choices a reading offers (§ 6.1, § 6.3)
 *
 * {@link timeAskOf} turns a `time-reading` row whose choice is `open` into one
 * field: a `format: 'zone'` field when the person named a zone the layer
 * cannot read (`PST`), else a `format: 'time-range'` field whose `enum` is
 * the candidates left (each an ISO interval) and whose `labels` render each in
 * the reader's locale, the zone named, with the end the person said. A
 * `kind: 'model'` reader's window is offered as the LIBRARY'S reading to
 * confirm ("I read “yesterday” as … — is that right?"), never as the person's
 * words (§ 5.5). So is a `rule` reading that is not the person's window
 * (`confirmNeeded`, step T6b): the question names what the reader did not read
 * ("I read only “8:40 AM” as a time, not “til 9.30”…") — or, for a form off the
 * said allow-list, a point time or one of several mentions (`rows.ts` ·
 * `confirmNeededOf`), asks the plain confirmation — and the one choice is the
 * reading WITH ITS ZONE ("I read “yesterday” as Thu, Oct 8, 2026, PDT in
 * America/Los_Angeles — is that right?"), so a person who meant another zone's
 * day corrects it in one answer. Free entry stays open: a field is `strict`
 * only when the app says so.
 *
 * @example
 * ```ts
 * checkTimeAnswer('time-range', '2026-10-09T08:40-07:00/2026-10-09T08:00-07:00');
 * // { problem: 'out-of-order', facts: { from: '2026-10-09T08:40-07:00', to: '2026-10-09T08:00-07:00' } }
 * checkTimeAnswer('instant', '2026-10-09T08:00'); // { problem: 'no-offset', facts: { value: '2026-10-09T08:00' } }
 * checkTimeAnswer('instant', '2026-03-08T02:30-08:00', 'America/Los_Angeles'); // { problem: 'dst-gap', … }
 * checkTimeAnswer('zone', 'PST'); // { problem: 'not-a-zone', facts: { value: 'PST' } }
 * refusalReason([checkTimeAnswer('zone', 'PST')!], defaultTimeAskMessages);
 * // '“PST” is not a time zone name. Name one such as America/Los_Angeles.'
 * ```
 */

import { periodFactProblem, type PeriodFacts } from './convert.js';
import { compareInstants, instantOf, utcWallMs, type InstantText } from './instant.js';
import { spellRange } from './range.js';
import { isZoneName, readWall, type ZoneName } from './zone.js';
import { presentRange } from './present.js';
import type { TimeReadingRow } from './rows.js';
import type { TimeCandidate } from './resolve.js';

// ─── The formats ─────────────────────────────────────────────────────────

/** What a time field's answer is (time design § 6.1). The value stays a string on the wire. */
export type TimeFormat = 'instant' | 'time-range' | 'zone';

export const TIME_FORMATS: readonly TimeFormat[] = Object.freeze(['instant', 'time-range', 'zone']);

/** Whether `value` names a {@link TimeFormat}. */
export function isTimeFormat(value: unknown): value is TimeFormat {
  return TIME_FORMATS.includes(value as TimeFormat);
}

// ─── The checks ──────────────────────────────────────────────────────────

/** Why a time answer was refused — a code; the sentence is the catalog's. */
export type TimeAnswerProblem =
  | 'not-an-instant'
  | 'no-offset'
  | 'not-a-range'
  | 'out-of-order'
  | 'dst-gap'
  | 'not-a-zone'
  | 'time-future'
  | 'time-past'
  | 'beyond-retention'
  | 'over-max-range';

/** One refused answer: the code and the facts its sentence names (the value as given, capped). */
export interface TimeAnswerRefusal {
  readonly problem: TimeAnswerProblem;
  readonly facts: Readonly<Record<string, string>>;
}

/** A date-time a person wrote with no offset: it could be any zone's. */
const NO_OFFSET = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/;
const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;
/** A quoted value in a sentence is cut here: a reason names the answer, it does not repeat an essay. */
const QUOTE_CHARS = 64;

const quoted = (value: string): string =>
  value.length <= QUOTE_CHARS ? value : `${value.slice(0, QUOTE_CHARS - 1)}…`;

/**
 * Whether `value` writes a wall time the clocks of `zone` skip, with one of
 * the two offsets around that change — an instant no clock in the zone showed.
 */
function inDstGap(value: string, offsetMinutes: number, zone: ZoneName): boolean {
  const m = WALL.exec(value);
  if (m === null) return false;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const reading = readWall({ year, month, day, hour, minute, second }, zone);
  if (reading.kind !== 'gap') return false;
  const wall = utcWallMs(year, month, day, hour, minute, second);
  const offsetMs = offsetMinutes * 60_000;
  // `readWall` names the gap's two readings: `earlier` with the offset AFTER the change, `later` with the one before.
  return offsetMs === wall - reading.earlier || offsetMs === wall - reading.later;
}

function checkInstant(value: string, zone: ZoneName | undefined): TimeAnswerRefusal | undefined {
  const instant = instantOf(value, 'strict');
  if (instant === undefined) {
    return {
      problem: NO_OFFSET.test(value) ? 'no-offset' : 'not-an-instant',
      facts: { value: quoted(value) },
    };
  }
  if (zone !== undefined && inDstGap(value, instant.offsetMinutes, zone)) {
    return {
      problem: 'dst-gap',
      facts: { value: quoted(value), wall: value.slice(0, 16).replace('T', ' '), zone },
    };
  }
  return undefined;
}

/** A tool's declared facts and the turn's clock — what a `time-range` answer for that tool's period is judged against. */
export interface ToolTimeFacts {
  readonly facts: PeriodFacts;
  readonly now: InstantText;
}

/**
 * Why `value` is not a well-formed answer of `format`, or `undefined` when it
 * is one. `zone` — the person's zone, when the ask knows it (the run clock's)
 * — arms the DST-gap check; without it the answer is judged for shape, order
 * and offset only. `tool` — a tool's declared facts and the clock — judges a
 * well-formed `time-range` against them too.
 */
export function checkTimeAnswer(
  format: TimeFormat,
  value: string,
  zone?: ZoneName,
  tool?: ToolTimeFacts,
): TimeAnswerRefusal | undefined {
  const known = zone !== undefined && isZoneName(zone) ? zone : undefined;
  switch (format) {
    case 'zone':
      return isZoneName(value)
        ? undefined
        : { problem: 'not-a-zone', facts: { value: quoted(value) } };
    case 'instant':
      return checkInstant(value, known);
    case 'time-range': {
      const halves = value.split('/');
      if (halves.length !== 2) return { problem: 'not-a-range', facts: { value: quoted(value) } };
      const [from, to] = halves as [string, string];
      const refused = checkInstant(from, known) ?? checkInstant(to, known);
      if (refused !== undefined) return refused;
      const a = instantOf(from, 'strict');
      const b = instantOf(to, 'strict');
      if (a === undefined || b === undefined || compareInstants(a, b) >= 0) {
        return { problem: 'out-of-order', facts: { from: quoted(from), to: quoted(to) } };
      }
      if (tool === undefined) return undefined;
      const problem = periodFactProblem({ from, to }, tool.facts, tool.now);
      if (problem === undefined) return undefined;
      return {
        problem,
        facts: {
          from: quoted(from),
          to: quoted(to),
          ...(tool.facts.retention !== undefined && { retention: tool.facts.retention }),
          ...(tool.facts.maxRange !== undefined && { maxRange: tool.facts.maxRange }),
        },
      };
    }
  }
}

// ─── The catalog ─────────────────────────────────────────────────────────

/**
 * Every sentence the time ask can put before a person — the keys of the
 * catalog (`src/locales/timeAsk.ts`). `answer.*` is a refusal's reason, one
 * per {@link TimeAnswerProblem}; `ask.*` a question; `choice.confirm` the
 * label on a reading to confirm (a `model` reader's, or a `rule` reading off
 * the said allow-list); `choice.confirm-part` the label on a `rule` reading
 * that left words unread (`confirmNeeded.leftover`), and `ask.confirm-part`
 * its question. Placeholders are `{{name}}`; both labels also take `zone`.
 */
export const TIME_ASK_MESSAGE_KEYS = Object.freeze([
  'answer.not-an-instant',
  'answer.no-offset',
  'answer.not-a-range',
  'answer.out-of-order',
  'answer.dst-gap',
  'answer.not-a-zone',
  'answer.time-future',
  'answer.time-past',
  'answer.beyond-retention',
  'answer.over-max-range',
  'ask.which',
  'ask.confirm',
  'ask.confirm-part',
  'ask.zone',
  'choice.confirm',
  'choice.confirm-part',
] as const);

export type TimeAskMessageKey = (typeof TIME_ASK_MESSAGE_KEYS)[number];

/** A whole catalog: one sentence per key. */
export type TimeAskMessages = Readonly<Record<TimeAskMessageKey, string>>;

const MAX_SENTENCE = 4096;

/**
 * The app's overrides (`.time({ messages })`) read — every key one the
 * catalog has, every value a non-blank sentence of at most 4096 characters —
 * or a problem in words.
 */
export function readTimeAskMessages(
  value: unknown,
): { readonly value: Partial<TimeAskMessages> } | { readonly problem: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { problem: 'messages must be an object of catalog key → sentence' };
  }
  const out: Partial<Record<TimeAskMessageKey, string>> = {};
  for (const [key, sentence] of Object.entries(value as Record<string, unknown>)) {
    if (!(TIME_ASK_MESSAGE_KEYS as readonly string[]).includes(key)) {
      return {
        problem: `messages has no key '${key}' — the keys are ${TIME_ASK_MESSAGE_KEYS.join(', ')}`,
      };
    }
    if (
      typeof sentence !== 'string' ||
      sentence.trim().length === 0 ||
      sentence.length > MAX_SENTENCE
    ) {
      return {
        problem: `messages['${key}'] must be a non-blank sentence of at most ${MAX_SENTENCE} characters`,
      };
    }
    out[key as TimeAskMessageKey] = sentence;
  }
  return { value: out };
}

/** A catalog sentence with its `{{name}}` placeholders filled; a placeholder with no fact is left as written. */
export function fillMessage(template: string, facts: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(facts, name) ? (facts[name] as string) : whole,
  );
}

/**
 * The reason a re-ask carries (`InputRefusal.reason`): one catalog sentence
 * per refused field, in field order, joined by a space — at most 4096
 * characters, the refusal's own bound.
 */
export function refusalReason(
  refusals: readonly TimeAnswerRefusal[],
  messages: TimeAskMessages,
): string {
  const reason = refusals
    .map((r) => fillMessage(messages[`answer.${r.problem}`], r.facts))
    .join(' ');
  return reason.length <= MAX_SENTENCE ? reason : `${reason.slice(0, MAX_SENTENCE - 1)}…`;
}

// ─── The choices a reading offers ─────────────────────────────────────────

/** A time field built from a reading — the fields of `core/inputRequest.ts` · `InputField` it sets. */
export interface TimeAskField {
  readonly id: string;
  readonly type: 'string';
  readonly required: true;
  readonly format: TimeFormat;
  readonly enum?: readonly string[];
  readonly labels?: readonly string[];
}

/** One question about one mention: the question and its field. */
export interface TimeAsk {
  readonly question: string;
  readonly field: TimeAskField;
}

/** The zone token the person wrote in the mention's first parse that has one. */
function saidZoneToken(row: TimeReadingRow): string {
  for (const parts of row.parses ?? []) {
    const token = parts.zoneToken ?? parts.rangeOf?.[0].zoneToken ?? parts.rangeOf?.[1].zoneToken;
    if (token !== undefined) return token;
  }
  return '';
}

/**
 * The ask a `time-reading` row needs, or `undefined` when its reading is
 * settled (`only`, `policy`) or cannot be asked about (`none`, a refused
 * mention). `messages` is the whole catalog (the caller composes the app's
 * overrides over `defaultTimeAskMessages`); `id` names the field.
 */
export function timeAskOf(
  row: TimeReadingRow,
  messages: TimeAskMessages,
  id = 'time',
): TimeAsk | undefined {
  const choice = row.choice;
  if (choice?.by !== 'open' || row.quote === undefined) return undefined;
  const quote = quoted(row.quote);
  if (choice.open.includes('zone')) {
    return {
      question: fillMessage(messages['ask.zone'], { quote, token: quoted(saidZoneToken(row)) }),
      field: { id, type: 'string', required: true, format: 'zone' },
    };
  }
  const candidates = row.candidates ?? [];
  const seen = new Set<string>();
  const offered: { value: string; candidate: TimeCandidate }[] = [];
  for (const index of choice.remaining) {
    const candidate = candidates[index];
    if (candidate === undefined) continue;
    const value = spellRange(candidate.range);
    if (seen.has(value)) continue;
    seen.add(value);
    offered.push({ value, candidate });
  }
  if (offered.length === 0) return undefined;
  // The resolver owns "a reading needs confirming" (`resolve.ts` puts 'confirm'
  // on every open choice a model reader or an incomplete reading made); this only reads it.
  const confirm = choice.open.includes('confirm');
  // Words left unread are named; any other reading to confirm asks the plain confirmation.
  const left = row.confirmNeeded?.leftover;
  const labels = offered.map(({ candidate }) => {
    const window = presentRange(
      candidate.range,
      { zone: candidate.zone, locale: row.reader.locale },
      candidate.grain,
    );
    if (!confirm) return window;
    // The zone is named: the reading leaned on it, and the person may have meant another.
    return fillMessage(messages[left !== undefined ? 'choice.confirm-part' : 'choice.confirm'], {
      quote,
      window,
      zone: candidate.zone,
    });
  });
  const question = !confirm
    ? fillMessage(messages['ask.which'], { quote })
    : left !== undefined
    ? fillMessage(messages['ask.confirm-part'], { quote, leftover: quoted(left.join(' ')) })
    : fillMessage(messages['ask.confirm'], { quote });
  return {
    question,
    field: {
      id,
      type: 'string',
      required: true,
      format: 'time-range',
      enum: offered.map((o) => o.value),
      labels,
    },
  };
}
