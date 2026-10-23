/**
 * The value decision shared by claim-seam adapters. Evidence selection,
 * scope/coverage eligibility, provenance and delivery policy belong to callers.
 * This module owns the existing doubt and numeric-leniency rules; structural
 * comparison stays in ContextFootprint's assertion algebra. It also owns the
 * one declared normalization a claim that governs delivery is compared under
 * (`compareClaimValues`, read by `delivered.ts`): the detector keeps exact
 * equality, pinned; a verdict that can withhold an answer must not accuse it
 * over a representational difference.
 *
 * Outcomes describe why a comparison did or did not find a conflict. None is
 * a verification badge: in particular, no-conflict is not positive support.
 */
import type { Assertion } from '../assertion/types.js';
import { comparableValueOf, participates } from '../assertion/types.js';
import { conflictsOf } from '../assertion/conflicts.js';

export type ClaimPairEvaluation =
  | 'evidence-unavailable'
  | 'claim-nonparticipating'
  | 'doubt-against-value'
  | 'both-doubt'
  | 'numeric-leniency'
  | 'conflict'
  | 'no-conflict';

const isDoubt = (value: unknown): boolean => value === null || value === 'unknown';

/** The existing one-direction leniency: a raw numeric string claims a number. */
function numericallyEqual(claimed: unknown, settled: unknown): boolean {
  return (
    typeof settled === 'number' &&
    typeof claimed === 'string' &&
    claimed.trim() !== '' &&
    Number(claimed) === settled
  );
}

/**
 * Evaluate an explicitly selected evidence/claim pair, without selecting or
 * rewriting either assertion. Adapters must establish that the asserted pair
 * concerns the same subject, predicate and epoch before interpreting a result.
 * No rule here establishes scope, completeness, authorisation or truth.
 */
export function evaluateClaimPair(evidence: Assertion, claim: Assertion): ClaimPairEvaluation {
  if (!participates(evidence.value)) return 'evidence-unavailable';

  const settled = comparableValueOf(evidence.value);
  // RAW claimed null/'unknown' is doubt; a known(...) wrapper follows the
  // algebra below. Unwrapping both sides here would change the old contract.
  if (isDoubt(claim.value)) return isDoubt(settled) ? 'both-doubt' : 'doubt-against-value';
  if (numericallyEqual(claim.value, settled)) return 'numeric-leniency';

  const conflict = conflictsOf([evidence, claim]).length !== 0;
  // Classify the absence without converting it into positive agreement. Do
  // this AFTER the algebra so its existing serialization failures still occur.
  if (!participates(claim.value)) return 'claim-nonparticipating';
  return conflict ? 'conflict' : 'no-conflict';
}

/**
 * How a value an answer states compares with the value a tool settled, under
 * ONE declared normalization (`compareClaimValues`). Only `contradicts`
 * accuses; `agrees` verifies nothing.
 */
export type ClaimValueComparison = 'agrees' | 'contradicts' | 'incomparable';

/** A string that is a plain decimal: a number as JSON writes one, with no exponent. */
const PLAIN_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
/** A plain decimal and the unit or word after it: `1250 ms`, `42.50 USD`, `50%`. */
const WITH_UNIT = /^(-?(?:0|[1-9]\d*)(?:\.\d+)?)\s*([^\d\s][^\d]*)$/;
/** Lists and objects nest; past this depth (or around a cycle) values are not compared. */
const MAX_DEPTH = 64;
/**
 * A value written in a FORMAT — a currency symbol, digit separators, a date
 * or a time — has more than one spelling of one value (`$1,250.00` and
 * `$1,250`, `2026-01-01` and `2026-01-01T00:00:00Z`), or one spelling of two
 * (`1.250` is 1.25 or 1250, by locale), so two of them agree only as written
 * and are otherwise never compared.
 */
