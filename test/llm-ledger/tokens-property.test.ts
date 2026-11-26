/**
 * TOKENS, GENERATED — the token reader against a plain-split oracle (case table 5.1, amendment 2).
 *
 * The oracle is the rule written as plainly as it can be: pair the backslashes from the left and
 * blank each piece that reads two ways (after an escape's letter, or before `\/`), blank the
 * groups of every run shaped like a number with thousands separators (one regular expression),
 * split at every comma and every character outside a piece, and read each piece by rules 1–3 (a
 * hand-written number scan, not the reader's expressions). On seeded prose, CSV, JSON, JSON Lines,
 * JSON the source cut short, raw text with backslashes (paths, regex-looking text, doubled
 * backslashes) and the shapes earlier comma rules got wrong, the two agree exactly: the tokens and
 * both counts. Every kept token is a WHOLE piece of the text, never a fragment of a longer one. A
 * reading CUT by a byte cap, at every cap, is the oracle's reading of exactly the bytes it read —
 * which end at a separator, never at a backslash that opens an escape — so it keeps more as the
 * cap grows and counts what it did not read.
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
  while (a < v.length && '$#@+:'.includes(v[a]!)) a++;
  let b = v.length;
  while (b > a && '.:%'.includes(v[b - 1]!)) b--;
  return v.slice(a, b);
}

/** A maximal run of digits and commas shaped `\d{1,3}(,\d{3})+`, not glued to a letter before it. */
const GROUPED_RUN = /(?<![A-Za-z0-9]|\d,)\d{1,3}(?:,\d{3})+(?!\d|,\d)/g;
const PIECE_CHAR = /[A-Za-z0-9:_\-/.%+@#$]/;
const SEPARATOR = /[^A-Za-z0-9:_\-/.%+@#$]/;

/** Every token a WHOLE piece of `text` gives, whatever is dropped. */
const wholePieces = (text: string) =>
  new Set(text.split(SEPARATOR).map((piece) => oracleClassify(oracleSpell(piece))));

/**
 * The rule, plainly: its distinct tokens in first-seen order, how many grouped runs it saw, and how
 * many pieces next to a backslash read two ways and hold a digit.
 */
function oracle(text: string): { tokens: string[]; grouped: number; escaped: number } {
  const chars = text.split('');
  const forRuns = text.split(''); // an escape's own characters blanked: they neither start nor glue a run
  const twoWays = new Set<number>(); // where each piece that reads two ways starts
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '\\') continue;
    const next = text[i + 1] ?? '';
    if (next === '\\') {
      i++; // an escaped backslash: a plain separator
      continue;
    }
    if (next === '' || !'bfnrtu/'.includes(next)) continue;
    twoWays.add(i + 1);
    const own = next === 'u' && /^[0-9A-Fa-f]{4}$/.test(text.slice(i + 2, i + 6)) ? 5 : 1;
    for (let j = i + 1; j < i + 1 + own; j++) forRuns[j] = ' ';
    if (next === '/') {
      let j = i;
      while (j > 0 && PIECE_CHAR.test(text[j - 1]!)) j--;
      if (j < i) twoWays.add(j);
    }
  }
  let escaped = 0;
  for (const start of twoWays) {
    let digit = false;
    for (let j = start; j < text.length && PIECE_CHAR.test(text[j]!); j++) {
      digit ||= isDigit(text[j]!);
      chars[j] = ' ';
    }
    if (digit) escaped++;
  }
  let grouped = 0;
  for (const m of forRuns.join('').matchAll(GROUPED_RUN)) {
    grouped++;
    // Its groups — from its first comma to the end of its last group's piece — are not read.
    let j = m.index + m[0].indexOf(',');
    for (; j < m.index + m[0].length; j++) chars[j] = ' ';
    while (j < text.length && PIECE_CHAR.test(text[j]!)) chars[j++] = ' ';
  }
  const tokens: string[] = [];
  for (const piece of chars.join('').split(SEPARATOR)) {
    const token = oracleClassify(oracleSpell(piece));
    if (token !== undefined && !tokens.includes(token)) tokens.push(token);
  }
  return { tokens, grouped, escaped };
}

const PIECES = [
  '1234',
  '41,200',
  '1,234.5',
  '10:00:00,123',
  '120,',
  ',000',
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
  '\\n',
  '\\"',
  '\\u0031',
  '\\u00e9',
  '\\\\',
  '\\t',
  '\\b',
  '\\/',
  '\b',
  '\f',
  '\r',
  '\u0001',
  'node1234.log',
  'logs',
  'D:',
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
  '[',
  ']',
  '{',
  '}',
  '*',
  '`',
  'ok',
  '😀',
  '2026-11-25',
  '08:00',
];

