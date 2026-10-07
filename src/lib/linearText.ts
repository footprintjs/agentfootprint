/**
 * linearText — trims that cost one pass, where the regex they replace costs a
 * pass PER STARTING POSITION.
 *
 * Pattern: leaf utility (imports nothing).
 * Role:    asked wherever a run of characters is trimmed from text the library
 *          did not write — base URLs and prefixes from configuration, tokens
 *          and replies from a model, words from a person. It lives here so
 *          those doors share one implementation and one test.
 * Emits:   N/A.
 *
 * ── Why these exist ─────────────────────────────────────────────────────────
 * `s.replace(/\/+$/, '')` reads as "drop the trailing slashes", but a
 * backtracking engine runs it as "at every position, take the slashes that
 * start there and see whether the string ends after them". On `'/' * n + 'x'`
 * that is n attempts of up to n steps each: 16,000 slashes take ~90 ms in V8,
 * a million take minutes, and the event loop is blocked the whole time. Any
 * `X+$` (or `[set]+$`) without a `^` has that shape. These functions walk in
 * from the end once instead — the work is the length of the run they remove,
 * plus one.
 *
 * ── The one rule ────────────────────────────────────────────────────────────
 * Each function returns EXACTLY what the regex in its comment returns, for
 * every input; only the cost differs. The equivalence and the work bound are
 * both pinned by `test/security/linear-text.test.ts`.
 *
 * ```ts
 * import { isSlash, trimTrailing } from '../lib/linearText.js';
 *
 * trimTrailing('https://api.example.com///', isSlash); // 'https://api.example.com'
 * ```
 */

/** Whether one UTF-16 code unit belongs to the run being trimmed. */
export type CharTest = (code: number) => boolean;

/** `/` — base URLs, object-key prefixes and paths. */
export const isSlash: CharTest = (code) => code === 0x2f;

/** `-` — slugs. */
export const isHyphen: CharTest = (code) => code === 0x2d;

/**
 * Exactly the code units `\s` matches in a JavaScript regular expression:
 * WhiteSpace (tab, vertical tab, form feed, space, no-break space, the
 * byte-order mark and every Unicode `Zs` space) plus LineTerminator (LF, CR,
 * U+2028, U+2029).
 */
export const isRegExpWhitespace: CharTest = (code) => {
  if (code <= 0x20) return code === 0x20 || (code >= 0x09 && code <= 0x0d);
  if (code < 0xa0) return false;
  return (
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
};

/** A test for any one of `chars` — a regex character class with no ranges. */
export function anyOf(chars: string): CharTest {
  const codes = new Set<number>();
  for (let i = 0; i < chars.length; i++) codes.add(chars.charCodeAt(i));
  return (code) => codes.has(code);
}

/** Either test — `[ab]` built from `a` and `b`. */
export function either(a: CharTest, b: CharTest): CharTest {
  return (code) => a(code) || b(code);
}

/** `s.replace(/^[run]+/, '')`, walking forward once. */
export function trimLeading(s: string, drop: CharTest): string {
  let start = 0;
  while (start < s.length && drop(s.charCodeAt(start))) start++;
  return start === 0 ? s : s.slice(start);
}

/** `s.replace(/[run]+$/, '')`, walking back from the end once. */
export function trimTrailing(s: string, drop: CharTest): string {
  let end = s.length;
  while (end > 0 && drop(s.charCodeAt(end - 1))) end--;
  return end === s.length ? s : s.slice(0, end);
}

/** `s.replace(/^[run]+|[run]+$/g, '')` — both ends, each walked once. */
export function trimBoth(s: string, drop: CharTest): string {
  return trimTrailing(trimLeading(s, drop), drop);
}
