/**
 * session and digest — the session id's one spelling, and the folder's one door to Web Crypto.
 *
 * Unit: the id encodes exactly 128 bits (an independent BigInt oracle decodes it back), the
 * grammar refuses everything a minter cannot write, and the digest is SHA-256 over UTF-8
 * (checked against `node:crypto`, an independent implementation).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { digestOf, isDigest, randomBytes } from './digest.js';
import { isSessionId, mintSessionId, sessionIdOf } from './session.js';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** The oracle: the 128-bit number an id spells, read back by BigInt arithmetic. */
function bitsOf(id: string): bigint {
  let n = 0n;
  for (const char of id.slice(3)) n = n * 32n + BigInt(CROCKFORD.indexOf(char));
  return n;
}
const bigintOf = (bytes: Uint8Array): bigint =>
  [...bytes].reduce((n, byte) => n * 256n + BigInt(byte), 0n);

describe('session id', () => {
  it('is ls_ and 26 Crockford characters, holding the 16 bytes exactly', () => {
    for (const bytes of [
      new Uint8Array(16),
      new Uint8Array(16).fill(0xff),
      Uint8Array.from({ length: 16 }, (_, i) => i * 17),
      randomBytes(16),
    ]) {
      const id = sessionIdOf(bytes);
      expect(id).toMatch(/^ls_[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(isSessionId(id)).toBe(true);
      expect(bitsOf(id)).toBe(bigintOf(bytes));
    }
    expect(sessionIdOf(new Uint8Array(16))).toBe(`ls_${'0'.repeat(26)}`);
    expect(sessionIdOf(new Uint8Array(16).fill(0xff))).toBe(`ls_7${'Z'.repeat(25)}`);
  });

  it('mints distinct ids from 128 random bits', () => {
    const ids = new Set(Array.from({ length: 2_000 }, () => mintSessionId()));
    expect(ids.size).toBe(2_000);
    for (const id of ids) expect(isSessionId(id)).toBe(true);
  });

  it('takes exactly 16 bytes', () => {
    expect(() => sessionIdOf(new Uint8Array(15))).toThrow(RangeError);
    expect(() => sessionIdOf(new Uint8Array(17))).toThrow(RangeError);
    expect(() => sessionIdOf([1, 2, 3] as unknown as Uint8Array)).toThrow(RangeError);
  });

  it.each([
    ['a first character past 7', `ls_8${'0'.repeat(25)}`],
    ['lower case', `ls_${'a'.repeat(26)}`],
    ['the letter I', `ls_0${'I'.repeat(25)}`],
    ['the letter L', `ls_0${'L'.repeat(25)}`],
    ['the letter O', `ls_0${'O'.repeat(25)}`],
    ['the letter U', `ls_0${'U'.repeat(25)}`],
    ['one character short', `ls_${'0'.repeat(25)}`],
    ['one character long', `ls_${'0'.repeat(27)}`],
    ['another prefix', `lx_${'0'.repeat(26)}`],
    ['a path', '../../etc/passwd'],
    ['a path inside the id', `ls_${'0'.repeat(12)}/${'0'.repeat(13)}`],
    ['a trailing newline', `ls_${'0'.repeat(26)}\n`],
    ['the empty string', ''],
  ])('refuses %s', (_name, id) => {
    expect(isSessionId(id)).toBe(false);
  });

  it('refuses what is not a string', () => {
    for (const value of [undefined, null, 1, {}, [`ls_${'0'.repeat(26)}`]])
      expect(isSessionId(value)).toBe(false);
  });
});

describe('digest', () => {
  it('is sha256 over the UTF-8 bytes, as node:crypto computes it', async () => {
    for (const text of ['', 'abc', 'é ✓ 😀', 'x'.repeat(100_000)]) {
      const expected = createHash('sha256').update(text, 'utf8').digest('hex');
      expect(await digestOf(text)).toBe(`sha256:${expected}`);
    }
    expect(await digestOf('')).toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('isDigest takes only the one spelling', async () => {
    expect(isDigest(await digestOf('x'))).toBe(true);
    expect(isDigest(`sha256:${'A'.repeat(64)}`)).toBe(false);
    expect(isDigest(`sha256:${'a'.repeat(63)}`)).toBe(false);
    expect(isDigest(`sha512:${'a'.repeat(64)}`)).toBe(false);
    expect(isDigest('a'.repeat(64))).toBe(false);
    expect(isDigest(undefined)).toBe(false);
  });

  it('randomBytes is bounded', () => {
    expect(randomBytes(32)).toHaveLength(32);
    expect(() => randomBytes(0)).toThrow(RangeError);
    expect(() => randomBytes(65_537)).toThrow(RangeError);
    expect(() => randomBytes(1.5)).toThrow(RangeError);
  });
});
