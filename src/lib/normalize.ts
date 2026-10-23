/**
 * normalize — one spelling for one value, on BOTH sides of the comparison.
 *
 * Pattern: a pure leaf module (its one import, `linearText.ts`, is a leaf
 *          too), shared by the extractor and the evidence index so the two can
 *          never disagree about what "the same value" means.
 * Role:    lib/ layer (L0): the evidence gate (`namesAndNumbersFromEvidence`),
 *          the inputs layer (`tools/declare.ts`) and the `absent({ among })`
 *          mint (`semantics/coverage/among.ts`, which ranks the names nearest
 *          a missed one) read it. It moved down from `tools/` so the coverage
 *          mint, two layers below, spells a name the way the gate does — one
 *          spelling, not a second one beside it.
 * Emits:   N/A.
 *
 * ## Why this file exists at all
 *
 * The answer is prose and the evidence is JSON. The same fact is spelled
 * differently in each: a tool returns the NUMBER `41200`, and the model writes
 * `41,200 IOPS.` — with a thousands separator, a unit and a full stop. A naive
 * matcher calls that fabricated, which is the worst failure this feature can
 * have: a false accusation costs a real turn under `guard` and refuses a good
 * answer under `rails`.
 *
 * So every value passes through {@link normalizeToken} before it is compared,
 * on the answer side AND on the evidence side. The rules are deliberately few
 * and each is here because a real spelling difference needed it.
 */
import { anyOf, isRegExpWhitespace, trimTrailing } from './linearText.js';

/**
 * Characters that may live INSIDE one token.
 *
 * Everything else is a separator. The set is the punctuation that real
 * identifiers are built from — `21:00:00:24:ff:4a:12:03` (colons),
 * `stor-array05-ct1-fc0` (hyphens), `fc1/3` (slash), `z_array05_ct1_esxi`
 * (underscore), `7.0.3` (dots), `41,200` (comma), `0xef0101`, `78%`, `$20`.
 * Quotes, brackets, pipes, asterisks and backticks are NOT in it, so a value
 * in a markdown table cell or in `**bold**` tokenizes to the same string as the
 * bare one.
 */
const INTRA_TOKEN = /[^A-Za-z0-9:_\-/.,%+@#$]+/g;
/** The answer's range reader keeps an en dash until it knows whether it is numeric. */
const RANGE_TOKEN = /[^A-Za-z0-9:_\-/.,%+@#$–]+/g;

/**
 * A comma that is NOT flanked by digits on both sides — i.e. a list comma
 * (`fc1/3,fc1/4`) rather than a thousands separator (`41,200`).
 */
const LIST_COMMA = /,(?!\d)|(?<!\d),/;

/**
 * Leading characters that decorate a value rather than belong to it. Quotes
 * and brackets are in the set even though {@link tokenize} already removes
 * them: this function is ALSO called straight on a JSON leaf and on a
 * caller's `exempt` string, and one spelling rule has to cover all three
 * entry points or the two sides can disagree.
 */
const LEADING_DECORATION = /^[$#@+'"`([{<]+/;

/**
 * Trailing punctuation: sentence ends, list separators, a trailing percent.
 * A character test walked in from the end, not `/[…]+$/`: a token is model
 * output, and that regex retries from every position of a long punctuation
 * run (`lib/linearText.ts` · "Why these exist").
 */
const TRAILING_DECORATION = anyOf('.,;:!?%\'"`)]}>');
const ANSWER_TRAILING_DECORATION = anyOf('.,;:!?\'"`)]}>');

const QUOTE = 0x22;
const COLON = 0x3a;
const BACKSLASH = 0x5c;

/**
 * Text with each JSON key's colon made a space: `{"total":1200}` reads
 * `{"total" 1200}`. Compact JSON writes no space after a key, so once the
 * quotes become separators the key's colon stayed on the value, and `:1200`
 * read as an IDENTIFIER no result carries — every number of three or more
 * digits in a typed answer looked invented (and `rails` refused the answer
 * that copied it).
 *
 * Only a KEY's colon: one right after a closing double quote (the second of a
 * pair; an escaped `\"` is not counted), white space allowed between. Every
 * other colon is part of the value it sits in and stays — an IPv6 address
 * (`::1234`, `fe80::1`, `::ffff:192.0.2.1`) is never the number after its
 * colons, and a quoted `":8080"` keeps its colon. One pass, on both sides,
 * like every rule here.
 */
function withoutKeyColons(text: string): string {
  if (!text.includes('"')) return text;
  let out = '';
  let from = 0;
  let open = false;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) !== QUOTE || escaped(text, i)) continue;
    open = !open;
    if (open) continue;
    let j = i + 1;
    while (j < text.length && isRegExpWhitespace(text.charCodeAt(j))) j++;
    if (text.charCodeAt(j) === COLON) {
      out += `${text.slice(from, j)} `;
      from = j + 1;
    }
  }
  return from === 0 ? text : out + text.slice(from);
}

