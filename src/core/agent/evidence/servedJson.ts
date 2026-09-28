/**
 * servedJson — a served tool result's JSON, read by the JSON grammar when the
 * whole text is NOT one JSON value.
 *
 * Pattern: two pure readers over the JSON grammar (no imports, no state, no
 *          clock): `leadingJsonValues` (the complete values a text OPENS
 *          with, and the text after them) and `jsonPrefixOf` (the leaves of
 *          JSON text cut short, token by token, and the whole words of a
 *          string the cut falls inside).
 * Role:    core/ layer, `evidence/`. Asked by `evidenceIndex.ts` ·
 *          `readResult` — the ONE reading of a result that the evidence index
 *          and the inputs layer's declared-sources check
 *          (`resultCarries.ts` · `resultReader`) share.
 * Emits:   N/A.
 *
 * ## Why a served result is not always one JSON value
 *
 * The dispatch loop serves a tool's value as JSON and joins framework notes
 * AFTER it — a stepped skill's step banner, an effect note, the repeated-call
 * note (`stages/toolCalls.ts`); an MCP text result joins its content blocks
 * with a newline (`lib/mcp/toolResult.ts` · `readTextResult`); and a capped
 * result's `head` is the first characters of the tool's JSON, cut mid-value
 * (`toolResultCap.ts`). `JSON.parse` refuses all of these, and the text
 * fallback tokenises `{"id":4417,"up":true}` into `id`, `:4417`, `up`,
 * `:true` — so every number and boolean the tool returned read as ABSENT: the
 * evidence gate's false flag on an answer that quoted one, and the
 * declared-sources check's false `not-in-result` on a value the model took
 * from one (then a needless ask). So the tool's JSON is read by the JSON
 * grammar as far as it goes, and only what follows it is text.
 *
 * The extent of a value is found the way `findings/unsettled.ts` ·
 * `leadingObjectOf` finds the served envelope — strings and their escapes
 * skipped, brackets counted — and each span is parsed once, guarded.
 */

/** Characters that separate JSON tokens outside a string. */
const DELIMITERS = new Set(['{', '}', '[', ']', ',', ':', '"']);

/** JSON's number grammar — a literal that matches is a number. */
const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

const isSpace = (ch: string | undefined): boolean =>
  ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t';

function skipSpace(text: string, from: number): number {
  let at = from;
  while (at < text.length && isSpace(text[at])) at += 1;
  return at;
}

/**
 * The end (exclusive) of the bracketed JSON value that starts at `start` —
 * strings and their escapes skipped, brackets counted; `-1` when the text ends
 * before it closes.
 */
function valueEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      depth += 1;
    } else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** `JSON.parse`, guarded — `{ ok: false }` for text that is not one JSON value. */
