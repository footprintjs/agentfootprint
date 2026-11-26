/**
 * TOKENS, GENERATED — the token reader against an independent oracle (case table 5.1, 8.4).
 *
 * The oracle finds tokens by a CHARACTER SCAN, not by the reader's regular expressions: its own
 * splitter and comma rule (a comma separates values except inside a thousands-grouped run of
 * digits not glued to a letter), its own decoration rule, and a hand-written number parser for
 * rules 1–3. On many seeded texts built from the pieces that matter (digits, separators, commas, units,
 * quotes, JSON keys) the two must agree exactly. A JSON value is checked against a walk of its
 * parsed form in document order. Every token either side gives is a fixed point (`isToken`), and
 * a pathological input of the full 1 MiB is read in bounded time. A reading CUT by a byte cap, at
 * every cap, keeps only tokens the whole text holds (never a piece of a value), and keeps more as
 * the cap grows.
 */
import { describe, expect, it } from 'vitest';

import { LEDGER_LIMITS } from '../../src/llm-ledger/limits.js';
import {
  isToken,
  readTokens,
  readTokensUpTo,
  tokensOf,
  utf8Bytes,
} from '../../src/llm-ledger/tokens.js';
import { seeded, seededTexts } from '../helpers/seededText.js';

const isDigit = (c: string) => c >= '0' && c <= '9';
const isLower = (c: string) => c >= 'a' && c <= 'z';
const INSIDE = new Set([...':_-/.,%+@#$']);
const inside = (c: string) => isDigit(c) || (c >= 'A' && c <= 'Z') || isLower(c) || INSIDE.has(c);

/** `[-+]?\d+(\.\d+)?` from `i`: the index after it, or -1. */
function numberEnd(s: string, i: number): number {
  let j = i;
  if (s[j] === '-' || s[j] === '+') j++;
  const start = j;
  while (j < s.length && isDigit(s[j]!)) j++;
  if (j === start) return -1;
  if (s[j] === '.' && isDigit(s[j + 1] ?? '')) {
    j++;
    while (j < s.length && isDigit(s[j]!)) j++;
  }
  return j;
}
const lettersEnd = (s: string, i: number) => {
  let j = i;
  while (j < s.length && isLower(s[j]!)) j++;
  return j;
};
const digits = (s: string) => [...s].filter(isDigit).length;

/** Rules 1–3, by scanning. */
function oracleClassify(t: string): string | undefined {
  if (digits(t) === 0) return undefined;
  const parts = t.split('/');
  if (
    parts.length === 2 &&
    parts.every((p) => p.length >= 1 && p.length <= 2 && [...p].every(isDigit))
  )
    return undefined;
  const n = numberEnd(t, 0);
  if (n !== -1) {
    let numeric: string | undefined;
    if (n === t.length) numeric = t;
    else {
      let j = n;
      if (t[j] === '-' || t[j] === '/') j++;
      const l = lettersEnd(t, j);
      let ok = l - j >= 1 && l - j <= 5;
      let end = l;
      if (ok && t[end] === '/') {
        const l2 = lettersEnd(t, end + 1);
        ok = l2 - (end + 1) >= 1 && l2 - (end + 1) <= 5;
        end = l2;
      }
      if (ok && end === t.length) numeric = t.slice(0, n);
    }
    if (numeric !== undefined) return digits(numeric) >= 4 ? numeric : undefined;
  }
  if (t.length < 4) return undefined;
  return [...t].some((c) => isLower(c) || ':_-/.'.includes(c)) ? t : undefined;
}

function oracleSpell(raw: string): string {
  const v = raw.toLowerCase();
  let a = 0;
  while (a < v.length && '$#@+'.includes(v[a]!)) a++;
  let b = v.length;
  while (b > a && '.,:%'.includes(v[b - 1]!)) b--;
  return v.slice(a, b);
}

