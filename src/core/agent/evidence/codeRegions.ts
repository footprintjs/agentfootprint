/**
 * codeRegions — the fenced code blocks of an answer, read by one linear pass,
 * closed where a CommonMark renderer closes them.
 *
 * Pattern: pure leaf. Imports nothing — it does not know the gate exists. The
 *          one reader of "which bytes of this answer sit inside a fenced
 *          block", asked by the script match (`../scripts/match.ts`) under
 *          `.namesAndNumbersFromEvidence({ code: 'match' })`. Under the
 *          default `code: 'check'` it is never called.
 * Role:    core/ layer (the evidence gate's folder), no state, no events.
 *
 * ## Why it must agree with the renderer
 *
 * A region that matches a submission is exempt from the evidence check. If
 * this reader saw a block where a renderer shows prose, a model could submit a
 * program holding a sentence, show it fenced so that the sentence renders
 * outside the block, and the sentence would never be checked. So the reader
 * closes a block exactly where CommonMark closes it. Where a renderer could
 * pair fences another way, it stops reading blocks altogether.
 *
 * ## The grammar (design: docs/design/2026-10-script-artifact.md § 5.1–5.2, aligned with CommonMark)
 *
 * The answer is read line by line. A line ends at an LF, a CR or a CRLF, as
 * CommonMark ends it.
 *
 * - An OPENING fence starts at column 0 with three or more backticks, or three
 *   or more tildes, then an optional info string, and ENDS IN A LINE ENDING.
 *   A backtick fence's info string may not contain a backtick.
 * - The CLOSING fence uses the same character and is at least as long. As in
 *   CommonMark, it may be indented by up to three spaces and is followed only
 *   by spaces.
 * - The CONTENT is exactly the bytes between the opening line's line ending
 *   and the ONE line ending before the closing line: every space, tab, CR and
 *   code point as written. Before the closing line, an LF is the wrapper's (a
 *   CR before it is content), and so is a lone CR. A closing fence on the line
 *   right after the opening one gives an empty block (content `''`).
 * - A fence that never closes is NOT a region: the text from it to the end is
 *   prose.
 * - At most {@link MAX_CODE_REGIONS} regions are read; the rest are prose and
 *   counted in `dropped`.
 *
 * ## Where reading stops (`stoppedAt`)
 *
 * The reader models CommonMark's top level only. It does not model list
 * items, block quotes, HTML blocks or the extensions renderers add. At the
 * first line where a renderer could pair fences another way, reading STOPS.
 * No region is read from there on: everything after that point is prose and
 * checked.
 *
 * Outside a block, reading stops at:
 * - a fence indented by one to three spaces. It is either a list item's fence,
 *   which the item scopes, or an indented fence, whose content a renderer
 *   strips (and "as written" and "with the indentation removed" are two
 *   different programs);
 * - a line that may start an HTML block (up to three spaces, `<`, then a
 *   letter, `/`, `!` or `?`). Inside an HTML block, a fence is not a fence;
 * - a line opening display math (`$$`), the block extension chat renderers
 *   commonly add. Inside display math, a fence is not a fence;
 * - a byte-order mark at the very start, which some renderers drop and some
 *   keep.
 *
 * Inside a block, reading stops at:
 * - a closing run followed by a TAB. CommonMark 0.30 closes the block there
 *   and 0.29 does not, so the block is read (it is code either way) and
 *   reading stops after it;
 * - a run of the block's own fence character, anywhere in its content, as long
 *   as its opening fence. A renderer laxer than CommonMark could close the
 *   block there, so the block is prose and reading stops at its opening line.
 *   The library's own wrapper never writes such a block
 *   (`../scripts/wrapper.ts` · `fenceFor`: the longest run + 1).
 *
 * Nothing here normalizes anything: no trimming, no line-ending rewrite, no
 * Unicode normalization. A region is the program a reader would copy.
 *
 * ## Linear by construction
 *
 * The text is model output, so the pass is linear in it (the
 * `lib/linearText.ts` law, pinned by `test/security/linear-scanners.test.ts`).
 * Each line is read ONCE, character by character, from where the last one
 * ended: its indentation, its fence run, the rest of it and its line ending.
 * No regular expression runs over the answer.
 *
 * @example
 * ```ts
 * const { regions } = codeRegionsOf('Total:\n```python\nprint(1)\n```\nDone.');
 * regions[0].content; // 'print(1)'
 * regions[0].block;   // 1
 * codeRegionsOf('```\na\n  ```\nRevenue was 4321.').regions[0].content; // 'a'
 * ```
 */

