/**
 * utf8 — the one measure of a string in UTF-8 payload bytes, without encoding it.
 *
 * Pattern: pure leaf, no imports. One owner of "how many bytes is this text",
 *          asked wherever a bound is stated in bytes: a code runner's staged
 *          payload (`adapters/code/output.ts`) and a script on the record
 *          (`core/agent/scripts/`). Two readers that cannot import each other
 *          must not count the same program two ways.
 * Role:    lib/ leaf (layer L0).
 *
 * The unit is the UTF-8 encoding's length, `Buffer.byteLength(text, 'utf8')`
 * on Node, measured here from UTF-16 code units so a browser build counts the
 * same: an ASCII unit is 1 byte, up to U+07FF 2, the rest of the BMP 3, a
 * surrogate PAIR 4. A lone surrogate counts 3 — what an encoder writes for it
 * (U+FFFD) — so a malformed string is never measured short.
 *
 * @example
 * ```ts
 * utf8Length('é');          // 2
 * utf8Length('\u{1F600}');  // 4
 * utf8Prefix('aé€', 3);     // 'aé' — '€' (3 bytes) would cross the bound
 * ```
 */

/** A UTF-16 high (leading) surrogate. */
export function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

/** A UTF-16 low (trailing) surrogate. */
export function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

/** UTF-8 byte length of a string, without encoding it. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (isHighSurrogate(unit) && isLowSurrogate(text.charCodeAt(i + 1))) {
      bytes += 4;
      i++;
    } else bytes += 3; // other BMP, and a lone surrogate (written as U+FFFD, 3 bytes)
  }
  return bytes;
}

/**
 * The longest prefix of `text` whose UTF-8 length is at most `maxBytes`, cut
 * at a CODE-POINT boundary: a character that would cross the bound is left
 * out whole, never split (a surrogate pair is one character). Linear in the
 * prefix it returns. `maxBytes` below 0 is read as 0.
 */
export function utf8Prefix(text: string, maxBytes: number): string {
  let bytes = 0;
  let i = 0;
  while (i < text.length) {
    const unit = text.charCodeAt(i);
    const pair = isHighSurrogate(unit) && isLowSurrogate(text.charCodeAt(i + 1));
    const width = unit < 0x80 ? 1 : unit < 0x800 ? 2 : pair ? 4 : 3;
    if (bytes + width > maxBytes) break;
    bytes += width;
    i += pair ? 2 : 1;
  }
  return i === text.length ? text : text.slice(0, i);
}