const FORMATTED: readonly RegExp[] = [
  /\p{Sc}/u, // a currency symbol: $ € £ ¥ ₹ …
  /\d[,'\u00a0\u202f]\d/u, // a separator between digits: 1,250 · 1,5 · 1'250
  /\d \d{3}(?!\d)/, // a space between thousands: 1 250
  /(?:^|[^\d.])[1-9]\d{0,2}(?:\.\d{3})+(?![\d.])/, // dot-grouped: 1.250 · 12.345.678
  /\d{4}-\d{2}-\d{2}/, // an ISO date, with or without its time
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/, // 01/02/2026 · 1-2-26
  /\b\d{1,2}\.\d{1,2}\.\d{4}\b/, // 01.02.2026
  /(?:^|[\sT])\d{1,2}:\d{2}(?::\d{2})?(?![:\w])/, // a clock time: 09:14 · 9:14:05
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i, // Jan 5
  /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i, // 5 Jan
];

/** Text as compared: Unicode NFC, trimmed, every run of white space one space. */
const textOf = (value: string): string => value.normalize('NFC').trim().replace(/\s+/g, ' ');
/**
 * A full Unicode case fold WITHOUT the Turkic mappings: each character
 * upper- then lower-cased on its own (so `ß` and `ẞ` fold to `ss`, `ﬁ` to
 * `fi`, a final `ς` to `σ`), except the dotless `ı`, which stays `ı`. It
 * never decides agreement (`caseOnly` does, on the letters as written): two
 * texts it folds alike are only texts the comparison cannot tell apart.
 */
const foldCase = (text: string): string =>
  Array.from(text, (ch) => (ch === 'ı' ? ch : ch.toUpperCase().toLowerCase()))
    .join('')
    .replace(/ß/g, 'ss')
    .normalize('NFC');
/** Dotted and dotless i as one letter — only to tell an i/ı difference apart. */
const dotlessAsDotted = (folded: string): string =>
  folded.replace(/ı/g, 'i').replace(/i\u0307/g, 'i');
const hasDigit = (text: string): boolean => /\p{Nd}/u.test(text);

/** How a word is cased: all lower, all upper, a capital first letter, or mixed. */
function casing(word: string): 'lower' | 'upper' | 'capitalized' | 'mixed' {
  if (word === word.toLowerCase()) return 'lower';
  if (word === word.toUpperCase()) return 'upper';
  const [first = '', ...rest] = Array.from(word);
  const tail = rest.join('');
  return first === first.toUpperCase() && tail === tail.toLowerCase() ? 'capitalized' : 'mixed';
}

/**
 * A word the case rule compares across casings (`caseOnly`): letters only,
 * more than three of them, cased all lower, all upper or with a capital first
 * letter. The rule cannot tell where such a word's case carries meaning
 * (`Polish`, `polish`). A short word (`MW`, `Co`), a mixed-case one
 * (`aB3xZ9`, `iPhone`) and anything with a digit or another mark keeps its
 * case as written.
 */
const foldableWord = (word: string): boolean =>
  /^\p{L}+$/u.test(word) && Array.from(word).length > 3 && casing(word) !== 'mixed';

/**
 * Two word texts that differ in case alone: as many words, and every word
 * that differs is a foldable word with the same letters, letter for letter,
 * in another case — its locale-free lower case (`toLowerCase`) is the
 * other's: `Settled` and `SETTLED`, `STRAẞE` and `Straße` (`ẞ` is the capital
 * of `ß`). Letters are compared as written, before any fold, so `ß` is never
 * `ss`: `Masse`, `maße`, `MAẞE` and `MASSE` against `Maße` differ in letters.
 */
function caseOnly(a: string, b: string): boolean {
  const wordsA = a.split(' ');
  const wordsB = b.split(' ');
  return (
    wordsA.length === wordsB.length &&
    wordsA.every((word, index) => {
      const other = wordsB[index] ?? '';
      if (word === other) return true;
      return (
        foldableWord(word) && foldableWord(other) && word.toLowerCase() === other.toLowerCase()
      );
    })
  );
}
const isFormatted = (text: string): boolean => FORMATTED.some((format) => format.test(text));
/** Every number inside a text by its value: `USD 42.50` and `USD 42.5` mask alike. */
const masked = (text: string): string =>
  text.replace(/\d+(?:\.\d+)?/g, (number) => `\u0000${decimalKey(number)}\u0000`);

/**
 * Two texts (each `textOf`). Equal: they agree. Otherwise a formatted one is
 * never compared. Texts with no digit agree when they differ in case alone
 * (`caseOnly`: foldable words, the same letters in another case). Any other
 * case difference is not compared — a short word, a mixed-case one, a digit,
 * ß against ss in any casing, a long s or a ligature against its letters —
 * and neither are texts that differ only by a dotted or dotless i (`ılık`,
 * `ilik`), or only in how a number inside them is spelled (`USD 42.50`,
 * `v1.20`). Anything else contradicts.
 */
function compareText(a: string, b: string): ClaimValueComparison {
  if (a === b) return 'agrees';
  if (isFormatted(a) || isFormatted(b)) return 'incomparable';
  if (!hasDigit(a) && !hasDigit(b) && caseOnly(a, b)) return 'agrees';
  const foldedA = foldCase(a);
  const foldedB = foldCase(b);
  // Alike under the fold, or but for the dot of an i: a case difference the
  // rule above does not accept — never a contradiction, never agreement.
  if (foldedA === foldedB || dotlessAsDotted(foldedA) === dotlessAsDotted(foldedB)) {
    return 'incomparable';
  }
  return masked(foldedA) === masked(foldedB) ? 'incomparable' : 'contradicts';
}

/**
 * The exact key of a text: equal keys only where `compareText` agrees. A
 * foldable word in lower case or with a capital first letter keys by its
 * lower case (`Settled` as `settled`), tagged so it never meets a word kept
 * as written (`İstanbul` lowers to an `i` and a combining dot, which as
 * written is not a word of letters); every other word, and any text with a
 * digit or a format, keys exactly as written.
 */
function textKey(text: string): string {
  if (isFormatted(text)) return `f:${JSON.stringify(text)}`;
  if (hasDigit(text)) return `t:${JSON.stringify(text)}`;
  const words = text
    .split(' ')
    .map((word) =>
      foldableWord(word) && casing(word) !== 'upper' ? `l:${word.toLowerCase()}` : `w:${word}`,
    );
  return `w:${JSON.stringify(words)}`;
}
/**
 * The own keys a well-formed Claim of each kind may have, and the ones it must
 * (`lib/claim/claim.ts`): `known` its `value` and text `evidence`, `unknown`
 * its text `reason` (and text `evidence`, optionally), `not-applicable` its
 * text `evidence`. Anything else carrying one of these `kind`s is malformed.
 */
const CLAIM_KEYS: Readonly<
  Record<
    'known' | 'unknown' | 'not-applicable',
    { readonly may: readonly string[]; readonly must: readonly string[] }
  >
> = {
  known: { may: ['kind', 'value', 'evidence'], must: ['value', 'evidence'] },
  unknown: { may: ['kind', 'reason', 'evidence'], must: ['reason'] },
  'not-applicable': { may: ['kind', 'evidence'], must: ['evidence'] },
};
/** The doubt word, after the comparison's own normalization (`' Unknown '` is one). */
const DOUBT_WORD = 'unknown';

/**
 * One spelling per decimal value: `42.50` and `42.5` share `425e2`. Takes a
 * plain decimal, or a JS number's own spelling with its exponent (`1e+21`).
 */
function decimalKey(spelling: string): string {
  const [mantissa = '', exponent = '0'] = spelling.split(/e/i);
  const negative = mantissa.startsWith('-');
  const [whole = '', fraction = ''] = (negative ? mantissa.slice(1) : mantissa).split('.');
  const digits = whole + fraction;
  const first = digits.search(/[1-9]/);
  if (first === -1) return '0'; // every zero, -0 included
  const significant = digits.slice(first).replace(/0+$/, '');
  const point = whole.length - first + Number(exponent);
  return `${negative ? '-' : ''}${significant}e${point}`;
}

/**
 * The Claim a value at the TOP of a claim is, by its shape: `undefined` for
 * plain data (no Claim `kind`), else its kind and whether it is well formed.
 */
function claimOf(
  value: unknown,
):
  | { readonly kind: 'known' | 'unknown' | 'not-applicable'; readonly wellFormed: boolean }
  | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Readonly<Record<string, unknown>>;
  const kind = record.kind;
  if (kind !== 'known' && kind !== 'unknown' && kind !== 'not-applicable') return undefined;
  const keys = CLAIM_KEYS[kind];
  // Every own key is one the kind may have, every key it must have is there,
  // and every key but `kind` and `value` holds text — an own `undefined`
  // included is not a well-formed Claim (no constructor writes one).
  const wellFormed =
    Object.keys(record).every(
      (key) =>
        keys.may.includes(key) &&
        (key === 'kind' || key === 'value' || typeof record[key] === 'string'),
    ) && keys.must.every((key) => Object.hasOwn(record, key));
  return { kind, wellFormed };
}

