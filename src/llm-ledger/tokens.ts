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
 * ## A token is a piece of the text
 *
 * A text is split into PIECES: runs of the characters `A–Z a–z 0–9 : _ - / . % + @ # $`. Every
 * other character separates, and so does every comma and every backslash escape (`\n`, `\"`,
 * `é`, as JSON and logs write them). A leading `$ # @ + :` and a trailing `. : %` are
 * decoration, so `{"total":1200}` gives `1200`. Nothing is folded, joined or respelled but for
 * lower case: every token is a substring of the lower-cased text, whatever the text is — prose,
 * CSV, JSON, JSON Lines, or any part of one — and no text is recognised as one kind first.
 *
 * ## Which pieces are values
 *
 * A piece is a token only if:
 *
 *   1. it contains a digit (prose is alphabetic — so an all-letter name is
 *      invisible here, stated plainly);
 *   2. it is distinctive: an IDENTIFIER of at least 4 characters (digits
 *      mixed with letters or with `:` `_` `-` `/` `.`), or a NUMBER of at
 *      least 4 digits;
 *   3. it is not prose wearing a number: a number with a short unit glued on
 *      (`32G`, `48-port`, `41200iops`) is judged by its number alone, and a
 *      bare one-or-two-digit ratio (`24/7`) is never a token.
 *
 * Tokens are compared exactly: `98304.0` is not `98304`, and `1.2 s` is not `1200ms`.
 *
 * ## Numbers written with thousands separators are not read
 *
 * A run of digits and commas that matches `\d{1,3}(,\d{3})+` and is not glued to a letter before
 * it (`41,200`, `$1,234.50`, `1,234ms`, `[100,200,300` — not `host1,234`) may be one number or a
 * list of values, and no reading of its pieces can tell which. It is COUNTED (`groupedNumbers`),
 * and its groups — the pieces after its first comma — are never read, so `1,234.5` gives no
 * `234.5`. A receipt that counted one is incomplete (`entries.ts` · `isIncomplete`); in a claim,
 * such a number is no visible token. This differs on purpose from the agent's own extractor, which
 * folds the commas out (`5,100` is `5100`) and reads one JSON value through its literals.
 *
 * ## The caps (`limits.ts`)
 *
 * `readTokens` reads at most `maxTextBytes` UTF-8 bytes. Past the cap each character is counted
 * once (`bytes`, `cut.bytesUnread`) and never read: nothing past it is copied, split or looked at
 * to decide anything. The last piece before the cap is kept only when a separator follows it within
 * the bytes read; otherwise it is left unread with the rest. It keeps the first `maxTokens` distinct tokens in first-seen order;
 * every other distinct token — past the cap, or longer than `maxTokenChars` — is counted in
 * `cut.tokensDropped`. A reading that kept everything has no `cut`. Nothing read is dropped
 * uncounted.
 */
import { LEDGER_LIMITS } from './limits.js';

/** What a text was read to hold. */
export interface LedgerTokenReading {
  readonly tokens: readonly string[];
  /** UTF-8 bytes of the whole text. */
  readonly bytes: number;
  readonly cut?: { readonly tokensDropped: number; readonly bytesUnread: number };
  /** Present only when the part read holds a number written with thousands separators. */
  readonly groupedNumbers?: number;
}

