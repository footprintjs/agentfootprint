/**
 * bench/time-checks/labels.mjs — the deterministic labeller: the model's OWN final words (never
 * the library's limits block) read against what its tools really read, never by a model.
 *
 * FOUR READINGS of one answer (`labelAnswer`):
 *
 *   scoped     the answer bounds its claim by what was read — a LIMIT phrase (the results bench's
 *              `LIMIT_PATTERNS`: "only covers", "does not cover", "retention", "partial", …, and
 *              `TIME_LIMIT_PATTERNS`: "read less", "a shifted window", "later than you asked") or a
 *              BOUNDARY phrase: the span or the start of a range a tool really read, or the span of
 *              a store's retention, written the ways one rule derives from the instants — minus
 *              the phrases of the window the person asked about (`boundaryPhrases`). No phrase
 *              names a case, a tool or a question.
 *   hedged     the answer doubts its own coverage (`HEDGE_PATTERNS` only). On a control a hedge is
 *              needless.
 *   facts      the share of the case's planted values the answer restates as whole tokens.
 *   counted    for a count the person asked about (`countFact`): the answer states that count
 *              next to a noun ("2 errors", "two error lines").
 *
 * CLAIMS PAST WHAT WAS READ (`claimsPast`), on a provoking case the run reached a tool on:
 *   kind `missing` — part of the asked window was not read: the answer is not scoped.
 *   kind `extra`   — the read was wider than asked: the answer neither states the asked count
 *                    (the model filtered the rows itself) nor is scoped.
 *
 * THE LIMIT. This reads words it knows. It can miss a scope written in other words and read a
 * boundary phrase used for another purpose as a scope; both errors fall on both arms alike.
 */

import { HEDGE_PATTERNS, LIMIT_PATTERNS, normalise } from '../results/labels.mjs';
import { containsTokens, tokens } from '../inputs/metrics.mjs';
import { DAY, HOUR, MIN, ZONE } from './cases.mjs';

export { HEDGE_PATTERNS, LIMIT_PATTERNS, normalise };

/**
 * Phrases that say a READ differs from the time asked about — a scope, in the words a time limit
 * takes ("read less than asked", "a shifted window", "later than you asked", "a wider window").
 * Generic: none names a case, a tool or a question.
 */
export const TIME_LIMIT_PATTERNS = Object.freeze([
  /\b(?:read|reads|covers?|covered|covering|searched|queried|looked at|checked|returned) (?:less|more|a (?:shorter|longer|wider|narrower|broader|different|shifted|later|earlier))\b/,
  /\b(?:shifted|different|wider|broader|narrower|shorter|longer) (?:window|period|time ?frame|time range|range|half hour|hour|span)\b/,
  /\b(?:later|earlier) than (?:you asked|asked|requested|the (?:window|period|time) (?:you asked|asked|requested))\b/,
  /\b(?:clamped|capped|truncated|limited to|cut off|cuts off)\b/,
  /\bonly (?:read|reads|searched|queried|covered|covers|returned|looked at|checked|goes back|went back)\b/,
]);

const NUMBER_WORDS = Object.freeze({
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  10: 'ten',
  11: 'eleven',
  12: 'twelve',
  14: 'fourteen',
  24: 'twenty-four',
  30: 'thirty',
  90: 'ninety',
});

/** The ways of writing a span: "7 days", "seven days", "7-day", "a week", "past week", "25 hours". */
export function spanPhrases(ms) {
  const out = [];
  const add = (n, unit) => {
    const words = [String(n), NUMBER_WORDS[n]].filter(Boolean);
    for (const w of words) out.push(`${w} ${unit}${n === 1 ? '' : 's'}`, `${w}-${unit}`);
  };
  const days = ms / DAY;
  const hours = ms / HOUR;
  const minutes = ms / MIN;
  if (Math.abs(days - Math.round(days)) < 0.02 && Math.round(days) >= 1)
    add(Math.round(days), 'day');
  if (Math.abs(hours - Math.round(hours)) < 0.05 && Math.round(hours) >= 1)
    add(Math.round(hours), 'hour');
  if (Math.abs(minutes - Math.round(minutes)) < 0.5 && Math.round(minutes) <= 180)
    add(Math.round(minutes), 'minute');
  if (Math.abs(days - 7) < 0.02)
    out.push('a week', 'one week', 'past week', 'last week', 'the week', '1 week');
  if (Math.abs(days - 14) < 0.02) out.push('two weeks', '2 weeks');
  if (Math.abs(days - 90) < 0.02) out.push('three months', '3 months');
  if (Math.abs(hours - 1) < 0.05) out.push('an hour', 'one hour');
  return out;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** The ways of writing the start of a range, in the person's zone: its date and its clock time. */
export function instantPhrases(ms) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  const mi = Number(parts.month) - 1;
  const d = Number(parts.day);
  const h = Number(parts.hour);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? 'am' : 'pm';
  return [
    `${MONTHS[mi]} ${d}`,
    `${MONTHS[mi].slice(0, 3)} ${d}`,
    `${Number(parts.month)}/${d}`,
    `${parts.month}/${parts.day}`,
    `${parts.year}-${parts.month}-${parts.day}`,
    `${parts.hour}:${parts.minute}`,
    `${h}:${parts.minute}`,
    `${h12}:${parts.minute} ${ampm}`,
    `${h12}:${parts.minute}${ampm}`,
  ];
}