/** What a value at the TOP of a claim is (`claimShapeOf`). */
export type ClaimShape =
  /** A value: plain data, or a well-formed `known(…)` by its value (`declared`). */
  | { readonly kind: 'value'; readonly face: unknown; readonly declared: boolean }
  /**
   * Doubt: no value (`undefined`), `null` or the doubt word (`'unknown'` in
   * any case or spacing), or — `declared` — a well-formed `unknown(…)` /
   * `notApplicable(…)` Claim.
   */
  | { readonly kind: 'doubt'; readonly declared: boolean }
  /** Claim-shaped, but not a well-formed Claim of its kind: never read. */
  | { readonly kind: 'malformed' };

/**
 * Read a value at the TOP of a claim — the one place the contract puts a
 * Claim (a tool's `known(…)` fact, a claimed field) — by its shape. Doubt
 * words are recognized after the same normalization the comparison uses, so
 * `'Unknown'` and `' UNKNOWN '` are doubt like `'unknown'`. Inside a value
 * nothing is read this way: a wrapper there is the value's data.
 */
export function claimShapeOf(value: unknown): ClaimShape {
  const claim = claimOf(value);
  if (claim !== undefined) {
    if (!claim.wellFormed) return { kind: 'malformed' };
    return claim.kind === 'known'
      ? { kind: 'value', face: (value as { value: unknown }).value, declared: true }
      : { kind: 'doubt', declared: true };
  }
  if (value === null || value === undefined) return { kind: 'doubt', declared: false };
  if (typeof value === 'string' && foldCase(textOf(value)) === DOUBT_WORD) {
    return { kind: 'doubt', declared: false };
  }
  return { kind: 'value', face: value, declared: false };
}