function parseOne(
  text: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * The complete JSON values `text` OPENS with — an object or an array, then
 * any further ones separated by whitespace (the blocks of an MCP text result)
 * — and the text after the last of them (`rest`, which starts at its first
 * non-space character; `''` when nothing follows). `values` is empty when the
 * text does not open with a complete, parseable value.
 *
 * @example
 * ```ts
 * leadingJsonValues('{"id":4417}\n{"id":2210}\n\n[identical call: …]');
 * // { values: [{ id: 4417 }, { id: 2210 }], rest: '[identical call: …]' }
 * ```
 */
export function leadingJsonValues(text: string): {
  readonly values: readonly unknown[];
  readonly rest: string;
} {
  const values: unknown[] = [];
  let at = skipSpace(text, 0);
  while (at < text.length && (text[at] === '{' || text[at] === '[')) {
    const end = valueEnd(text, at);
    if (end < 0) break;
    const read = parseOne(text.slice(at, end));
    if (!read.ok) break;
    values.push(read.value);
    at = skipSpace(text, end);
  }
  return { values, rest: text.slice(at) };
}

/** What JSON text CUT SHORT reads as (`jsonPrefixOf`). */
export interface JsonPrefix {
  /**
   * Every complete string (a key or a value) and every complete number and
   * boolean, in order, each as the string the parsed walk would index
   * (`String(4417)`, `'true'`); `null` is not a leaf.
   */
  readonly leaves: readonly string[];
  /**
   * When the text ends inside a string: its WHOLE words — the string up to the
   * last space before the cut, unescaped (`"msg":"disk full on host-7 and mo`
   * → `disk full on host-7 and`). Text, never a leaf: it is not the whole
   * string. Absent when no whole word is left.
   */
  readonly words?: string;
}

/**
 * JSON text CUT SHORT — an object or an array whose text ends before it
 * closes (a capped result's `head`, a result a tool truncated itself) — read
 * by the JSON grammar as far as it goes: its complete leaves, in order, and,
 * when the text ends inside a string, that string's whole words (`words`).
 * The token the text ends inside is never a leaf — it may be cut (`4417` cut
 * at `44` is not the value `44`) — and the word a cut string ends in is never
 * one of its words (`mo` may be `more`).
 *
 * `undefined` when the text is not JSON cut short: it does not open with `{`
 * or `[`, a token is not a JSON token (`[INFO] …`, `{level=info`) — the one
 * the text ends inside not even the beginning of one — a closing bracket does
 * not match, or the value CLOSES: a complete value that did not parse is not
 * JSON at all. Such text is read as text.
 *
 * @example
 * ```ts
 * jsonPrefixOf('{"hosts":[{"id":4417,"up":true},{"id":22');
 * // { leaves: ['hosts', 'id', '4417', 'up', 'true', 'id'] }
 * jsonPrefixOf('{"id":4417,"msg":"disk full on host-7 and mo');
 * // { leaves: ['id', '4417', 'msg'], words: 'disk full on host-7 and' }
 * ```
 */
export function jsonPrefixOf(text: string): JsonPrefix | undefined {
  let at = skipSpace(text, 0);
  if (text[at] !== '{' && text[at] !== '[') return undefined;
  const leaves: string[] = [];
  const open: string[] = [];
  while (at < text.length) {
    const ch = text[at] as string;
    if (isSpace(ch) || ch === ',' || ch === ':') {
      at += 1;
    } else if (ch === '{' || ch === '[') {
      open.push(ch === '{' ? '}' : ']');
      at += 1;
    } else if (ch === '}' || ch === ']') {
      if (open.pop() !== ch || open.length === 0) return undefined;
      at += 1;
    } else if (ch === '"') {
      const end = stringEnd(text, at);
      if (end < 0) {
        // The text ends inside this string: not a complete leaf — its whole words are text.
        const words = wholeWordsOf(text.slice(at + 1));
        return words === undefined ? { leaves } : { leaves, words };
      }
      const read = parseOne(text.slice(at, end));
      if (!read.ok) return undefined;
      leaves.push(read.value as string);
      at = end;
    } else {
      let end = at;
      while (end < text.length && !DELIMITERS.has(text[end] as string) && !isSpace(text[end])) {
        end += 1;
      }
      const literal = text.slice(at, end);
      // The text ends inside this literal: it may be cut — but only a JSON
      // literal's beginning can be (`tr`, `-4`, `1.5e`); anything else is not JSON.
      if (end === text.length) return isLiteralStart(literal) ? { leaves } : undefined;
      if (literal === 'true' || literal === 'false') leaves.push(literal);
      else if (JSON_NUMBER.test(literal)) leaves.push(String(Number(literal)));
      else if (literal !== 'null') return undefined;
      at = end;
    }
  }
  return { leaves };
}

/**
 * The whole words of a string literal's body cut short (the characters after
 * its opening quote): the body up to its LAST space, read as a JSON string. A
 * space cannot sit inside an escape, so that part is complete; the word the
 * cut may have split — and anything glued to it without a space — is left
 * out. `undefined` when nothing but that word is left, or the part does not
 * read as a JSON string (an escape the grammar refuses).
 */
function wholeWordsOf(body: string): string | undefined {
  const lastSpace = body.lastIndexOf(' ');
  if (lastSpace < 0) return undefined;
  const read = parseOne(`"${body.slice(0, lastSpace)}"`);
  if (!read.ok) return undefined;
  const words = read.value as string;
  return words.trim() === '' ? undefined : words;
}

/** The beginning of a JSON number: `-`, `4`, `1.`, `1.5e`, `1.5e-`, `12e+3`. */
const NUMBER_START = /^-?(?:\d+(?:\.\d*)?(?:[eE][+-]?\d*)?)?$/;

/** Whether `literal` is the beginning of a JSON literal — a number, `true`, `false` or `null`, cut. */
function isLiteralStart(literal: string): boolean {
  return (
    'true'.startsWith(literal) ||
    'false'.startsWith(literal) ||
    'null'.startsWith(literal) ||
    NUMBER_START.test(literal)
  );
}

/** The end (exclusive) of the string literal opening at `start`; `-1` when the text ends inside it. */
function stringEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') i += 1;
    else if (ch === '"') return i + 1;
  }
  return -1;
}
