/**
 * llm-ledger/tokens — which tokens of a text are VALUES, read the same way on every side.
 *
 * Pattern: one pure reader, used for what a read returned (a receipt), what
 *          was supplied, and — in the rules — what a note or a draft states.
 *          One spelling on every side, so two sides can never disagree about
 *          what "the same value" means.
 * Role:    the closed leaf's own copy of rules 1–3 in the header of
 *          `core/agent/evidence/extract.ts` (this folder cannot import it). A
 *          differential test against that extractor is added when the plugin
 *          adapter starts.
 * Emits:   N/A.
 *
 * ## The rule
 *
 * A token is a candidate only if:
 *
 *   1. it contains a digit (prose is alphabetic — so an all-letter name is
 *      invisible here, stated plainly);
 *   2. it is distinctive: an IDENTIFIER of at least 4 characters (digits
 *      mixed with letters or with `:` `_` `-` `/` `.`), or a NUMBER of at
 *      least 4 digits (thousands separators folded: `41,200` is `41200`);
 *   3. it is not prose wearing a number: a number with a short unit glued on
 *      (`32G`, `48-port`, `41200iops`) is judged by its number alone, and a
 *      bare one-or-two-digit ratio (`24/7`) is never a token.
 *
 * Tokens are lower-cased and compared exactly. Nothing else is respelled:
 * `98304.0` is not `98304`, and `1.2 s` is not `1200ms`.
 *
 * ## How a text is split
 *
 * The characters `A–Z a–z 0–9 : _ - / . , % + @ # $` live inside a token;
 * everything else separates. A comma not between two digits splits a list.
 * Leading `$ # @ +` and trailing `. , ; : ! ? %` are decoration. A JSON key's
 * colon is a separator (`{"total":1200}` gives `1200`, never `:1200`).
 *
 * A text that is ONE JSON object or array is read value by value instead:
 * every string literal and key as text, every number literal as written. Read
 * as prose, compact JSON glues its punctuation onto the values (`[1200,9750]`
 * would give no token at all).
 *
 * ## The caps (`limits.ts`)
 *
 * `readTokens` reads at most `maxTextBytes` UTF-8 bytes; the rest is counted in
 * `cut.bytesUnread`, never read. A cut never splits a token: the token the
 * byte cap falls in is left unread with the rest. It keeps the first
 * `maxTokens` distinct tokens in first-seen order; every other distinct token —
 * past the cap, or longer than `maxTokenChars` — is counted in
 * `cut.tokensDropped`. A reading that kept everything has no `cut`.
 */
import { LEDGER_LIMITS } from './limits.js';

/** What a text was read to hold. */
export interface LedgerTokenReading {
  readonly tokens: readonly string[];
  /** UTF-8 bytes of the whole text. */
  readonly bytes: number;
  readonly cut?: { readonly tokensDropped: number; readonly bytesUnread: number };
}

const ROUGH = /[A-Za-z0-9:_\-/.,%+@#$]+/g;
const LIST_COMMA = /,(?!\d)|(?<!\d),/;
const LEADING = /^[$#@+'"`([{<]+/;
const TRAILING = '.,;:!?%\'"`)]}>';
const THOUSANDS = /^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const RATIO = /^\d{1,2}\/\d{1,2}$/;
const WITH_TAIL = /^([-+]?\d+(?:\.\d+)?)[-/]?[a-z]{1,5}(?:\/[a-z]{1,5})?$/;
const NUMBER = /^[-+]?\d+(?:\.\d+)?$/;
const STRUCTURAL = /[:_\-/.]/;
const LETTER = /[a-z]/;
const DIGIT = /\d/;
const JSON_NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** Whether the code unit `c` may live inside a token. */
function intra(c: number): boolean {
  return (
    (c >= 0x30 && c <= 0x39) || // 0-9
    (c >= 0x41 && c <= 0x5a) || // A-Z
    (c >= 0x61 && c <= 0x7a) || // a-z
    c === 0x3a || // :
    c === 0x5f || // _
    c === 0x2d || // -
    c === 0x2f || // /
    c === 0x2e || // .
    c === 0x2c || // ,
    c === 0x25 || // %
    c === 0x2b || // +
    c === 0x40 || // @
    c === 0x23 || // #
    c === 0x24 // $
  );
}

/** One raw piece in the form every side compares on; `''` for pure decoration. */
function spelling(raw: string): string {
  let v = raw.toLowerCase().replace(LEADING, '');
  let end = v.length;
  while (end > 0 && TRAILING.includes(v[end - 1] as string)) end--;
  v = v.slice(0, end);
  return THOUSANDS.test(v) ? v.replace(/,/g, '') : v;
}

/** Rules 1–3: the token a spelled piece is, or `undefined` for prose. */
function classify(piece: string): string | undefined {
  if (!DIGIT.test(piece) || RATIO.test(piece)) return undefined;
  const tail = WITH_TAIL.exec(piece);
  const numeric = tail !== null ? (tail[1] as string) : NUMBER.test(piece) ? piece : undefined;
  if (numeric !== undefined) {
    let digits = 0;
    for (let i = 0; i < numeric.length; i++) if (DIGIT.test(numeric[i] as string)) digits++;
    return digits >= 4 ? numeric : undefined;
  }
  if (piece.length < 4 || (!LETTER.test(piece) && !STRUCTURAL.test(piece))) return undefined;
  return piece;
}

/** `text` with each JSON key's colon made a space, so `{"total":1200}` reads `1200`. */
function withoutKeyColons(text: string): string {
  if (!text.includes('"')) return text;
  let out = '';
  let from = 0;
  let open = false;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) !== 0x22) continue;
    let slashes = 0;
    for (let k = i - 1; k >= 0 && text.charCodeAt(k) === 0x5c; k--) slashes++;
    if (slashes % 2 === 1) continue;
    open = !open;
    if (open) continue;
    let j = i + 1;
    while (j < text.length && /\s/.test(text[j] as string)) j++;
    if (text.charCodeAt(j) === 0x3a) {
      out += `${text.slice(from, j)} `;
      from = j + 1;
    }
  }
  return from === 0 ? text : out + text.slice(from);
}

