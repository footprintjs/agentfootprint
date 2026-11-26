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
 * everything else separates. Leading `$ # @ +` and trailing `. , ; : ! ? %`
 * are decoration. A JSON key's colon is a separator (`{"total":1200}` gives
 * `1200`, never `:1200`).
 *
 * A comma separates values — logs and tools answer in CSV — except inside a
 * THOUSANDS-GROUPED number: a run of digits and commas that matches
 * `\d{1,3}(,\d{3})+` exactly and is not glued to a letter before it. There the
 * commas are folded out: `41,200` is `41200`, and so are `$41,200`,
 * `41,200ms` and `-41,200.5`'s number. Every other comma separates:
 * `1200,9750` is `1200` and `9750`, `host-a,1200,ok` is three pieces, and so
 * are identifiers joined by commas (`esx01a,esx02b`, `host1,234`). This
 * departs on purpose from the agent's own extractor, which keeps `1200,9750`
 * as one piece and so sees neither value; the differential against it lists
 * this as a known difference.
 *
 * A text that is ONE JSON object or array (`isJsonValue`, JSON's grammar in
 * one pass) is read value by value instead: every string literal and key as
 * text, every number literal as written. Which way a text is read is decided
 * on the WHOLE text, also when the byte cap reads only its start, which is
 * then read the same way up to its last whole literal — so a cut reading can
 * never keep a token the whole text does not hold.
 *
 * ## The caps (`limits.ts`)
 *
 * `readTokens` reads at most `maxTextBytes` UTF-8 bytes; the rest is counted in
 * `cut.bytesUnread`, never read. A cut never keeps a piece of a value: a piece
 * the byte cap falls in — or one that what follows could still change, such as
 * the digits of a thousands-grouped number — is left unread with the rest, and
 * so is a JSON string the cap falls inside. It keeps the first `maxTokens`
 * distinct tokens in first-seen order; every other distinct token — past the
 * cap, or longer than `maxTokenChars` — is counted in `cut.tokensDropped`. A
 * reading that kept everything has no `cut`. Nothing read is dropped uncounted.
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
const LEADING = /^[$#@+'"`([{<]+/;
const TRAILING = '.,;:!?%\'"`)]}>';
const THOUSANDS_RUN = /^\d{1,3}(?:,\d{3})+$/;
const RATIO = /^\d{1,2}\/\d{1,2}$/;
const WITH_TAIL = /^([-+]?\d+(?:\.\d+)?)[-/]?[a-z]{1,5}(?:\/[a-z]{1,5})?$/;
const NUMBER = /^[-+]?\d+(?:\.\d+)?$/;
const STRUCTURAL = /[:_\-/.]/;
const LETTER = /[a-z]/;
const DIGIT = /\d/;
const JSON_NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const JSON_WORDS = ['true', 'false', 'null'];
/** A number in JSON's own spelling: no leading zero, no bare dot, no sign but a leading minus. */
const JSON_STRICT_NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const JSON_SPACE = ' \t\n\r';
const COMMA = 0x2c;
const QUOTE = 0x22;
const BACKSLASH = 0x5c;

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
  const v = raw.toLowerCase().replace(LEADING, '');
  let end = v.length;
  while (end > 0 && TRAILING.includes(v[end - 1] as string)) end--;
  return v.slice(0, end);
}

/**
 * One rough token's pieces, split at every comma but those of a thousands-grouped number — a
 * run of digits and commas matching `\d{1,3}(,\d{3})+` exactly, not glued to a letter — whose
 * commas are folded out. No piece holds a comma.
 */
function piecesOf(rough: string): string[] {
  if (!rough.includes(',')) return [rough];
  let out = '';
  for (let i = 0; i < rough.length; ) {
    if (!isDigitAt(rough, i)) {
      out += rough.charCodeAt(i) === COMMA ? ' ' : rough[i];
      i++;
      continue;
    }
    let end = i;
    while (end < rough.length && (isDigitAt(rough, end) || runCommaAt(rough, end))) end++;
    const run = rough.slice(i, end);
    const glued = i > 0 && isLetterAt(rough, i - 1);
    out += !glued && THOUSANDS_RUN.test(run) ? run.replace(/,/g, '') : run.replace(/,/g, ' ');
    i = end;
  }
  return out.split(' ');
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
    for (const piece of piecesOf(rough)) {
      const token = classify(spelling(piece));
      if (token !== undefined) into(token);
    }
  }
}

