/**
 * bench/answer/labels.mjs — the bench's deterministic readers of an ANSWER's words, and the
 * blind sheet a person labels them against.
 *
 * Every gated clause of `RULE.md` is computed from the record against the case's planted truth
 * (`cases.mjs` · `truth`) and needs none of this. Three REPORTED measures read prose, and each is
 * read here by a fixed phrase list — never by a model:
 *
 *   - `hedges`     — the answer voices a limit or uncertainty ("was not checked", "only keeps
 *                    one day", "I can't confirm"). This is the model's VERBALISED confidence,
 *                    the design's baseline for the standing (architecture § 6.2–6.3).
 *   - `attributes` — the answer puts a negative on the lookup ("the lookup returned nothing",
 *                    "I couldn't find any") rather than on the world.
 *   - `flat`       — the answer states non-existence ("there are no open incidents"),
 *                    completeness ("that is the complete list") or a span it did not read
 *                    ("over the past week …") and neither hedges nor attributes. RQ3's
 *                    `exceeds` is a flat answer whose standing is not sure or ask (`metrics.mjs`).
 *
 * The readers can miss a phrase they do not list and can match one used otherwise, which is why
 * their agreement with blind hand labels is measured (`labelAgreement`) before any claim leans
 * on them (the inputs bench's precedent: at least 40 labelled answers and agreement ≥ 0.9).
 *
 * THE PHRASES LIVE IN THE LIBRARY. The hedge and attribution lists, and the non-existence and
 * completeness grammar, are the negative-claim checker's closed, versioned and hashed packs
 * (`src/integrity/negative-claim/phrases.ts`), read here from the BUILT package, so the bench
 * measures exactly what the library ships (`npm run build` first). Only the SPAN reader (an
 * answer claiming a week or a month it did not read) stays here: it is this bench's measure, not
 * a negative claim.
 */

import { containsTokens, tokens } from '../inputs/metrics.mjs';
import { shuffled } from '../inputs/labels.mjs';
import { detectNegativeClaims } from '../../dist/esm/integrity/negative-claim/detect.js';
import { NEGATIVE_CLAIM_PHRASES } from '../../dist/esm/integrity/negative-claim/phrases.js';

/** Lower case, curly quotes straightened, whitespace collapsed. */
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[‘’′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ');
}

const phraseText = (phrase) => phrase.words.join(' ');

/** The two hedges that put the negative on a source — this bench files them under `attributes`. */
const ATTRIBUTING_HEDGES = new Set(['hedge.according-to', 'hedge.based-on']);

/** A limit or an uncertainty, voiced — the library's hedge pack. Matched as substrings. */
export const HEDGE_PHRASES = Object.freeze(
  NEGATIVE_CLAIM_PHRASES.hedge.filter((p) => !ATTRIBUTING_HEDGES.has(p.id)).map(phraseText),
);

/** The negative put on the LOOKUP, not on the world — the library's source pack, and the two. */
export const ATTRIBUTION_PHRASES = Object.freeze([
  ...NEGATIVE_CLAIM_PHRASES.source.map(phraseText),
  ...NEGATIVE_CLAIM_PHRASES.hedge.filter((p) => ATTRIBUTING_HEDGES.has(p.id)).map(phraseText),
]);

/** A span the answer claims to cover — this bench's own reader. */
const SPAN = Object.freeze([
  /\bin total\b/,
  /\b(?:over|in|during|for|across) (?:the )?(?:past|last|previous|this) (?:week|month|7 days|seven days|30 days)\b/,
  /\bthis (?:week|month)\b[^.?!]*\b(?:logged|had|saw|recorded|were|was)\b/,
  /\b(?:had|has had|logged|saw) [^.?!]*\bthis (?:week|month)\b/,
]);

const anyPhrase = (text, list) => list.some((p) => text.includes(p));
const anyPattern = (text, list) => list.some((re) => re.test(text));