/** Regions read per answer; the rest are prose and counted (`dropped`). Design § 4.4. */
export const MAX_CODE_REGIONS = 32;

/** One fenced block, as the answer wrote it. */
export interface CodeRegion {
  /** 1-based position among the regions READ, in answer order. */
  readonly block: number;
  /** Index of the opening fence line's first character. */
  readonly start: number;
  /** Index just past the closing fence line (past its line ending when it has one). */
  readonly end: number;
  /** The bytes between the wrapper's two line endings — the program as written. */
  readonly content: string;
  /** The opening line's info string, as written (spaces excluded at the ends). */
  readonly info: string;
}

/** Every region of one answer, and how many more there were. */
export interface CodeRegions {
  readonly regions: readonly CodeRegion[];
  /** Regions past {@link MAX_CODE_REGIONS}: read as prose, never matched. */
  readonly dropped: number;
  /**
   * Where reading stopped, when it did: the index of the first character no
   * region is read from. Everything from here on is prose. Absent when the
   * whole answer was read.
   */
  readonly stoppedAt?: number;
  /**
   * The opening run of a fence still open at the END (`'```'`, `'~~~~'`) —
   * the block a renderer is still inside there. The fence is prose for the
   * match; a writer that appends after this text closes it first
   * (`../scripts/attachment.ts` · `attachmentBoundary`). Never set with
   * `stoppedAt`: after a stop the reader does not know what is open.
   */
  readonly openFence?: string;
}

const BACKTICK = 0x60;
const TILDE = 0x7e;
const SPACE = 0x20;
const TAB = 0x09;
const CR = 0x0d;
const LF = 0x0a;
const LESS_THAN = 0x3c;
const DOLLAR = 0x24;
const BYTE_ORDER_MARK = 0xfeff;

/** One line, read once. */
interface Line {
  /** Index of the line's line ending (the text's length on the last line). */
  readonly end: number;
  /** Index just past its line ending. */
  readonly next: number;
  /** Whether the line ends in a line ending (the last line may not). */
  readonly terminated: boolean;
  /** Leading spaces. */
  readonly indent: number;
  /** The character after the leading spaces (-1 at the end of the line). */
  readonly first: number;
  /** The fence character the line starts with after its spaces, or 0. */
  readonly char: number;
  /** The length of that run (0 when the line starts with none). */
  readonly run: number;
  /** After the run: nothing but spaces. */
  readonly restSpaces: boolean;
  /** After the run: nothing but spaces and tabs. */
  readonly restBlank: boolean;
  /** After the run: a backtick somewhere (no backtick fence's info string holds one). */
  readonly restBacktick: boolean;
  /** After the run, without the spaces at either end: the info string's bounds. */
  readonly infoFrom: number;
  readonly infoTo: number;
  /** The longest run of the watched character anywhere on the line. */
  readonly longest: number;
}

/**
 * Read the line starting at `start`, each character once. `watch` is the fence
 * character of the block that is open (0 when none): the longest run of it on
 * the line is counted.
 */