/** Whether the quote at `at` is escaped: an odd run of backslashes before it. */
function escaped(text: string, at: number): boolean {
  let run = 0;
  for (let k = at - 1; k >= 0 && text.charCodeAt(k) === BACKSLASH; k--) run++;
  return run % 2 === 1;
}

/** `1,234` / `12,345,678` / `1,234.56` — a number wearing thousands separators. */
const THOUSANDS = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;

/** A plain decimal or integer, optionally signed. */
const PLAIN_NUMBER = /^[-+]?\d+(\.\d+)?$/;

/**
 * Above this many digits, `Number()` silently rounds — `9007199254740993`
 * becomes `9007199254740992`. A 20-digit array serial is a VALUE, not a
 * quantity, so past the safe-integer range the raw digits are kept and
 * compared as a string.
 */
const MAX_EXACT_DIGITS = 15;

/**
 * Reduce one raw token to the form both sides compare on.
 *
 * Returns `''` for a token that is nothing but decoration — callers drop those.
 */
function tokenSpelling(raw: string, preservePercent = false): string {
  let v = raw.toLowerCase().trim();
  if (v === '') return '';
  v = trimTrailing(
    v.replace(LEADING_DECORATION, ''),
    preservePercent ? ANSWER_TRAILING_DECORATION : TRAILING_DECORATION,
  );
  if (v === '') return '';
  // Thousands separators are PRESENTATION. `41,200` in prose and `41200` in
  // JSON are one value, and this is the single most common way a correct
  // answer looks fabricated to a naive matcher.
  if (THOUSANDS.test(v)) v = v.replace(/,/g, '');
  return v;
}

export function normalizeToken(raw: string): string {
  let v = tokenSpelling(raw);
  // `98304.0` (a JSON float printed by a spreadsheet exporter) and `98304`
  // (the same float printed by JSON.stringify) are one value. Canonicalise
  // through Number — but only while Number can hold the digits exactly.
  if (PLAIN_NUMBER.test(v) && countDigits(v) <= MAX_EXACT_DIGITS) {
    const n = Number(v);
    if (Number.isFinite(n)) v = String(n);
  }
  return v;
}

/** How many digit characters a string carries. */
export function countDigits(v: string): number {
  let n = 0;
  for (const ch of v) if (ch >= '0' && ch <= '9') n += 1;
  return n;
}

/**
 * Split free text into candidate tokens.
 *
 * Used on the answer (to find values to ground) and on any tool-result text
 * that is not JSON. Token boundaries are the whole point: a value that appears
 * only as a SUBSTRING of an unrelated field must not read as grounded, so
 * matching is always token-exact and never substring.
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const rough of withoutKeyColons(text).replace(INTRA_TOKEN, ' ').split(/\s+/)) {
    if (rough === '') continue;
    // A comma inside a token is either a thousands separator (keep the token
    // whole) or a list separator that had no space after it (split).
    for (const piece of rough.split(LIST_COMMA)) {
      const norm = normalizeToken(piece);
      if (norm !== '') out.push(norm);
    }
  }
  return out;
}

/**
 * Answer-side spellings, before numeric canonicalization, for precision and
 * exactly-two-endpoint ranges. Ordinary tokenization remains unchanged on the
 * evidence and exemption sides. A non-range en-dash token is split normally by
 * the caller after it has declined the range grammar.
 */
export function answerTokenSpellings(text: string): string[] {
  const out: string[] = [];
  for (const rough of withoutKeyColons(text).replace(RANGE_TOKEN, ' ').split(/\s+/)) {
    for (const piece of rough.split(LIST_COMMA)) {
      const spelling = tokenSpelling(piece, true);
      if (spelling !== '') out.push(spelling);
    }
  }
  return out;
}

/**
 * The spellings of one normalized value that count as the SAME value when
 * looking it up.
 *
 * Only one rule so far, and it is a real one: an FCID is read off a switch as
 * `0xef0101` and quoted back sometimes as `ef0101`. Both sides expand, so the
 * prefix can be dropped by either the tool or the model without either being
 * accused of inventing it.
 *
 * Deliberately NOT here (9.110.0): a glued-unit number's bare form. Applied
 * on the INDEX side it would let a result's `latency 2024ms` ground an
 * answer's prose year `2024`, which weakens the gate; the glued spelling is
 * met on the LOOKUP side only, by the candidate that came from one
 * (`evidence/extract.ts · candidateForms`).
 */
export function lookupForms(normalized: string): readonly string[] {
  if (normalized.startsWith('0x') && normalized.length > 2) {
    return [normalized, normalized.slice(2)];
  }
  return [normalized];
}

/**
 * The one spelling every equivalent value shares — the LAST of
 * `lookupForms`, so `0xef0101` and `ef0101` both canonicalise to `ef0101`.
 * A reader that must file one thing per VALUE (`findings/contingent.ts`,
 * one row per value per moment) keys on this rather than on the spelling
 * the model happened to use.
 */
export function canonicalForm(normalized: string): string {
  const forms = lookupForms(normalized);
  return forms[forms.length - 1] ?? normalized;
}
