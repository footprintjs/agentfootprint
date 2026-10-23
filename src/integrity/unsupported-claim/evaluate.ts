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
 * A value written in a FORMAT — a currency symbol, thousands separators, a
 * date or a time — has more than one spelling of one value (`$1,250.00` and
 * `$1,250`, `2026-01-01` and `2026-01-01T00:00:00Z`), so two of them agree
 * only as written and are otherwise never compared.
 */
const FORMATTED: readonly RegExp[] = [
  /\p{Sc}/u, // a currency symbol: $ € £ ¥ ₹ …
  /\d[ ,'\u00a0\u202f]\d{3}(?!\d)/u, // thousands separators: 1,250 · 1 250 · 1'250
  /\d{4}-\d{2}-\d{2}/, // an ISO date, with or without its time
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/, // 01/02/2026 · 1-2-26
  /\b\d{1,2}\.\d{1,2}\.\d{4}\b/, // 01.02.2026
  /(?:^|[\sT])\d{1,2}:\d{2}(?::\d{2})?(?![:\w])/, // a clock time: 09:14 · 9:14:05
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i, // Jan 5
  /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i, // 5 Jan
];

/** Text as compared: Unicode NFC, trimmed, every run of white space one space. */
const textOf = (value: string): string => value.normalize('NFC').trim().replace(/\s+/g, ' ');
/** A real case fold: `Straße` and `STRASSE` both fold to `strasse`. */
const foldCase = (text: string): string => text.toUpperCase().toLowerCase().normalize('NFC');
const hasDigit = (text: string): boolean => /\p{Nd}/u.test(text);
const isFormatted = (text: string): boolean => FORMATTED.some((format) => format.test(text));
/** Every number inside a text by its value: `USD 42.50` and `USD 42.5` mask alike. */
const masked = (text: string): string =>
  text.replace(/\d+(?:\.\d+)?/g, (number) => `\u0000${decimalKey(number)}\u0000`);

/**
 * Two texts (each `textOf`). Equal: they agree. Otherwise a formatted one is
 * never compared; texts that differ only in case agree when they are words,
 * and are not compared when they carry a digit (an identifier's case may
 * matter: `aB3xZ9`); texts that differ only in how a number inside them is
 * spelled are not compared (`USD 42.50`, `v1.20`); anything else contradicts.
 */
function compareText(a: string, b: string): ClaimValueComparison {
  if (a === b) return 'agrees';
  if (isFormatted(a) || isFormatted(b)) return 'incomparable';
  const foldedA = foldCase(a);
  const foldedB = foldCase(b);
  if (foldedA === foldedB) return hasDigit(a) || hasDigit(b) ? 'incomparable' : 'agrees';
  return masked(foldedA) === masked(foldedB) ? 'incomparable' : 'contradicts';
}

/** The exact key of a text: equal keys exactly where `compareText` agrees. */
function textKey(text: string): string {
  if (isFormatted(text)) return `f:${JSON.stringify(text)}`;
  return hasDigit(text) ? `t:${JSON.stringify(text)}` : `w:${JSON.stringify(foldCase(text))}`;
}
/** The keys a well-formed `known(…)` wrapper has (`lib/claim/claim.ts` · `known`). */
const KNOWN_WRAPPER_KEYS: ReadonlySet<string> = new Set(['kind', 'value', 'evidence']);

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
 * The comparable face of a value at the TOP of a claim — the one place the
 * contract puts a Claim wrapper (a tool's `known(…)` fact, a claimed field).
 * A well-formed `known(…)` is read as its value; anything else is the value
 * itself. `undefined` — never compared — for an unknown Claim, or a wrapper
 * carrying any other key (or an `evidence` that is not text). Inside a value
 * a wrapper is never read: it is that value's data, compared as an object.
 */
function topFace(value: unknown): { readonly face: unknown } | undefined {
  if (!participates(value)) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { face: value };
  const record = value as Readonly<Record<string, unknown>>;
  if (record.kind !== 'known' || !Object.hasOwn(record, 'value')) return { face: value };
  const wellFormed =
    Object.keys(record).every((key) => KNOWN_WRAPPER_KEYS.has(key)) &&
    (record.evidence === undefined || typeof record.evidence === 'string');
  return wellFormed ? { face: record.value } : undefined;
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
    if (PLAIN_DECIMAL.test(text)) {
      return { kind: 'number', value: Number(text), written: decimalKey(text) };
    }
    // A currency, a separator, a date or a time is compared as written.
    const unit = isFormatted(text) ? null : WITH_UNIT.exec(text);
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
    return combine(a.items.map((item, index) => compareAt(item, b.items[index], depth + 1)));
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
      const items = reading.items.map((item) => keyAt(item, depth + 1));
      return items.includes(undefined) ? undefined : `[${items.join(',')}]`;
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
 * - text is Unicode NFC, trimmed, its white space collapsed; a word is
 *   case-folded (`'Settled'` and `'settled '` agree, `'Straße'` and
 *   `'STRASSE'` too), but text with a digit that differs only in case is not
 *   compared (an identifier's case may matter);
 * - a value written in a format — a currency symbol, thousands separators, a
 *   date or a time — agrees only as written and is otherwise not compared,
 *   and so is text that differs only in how a number inside it is spelled
 *   (`'USD 42.50'`, `'USD 42.5'`);
 * - a number and a string written as a plain decimal (`-?digits[.digits]`, no
 *   leading zero, sign or exponent) compare by value, both ways: two decimal
 *   strings digit for digit (`'42.50'` = `'42.5'`), a JS number at the double
 *   precision it has (`'42.50'` = `42.5`);
 * - a plain decimal with a unit (`'1250 ms'`) compares only with the same
 *   unit, written exactly — case included (`MW` is not `mW`);
 * - lists compare item by item in order, objects key by key, and a definite
 *   difference anywhere wins over a part that could not be compared;
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
 * ways). Two values share a key only when they are the same value as written:
 * a JS number by the digits it prints, so `'9007199254740993'` and the double
 * `9007199254740992` — which `compareClaimValues` cannot tell apart — have
 * different keys. Equal keys always compare `agrees`; key equality is
 * transitive, agreement at double precision is not. `undefined` for a value
 * that cannot be compared at all.
 */
export function claimValueKey(value: unknown): string | undefined {
  const top = topFace(value);
  return top === undefined ? undefined : keyAt(top.face, 0);
}