/** Every token of prose, in first-seen order, duplicates kept. */
function proseTokens(text: string, into: (token: string) => void): void {
  for (const [rough] of withoutKeyColons(text).matchAll(ROUGH)) {
    for (const piece of rough.split(LIST_COMMA)) {
      const token = classify(spelling(piece));
      if (token !== undefined) into(token);
    }
  }
}

/**
 * Every token of one JSON object or array, value by value — or `false` when
 * `text` is not one. String literals and keys are read as prose, number
 * literals as written.
 */
function jsonTokens(text: string, into: (token: string) => void): boolean {
  const first = text.trimStart()[0];
  if (first !== '{' && first !== '[') return false;
  try {
    JSON.parse(text); // the grammar check; the values are read from the text below
  } catch {
    return false;
  }
  for (let i = 0; i < text.length; ) {
    const c = text.charCodeAt(i);
    if (c === 0x22) {
      let end = i + 1;
      while (text.charCodeAt(end) !== 0x22) end += text.charCodeAt(end) === 0x5c ? 2 : 1;
      proseTokens(JSON.parse(text.slice(i, end + 1)) as string, into);
      i = end + 1;
    } else if (c === 0x2d || (c >= 0x30 && c <= 0x39)) {
      JSON_NUMBER.lastIndex = i;
      const literal = (JSON_NUMBER.exec(text) as RegExpExecArray)[0];
      const token = classify(spelling(literal));
      if (token !== undefined) into(token);
      i += literal.length;
    } else i++;
  }
  return true;
}

/** Every distinct token of `text`, in first-seen order, with no cap. */
export function tokensOf(text: string): string[] {
  const seen = new Set<string>();
  const add = (token: string): void => void seen.add(token);
  if (!jsonTokens(text, add)) proseTokens(text, add);
  return [...seen];
}

/** Whether `value` is exactly one token, spelled as `tokensOf` writes it. */
export function isToken(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length < LEDGER_LIMITS.minTokenChars || value.length > LEDGER_LIMITS.maxTokenChars)
    return false;
  const read = tokensOf(value);
  return read.length === 1 && read[0] === value;
}

/**
 * UTF-8 bytes of the character starting at code unit `i`, as an encoder
 * writes it: a surrogate pair is 4 bytes over 2 units, a lone surrogate 3
 * (U+FFFD). Never more than one character is read.
 */
function bytesAt(text: string, i: number): number {
  const c = text.charCodeAt(i);
  if (c < 0x80) return 1;
  if (c < 0x800) return 2;
  if (c >= 0xd800 && c <= 0xdbff) {
    const next = text.charCodeAt(i + 1);
    if (next >= 0xdc00 && next <= 0xdfff) return 4;
  }
  return 3;
}

/** UTF-8 bytes of `text`, counted without encoding it. */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; ) {
    const step = bytesAt(text, i);
    bytes += step;
    i += step === 4 ? 2 : 1;
  }
  return bytes;
}

/**
 * The tokens a receipt keeps of the host's `text`, and what it did not keep.
 * The text itself is never kept: only its byte count and its capped tokens.
 */
export function readTokens(text: string): LedgerTokenReading {
  let readUnits = 0;
  let readBytes = 0;
  let bytes = 0;
  for (let i = 0; i < text.length; ) {
    const step = bytesAt(text, i);
    const units = step === 4 ? 2 : 1;
    bytes += step;
    if (bytes <= LEDGER_LIMITS.maxTextBytes) {
      readUnits = i + units;
      readBytes = bytes;
    }
    i += units;
  }
  // The cap fell inside a token: leave the whole token unread rather than keep a piece of it.
  if (readUnits < text.length && intra(text.charCodeAt(readUnits))) {
    while (readUnits > 0 && intra(text.charCodeAt(readUnits - 1))) {
      readUnits--;
      readBytes--; // a token character is ASCII: one byte
    }
  }
  const all = tokensOf(text.slice(0, readUnits));
  const tokens: string[] = [];
  for (const token of all) {
    if (tokens.length === LEDGER_LIMITS.maxTokens) break;
    if (token.length <= LEDGER_LIMITS.maxTokenChars) tokens.push(token);
  }
  const tokensDropped = all.length - tokens.length;
  const bytesUnread = bytes - readBytes;
  Object.freeze(tokens);
  return tokensDropped === 0 && bytesUnread === 0
    ? Object.freeze({ tokens, bytes })
    : Object.freeze({ tokens, bytes, cut: Object.freeze({ tokensDropped, bytesUnread }) });
}