/**
 * The comparable face of a value at the TOP of a claim: a well-formed
 * `known(…)` by its value, plain data as itself. `undefined` — never
 * compared — for an `unknown` / `notApplicable` Claim and for anything
 * Claim-shaped that is not well formed. A raw doubt (`null`, `'unknown'`) is
 * the caller's to classify first (`claimShapeOf`); here it is plain data.
 */
function topFace(value: unknown): { readonly face: unknown } | undefined {
  const claim = claimOf(value);
  if (claim === undefined) return { face: value };
  return claim.wellFormed && claim.kind === 'known'
    ? { face: (value as { value: unknown }).value }
    : undefined;
}

type Reading =
  /** A JS number — a double — or a plain decimal string (`written`: its digits, keyed). */
  | { readonly kind: 'number'; readonly value: number; readonly written?: string }
  /** A plain decimal and its unit, the unit exactly as written (`MW` is not `mW`). */
  | { readonly kind: 'with-unit'; readonly written: string; readonly unit: string }
  /** Text (`textOf`) — a formatted value included (`isFormatted`). */
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'null' }
  | { readonly kind: 'list'; readonly items: readonly unknown[] }
  | { readonly kind: 'object'; readonly value: Readonly<Record<string, unknown>> }
  /** Not a JSON value: never compared. */
  | { readonly kind: 'other' };

/** What a value IS, as plain data — no wrapper is read here (see `topFace`). */
function readingOf(value: unknown): Reading {
  if (value === null) return { kind: 'null' };
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { kind: 'number', value } : { kind: 'other' };
  }
  if (typeof value === 'string') {
    const text = textOf(value);
    // A currency, a separator, a date, a time or a dot-grouped number is
    // compared as written — before it could read as a plain decimal.
    if (isFormatted(text)) return { kind: 'text', text };
    if (PLAIN_DECIMAL.test(text)) {
      return { kind: 'number', value: Number(text), written: decimalKey(text) };
    }
    const unit = WITH_UNIT.exec(text);
    if (unit?.[1] !== undefined && unit[2] !== undefined) {
      return { kind: 'with-unit', written: decimalKey(unit[1]), unit: unit[2].trim() };
    }
    return { kind: 'text', text };
  }
  if (Array.isArray(value)) return { kind: 'list', items: value };
  if (typeof value === 'object') {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      return { kind: 'object', value: value as Readonly<Record<string, unknown>> };
    }
  }
  return { kind: 'other' };
}