/** A rough token's pieces: split at every comma but those of a grouped run, which fold away. */
function oraclePieces(rough: string): string[] {
  const out: string[] = [];
  let piece = '';
  for (let i = 0; i < rough.length; ) {
    const c = rough[i]!;
    if (!isDigit(c)) {
      if (c === ',') {
        out.push(piece);
        piece = '';
      } else piece += c;
      i++;
      continue;
    }
    let j = i;
    let run = '';
    while (
      j < rough.length &&
      (isDigit(rough[j]!) ||
        (rough[j] === ',' && isDigit(rough[j - 1] ?? '') && isDigit(rough[j + 1] ?? '')))
    )
      run += rough[j++];
    const groups = run.split(',');
    const glued = i > 0 && /[A-Za-z]/.test(rough[i - 1]!);
    const grouped =
      !glued &&
      groups.length >= 2 &&
      groups[0]!.length >= 1 &&
      groups[0]!.length <= 3 &&
      groups.slice(1).every((g) => g.length === 3);
    if (grouped) piece += groups.join('');
    else
      groups.forEach((g, k) => {
        if (k > 0) {
          out.push(piece);
          piece = '';
        }
        piece += g;
      });
    i = j;
  }
  out.push(piece);
  return out;
}

/** Prose: key colons blanked, rough tokens by character, list commas split, then rules 1–3. */
function oracleProse(text: string, out: string[]): void {
  const chars = [...text];
  let open = false;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== '"') continue;
    let slashes = 0;
    for (let k = i - 1; k >= 0 && chars[k] === '\\'; k--) slashes++;
    if (slashes % 2 === 1) continue;
    open = !open;
    if (open) continue;
    let j = i + 1;
    while (j < chars.length && /\s/.test(chars[j]!)) j++;
    if (chars[j] === ':') chars[j] = ' ';
  }
  let rough = '';
  const flush = () => {
    for (const piece of oraclePieces(rough)) {
      const token = oracleClassify(oracleSpell(piece));
      if (token !== undefined && !out.includes(token)) out.push(token);
    }
    rough = '';
  };
  for (const c of chars) {
    if (c.length === 1 && inside(c)) rough += c;
    else flush();
  }
  flush();
}

/** A JSON value's tokens, by walking its parsed form in document order. */
function oracleJson(value: unknown, out: string[]): void {
  if (typeof value === 'string') oracleProse(value, out);
  else if (typeof value === 'number') {
    const token = oracleClassify(oracleSpell(JSON.stringify(value)));
    if (token !== undefined && !out.includes(token)) out.push(token);
  } else if (Array.isArray(value)) value.forEach((v) => oracleJson(v, out));
  else if (typeof value === 'object' && value !== null)
    for (const [k, v] of Object.entries(value)) {
      oracleProse(k, out);
      oracleJson(v, out);
    }
}

const PIECES = [
  '1234',
  '41,200',
  '1,2',
  '12',
  '9',
  '0012',
  '.',
  ',',
  ':',
  '/',
  '-',
  '+',
  '$',
  '%',
  '#',
  '@',
  '_',
  ' ',
  '\n',
  '\t',
  'ab',
  'esx',
  'X',
  'é',
  '"',
  '\\',
  '"k":',
  '24/7',
  'ms',
  'iops',
  'mb/s',
  '0x1f',
  '1.5',
  '-7',
  '...',
  '(',
  ')',
  '*',
  '`',
  'ok',
  '😀',
  '2026-11-25',
  '08:00',
];

describe('tokensOf against the character-scan oracle', () => {
  it('prose: the two agree on every seeded text', () => {
    let tokens = 0;
    for (const body of seededTexts(2026, PIECES, 30_000, 16)) {
      const text = `p ${body}`; // prose, never one JSON value
      const expected: string[] = [];
      oracleProse(text, expected);
      expect(tokensOf(text), JSON.stringify(text)).toEqual(expected);
      tokens += expected.length;
    }
    expect(tokens).toBeGreaterThan(20_000);
  });

  it('JSON: one value is read as its parsed form, in document order', () => {
    const next = seeded(11);
    const leaf = () => {
      const r = next();
      if (r < 0.3) return Math.floor(next() * 10 ** Math.floor(next() * 8));
      if (r < 0.4) return -Math.round(next() * 1e6) / 100;
      return seededTexts(Math.floor(next() * 1e9), PIECES, 1, 6)[0]!;
    };
    const value = (depth: number): unknown => {
      if (depth > 2 || next() < 0.4) return leaf();
      return next() < 0.5
        ? Array.from({ length: Math.floor(next() * 4) }, () => value(depth + 1))
        : Object.fromEntries(
            Array.from({ length: Math.floor(next() * 4) }, () => [
              String(leaf()),
              value(depth + 1),
            ]),
          );
    };
    let compared = 0;
    for (let i = 0; i < 5_000; i++) {
      const v = value(0);
      if (typeof v !== 'object' || v === null) continue;
      const expected: string[] = [];
      oracleJson(v, expected);
      expect(tokensOf(JSON.stringify(v)), JSON.stringify(v)).toEqual(expected);
      compared++;
    }
    expect(compared).toBeGreaterThan(1_000);
  });

  it('every token is a fixed point, and distinct', () => {
    for (const text of seededTexts(77, PIECES, 10_000, 20)) {
      const tokens = tokensOf(text);
      expect(new Set(tokens).size).toBe(tokens.length);
      for (const token of tokens) {
        expect(tokensOf(token)).toEqual([token]);
        if (token.length <= LEDGER_LIMITS.maxTokenChars) expect(isToken(token)).toBe(true);
      }
    }
  });
});

