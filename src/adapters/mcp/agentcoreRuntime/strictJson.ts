/**
 * strictJson — ONE reading of a JSON text, with every ambiguity refused.
 *
 * `JSON.parse` resolves ambiguity silently: a duplicated key keeps its LAST
 * value, while another reader may keep the first. A check that reads a body one
 * way and a consumer that reads it another is a parser differential — a crafted
 * answer passes the check and is used as something else. So the transport reads
 * an answer once, here, refusing what two readers could disagree on, and hands
 * the client the canonical re-serialization of exactly the value it checked.
 *
 * Refused, by name: a duplicated object key, trailing data after the value, a
 * leading byte-order mark, nesting deeper than {@link MAX_DEPTH}, a number
 * out of range (its re-serialization would be `null`), and anything that is
 * not RFC 8259 JSON.
 *
 * Objects are built with own properties only (a `__proto__` key is data, never
 * a prototype).
 *
 * Pattern: recursive-descent parser. Role: outer ring, the one reader.
 */

/** Why a text was refused. */
export class AmbiguousJsonError extends Error {
  constructor(readonly reason: string) {
    super(`ambiguous JSON: ${reason}`);
    this.name = 'AmbiguousJsonError';
  }
}

/** How deep a value may nest. */
export const MAX_DEPTH = 256;

/** A JSON value, as read. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * The one value `text` holds.
 *
 * @throws AmbiguousJsonError when the text is not exactly one unambiguous value.
 */
export function parseStrictJson(text: string): JsonValue {
  if (text.charCodeAt(0) === 0xfeff) throw new AmbiguousJsonError('a leading byte-order mark');
  const reader = new Reader(text);
  reader.space();
  const value = reader.value(0);
  reader.space();
  if (!reader.done()) throw new AmbiguousJsonError('trailing data after the value');
  return value;
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** Characters a string may hold as they are: not a quote, a backslash or a control character. */
// eslint-disable-next-line no-control-regex
const PLAIN_RUN = /[^"\\\u0000-\u001f]+/y;

class Reader {
  private at = 0;

  constructor(private readonly text: string) {}

  done(): boolean {
    return this.at >= this.text.length;
  }

  space(): void {
    while (this.at < this.text.length) {
      const c = this.text.charCodeAt(this.at);
      if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return;
      this.at++;
    }
  }

  value(depth: number): JsonValue {
    if (depth > MAX_DEPTH) throw new AmbiguousJsonError('nesting too deep');
    const c = this.text[this.at];
    if (c === '{') return this.object(depth);
    if (c === '[') return this.array(depth);
    if (c === '"') return this.string();
    if (this.word('true')) return true;
    if (this.word('false')) return false;
    if (this.word('null')) return null;
    return this.number();
  }

  private object(depth: number): JsonValue {
    this.at++; // {
    const out: Record<string, JsonValue> = {};
    const seen = new Set<string>();
    this.space();
    if (this.text[this.at] === '}') {
      this.at++;
      return out;
    }
    for (;;) {
      this.space();
      if (this.text[this.at] !== '"')
        throw new AmbiguousJsonError('an object key that is not a string');
      const key = this.string();
      // The key is not named: it is the answer's text, and a refusal repeats none.
      if (seen.has(key)) throw new AmbiguousJsonError('a duplicated object key');
      seen.add(key);
      this.space();
      this.expect(':');
      this.space();
      Object.defineProperty(out, key, {
        value: this.value(depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
      this.space();
      if (this.text[this.at] === ',') {
        this.at++;
        continue;
      }
      this.expect('}');
      return out;
    }
  }

  private array(depth: number): JsonValue {
    this.at++; // [
    const out: JsonValue[] = [];
    this.space();
    if (this.text[this.at] === ']') {
      this.at++;
      return out;
    }
    for (;;) {
      this.space();
      out.push(this.value(depth + 1));
      this.space();
      if (this.text[this.at] === ',') {
        this.at++;
        continue;
      }
      this.expect(']');
      return out;
    }
  }

  private string(): string {
    this.at++; // opening quote
    let out = '';
    for (;;) {
      if (this.at >= this.text.length) throw new AmbiguousJsonError('an unterminated string');
      const c = this.text[this.at] as string;
      const code = c.charCodeAt(0);
      if (c === '"') {
        this.at++;
        return out;
      }
      if (code < 0x20) throw new AmbiguousJsonError('a control character inside a string');
      if (c !== '\\') {
        // A run of plain characters at once — a large string is read in slices.
        PLAIN_RUN.lastIndex = this.at;
        const run = PLAIN_RUN.exec(this.text)?.[0] ?? c;
        out += run;
        this.at += run.length;
        continue;
      }
      const e = this.text[this.at + 1];
      this.at += 2;
      if (e === 'u') {
        const hex = this.text.slice(this.at, this.at + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new AmbiguousJsonError('a malformed \\u escape');
        out += String.fromCharCode(parseInt(hex, 16));
        this.at += 4;
        continue;
      }
      const simple = ESCAPES[e ?? ''];
      if (simple === undefined) throw new AmbiguousJsonError('an unknown escape');
      out += simple;
    }
  }

  private number(): number {
    NUMBER.lastIndex = this.at;
    const match = NUMBER.exec(this.text);
    if (match === null || match[0] === '') throw new AmbiguousJsonError('a value that is not JSON');
    this.at += match[0].length;
    const value = Number(match[0]);
    // Re-serialized, a number out of range would become `null` — another value.
    if (!Number.isFinite(value)) throw new AmbiguousJsonError('a number out of range');
    return value;
  }

  private word(word: string): boolean {
    if (!this.text.startsWith(word, this.at)) return false;
    this.at += word.length;
    return true;
  }

  private expect(c: string): void {
    if (this.text[this.at] !== c) throw new AmbiguousJsonError(`a missing '${c}'`);
    this.at++;
  }
}

const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};
