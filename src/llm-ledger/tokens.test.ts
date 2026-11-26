/**
 * tokens — which tokens of a text are values, and what a receipt keeps (case table 5.1).
 *
 * Unit: rules 1–3 case by case, the JSON reading, the caps at 2,047 / 2,048 / 2,049 tokens and at
 * 1 MiB ± 1 byte, and a cut that never keeps a piece of a token. The generated properties live in
 * `test/llm-ledger/tokens-property.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { LEDGER_LIMITS } from './limits.js';
import { isToken, readTokens, readTokensUpTo, tokensOf, utf8Bytes } from './tokens.js';

const MiB = LEDGER_LIMITS.maxTextBytes;
/** `n` distinct tokens of 8 characters, space-separated: `t0000001 t0000002 …`. */
const distinct = (n: number, from = 0): string =>
  Array.from({ length: n }, (_, i) => `t${String(from + i).padStart(7, '0')}`).join(' ');

describe('tokensOf — rules 1–3', () => {
  it.each([
    ['a number of 4 digits', 'took 1234 ms', ['1234']],
    ['thousands separators folded', 'served 41,200 requests', ['41200']],
    ['a decimal with 4 digits', 'ratio 12.34 and 1.5', ['12.34']],
    ['a signed number', 'delta -1234', ['-1234']],
    ['a leading plus is decoration', 'delta +1234', ['1234']],
    ['an identifier mixing letters and digits', 'host esx01a is up', ['esx01a']],
    ['an identifier with structure', 'port fc1/3 and 10.0.0.1', ['fc1/3', '10.0.0.1']],
    ['a MAC address', 'wwn 21:00:00:24:ff:4a:12:03', ['21:00:00:24:ff:4a:12:03']],
    ['a date and a time', 'on 2026-11-25 at 08:00', ['2026-11-25', '08:00']],
    ['lower-cased', 'id UCSB-B200-M5', ['ucsb-b200-m5']],
    ['a unit glued on: judged by the number', '41200iops and 32G and 48-port', ['41200']],
    ['a unit with a rate', '$20/month 1500mb/s', ['1500']],
    ['a short ratio is prose', '24/7 support, 1/2 off', []],
    ['short numbers are prose', 'three 3 issues in 24 hours, 999 left', []],
    ['short identifiers are prose', 'po1 a1 x9', []],
    ['an all-letter name is invisible', 'esxi-host-alpha', []],
    ['trailing punctuation is decoration', 'total: 1234.', ['1234']],
    ['a list comma splits', 'fc1/3,fc1/4', ['fc1/3', 'fc1/4']],
    ['a percent is decoration at the end', 'usage 1234%', ['1234']],
    ['no respelling of a number', '98304.0 98304', ['98304.0', '98304']],
    ['leading zeros kept', 'code 0012', ['0012']],
    ['distinct, in first-seen order', '5678 1234 5678', ['5678', '1234']],
    ['brackets and quotes separate', '**1234** `abc123` "x9y8"', ['1234', 'abc123', 'x9y8']],
    ['non-ASCII separates', 'naïve1234 №5678', ['ve1234', '5678']],
  ])('%s', (_name, text, tokens) => {
    expect(tokensOf(text)).toEqual(tokens);
  });

  it.each([
    ['thousands grouping is folded', '41,200 and 1,234,567', ['41200', '1234567']],
    [
      'with a sign, a decimal, a currency or a unit',
      '-1,234.5 $2,500 1,234ms',
      ['-1234.5', '2500', '1234'],
    ],
    ['CSV values are separated', 'host-a,1200,9750,ok', ['1200', '9750']],
    [
      'a digit comma that is not grouping separates',
      '1200,9750 12,345,6789 1,0000',
      ['1200', '9750', '6789', '0000'],
    ],
    [
      'identifiers joined by commas are separated',
      'esx01a,esx02b fc1/3,fc1/4',
      ['esx01a', 'esx02b', 'fc1/3', 'fc1/4'],
    ],
    [
      'a grouped run glued to a letter is not a number: its commas separate',
      'host1,234 v2,500',
      ['host1'],
    ],
    ['edge and doubled commas separate', ',41,200, 1,,234 5678,,', ['41200', '5678']],
    ['no token holds a comma', 'a1,b2,c3 1,2,3 10,20', []],
  ])('commas: %s', (_name, text, tokens) => {
    expect(tokensOf(text)).toEqual(tokens);
    for (const token of tokens) expect(token).not.toContain(',');
  });

  it("a JSON key's colon is a separator in prose", () => {
    expect(tokensOf('result {"total":1200, "host":"esx01a"} done')).toEqual(['1200', 'esx01a']);
  });

  it('one JSON value is read value by value', () => {
    expect(tokensOf('[1200,9750]')).toEqual(['1200', '9750']);
    expect(tokensOf('[5,100]')).toEqual([]);
    expect(tokensOf('{"rows":[{"id":"vm-0042","iops":41200}],"n1234":true}')).toEqual([
      'vm-0042',
      '41200',
      'n1234',
    ]);
    expect(tokensOf('  {"note":"took 1234 ms, see \\"run-77ab\\""}')).toEqual(['1234', 'run-77ab']);
  });

  it('text that only looks like JSON is read as prose, where a comma separates values', () => {
    expect(tokensOf('[1200,9750')).toEqual(['1200', '9750']);
    expect(tokensOf('{1234}')).toEqual(['1234']);
  });

  it('every token it gives is exactly one token (the spelling is a fixed point)', () => {
    const text = 'x 41,200 ok -1234ms fc1/3,fc1/4 {"a":1200} 1.5e+10 2026-11-25T10:00:00Z';
    for (const token of tokensOf(text)) {
      expect(tokensOf(token)).toEqual([token]);
      expect(isToken(token)).toBe(true);
    }
  });

  it('isToken refuses what is not one token as written', () => {
    expect(isToken('41200iops')).toBe(false);
    expect(isToken('41,200')).toBe(false);
    expect(isToken('ESX01A')).toBe(false);
    expect(isToken('1234 5678')).toBe(false);
    expect(isToken('abc')).toBe(false);
    expect(isToken(`a${'1'.repeat(64)}`)).toBe(false); // 65 characters
    expect(isToken(`a${'1'.repeat(63)}`)).toBe(true);
    expect(isToken(1234)).toBe(false);
  });
});