function readLine(text: string, start: number, watch: number): Line {
  const length = text.length;
  let i = start;
  let c = i < length ? text.charCodeAt(i) : -1;
  while (c === SPACE) c = ++i < length ? text.charCodeAt(i) : -1;
  const indent = i - start;
  const first = c === CR || c === LF ? -1 : c;
  let char = 0;
  let run = 0;
  let current = 0;
  let longest = 0;
  if (c === BACKTICK || c === TILDE) {
    char = c;
    while (c === char) {
      run += 1;
      c = ++i < length ? text.charCodeAt(i) : -1;
    }
    if (watch !== 0 && char === watch) longest = current = run;
  }
  let restSpaces = true;
  let restBlank = true;
  let restBacktick = false;
  let infoFrom = -1;
  let infoTo = i;
  while (c !== -1 && c !== CR && c !== LF) {
    if (c !== SPACE) {
      restSpaces = false;
      if (c !== TAB) restBlank = false;
      if (infoFrom === -1) infoFrom = i;
      infoTo = i + 1;
    }
    if (c === BACKTICK) restBacktick = true;
    if (watch !== 0 && c === watch) {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
    c = ++i < length ? text.charCodeAt(i) : -1;
  }
  const end = i;
  let next = end;
  if (c === CR) {
    next = end + 1;
    if (next < length && text.charCodeAt(next) === LF) next += 1;
  } else if (c === LF) {
    next = end + 1;
  }
  return {
    end,
    next,
    terminated: next > end,
    indent,
    first,
    char,
    run,
    restSpaces,
    restBlank,
    restBacktick,
    infoFrom: infoFrom === -1 ? infoTo : infoFrom,
    infoTo,
    longest,
  };
}

/**
 * Whether a line outside any block could be read by a renderer as something
 * that pairs fences another way: an indented fence, an HTML block's start, or
 * display math.
 */
function unsettles(text: string, lineStart: number, line: Line): boolean {
  if (line.indent > 3) return false;
  if (line.run >= 3) return line.indent > 0;
  if (line.first !== LESS_THAN && line.first !== DOLLAR) return false;
  const second = text.charCodeAt(lineStart + line.indent + 1);
  if (line.first === LESS_THAN) {
    // A letter (an open tag), `/` (a closing tag), `!` (a comment, a
    // declaration, CDATA) or `?` (a processing instruction).
    const lower = second | 0x20;
    return (
      (lower >= 0x61 && lower <= 0x7a) || second === 0x2f || second === 0x21 || second === 0x3f
    );
  }
  return second === DOLLAR;
}

/**
 * The fenced code regions of `text`, in order, how many past the cap, and where
 * reading stopped. Pure and linear; `max` defaults to {@link MAX_CODE_REGIONS}.
 */
export function codeRegionsOf(text: string, max: number = MAX_CODE_REGIONS): CodeRegions {
  const regions: CodeRegion[] = [];
  let dropped = 0;
  if (text.length > 0 && text.charCodeAt(0) === BYTE_ORDER_MARK) {
    return { regions, dropped, stoppedAt: 0 };
  }
  let open:
    | {
        readonly start: number;
        readonly contentStart: number;
        readonly char: number;
        readonly length: number;
        readonly info: string;
      }
    | undefined;
  // The longest run of the open block's fence character in its content so far.
  let longest = 0;
  let lineStart = 0;
  while (lineStart < text.length) {
    const line = readLine(text, lineStart, open?.char ?? 0);
    if (open === undefined) {
      if (
        line.indent === 0 &&
        line.run >= 3 &&
        line.terminated &&
        !(line.char === BACKTICK && line.restBacktick)
      ) {
        open = {
          start: lineStart,
          contentStart: line.next,
          char: line.char,
          length: line.run,
          info: text.slice(line.infoFrom, line.infoTo),
        };
        longest = 0;
      } else if (unsettles(text, lineStart, line)) {
        return { regions, dropped, stoppedAt: lineStart };
      }
    } else if (
      line.indent <= 3 &&
      line.char === open.char &&
      line.run >= open.length &&
      line.restBlank
    ) {
      // A laxer renderer could have closed the block inside its content.
      if (longest >= open.length) return { regions, dropped, stoppedAt: open.start };
      if (regions.length < max) {
        // The ONE line ending before the closing line is the wrapper's: its
        // last character (the LF of an LF or a CRLF, or a lone CR). A closing
        // line right after the opening one leaves an empty block.
        const contentEnd = Math.max(open.contentStart, lineStart - 1);
        regions.push({
          block: regions.length + 1,
          start: open.start,
          end: line.next,
          content: text.slice(open.contentStart, contentEnd),
          info: open.info,
        });
      } else {
        dropped += 1;
      }
      open = undefined;
      // A tab after the run: CommonMark versions disagree on what follows.
      if (!line.restSpaces) return { regions, dropped, stoppedAt: line.next };
    } else if (line.longest > longest) {
      longest = line.longest;
    }
    lineStart = line.next;
  }
  // A fence still open here never closed: prose to the end, not a region —
  // and the block a renderer is still inside, for a writer appending after.
  if (open !== undefined) {
    return { regions, dropped, openFence: String.fromCharCode(open.char).repeat(open.length) };
  }
  return { regions, dropped };
}