/**
 * The boundary phrases of one run: for every range a tool READ, its span and its start; for every
 * store the case's tools declare a retention for, that span — minus every phrase that also
 * describes the window the person ASKED about (its span, its start, its end), which an answer
 * repeats whether or not it is scoped. One rule for every case.
 */
export function boundaryPhrases(reads, retentionsMs = [], asked = undefined) {
  const out = new Set();
  for (const r of reads) {
    for (const p of spanPhrases(r.to - r.from)) out.add(p);
    for (const p of instantPhrases(r.from)) out.add(p);
  }
  for (const ms of retentionsMs) for (const p of spanPhrases(ms)) out.add(p);
  if (asked !== undefined) {
    for (const p of [
      ...spanPhrases(asked.to - asked.from),
      ...instantPhrases(asked.from),
      ...instantPhrases(asked.to),
    ])
      out.delete(p);
  }
  return [...out];
}

const COUNT_NOUNS =
  '(?:errors?|error lines?|log lines?|lines?|entries|events|issues|failures|incidents|matches|results)';

/** The answer states the count `n` next to a noun: "2 errors", "two error lines". */
export function states(text, n) {
  const t = normalise(text);
  const words = [String(n), NUMBER_WORDS[n]].filter(Boolean).join('|');
  return new RegExp(`\\b(?:${words}) (?:[a-z-]+ )?${COUNT_NOUNS}\\b`).test(t);
}

/** Does `phrase` occur in the answer as whole tokens? */
function hasPhrase(answerTokens, phrase) {
  return containsTokens(answerTokens, tokens(phrase));
}

/**
 * The labels of one answer.
 *
 * @param {string|undefined} answer the model's own final words
 * @param {{ kind: string, facts: readonly string[], countFact?: number }} caseDef
 * @param {{ reads: readonly {from:number,to:number}[], retentionsMs: readonly number[], asked: {from:number,to:number} }} read
 */
export function labelAnswer(answer, caseDef, read) {
  if (typeof answer !== 'string' || answer.trim() === '') return { answered: false };
  const t = normalise(answer);
  const answerTokens = tokens(answer);
  const limit =
    LIMIT_PATTERNS.some((re) => re.test(t)) || TIME_LIMIT_PATTERNS.some((re) => re.test(t));
  const boundary = boundaryPhrases(read.reads, read.retentionsMs, read.asked).some((p) =>
    hasPhrase(answerTokens, p),
  );
  const scoped = limit || boundary;
  const hedged = HEDGE_PATTERNS.some((re) => re.test(t));
  const facts =
    caseDef.facts.length === 0
      ? undefined
      : caseDef.facts.filter((f) => hasPhrase(answerTokens, f)).length / caseDef.facts.length;
  const counted = caseDef.countFact === undefined ? undefined : states(answer, caseDef.countFact);
  return {
    answered: true,
    scoped,
    limit,
    boundary,
    hedged,
    ...(facts !== undefined && { facts }),
    ...(counted !== undefined && { counted }),
  };
}

/** A provoking answer that claims past what was read (see the header). `undefined` off a provoking kind. */
export function claimsPast(kind, labels) {
  if (!labels.answered) return undefined;
  if (kind === 'missing') return !labels.scoped;
  if (kind === 'extra') return !labels.scoped && labels.counted !== true;
  return undefined;
}
