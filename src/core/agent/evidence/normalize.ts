/**
 * normalize — one spelling for one value, on BOTH sides of the comparison.
 *
 * Pattern: a pure leaf module (no imports), shared by the extractor and the
 *          evidence index so the two can never disagree about what "the same
 *          value" means.
 * Role:    core/ layer, `namesAndNumbersFromEvidence` only.
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

/** Trailing punctuation: sentence ends, list separators, a trailing percent. */
const TRAILING_DECORATION = /[.,;:!?%'"`)\]}>]+$/;

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
export function normalizeToken(raw: string): string {
  let v = raw.toLowerCase().trim();
  if (v === '') return '';
  v = v.replace(LEADING_DECORATION, '').replace(TRAILING_DECORATION, '');
  if (v === '') return '';
  // Thousands separators are PRESENTATION. `41,200` in prose and `41200` in
  // JSON are one value, and this is the single most common way a correct
  // answer looks fabricated to a naive matcher.
  if (THOUSANDS.test(v)) v = v.replace(/,/g, '');
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
  for (const rough of text.replace(INTRA_TOKEN, ' ').split(/\s+/)) {
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
 * The spellings of one normalized value that count as the SAME value when
 * looking it up.
 *
 * Only one rule so far, and it is a real one: an FCID is read off a switch as
 * `0xef0101` and quoted back sometimes as `ef0101`. Both sides expand, so the
 * prefix can be dropped by either the tool or the model without either being
 * accused of inventing it.
 */
export function lookupForms(normalized: string): readonly string[] {
  if (normalized.startsWith('0x') && normalized.length > 2) {
    return [normalized, normalized.slice(2)];
  }
  return [normalized];
}
