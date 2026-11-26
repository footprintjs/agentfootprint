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
 * other character separates — a backslash too — and so does every comma. A leading `$ # @ + :`
 * and a trailing `. : %` are decoration, so `{"total":1200}` gives `1200`. Nothing is folded,
 * joined, decoded or respelled but for lower case: every token is a whole piece of the lower-cased
 * text, whatever the text is — prose, CSV, JSON, JSON Lines, a path, or any part of one — and no
 * text is recognised as one kind first.
 *
 * ## A piece that reads two ways is counted, never read
 *
 * After a backslash, a piece that opens with `b f n r t u` or `/` may be a JSON escape's letter and
 * what follows it, or a path's next name: `D:\logs\node1234.log` holds `node1234.log`, or
 * `ode1234.log` after a newline. Neither reading is kept, and the piece is counted in
 * `escapedPieces` when it holds a digit (a piece without one is no value either way). So is the
 * piece right before `\/`, which JSON joins to the next one with `/`. Backslashes pair from the
 * left: `\\` and `\"` are an escaped backslash and an escaped quote, plain separators with nothing
 * ambiguous after them, and a piece after any other character (`\logs`) is read as written. A
 * receipt that counted one is incomplete (`entries.ts` · `isIncomplete`).
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
 * such a number is no visible token. An escape's own characters (`n` of `\n`, `u00e9` of `\u00e9`)
 * neither start a run nor glue one. This differs on purpose from the agent's own extractor, which
 * folds the commas out (`5,100` is `5100`) and reads one JSON value through its literals.
 *
 * ## The caps (`limits.ts`)
 *
 * `readTokens` reads at most `maxTextBytes` UTF-8 bytes. Past the cap each character is counted
 * once (`bytes`, `cut.bytesUnread`) and never read: nothing past it is copied, split or looked at
 * to decide anything. The part read ends at a separator: the last piece before the cap is kept
 * only when a separator follows it within the bytes read, and a backslash right at the cap, whose
 * meaning is the character past it, is left unread with the piece before it. It keeps the first
 * `maxTokens` distinct tokens in first-seen order;
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
  /** Present only when the part read holds pieces next to a backslash that read two ways. */
  readonly escapedPieces?: number;
}

/** A run of piece characters and commas; the commas then split it. */
const ROUGH = /[A-Za-z0-9:_\-/.,%+@#$]+/g;
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
const BACKSLASH = 0x5c;
const SLASH = 0x2f;
/** What a JSON escape opens with after its backslash, where a path's next name could too. */
const ESCAPE_LETTERS = 'bfnrtu/';
const HEX4 = /^u[0-9A-Fa-f]{4}/;

/** What a reading could not read, counted: grouped-looking numbers and pieces that read two ways. */
interface Unread {
  grouped: number;
  escaped: number;
}

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

/** Whether the backslash at `i` opens an escape: it is not the second of an escaped one (`\\`). */
function opensEscape(text: string, i: number): boolean {
  let run = 0;
  while (i - run >= 0 && text.charCodeAt(i - run) === BACKSLASH) run++;
  return run % 2 === 1;
}

/**
 * How many of the first characters of `rough` (found at `at` in `text`) are an escape's own — `n`
 * of `\n`, `u00e9` of `\u00e9` — when a backslash that opens an escape stands right before it and
 * it opens with an escape's letter; else 0.
 */
function escapeLength(text: string, at: number, rough: string): number {
  if (at === 0 || text.charCodeAt(at - 1) !== BACKSLASH || !opensEscape(text, at - 1)) return 0;
  if (!ESCAPE_LETTERS.includes(rough[0] as string)) return 0;
  return HEX4.test(rough) ? 5 : 1;
}

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
 * number written with thousands separators (the pieces after its first comma), and for a piece
 * that reads two ways: the first, after `escape` characters of an escape's own, and the last when
 * `\/` follows it (`slashAfter`). Neither is read; both are counted in `unread`.
 */
function readRough(
  rough: string,
  escape: number,
  slashAfter: boolean,
  into: (token: string) => void,
  unread: Unread,
): void {
  // Each grouped number as [its first comma, the end of its last group's piece]. An escape's own
  // characters neither start a run nor glue one.
  const groups: number[] = [];
  for (let i = escape; i < rough.length; ) {
    if (!isDigitAt(rough, i)) {
      i++;
      continue;
    }
    const start = i;
    while (i < rough.length && (isDigitAt(rough, i) || runCommaAt(rough, i))) i++;
    if (!(start > escape && isLetterAt(rough, start - 1)) && GROUPED.test(rough.slice(start, i))) {
      const end = rough.indexOf(',', i);
      groups.push(rough.indexOf(',', start), end === -1 ? rough.length : end);
    }
  }
  unread.grouped += groups.length / 2;
  const pieces = rough.split(',');
  let k = 0;
  let at = 0;
  for (let n = 0; n < pieces.length; n++) {
    const piece = pieces[n] as string;
    while (k < groups.length && (groups[k + 1] as number) <= at) k += 2;
    if ((n === 0 && escape > 0) || (n === pieces.length - 1 && slashAfter)) {
      if (DIGIT.test(piece)) unread.escaped++;
    } else if (!(k < groups.length && (groups[k] as number) < at)) {
      const token = tokenOf(piece);
      if (token !== undefined) into(token);
    }
    at += piece.length + 1;
  }
}

/** Every token of `text`, duplicates kept; what it could not read is counted in `unread`. */
function readPieces(text: string, into: (token: string) => void, unread: Unread): void {
  for (const m of text.matchAll(ROUGH)) {
    const end = m.index + m[0].length;
    const slashAfter = text.charCodeAt(end) === BACKSLASH && text.charCodeAt(end + 1) === SLASH;
    readRough(m[0], escapeLength(text, m.index, m[0]), slashAfter, into, unread);
  }
}

/** Every distinct token of `text`, in first-seen order, with no cap. */
export function tokensOf(text: string): string[] {
  const seen = new Set<string>();
  readPieces(text, (token) => void seen.add(token), { grouped: 0, escaped: 0 });
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
  let read = text.slice(0, readUnits);
  // A cut text's part read ends at a separator: a piece the cap cut is not read, nor a backslash
  // that opens an escape at the end (its meaning is the character after it) with the piece before.
  if (readUnits < text.length) {
    let end = read.length;
    for (;;) {
      while (end > 0 && inPiece(read.charCodeAt(end - 1))) end--;
      if (!(end > 0 && read.charCodeAt(end - 1) === BACKSLASH && opensEscape(read, end - 1))) break;
      end--;
    }
    readBytes -= read.length - end; // piece characters and backslashes are ASCII: one byte
    read = read.slice(0, end);
  }
  const seen = new Set<string>();
  const unread: Unread = { grouped: 0, escaped: 0 };
  readPieces(read, (token) => void seen.add(token), unread);
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
    ...(unread.grouped > 0 ? { groupedNumbers: unread.grouped } : {}),
    ...(unread.escaped > 0 ? { escapedPieces: unread.escaped } : {}),
  });
}
