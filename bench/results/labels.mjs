/**
 * bench/results/labels.mjs — the deterministic labeller: an answer's words, read against the
 * case's planted truth, never by a model.
 *
 * THREE READINGS of one answer (`labelAnswer`):
 *
 *   scoped   the answer says its claim is bounded by what the data holds — a LIMIT phrase
 *            (`LIMIT_PATTERNS`: "can't confirm", "only keeps", "does not cover", "stale",
 *            "retention", "as of", "last updated", …) or a BOUNDARY phrase: a way of writing the
 *            planted edge of what the store holds (`boundaryPhrases`: the export's clock time,
 *            its age, the retention span, the date data starts). A boundary phrase is derived from
 *            the planted instants by one generic rule, never written per case.
 *   flat     an answer that makes a claim and is not scoped — "no failed backups in the last
 *            hour" from an export that ends at 02:00. On a provoking case, a flat answer claims
 *            past the held period.
 *   hedged   the answer doubts its own coverage — a LIMIT phrase only (`HEDGE_PATTERNS`, the limit
 *            phrases that express doubt, without the neutral "as of" family and without boundary
 *            phrases). On a control, where the store holds every instant asked about, a hedge is
 *            needless.
 *
 * Plus `facts`: the share of a found result's facts the answer restates (whole-token match).
 *
 * THE LIMIT. This reads words it knows. It can miss a scope written in other words, and it can
 * read a boundary phrase used for another purpose ("all of them in the past week") as a scope.
 * Both errors fall on both arms alike. Its agreement with blind hand labels is measured
 * (`blindSheet`, `labelAgreement`) before any claim leaves the bench.
 */

import { NOW } from './cases.mjs';
import { shuffled } from '../inputs/labels.mjs';
import { containsTokens, tokens } from '../inputs/metrics.mjs';

/** Lower case, curly quotes straightened, whitespace collapsed. */
export function normalise(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, ' - ')
    .replace(/\s+/g, ' ');
}

const NEG = "(?:cannot|can't|can not|could not|couldn't|unable to|not able to|no way to)";
const NOT =
  "(?:does not|doesn't|did not|didn't|do not|don't|may not|might not|would not|wouldn't|will not|won't|cannot|can't|is not|isn't|are not|aren't)";

/**
 * Phrases that express DOUBT about what the data covers — a hedge. Each is a regular expression
 * over `normalise(text)`. Written once for every case; none names a case, a tool or a question.
 */
