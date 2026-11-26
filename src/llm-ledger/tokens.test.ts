/**
 * tokens — which tokens of a text are values, and what a receipt keeps (case table 5.1).
 *
 * Unit: rules 1–3 case by case, the JSON reading, the caps at 2,047 / 2,048 / 2,049 tokens and at
 * 1 MiB ± 1 byte, and a cut that never keeps a piece of a token. The generated properties live in
 * `test/llm-ledger/tokens-property.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { LEDGER_LIMITS } from './limits.js';
import { isToken, readTokens, tokensOf, utf8Bytes } from './tokens.js';

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

  it('text that only looks like JSON is read as prose', () => {
    expect(tokensOf('[1200,9750')).toEqual([]);
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

  it('the reading is frozen and holds no text', () => {
    const reading = readTokens('secret words 1234');
    expect(Object.isFrozen(reading)).toBe(true);
    expect(Object.isFrozen(reading.tokens)).toBe(true);
    expect(JSON.stringify(reading)).not.toContain('secret');
  });
});