/** A definite difference anywhere wins; else anything not compared; else agreement. */
function combine(results: readonly ClaimValueComparison[]): ClaimValueComparison {
  if (results.includes('contradicts')) return 'contradicts';
  return results.includes('incomparable') ? 'incomparable' : 'agrees';
}

/** An object's keys JSON would write (a key holding `undefined` is not one), sorted. */
const keysOf = (value: Readonly<Record<string, unknown>>): string[] =>
  Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();

function compareAt(settled: unknown, claimed: unknown, depth: number): ClaimValueComparison {
  if (depth > MAX_DEPTH) return 'incomparable';
  const a = readingOf(settled);
  const b = readingOf(claimed);
  if (a.kind === 'other' || b.kind === 'other') return 'incomparable';
  // An absence against a value is a difference between them, not two kinds.
  if (a.kind === 'null' || b.kind === 'null') return a.kind === b.kind ? 'agrees' : 'contradicts';
  if (a.kind === 'number' && b.kind === 'number') {
    // Digit for digit when both were written as text; a double is compared
    // as the double it is (it cannot say which of two spellings it was).
    const same =
      a.written !== undefined && b.written !== undefined
        ? a.written === b.written
        : a.value === b.value;
    return same ? 'agrees' : 'contradicts';
  }
  if (a.kind === 'with-unit' && b.kind === 'with-unit') {
    if (a.unit !== b.unit) return 'incomparable';
    return a.written === b.written ? 'agrees' : 'contradicts';
  }
  if (a.kind === 'text' && b.kind === 'text') return compareText(a.text, b.text);
  if (a.kind === 'boolean' && b.kind === 'boolean') {
    return a.value === b.value ? 'agrees' : 'contradicts';
  }
  if (a.kind === 'list' && b.kind === 'list') {
    if (a.items.length !== b.items.length) return 'contradicts';
    // Every slot, by index: `map` would skip a hole (`[, 1250]`, which
    // `structuredClone` keeps), and a skipped slot would count as agreement.
    // A hole is no value, so it is never compared.
    const results: ClaimValueComparison[] = [];
    for (let index = 0; index < a.items.length; index++) {
      results.push(
        Object.hasOwn(a.items, index) && Object.hasOwn(b.items, index)
          ? compareAt(a.items[index], b.items[index], depth + 1)
          : 'incomparable',
      );
    }
    return combine(results);
  }
  if (a.kind === 'object' && b.kind === 'object') {
    const keys = keysOf(a.value);
    const other = keysOf(b.value);
    if (keys.length !== other.length || keys.some((key, index) => key !== other[index])) {
      return 'contradicts';
    }
    return combine(keys.map((key) => compareAt(a.value[key], b.value[key], depth + 1)));
  }
  // A list or an object against a scalar, a unit against a bare number or
  // text, text against a number or `true`/`false`: kinds that cannot be
  // compared safely.
  return 'incomparable';
}

/** The exact key of a plain-data value; `undefined` when it cannot be compared. */
function keyAt(value: unknown, depth: number): string | undefined {
  if (depth > MAX_DEPTH) return undefined;
  const reading = readingOf(value);
  switch (reading.kind) {
    case 'null':
      return 'null';
    case 'boolean':
      return String(reading.value);
    case 'number':
      return `n:${reading.written ?? decimalKey(String(reading.value))}`;
    case 'with-unit':
      return `u:${JSON.stringify([reading.unit, reading.written])}`;
    case 'text':
      return textKey(reading.text);
    case 'list': {
      // Every slot, by index: a hole has no key, so neither has its list.
      const items: string[] = [];
      for (let index = 0; index < reading.items.length; index++) {
        const inner = Object.hasOwn(reading.items, index)
          ? keyAt(reading.items[index], depth + 1)
          : undefined;
        if (inner === undefined) return undefined;
        items.push(inner);
      }
      return `[${items.join(',')}]`;
    }
    case 'object': {
      const entries = keysOf(reading.value).map((key) => {
        const inner = keyAt(reading.value[key], depth + 1);
        return inner === undefined ? undefined : `${JSON.stringify(key)}:${inner}`;
      });
      return entries.includes(undefined) ? undefined : `{${entries.join(',')}}`;
    }
    case 'other':
      return undefined;
  }
}

