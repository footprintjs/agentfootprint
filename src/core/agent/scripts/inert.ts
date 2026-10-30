/**
 * scripts/inert — a dynamic value (a tool's name, a provider's call id) written
 * into a library line as an inline code span that cannot leave its line.
 *
 * Pattern: pure leaf.
 * Role:    core/ layer leaf, asked by the attachment's lines (`attachment.ts`)
 *          for every name and id they print.
 * Emits:   N/A.
 *
 * THE RULE. A provider may hand the library any string as a call id: line
 * breaks, a sentence, a fence. Interpolated as it is, a blank line in an id ends
 * the library's label paragraph, and the rest of the id renders as a paragraph
 * of its own — text nobody checked, under the answer, in the library's voice.
 * So a value is written as inline code:
 *
 * - every character that can end a line, turn the line's direction or hide
 *   (C0 and C1 controls, DEL, U+2028 and U+2029, format characters such as a
 *   bidi override or a zero-width joiner, a lone surrogate) is written as
 *   `\u{…}`, its code point in hex;
 * - at most {@link MAX_INERT_POINTS} code points are written, then `…`;
 * - the delimiter is one backtick longer than the longest run inside, with a
 *   space at either end when the value begins or ends with a backtick or a
 *   space (CommonMark's code-span rule), so nothing inside can close it.
 *
 * Inside a code span nothing is Markdown: no emphasis, no link, no HTML, no
 * line ending. The value is shown, never interpreted.
 *
 * @example
 * ```ts
 * inertCode('c1');                         // '`c1`'
 * inertCode('c1\n\nRevenue was 98765.');   // '`c1\u{a}\u{a}Revenue was 98765.`'
 * inertCode('a`b');                        // '``a`b``'
 * ```
 */

/** Code points of a value written; the rest is `…`. */
export const MAX_INERT_POINTS = 64;

const FORMAT = /\p{Cf}/u;

/** Whether one code point must be written as `\u{…}`. */
function escapes(point: number, char: string): boolean {
  if (point < 0x20 || point === 0x7f || (point >= 0x80 && point <= 0x9f)) return true;
  if (point === 0x2028 || point === 0x2029) return true;
  if (point >= 0xd800 && point <= 0xdfff) return true;
  return FORMAT.test(char);
}

/** The longest run of backticks in `text`. */
function longestBacktickRun(text: string): number {
  let longest = 0;
  let run = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0x60) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  return longest;
}

/** `value` as an inline code span that stays on its line. */
export function inertCode(value: string): string {
  let shown = '';
  let points = 0;
  for (const char of value) {
    if (points === MAX_INERT_POINTS) {
      shown += '…';
      break;
    }
    points += 1;
    const point = char.codePointAt(0) as number;
    shown += escapes(point, char) ? `\\u{${point.toString(16)}}` : char;
  }
  if (shown.length === 0) return '`(empty)`';
  const fence = '`'.repeat(longestBacktickRun(shown) + 1);
  const edge = (c: string | undefined): boolean => c === '`' || c === ' ';
  const pad = edge(shown[0]) || edge(shown[shown.length - 1]) ? ' ' : '';
  return `${fence}${pad}${shown}${pad}${fence}`;
}