describe('utf8Bytes', () => {
  it('counts as an encoder writes, a lone surrogate as U+FFFD', () => {
    for (const text of ['', 'abc', 'é', '✓', '😀', 'a\ud800b', '\udc00', 'x😀y\ud83d'])
      expect(utf8Bytes(text)).toBe(new TextEncoder().encode(text).length);
  });
});

describe('readTokens — the receipt caps', () => {
  it.each([
    [2_047, false],
    [2_048, false],
    [2_049, true],
  ])('%i distinct tokens: cut is %s', (n, cut) => {
    const reading = readTokens(distinct(n));
    expect(reading.tokens).toHaveLength(Math.min(n, 2_048));
    expect(reading.tokens[0]).toBe('t0000000');
    if (cut) expect(reading.cut).toEqual({ tokensDropped: n - 2_048, bytesUnread: 0 });
    else expect(reading.cut).toBeUndefined();
  });

  it('keeps the first 2,048 in first-seen order, and counts every distinct one past them', () => {
    const reading = readTokens(`${distinct(3_000)} ${distinct(10)}`);
    expect(reading.tokens).toEqual(distinct(2_048).split(' '));
    expect(reading.cut).toEqual({ tokensDropped: 952, bytesUnread: 0 });
  });

  it('a token past 64 characters is counted, never kept', () => {
    const long = `a${'1'.repeat(64)}`;
    const reading = readTokens(`1234 ${long} 5678`);
    expect(reading.tokens).toEqual(['1234', '5678']);
    expect(reading.cut).toEqual({ tokensDropped: 1, bytesUnread: 0 });
  });

  /** `bytes` of text whose last token ends exactly at the end, tokens separated by spaces. */
  const textOf = (bytes: number): string => {
    const unit = 'ab12 '; // 5 bytes, one token `ab12`
    const body = unit.repeat(Math.floor(bytes / unit.length));
    return body + 'x'.repeat(bytes - body.length);
  };

  it('1 MiB − 1 byte and 1 MiB exactly are read whole', () => {
    for (const bytes of [MiB - 1, MiB]) {
      const reading = readTokens(textOf(bytes));
      expect(reading.bytes).toBe(bytes);
      expect(reading.cut).toBeUndefined();
      expect(reading.tokens).toEqual(['ab12']);
    }
  });

  it('1 MiB + 1 byte: the byte past the cap is counted, never read', () => {
    const text = `${'z'.repeat(MiB - 5)} 1234 `; // 1 MiB + 1: the last byte is a space
    expect(utf8Bytes(text)).toBe(MiB + 1);
    const reading = readTokens(text);
    expect(reading.bytes).toBe(MiB + 1);
    expect(reading.cut).toEqual({ tokensDropped: 0, bytesUnread: 1 });
    expect(reading.tokens).toEqual(['1234']);
  });

  it('a cap that falls inside a token leaves the whole token unread, never a piece', () => {
    // The 1 MiB cap falls between `1234` and `5678` of the token `12345678`.
    const text = `${'z'.repeat(MiB - 5)} 12345678 9999`;
    const reading = readTokens(text);
    expect(reading.tokens).toEqual([]);
    expect(reading.tokens).not.toContain('1234');
    expect(reading.bytes).toBe(MiB + 9);
    // Unread: the 8 bytes of the token and the 5 after it.
    expect(reading.cut).toEqual({ tokensDropped: 0, bytesUnread: 13 });
  });

  it('a cap that falls inside a character counts that character as unread', () => {
    const text = `${'z'.repeat(MiB - 1)}é`; // the 2-byte é crosses the cap
    const reading = readTokens(text);
    expect(reading.bytes).toBe(MiB + 1);
    expect(reading.cut).toEqual({ tokensDropped: 0, bytesUnread: 2 });
  });

  it('a CSV receipt keeps its values (the review case)', () => {
    expect(readTokens('host-a,1200,9750,ok')).toEqual({ tokens: ['1200', '9750'], bytes: 19 });
  });

  it('a JSON number array past 1 MiB keeps what it read and counts the rest (the review case)', () => {
    const text = `[${Array.from({ length: 200_000 }, (_, i) => 100_000 + i).join(',')}]`;
    expect(text.length).toBeGreaterThan(MiB);
    const reading = readTokens(text);
    expect(reading.tokens).toHaveLength(2_048);
    expect(reading.tokens[0]).toBe('100000');
    // Every whole value before the cap was read: 7 bytes each after the bracket.
    const read = Math.floor((MiB - 1) / 7);
    expect(reading.cut).toEqual({
      tokensDropped: read - 2_048,
      bytesUnread: text.length - (1 + 7 * read),
    });
  });

  it('a cut never keeps a piece a later byte could change, and keeps every settled one', () => {
    // Inside a run that may still be thousands-grouped: none of it is kept.
    expect(readTokensUpTo('a 1,234,567 b', 8)).toEqual({
      tokens: [],
      bytes: 13,
      cut: { tokensDropped: 0, bytesUnread: 11 },
    });
    expect(readTokensUpTo('a 1,234,567 b', 8).tokens).not.toContain('1234');
    // A run that can no longer be grouping: every value before the last comma is settled.
    expect(readTokensUpTo('a 1200,9750,4321 b', 13)).toEqual({
      tokens: ['1200', '9750'],
      bytes: 18,
      cut: { tokensDropped: 0, bytesUnread: 6 },
    });
    // A run glued to a letter never folds, so its commas settle too.
    expect(readTokensUpTo('x host1,2345,678 y', 14).tokens).toEqual(['host1', '2345']);
    expect(readTokensUpTo('host1,234,567 z', 11).tokens).toEqual(['host1']);
    // A cap right after a separating comma keeps everything before it.
    expect(readTokensUpTo('9999,abcd5', 5)).toEqual({
      tokens: ['9999'],
      bytes: 10,
      cut: { tokensDropped: 0, bytesUnread: 5 },
    });
  });

  it('a cut JSON value is read as JSON up to its last whole literal; a cut string stays unread', () => {
    // Read as prose, `567,890` would fold into the false value 567890.
    expect(readTokensUpTo('[567,890,"xyz"]', 10)).toEqual({
      tokens: [],
      bytes: 15,
      cut: { tokensDropped: 0, bytesUnread: 6 },
    });
    expect(readTokensUpTo('["9999 x", "1234 5678"]', 18)).toEqual({
      tokens: ['9999'],
      bytes: 23,
      cut: { tokensDropped: 0, bytesUnread: 12 },
    });
    // A cut prefix with a string JSON cannot decode is not JSON: read as prose, nothing kept from
    // the JSON reading (`\u0031234` would decode to 1234).
    const bad = String.raw`["\u0031234","bad\q", "more 5678"]`;
    expect(readTokensUpTo(bad, 22).tokens).toEqual(['u0031234']);
    // Prose that merely opens with a bracket is still prose.
    expect(readTokensUpTo('[INFO] host esx01a took 1234 ms and more', 30).tokens).toEqual([
      'esx01a',
      '1234',
    ]);
  });

  it('prose that opens with a bracket is prose, also when it is cut (the review cases)', () => {
    const lines = Array.from(
      { length: 30_000 },
      (_, i) =>
        `[2026-11-25 10:${String(i % 60).padStart(2, '0')}:00] "GET /x" 200 ${1000 + i}-5678`,
    ).join('\n');
    expect(lines.length).toBeGreaterThan(MiB);
    const reading = readTokens(lines);
    const whole = new Set(tokensOf(lines));
    for (const token of reading.tokens) expect(whole.has(token), token).toBe(true);
    expect(reading.tokens.slice(0, 4)).toEqual(['2026-11-25', '10:00:00', '1000-5678', '10:01:00']);
    expect(reading.tokens).not.toContain('2026');
    expect(reading.tokens).not.toContain('-5678');
    // The 2,048 kept, every other distinct token before the cap counted: nothing dropped uncounted.
    expect(reading.cut?.tokensDropped).toBeGreaterThan(20_000);
    const numbers = `[${Array.from(
      { length: 200_000 },
      (_, i) => `1,${String(100 + (i % 900))} 5,678`,
    ).join(' ')}`;
    const counted = readTokens(numbers);
    expect(counted.tokens.slice(0, 2)).toEqual(['1100', '5678']);
    expect(counted.tokens).toHaveLength(901); // 1100…1999 and 5678: every value, none dropped
    expect(counted.cut?.bytesUnread).toBeGreaterThan(0);
  });

  it('a cut never keeps a number the grouping of its settled part would invent (the review cases)', () => {
    const date = 'n 1,234,2026-11-25';
    for (let cap = 9; cap < date.length; cap++)
      expect(readTokensUpTo(date, cap).tokens, `cap ${cap}`).not.toContain('1234');
    expect(tokensOf(date)).toEqual(['2026-11-25']);
    const row = 'row 120,975,300,1234-5 end';
    expect(readTokensUpTo(row, 21).tokens).toEqual([]);
    expect(tokensOf(row)).toEqual(['1234-5']);
    // A run whose kept part cannot fold on its own still settles at its last comma.
    expect(readTokensUpTo('x 1200,9750,4321', 14).tokens).toEqual(['1200', '9750']);
  });

  it('readTokensUpTo takes a whole number', () => {
    expect(() => readTokensUpTo('x', -1)).toThrow(RangeError);
    expect(() => readTokensUpTo('x', 1.5)).toThrow(RangeError);
    expect(readTokensUpTo('1234', 0)).toEqual({
      tokens: [],
      bytes: 4,
      cut: { tokensDropped: 0, bytesUnread: 4 },
    });
  });

  it('the reading is frozen and holds no text', () => {
    const reading = readTokens('secret words 1234');
    expect(Object.isFrozen(reading)).toBe(true);
    expect(Object.isFrozen(reading.tokens)).toBe(true);
    expect(JSON.stringify(reading)).not.toContain('secret');
  });
});