/**
 * Compare the value a tool settled with the value an answer states, after
 * the declared normalization — the comparison a claim that GOVERNS DELIVERY
 * is judged by (`delivered.ts`). The detector above keeps exact equality (its
 * findings are pinned); this rule exists so a representational difference
 * never withholds a correct answer as a contradiction:
 *
 * - text is Unicode NFC, trimmed and its white space collapsed. Case agrees
 *   only where two texts differ in case alone: every word that differs is a
 *   word of letters, more than three of them, cased all lower, all upper or
 *   with a capital first letter, with the same letters, letter for letter, in
 *   another case (`'Settled'` and `'settled '`, `'STRAẞE'` and `'Straße'` —
 *   `ẞ` is the capital of `ß`). The rule cannot know where case carries
 *   meaning, so it merges such words too (`'Polish'` and `'polish'`,
 *   `'AIDS'` and `'aids'`). Any other case difference is not compared — a
 *   short word or a unit (`'MW'`, `'Co'`), a mixed-case word, anything with a
 *   digit, `ß` against `ss` in any casing (`'Masse'`, `'maße'`, `'MASSE'`
 *   against `'Maße'`), a dotted against a dotless i (`'ılık'`): what a full
 *   case fold without the Turkic mappings would call alike is never
 *   agreement, and never a contradiction;
 * - a value written in a format — a currency symbol, digit separators, a
 *   dot-grouped number (`'1.250'`: 1.25 or 1250), a date or a time — agrees
 *   only as written and is otherwise not compared, and so is text that
 *   differs only in how a number inside it is spelled (`'USD 42.50'`);
 * - a number and a string written as a plain decimal (`-?digits[.digits]`, no
 *   leading zero, sign or exponent) compare by value, both ways: two decimal
 *   strings digit for digit (`'42.50'` = `'42.5'`), a JS number at the double
 *   precision it has (`'42.50'` = `42.5`);
 * - a plain decimal with a unit (`'1250 ms'`) compares only with the same
 *   unit, written exactly — case included (`MW` is not `mW`);
 * - lists compare item by item in order, objects key by key, and a definite
 *   difference anywhere wins over a part that could not be compared; a hole
 *   in a list (`[, 1250]`, which `structuredClone` keeps) is no value and is
 *   never compared;
 * - `null` against a value is a difference (a raw doubt is the caller's to
 *   classify first; only a DECLARED `known(null)` should reach here);
 * - a Claim wrapper is read only at the TOP of either value, and only when it
 *   is a well-formed `known(…)` (`kind`, `value`, a text `evidence`). Inside a
 *   value a wrapper-shaped object is that value's data, compared as an
 *   object: an answer cannot have a nested object read as the value it wraps.
 *
 * Anything else — a list or an object against a scalar, a unit against a bare
 * number or another unit, text against a number or `true`/`false`, a value
 * that is not JSON, an unknown `Claim` or a malformed wrapper at the top,
 * nesting past 64 levels — is `incomparable`: never "contradicts", never
 * "agrees". Pure and total.
 */
export function compareClaimValues(settled: unknown, claimed: unknown): ClaimValueComparison {
  const a = topFace(settled);
  const b = topFace(claimed);
  if (a === undefined || b === undefined) return 'incomparable';
  return compareAt(a.face, b.face, 0);
}

/**
 * One EXACT key per value under the same normalization, for a reader of
 * several values at once (`delivered.ts` asks whether a run read one fact two
 * ways). Equal keys always compare `agrees`: two values share a key only when
 * they are the same value under the comparison's exact parts — text up to
 * the case rule (a word keyed by its lower case never meets a word kept as
 * written), a number by its digits — so `'9007199254740993'` and the double
 * `9007199254740992`, which `compareClaimValues` cannot tell apart, have
 * different keys. The converse does not hold: a key is stricter (`'SETTLED'`
 * and `'settled'` agree under two keys), and key equality is transitive where
 * agreement at double precision is not. `undefined` for a value that cannot
 * be compared at all, a list with a hole included.
 */
export function claimValueKey(value: unknown): string | undefined {
  const top = topFace(value);
  return top === undefined ? undefined : keyAt(top.face, 0);
}