/**
 * The index after the JSON string literal that opens at `i`, or -1 when it is
 * not one: it never closes, holds a raw control character, or an escape JSON
 * does not have.
 */
function jsonStringEnd(text: string, i: number): number {
  for (let j = i + 1; j < text.length; ) {
    const c = text.charCodeAt(j);
    if (c === QUOTE) return j + 1;
    if (c < 0x20) return -1;
    if (c !== BACKSLASH) j++;
    else if ('"\\/bfnrt'.includes(text[j + 1] ?? '')) j += 2;
    else if (text[j + 1] === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(j + 2, j + 6))) j += 6;
    else return -1;
  }
  return -1;
}

/**
 * Whether `text` is ONE JSON object or array, by JSON's own grammar, followed
 * token by token with a bracket stack: a value, then only `,` or a closer (`:`
 * after a key), never two values side by side, numbers and strings in JSON's
 * own spelling, nothing after the last closer but white space. One pass,
 * nothing built. It decides how a text is read — the WHOLE text, also when a
 * byte cap reads only its start, so a cut reading and the whole text are read
 * the same way. Prose that merely opens with a bracket
 * (`[2026-11-25 10:00:00] GET 200`) is prose.
 */
export function isJsonValue(text: string): boolean {
  const stack: string[] = [];
  let want: 'value' | 'value-or-close' | 'key' | 'key-or-close' | 'colon' | 'after' = 'value';
  let i = 0;
  const skip = (): void => {
    while (i < text.length && JSON_SPACE.includes(text[i] as string)) i++;
  };
  skip();
  if (text[i] !== '{' && text[i] !== '[') return false;
  for (; i < text.length; skip()) {
    const c = text[i] as string;
    const top = stack[stack.length - 1];
    if (want === 'after') {
      if (top === undefined) return false; // the value is whole: nothing else may follow
      if (c === ',') want = top === '[' ? 'value' : 'key';
      else if ((c === ']' && top === '[') || (c === '}' && top === '{')) stack.pop();
      else return false;
      i++;
    } else if (want === 'colon') {
      if (c !== ':') return false;
      want = 'value';
      i++;
    } else if (want === 'key' || want === 'key-or-close') {
      if (c === '}' && want === 'key-or-close') {
        stack.pop();
        want = 'after';
        i++;
      } else if (c === '"') {
        i = jsonStringEnd(text, i);
        if (i === -1) return false;
        want = 'colon';
      } else return false;
    } else if (c === ']' && want === 'value-or-close') {
      stack.pop();
      want = 'after';
      i++;
    } else if (c === '{' || c === '[') {
      stack.push(c);
      want = c === '{' ? 'key-or-close' : 'value-or-close';
      i++;
    } else if (c === '"') {
      i = jsonStringEnd(text, i);
      if (i === -1) return false;
      want = 'after';
    } else if (c === '-' || isDigitAt(text, i)) {
      JSON_STRICT_NUMBER.lastIndex = i;
      const literal = JSON_STRICT_NUMBER.exec(text)?.[0];
      if (literal === undefined) return false;
      i += literal.length;
      want = 'after';
    } else {
      const word = JSON_WORDS.find((w) => text.startsWith(w, i));
      if (word === undefined) return false;
      i += word.length;
      want = 'after';
    }
  }
  return want === 'after' && stack.length === 0;
}

/**
 * Read a JSON object or array — or the start of one, a byte cap having cut it
 * — value by value: string literals and keys as prose, number literals as
 * written. Called only when the whole text is one JSON value. A string the
 * cut fell inside is left unread: returns how many code units were read.
 */