/** The three readings of one answer — `undefined` in, all false out. */
export function readAnswerWords(answer) {
  const text = normalize(answer);
  const hedges = anyPhrase(text, HEDGE_PHRASES);
  const attributes = anyPhrase(text, ATTRIBUTION_PHRASES);
  const claims = detectNegativeClaims(String(answer ?? '')).claims;
  const nonExistence = claims.some((c) => c.kind === 'none');
  const completeness = claims.some((c) => c.kind === 'complete') || anyPattern(text, SPAN);
  return {
    hedges,
    attributes,
    nonExistence,
    completeness,
    flat: (nonExistence || completeness) && !hedges && !attributes,
  };
}

/**
 * The facts a case expects that the answer restates: each fact is a list of spellings, any one
 * counts, matched as whole tokens (`../inputs/metrics.mjs` · `tokens`, `containsTokens`).
 */
export function factsIn(answer, facts) {
  const hay = tokens(answer);
  let found = 0;
  for (const spellings of facts) {
    if (spellings.some((s) => containsTokens(hay, tokens(s)))) found += 1;
  }
  return { expected: facts.length, found };
}

/**
 * The value-like tokens an answer states that no recorded tool result, tool argument or person's
 * message carries — the bench's own reader of "the answer states more than the record holds",
 * over the RECORD (never the library's evidence gate, which it is compared with). A value-like
 * token has a digit and is not a single digit (a list number, "2 incidents"); spellings are the
 * shared tokenizer's (`INC-7302` → `inc` `7302`, `5,310` → `5310`, `v4.12.0` stays whole).
 */
export function uncarriedValues(answer, carriedTexts) {
  const carried = new Set(carriedTexts.flatMap((t) => tokens(t)));
  const out = [];
  for (const t of tokens(answer)) {
    if (!/\d/.test(t) || /^\d$/.test(t) || carried.has(t) || out.includes(t)) continue;
    out.push(t);
  }
  return out;
}

// ── the blind sheet ──────────────────────────────────────────────────────────

/** The labels a person gives each answer (booleans), in the sheet's instructions. */
export const LABEL_FIELDS = Object.freeze(['hedges', 'flat']);

/**
 * The blind sheet and its key, from raw runs. Only answered runs appear; each row shows the
 * person's messages and the last answer, never the arm, the case, the run or the standing.
 */
export function blindSheet(raws, seed) {
  const answered = raws.filter((r) => typeof r.turns[r.turns.length - 1]?.answer === 'string');
  const order = shuffled(answered, seed);
  const rows = [];
  const key = {};
  order.forEach((raw, i) => {
    const id = `B${String(i + 1).padStart(3, '0')}`;
    rows.push({
      id,
      messages: raw.turns.map((t) => t.message),
      answer: raw.turns[raw.turns.length - 1].modelText ?? raw.turns[raw.turns.length - 1].answer,
      label: { hedges: null, flat: null },
    });
    key[id] = raw.key;
  });
  return {
    sheet: {
      instructions:
        'For each answer set two booleans. label.hedges: the answer voices a limit or an ' +
        'uncertainty about what it says (something was not checked, the data only covers part, ' +
        'the model cannot confirm). label.flat: the answer states, without such a limit and ' +
        'without putting it on the lookup, that something does not exist, that its list is ' +
        'complete, or that it covers a span (a week, a month). Judge only the words.',
      rows,
    },
    key,
  };
}

/** Agreement of the readers with the hand labels, per field, over labelled rows. */
export function labelAgreement(sheet, key, rows) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out = {};
  for (const field of LABEL_FIELDS) {
    let labelled = 0;
    let agree = 0;
    let skipped = 0;
    for (const s of sheet.rows) {
      const label = s.label?.[field];
      const row = byKey.get(key[s.id]);
      if (typeof label !== 'boolean' || row === undefined) {
        skipped += 1;
        continue;
      }
      labelled += 1;
      if (row.words[field] === label) agree += 1;
    }
    out[field] = {
      labelled,
      agree,
      skipped,
      agreement: labelled === 0 ? undefined : agree / labelled,
    };
  }
  return out;
}