describe('a reading cut by a byte cap', () => {
  /** Seeded texts of two kinds: prose, and one JSON value (so a cut is a cut JSON prefix). */
  const texts = (() => {
    const next = seeded(404);
    const prose = seededTexts(9, PIECES, 400, 14).map((t) => `p ${t}`);
    const json = Array.from({ length: 200 }, () =>
      JSON.stringify(
        Array.from({ length: 1 + Math.floor(next() * 6) }, () =>
          next() < 0.5
            ? Math.floor(next() * 10 ** Math.floor(next() * 7))
            : seededTexts(Math.floor(next() * 1e9), PIECES, 1, 5)[0]!,
        ),
      ),
    );
    return [...prose, ...json];
  })();

  it('at every cap, keeps only tokens the whole text holds, and more as the cap grows', () => {
    let cuts = 0;
    for (const text of texts) {
      const whole = new Set(tokensOf(text));
      const bytes = utf8Bytes(text);
      let before: readonly string[] = [];
      for (let cap = 0; cap <= bytes; cap++) {
        const reading = readTokensUpTo(text, cap);
        for (const token of reading.tokens)
          expect(whole.has(token), `${JSON.stringify(text)} @${cap}: ${token}`).toBe(true);
        for (const token of before)
          expect(reading.tokens, `${JSON.stringify(text)} @${cap}`).toContain(token);
        expect(reading.bytes).toBe(bytes);
        if (reading.cut !== undefined) {
          expect(reading.cut.bytesUnread).toBeGreaterThanOrEqual(bytes - cap);
          cuts++;
        }
        before = reading.tokens;
      }
      expect(readTokensUpTo(text, bytes).tokens).toEqual(
        tokensOf(text).filter((t) => t.length <= LEDGER_LIMITS.maxTokenChars),
      );
    }
    expect(cuts).toBeGreaterThan(5_000);
  });
});

describe('readTokens invariants', () => {
  it('under the caps it keeps exactly tokensOf, and counts bytes as an encoder', () => {
    for (const text of seededTexts(5, PIECES, 5_000, 30)) {
      const reading = readTokens(text);
      expect(reading.bytes).toBe(new TextEncoder().encode(text).length);
      expect(reading.bytes).toBe(utf8Bytes(text));
      const all = tokensOf(text);
      const long = all.filter((t) => t.length > LEDGER_LIMITS.maxTokenChars);
      expect(reading.tokens).toEqual(all.filter((t) => t.length <= LEDGER_LIMITS.maxTokenChars));
      if (long.length === 0) expect(reading.cut).toBeUndefined();
      else expect(reading.cut).toEqual({ tokensDropped: long.length, bytesUnread: 0 });
    }
  });

  it.each([
    // Each is read WHOLE (at most 1 MiB), so every pattern meets the one long token.
    ['a megabyte of digits', '1'.repeat(1_048_576)],
    ['a megabyte of quotes and backslashes', '\\"'.repeat(524_288)],
    ['a megabyte of commas between digits', '1,'.repeat(524_288)],
    ['thousands groups', `1${',000'.repeat(262_000)}`],
    ['unit tails', '1a'.repeat(524_288)],
    ['an unclosed JSON array', `[${'1,'.repeat(524_000)}`],
    ['two megabytes of digits (cut, never read past the cap)', '1'.repeat(2 * 1_048_576)],
  ])('%s is read in bounded time', (_name, text) => {
    const start = performance.now();
    const reading = readTokens(text);
    expect(performance.now() - start).toBeLessThan(3_000);
    expect(reading.tokens.length).toBeLessThanOrEqual(LEDGER_LIMITS.maxTokens);
  });
});