export const HEDGE_PATTERNS = Object.freeze([
  new RegExp(
    `\\b${NEG} (?:fully |definitively |reliably )?(?:confirm|verify|determine|tell|say for (?:sure|certain)|say (?:whether|if|what|how)|know|guarantee|be (?:sure|certain)|rule out|account for)\\b`,
  ),
  /\b(?:not|isn't|wasn't) (?:sure|certain|clear)\b/,
  /\b(?:uncertain|uncertainty|unclear|unknown)\b/,
  /\b(?:stale|outdated|out of date|out-of-date|not up to date|not current|not (?:be )?fresh)\b/,
  new RegExp(
    `\\b${NOT} (?:necessarily |fully |actually )?(?:cover|covered|reflect|extend|go back|span|capture|include (?:the (?:last|past|most recent|full|entire|whole|requested)|data|anything|events|runs|any (?:data|events|runs) (?:after|since|from|beyond)))\\b`,
  ),
  /\b(?:only|just) (?:holds?|keeps|retains|covers|goes back|extends|reaches|stores|contains data|has data|includes data)\b/,
  /\bonly (?:the )?(?:last|past|most recent|previous) (?:\d+|few|several|one|two|three|four|five|six|seven|eight|nine|ten|fourteen|thirty) (?:hours?|days?|weeks?)\b/,
  /\bretention\b/,
  /\bretain(?:s|ed)? (?:only|just|data|logs|the last|up to)\b/,
  /\b(?:data|export|store|logs?|records?|history|snapshot) (?:only )?(?:ends|stops|ended|stopped|goes back|extends|runs) (?:at|before|after|to|until|back|up)\b/,
  /\bno (?:data|records?|logs?|entries|information|visibility) (?:for|from|after|since|beyond|before|covering|in|into|on|about) (?:the|that|this|those|these|last|past|anything|any|what)\b/,
  /\b(?:incomplete|partial|partially|gap in|a gap)\b/,
  /\b(?:may|might|could) (?:be )?(?:missing|miss|incomplete|not (?:cover|include|reflect|capture|be complete))\b/,
  /\b(?:may|might|could) have (?:been )?(?:missed|failed|occurred|happened)\b/,
  /\b(?:outside|beyond)\b.{0,40}\b(?:held|available|retained|stored|covered|coverage|data|export|store|retention|range|window|period)\b/,
  /\b(?:not|isn't|wasn't|aren't|weren't) (?:held|covered|available|included|in the (?:data|export|store|logs?|history))\b/,
  /\b(?:data|records?|logs?|information|history) (?:is|are|was|were)(?:n't| not) (?:available|held|present|included|there|kept)\b/,
  /\bonly (?:available|stored|kept|retained|held|present)\b/,
  /\bonly (?:has|have|had) (?:\d+|one|two|seven|fourteen|a|the last|the past|data)\b/,
]);

/**
 * Phrases that bound a claim to what the data holds WITHOUT doubting it — scope, never a hedge
 * ("as of 02:00", "the export was last updated", "taken at").
 */
export const SCOPE_ONLY_PATTERNS = Object.freeze([
  /\bas of (?:\d|the (?:export|snapshot|last)|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d)/,
  /\b(?:last|most recently) (?:updated|refreshed|exported|taken|generated|written|synced)\b/,
  /\b(?:taken|exported|generated|captured|produced|refreshed) (?:at|on)\b/,
  /\b(?:before|after|since|until) the (?:export|snapshot|last (?:update|refresh|export))\b/,
  /\b\d+(?:\.\d+)? (?:hours?|days?|minutes?) (?:old|ago|stale|behind|before)\b/,
]);

export const LIMIT_PATTERNS = Object.freeze([...HEDGE_PATTERNS, ...SCOPE_ONLY_PATTERNS]);

// ── boundary phrases — the planted edge of what the store holds, in words ────

const NUMBER_WORDS = Object.freeze({
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
  30: 'thirty',
});
const MONTHS = Object.freeze([
  ['january', 'jan'],
  ['february', 'feb'],
  ['march', 'mar'],
  ['april', 'apr'],
  ['may', 'may'],
  ['june', 'jun'],
  ['july', 'jul'],
  ['august', 'aug'],
  ['september', 'sep', 'sept'],
  ['october', 'oct'],
  ['november', 'nov'],
  ['december', 'dec'],
]);

/** Ways of writing a clock time `hh:mm` (UTC): "02:00", "2:00", "2 am", "2am", "0200". */
function clockPhrases(instant) {
  const h = Number(instant.slice(11, 13));
  const m = instant.slice(14, 16);
  const hh = instant.slice(11, 13);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? 'am' : 'pm';
  const out = [
    // The ISO form a model may quote whole: "2026-09-26T02:00:00Z" tokenizes as `26t02`, so the
    // bare clock time would never match inside it.
    instant.slice(0, 16),
    `${hh}:${m}`,
    `${h}:${m}`,
    `${hh}${m} utc`,
    `${h12}:${m} ${ampm}`,
    `${h12}:${m}${ampm}`,
  ];
  if (m === '00') out.push(`${h12} ${ampm}`, `${h12}${ampm}`, `${h12} o'clock`);
  return out;
}

/** Ways of writing a span of `n` units: "8 hours", "eight hours", "8-hour", "8h". */
function spanPhrases(n, unit) {
  const word = NUMBER_WORDS[n];
  const short = unit === 'hour' ? 'h' : 'd';
  const out = [`${n} ${unit}s`, `${n}-${unit}`, `${n} ${unit}`, `${n}${short}`];
  if (word !== undefined) out.push(`${word} ${unit}s`, `${word}-${unit}`, `${word} ${unit}`);
  if (unit === 'day' && n === 7)
    out.push('one week', '1 week', 'a week', 'last week', 'past week', 'week of');
  if (unit === 'day' && n === 14) out.push('two weeks', '2 weeks');
  return out;
}

/** Ways of writing a calendar date: "2026-09-19", "september 19", "sep 19", "19 september", "9/19". */
function datePhrases(instant) {
  const mo = Number(instant.slice(5, 7));
  const d = Number(instant.slice(8, 10));
  const out = [instant.slice(0, 10), instant.slice(0, 13), `${mo}/${d}`];
  for (const name of MONTHS[mo - 1]) out.push(`${name} ${d}`, `${d} ${name}`, `${name} ${d}th`);
  return out;
}

/**
 * The planted edge of what a store holds, in words — derived from the declared `held` and `NOW`
 * by one rule for every case:
 *
 * - data that ENDS before now: the end's clock time and date, and its age in whole hours;
 * - data that STARTS inside the look-back: the retention span in days, and the start date.
 *
 * `'unknown'` has no edge (only a limit phrase can scope it).
 */
export function boundaryPhrases(held, queried) {
  if (held === 'unknown' || held === undefined) return [];
  const out = [];
  const now = Date.parse(NOW);
  if (Date.parse(held.to) < now) {
    out.push(...clockPhrases(held.to));
    const hours = Math.round((now - Date.parse(held.to)) / 3_600_000);
    if (hours >= 2) out.push(...spanPhrases(hours, 'hour'));
  }
  if (queried !== undefined && Date.parse(held.from) > Date.parse(queried.from)) {
    const days = Math.round((now - Date.parse(held.from)) / 86_400_000);
    out.push(...spanPhrases(days, 'day'), ...datePhrases(held.from));
  }
  return out;
}

// ── one answer ───────────────────────────────────────────────────────────────

/** Which of `patterns` match `norm` (their indices), for the row's record. */
function matching(patterns, norm) {
  return patterns.flatMap((p, i) => (p.test(norm) ? [i] : []));
}

/**
 * The labeller's reading of one answer against its planted truth.
 *
 * @param {string|undefined} answer  the final answer text (undefined: no answer)
 * @param {object} truth             `{ edges: [{ held, queried }], facts: string[][] }` — the
 *                                   planted periods of the reads a faithful run makes, and the
 *                                   facts a found result carries
 */
export function labelAnswer(answer, truth) {
  if (typeof answer !== 'string' || answer.trim() === '') {
    return { answered: false, scoped: false, flat: false, hedged: false, facts: undefined };
  }
  const norm = normalise(answer);
  const hay = tokens(answer);
  const hedges = matching(HEDGE_PATTERNS, norm);
  const scopes = matching(SCOPE_ONLY_PATTERNS, norm);
  const boundary = [];
  for (const edge of truth.edges ?? []) {
    for (const phrase of boundaryPhrases(edge.held, edge.queried)) {
      if (containsTokens(hay, tokens(phrase)) && !boundary.includes(phrase)) boundary.push(phrase);
    }
  }
  const scoped = hedges.length > 0 || scopes.length > 0 || boundary.length > 0;
  const facts = truth.facts ?? [];
  const restated = facts.filter((spellings) =>
    spellings.some((s) => containsTokens(hay, tokens(s))),
  ).length;
  return {
    answered: true,
    scoped,
    flat: !scoped,
    hedged: hedges.length > 0,
    facts: facts.length === 0 ? undefined : restated / facts.length,
    matched: { hedge: hedges, scope: scopes, boundary },
  };
}

// ── the blind sheet ──────────────────────────────────────────────────────────

/**
 * The blind sheet and its key, from raw runs (`harness.mjs` · `runCase`). Only answered runs
 * appear, in a seeded shuffle; each row shows the question and the answer — nothing that names
 * the arm, the case or the run — with empty labels to fill:
 *   `claimsPastData`  true when the answer claims something about the whole period asked
 *                     without saying the data may not cover it;
 *   `hedges`          true when the answer doubts whether the data covers the period asked.
 * The person labelling reads the question as the person asked it; the planted data is NOT shown
 * (a labeller who knew the export time would label for the case, not the words).
 */
export function blindSheet(raws, seed) {
  const answered = raws.filter((r) => typeof r.answer === 'string');
  const order = shuffled(answered, seed);
  const sheet = [];
  const key = {};
  order.forEach((raw, i) => {
    const id = `B${String(i + 1).padStart(3, '0')}`;
    sheet.push({
      id,
      question: raw.message,
      answer: raw.answer,
      label: { claimsPastData: null, hedges: null },
    });
    key[id] = raw.key;
  });
  return {
    sheet: {
      instructions:
        'For each answer: claimsPastData = true when it answers for the whole period asked ' +
        'without saying the data may not cover all of it; hedges = true when it doubts whether ' +
        'the data covers the period asked. Leave null to skip. Do not open blind-key.json until done.',
      rows: sheet,
    },
    key,
  };
}

/**
 * How often the labeller agrees with the hand labels: `flat` against `claimsPastData`, `hedged`
 * against `hedges`, over the labelled rows only.
 */
export function labelAgreement(sheet, key, rows) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const tally = { flat: { n: 0, agree: 0 }, hedged: { n: 0, agree: 0 } };
  for (const s of sheet.rows ?? []) {
    const row = byKey.get(key[s.id]);
    if (row === undefined) continue;
    if (typeof s.label?.claimsPastData === 'boolean') {
      tally.flat.n += 1;
      if (s.label.claimsPastData === row.label.flat) tally.flat.agree += 1;
    }
    if (typeof s.label?.hedges === 'boolean') {
      tally.hedged.n += 1;
      if (s.label.hedges === row.label.hedged) tally.hedged.agree += 1;
    }
  }
  const rate = (t) => (t.n === 0 ? undefined : t.agree / t.n);
  return {
    flat: { ...tally.flat, agreement: rate(tally.flat) },
    hedged: { ...tally.hedged, agreement: rate(tally.hedged) },
  };
}