function jsonValues(text: string, into: (token: string) => void): number {
  for (let i = 0; i < text.length; ) {
    const c = text.charCodeAt(i);
    if (c === QUOTE) {
      let end = i + 1;
      while (end < text.length && text.charCodeAt(end) !== QUOTE)
        end += text.charCodeAt(end) === BACKSLASH ? 2 : 1;
      if (end >= text.length) return i; // the cut fell inside this string
      proseTokens(JSON.parse(text.slice(i, end + 1)) as string, into);
      i = end + 1;
    } else if (c === 0x2d || isDigitAt(text, i)) {
      JSON_NUMBER.lastIndex = i;
      const literal = JSON_NUMBER.exec(text)?.[0] ?? text.slice(i, i + 1);
      const token = classify(spelling(literal));
      if (token !== undefined) into(token);
      i += literal.length;
    } else i++;
  }
  return text.length;
}

/** Every distinct token of `text`, in first-seen order, with no cap. */
export function tokensOf(text: string): string[] {
  const seen = new Set<string>();
  const add = (token: string): void => void seen.add(token);
  if (isJsonValue(text)) jsonValues(text, add);
  else proseTokens(text, add);
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
 * Whether a run of digits and commas could still turn out a thousands-grouped
 * number: never when it is glued to a letter; when it ends before the cap,
 * exactly when it is one; when the cap cut it, while what is visible can still
 * be the start of one.
 */
function mayFold(run: string, glued: boolean, open: boolean): boolean {
  if (glued) return false;
  if (!open) return THOUSANDS_RUN.test(run);
  const groups = run.split(',');
  const first = groups[0] as string;
  const last = groups[groups.length - 1] as string;
  return (
    first.length >= 1 &&
    first.length <= 3 &&
    groups.slice(1, -1).every((g) => g.length === 3) &&
    last.length <= 3
  );
}

/**
 * How much of `p` — the part of a token run before the cap — is settled:
 * every piece before it reads the same whatever follows the cap. A comma
 * settles what is before it when it separates values whatever comes next: one
 * not inside a run of digits, or one inside a run that cannot fold. One pass.
 */
function settledLength(p: string): number {
  let settled = 0;
  for (let i = 0; i < p.length; ) {
    if (!isDigitAt(p, i)) {
      if (p.charCodeAt(i) === COMMA) settled = i + 1;
      i++;
      continue;
    }
    // A run of digits and the commas between them; a comma right at the cap may yet be one.
    const start = i;
    let lastComma = -1;
    while (i < p.length) {
      if (isDigitAt(p, i)) i++;
      else if (
        p.charCodeAt(i) === COMMA &&
        isDigitAt(p, i - 1) &&
        (i + 1 === p.length || isDigitAt(p, i + 1))
      )
        lastComma = i++;
      else break;
    }
    const glued = start > 0 && isLetterAt(p, start - 1);
    const run = p.slice(start, i);
    if (lastComma === -1 || mayFold(run, glued, i === p.length)) continue;
    // The run cannot fold, so every one of its commas separates. But the settled part is read on
    // its own: what it keeps of the run must not fold there either (`120,975,` of
    // `120,975,300,1234-5` would). Then settle after the run's FIRST comma — one group alone never
    // folds — rather than after its last.
    const before = run.slice(0, lastComma - start);
    settled = mayFold(before, glued, false) ? start + run.indexOf(',') + 1 : lastComma + 1;
  }
  return settled;
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
  // The cap fell inside a token run: keep only the pieces of it nothing after the cap can change.
  if (readUnits < text.length && intra(text.charCodeAt(readUnits))) {
    let start = readUnits;
    while (start > 0 && intra(text.charCodeAt(start - 1))) start--;
    const settled = start + settledLength(text.slice(start, readUnits));
    readBytes -= readUnits - settled; // a token character is ASCII: one byte
    readUnits = settled;
  }
  const seen = new Set<string>();
  const add = (token: string): void => void seen.add(token);
  // Read the part read the way the WHOLE text is read: as JSON only when the whole is one value.
  const prefix = text.slice(0, readUnits);
  if (!isJsonValue(text)) proseTokens(prefix, add);
  else {
    const read = jsonValues(prefix, add);
    if (read < prefix.length) {
      readBytes -= utf8Bytes(prefix.slice(read)); // a JSON string the cut fell inside: unread
      readUnits = read;
    }
  }
  const all = [...seen];
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