/** Seeded CSV: cells, commas and line ends, some cells quoted. */
const CSV_PIECES = [
  '1200',
  '9750',
  '1',
  '234',
  '100',
  '200',
  'host-a',
  'esx01a',
  '2026-11-25',
  '10:00:00',
  '0.5',
  '-7',
  '"x,y"',
  '"1,234"',
  ',',
  ',',
  ',',
  '\n',
  '\r\n',
];

/** Seeded raw text with backslashes: Windows paths, regex-looking text, doubled backslashes. */
const PATH_PIECES = [
  'C:',
  'D:',
  '\\',
  '\\',
  '\\',
  '\\\\',
  'logs',
  'temp',
  'node1234.log',
  'file2026.txt',
  'build4521',
  'Users',
  'report-2026.pdf',
  'new1234',
  'u00e9',
  'u0031',
  'r1',
  't5678',
  '/',
  '/v2',
  ' ',
  '"',
  'd{4}',
  '1,234',
  '.5',
  'x',
];

/** Seeded JSON values; strings drawn from `PIECES`, numbers of every size. */
function jsonValue(next: () => number, depth = 0): unknown {
  if (depth > 2 || next() < 0.35) {
    const r = next();
    if (r < 0.35) return Math.floor(next() * 10 ** Math.floor(next() * 8));
    if (r < 0.45) return -Math.round(next() * 1e6) / 100;
    if (r < 0.5) return [true, false, null][Math.floor(next() * 3)];
    return seededTexts(Math.floor(next() * 1e9), PIECES, 1, 6)[0]!;
  }
  return next() < 0.5
    ? Array.from({ length: Math.floor(next() * 4) }, () => jsonValue(next, depth + 1))
    : Object.fromEntries(
        Array.from({ length: Math.floor(next() * 4) }, () => [
          seededTexts(Math.floor(next() * 1e9), PIECES, 1, 3)[0]!,
          jsonValue(next, depth + 1),
        ]),
      );
}

/** Generated texts of each kind the rule reads alike: prose, CSV, JSON, JSON Lines, cut JSON, paths. */
function kinds(scale: number): Record<string, string[]> {
  const next = seeded(4_040 + scale);
  const json = () => JSON.stringify(jsonValue(next), null, next() < 0.2 ? 1 : undefined);
  return {
    prose: seededTexts(2026 + scale, PIECES, 30 * scale, 16).map((t) => `p ${t}`),
    csv: seededTexts(77 + scale, CSV_PIECES, 10 * scale, 24),
    json: Array.from({ length: 10 * scale }, json),
    jsonLines: Array.from({ length: 5 * scale }, () =>
      Array.from({ length: 1 + Math.floor(next() * 4) }, json).join('\n'),
    ),
    cutJson: Array.from({ length: 10 * scale }, () => {
      const text = json();
      return text.slice(0, Math.floor(next() * text.length));
    }),
    paths: seededTexts(91 + scale, PATH_PIECES, 10 * scale, 12),
  };
}

describe('tokensOf against the plain-split oracle', () => {
  const generated = kinds(1_000);

  it.each(Object.keys(generated))('%s: the same tokens and the same two counts', (kind) => {
    let tokens = 0;
    let grouped = 0;
    let escaped = 0;
    for (const text of generated[kind]!) {
      const expected = oracle(text);
      const reading = readTokens(text);
      expect(tokensOf(text), JSON.stringify(text)).toEqual(expected.tokens);
      expect(reading.groupedNumbers ?? 0, JSON.stringify(text)).toBe(expected.grouped);
      expect(reading.escapedPieces ?? 0, JSON.stringify(text)).toBe(expected.escaped);
      tokens += expected.tokens.length;
      grouped += expected.grouped;
      escaped += expected.escaped;
    }
    expect(tokens).toBeGreaterThan(1_000);
    expect(grouped).toBeGreaterThan(kind === 'csv' ? -1 : 100);
    expect(escaped).toBeGreaterThan(kind === 'csv' ? -1 : 100);
  });

  it('every token is a whole piece of the lower-cased text, never a fragment, a fixed point, and distinct', () => {
    for (const texts of Object.values(kinds(300))) {
      for (const text of texts) {
        const lower = text.replace(/[A-Z]/g, (c) => c.toLowerCase());
        const wholes = wholePieces(text);
        const tokens = tokensOf(text);
        expect(new Set(tokens).size).toBe(tokens.length);
        for (const token of tokens) {
          expect(lower.includes(token), `${JSON.stringify(text)}: ${token}`).toBe(true);
          expect(wholes.has(token), `${JSON.stringify(text)}: ${token}`).toBe(true);
          expect(tokensOf(token)).toEqual([token]);
          if (token.length <= LEDGER_LIMITS.maxTokenChars) expect(isToken(token)).toBe(true);
        }
      }
    }
  });
});