/** A run of piece characters and commas; the commas then split it. */
const ROUGH = /[A-Za-z0-9:_\-/.,%+@#$]+/g;
/** A backslash escape: `\u` and four hex digits, or a backslash and one of `" \ / b f n r t`. */
const ESCAPE = /\\(?:u[0-9A-Fa-f]{4}|["\\/bfnrt])/g;
const GROUPED = /^\d{1,3}(?:,\d{3})+$/;
const LEADING = /^[$#@+:]+/;
const TRAILING = '.:%';
const RATIO = /^\d{1,2}\/\d{1,2}$/;
const WITH_TAIL = /^([-+]?\d+(?:\.\d+)?)[-/]?[a-z]{1,5}(?:\/[a-z]{1,5})?$/;
const NUMBER = /^[-+]?\d+(?:\.\d+)?$/;
const STRUCTURAL = /[:_\-/.]/;
const LETTER = /[a-z]/;
const DIGIT = /\d/;
const COMMA = 0x2c;

const isDigitAt = (s: string, i: number): boolean => {
  const c = s.charCodeAt(i);
  return c >= 0x30 && c <= 0x39;
};
const isLetterAt = (s: string, i: number): boolean => {
  const c = s.charCodeAt(i);
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
};
/** A comma at `i` with a digit on both sides: inside a run of digits and commas. */
const runCommaAt = (s: string, i: number): boolean =>
  s.charCodeAt(i) === COMMA && isDigitAt(s, i - 1) && isDigitAt(s, i + 1);

/** Whether the code unit `c` may live inside a piece (a comma never does). */
function inPiece(c: number): boolean {
  return (
    (c >= 0x30 && c <= 0x39) || // 0-9
    (c >= 0x41 && c <= 0x5a) || // A-Z
    (c >= 0x61 && c <= 0x7a) || // a-z
    c === 0x3a || // :
    c === 0x5f || // _
    c === 0x2d || // -
    c === 0x2f || // /
    c === 0x2e || // .
    c === 0x25 || // %
    c === 0x2b || // +
    c === 0x40 || // @
    c === 0x23 || // #
    c === 0x24 // $
  );
}

/** `text` with every backslash escape made spaces of its own length, so offsets stay put. */
const blankEscapes = (text: string): string =>
  text.includes('\\') ? text.replace(ESCAPE, (escape) => ' '.repeat(escape.length)) : text;

/** Rules 1–3 on one piece, in the form every side compares on: the token, or `undefined`. */
function tokenOf(raw: string): string | undefined {
  const v = raw.toLowerCase().replace(LEADING, '');
  let end = v.length;
  while (end > 0 && TRAILING.includes(v[end - 1] as string)) end--;
  const piece = v.slice(0, end);
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

/**
 * One rough run's pieces, split at every comma, each read by rules 1–3 — but for the groups of a
 * number written with thousands separators (the pieces after its first comma), which are never
 * read. Returns how many such numbers the run holds.
 */
function readRough(rough: string, into: (token: string) => void): number {
  // Each grouped number as [its first comma, the end of its last group's piece].
  const groups: number[] = [];
  for (let i = 0; i < rough.length; ) {
    if (!isDigitAt(rough, i)) {
      i++;
      continue;
    }
    const start = i;
    while (i < rough.length && (isDigitAt(rough, i) || runCommaAt(rough, i))) i++;
    if (!(start > 0 && isLetterAt(rough, start - 1)) && GROUPED.test(rough.slice(start, i))) {
      const end = rough.indexOf(',', i);
      groups.push(rough.indexOf(',', start), end === -1 ? rough.length : end);
    }
  }
  let k = 0;
  let at = 0;
  for (const piece of rough.split(',')) {
    while (k < groups.length && (groups[k + 1] as number) <= at) k += 2;
    if (!(k < groups.length && (groups[k] as number) < at)) {
      const token = tokenOf(piece);
      if (token !== undefined) into(token);
    }
    at += piece.length + 1;
  }
  return groups.length / 2;
}

/** Every token of a text whose escapes are blanked, duplicates kept; returns the grouped count. */
function readPieces(text: string, into: (token: string) => void): number {
  let grouped = 0;
  for (const [rough] of text.matchAll(ROUGH)) grouped += readRough(rough, into);
  return grouped;
}

/** Every distinct token of `text`, in first-seen order, with no cap. */
export function tokensOf(text: string): string[] {
  const seen = new Set<string>();
  readPieces(blankEscapes(text), (token) => void seen.add(token));
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
  return readTokensUpTo(text, LEDGER_LIMITS.maxTextBytes);
}

/**
 * `readTokens` under another byte cap, `maxBytes` (a whole number). The
 * receipt's cap is `maxTextBytes`; a smaller one reads less, by the same law.
 */
export function readTokensUpTo(text: string, maxBytes: number): LedgerTokenReading {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new RangeError('readTokensUpTo: maxBytes must be a whole number');
  // One pass counts every character's bytes and finds where the cap falls; nothing past it is read.
  let readUnits = 0;
  let readBytes = 0;
  let bytes = 0;
  for (let i = 0; i < text.length; ) {
    const step = bytesAt(text, i);
    const units = step === 4 ? 2 : 1;
    bytes += step;
    if (bytes <= maxBytes) {
      readUnits = i + units;
      readBytes = bytes;
    }
    i += units;
  }
  let read = blankEscapes(text.slice(0, readUnits));
  // A cut text's last piece is kept only when a separator follows it within the bytes read.
  if (readUnits < text.length) {
    let start = read.length;
    while (start > 0 && inPiece(read.charCodeAt(start - 1))) start--;
    readBytes -= read.length - start; // a piece character is ASCII: one byte
    read = read.slice(0, start);
  }
  const seen = new Set<string>();
  const groupedNumbers = readPieces(read, (token) => void seen.add(token));
  const all = [...seen];
  const tokens: string[] = [];
  for (const token of all) {
    if (tokens.length === LEDGER_LIMITS.maxTokens) break;
    if (token.length <= LEDGER_LIMITS.maxTokenChars) tokens.push(token);
  }
  const tokensDropped = all.length - tokens.length;
  const bytesUnread = bytes - readBytes;
  Object.freeze(tokens);
  return Object.freeze({
    tokens,
    bytes,
    ...(tokensDropped > 0 || bytesUnread > 0
      ? { cut: Object.freeze({ tokensDropped, bytesUnread }) }
      : {}),
    ...(groupedNumbers > 0 ? { groupedNumbers } : {}),
  });
}