describe('a reading cut by a byte cap', () => {
  /**
   * The shapes earlier comma rules got wrong: comma runs that end in a date, a dash or a longer
   * group (`1,234,2026-11-25`, `120,975,300,1234-5`), grouped runs glued to letters, and prose
   * that opens with a bracket like a log line, and backslashes before names, escapes and `/`.
   * `LEDGER_CUT_TEXTS` raises their count for a long local run.
   */
  const SHAPE_PIECES = [
    '1,',
    '12,',
    '120,',
    '234,',
    '975,',
    '300,',
    '1234',
    '2026-11-25',
    '1234-5',
    '-',
    '5678',
    '6789',
    ',',
    ',,',
    ' ',
    'n ',
    'x',
    'host',
    '[',
    ']',
    '"',
    ':',
    '\\n',
    '\\',
    '\\\\',
    '\\/',
    '\\u00e9',
    'node1234',
    'n1',
    '/',
    '10:00:00',
    '.5',
    '$',
    'ms',
    '0',
    '00',
  ];
  const shapeCount = Number(process.env.LEDGER_CUT_TEXTS ?? 1_500);
  const shapes = seededTexts(31, SHAPE_PIECES, shapeCount, 10);
  const texts = [...Object.values(kinds(20)).flat(), ...shapes, ...shapes.map((t) => `[${t}`)];

  it(
    'at every cap, is the plain reading of exactly the bytes it read, and keeps more as the cap grows',
    { timeout: 600_000 },
    () => {
      let cuts = 0;
      for (const text of texts) {
        const whole = new Set(tokensOf(text));
        const wholes = wholePieces(text);
        const bytes = utf8Bytes(text);
        let before: readonly string[] = [];
        for (let cap = 0; cap <= bytes; cap++) {
          const reading = readTokensUpTo(text, cap);
          const at = `${JSON.stringify(text)} @${cap}`;
          expect(reading.bytes).toBe(bytes);
          for (const token of reading.tokens) {
            expect(whole.has(token), `${at}: ${token}`).toBe(true);
            expect(wholes.has(token), `${at}: ${token}`).toBe(true);
          }
          for (const token of before) expect(reading.tokens, at).toContain(token);
          before = reading.tokens;
          // The bytes it read: a prefix of the text that ends at a separator unless it is all.
          const readBytes = bytes - (reading.cut?.bytesUnread ?? 0);
          expect(readBytes, at).toBeLessThanOrEqual(cap);
          let units = 0;
          while (units < text.length && utf8Bytes(text.slice(0, units + 1)) <= readBytes) units++;
          while (utf8Bytes(text.slice(0, units)) < readBytes) units++; // a surrogate pair's second half
          const read = text.slice(0, units);
          expect(utf8Bytes(read), at).toBe(readBytes);
          if (read !== text && read !== '') {
            expect(PIECE_CHAR.test(read.at(-1)!), at).toBe(false);
            const backslashes = /\\*$/.exec(read)![0].length;
            expect(backslashes % 2, `${at}: ends at a backslash that opens an escape`).toBe(0);
          }
          const expected = oracle(read);
          const kept = expected.tokens.filter((t) => t.length <= LEDGER_LIMITS.maxTokenChars);
          expect(reading.tokens, at).toEqual(kept);
          expect(reading.cut?.tokensDropped ?? 0, at).toBe(expected.tokens.length - kept.length);
          expect(reading.groupedNumbers ?? 0, at).toBe(expected.grouped);
          expect(reading.escapedPieces ?? 0, at).toBe(expected.escaped);
          if (reading.cut !== undefined) cuts++;
        }
      }
      expect(cuts).toBeGreaterThan(5_000);
    },
  );
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
    ['a megabyte of escapes', '\\u0031'.repeat(174_762)],
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
