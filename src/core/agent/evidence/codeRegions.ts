/**
 * codeRegions — the fenced code blocks of an answer, read by one linear pass.
 *
 * Pattern: pure leaf. Imports nothing — it does not know the gate exists. The
 *          one reader of "which bytes of this answer sit inside a fenced
 *          block", asked by the script match (`../scripts/match.ts`) under
 *          `.namesAndNumbersFromEvidence({ code: 'match' })`. Under the
 *          default `code: 'check'` it is never called.
 * Role:    core/ layer (the evidence gate's folder), no state, no events.
 *
 * ## The grammar (design: docs/design/2026-10-script-artifact.md § 5.1–5.2)
 *
 * Fenced blocks and nothing else, read line by line, where a line ends at LF:
 *
 * - An OPENING fence is a line that starts at column 0 with three or more
 *   backticks, or three or more tildes, then an optional info string, and that
 *   ENDS IN AN LF. A backtick fence's info string may not contain a backtick.
 * - The CLOSING fence starts at column 0, uses the same character, is at least
 *   as long, and carries nothing else but spaces (a CR before its own LF is the
 *   line's ending, not "else").
 * - The CONTENT is exactly the bytes between the opening line's LF and the ONE
 *   LF immediately before the closing line — every space, tab, CR and code
 *   point as written. A CR before that last LF is content; a CR before the
 *   opening line's LF is wrapper. A closing fence on the line right after the
 *   opening one is an empty block (content `''`).
 * - A fence that never closes is NOT a region: the text from it to the end is
 *   prose. An indented fence (any leading space — CommonMark allows three, and
 *   "as written" and "with the indentation removed" are two different byte
 *   strings), an indented code block and an inline span are prose.
 * - At most {@link MAX_CODE_REGIONS} regions are read; the rest are prose and
 *   counted in `dropped`.
 *
 * Nothing here normalizes anything: no trimming, no line-ending rewrite, no
 * Unicode normalization. A region is the program a reader would copy.
 *
 * ## Linear by construction
 *
 * The text is model output, so the pass is linear in it (the
 * `lib/linearText.ts` law, pinned by `test/security/linear-scanners.test.ts`):
 * each line is found with ONE `indexOf` from where the last one ended, and its
 * bytes are read at most twice (the fence run, then the info string or the
 * closing spaces). No regular expression runs over the answer.
 *
 * @example
 * ```ts
 * const { regions } = codeRegionsOf('Total:\n```python\nprint(1)\n```\nDone.');
 * regions[0].content; // 'print(1)'
 * regions[0].block;   // 1
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
  /** Index just past the closing fence line (past its LF when it has one). */
  readonly end: number;
  /** The bytes between the wrapper's two LFs — the program as written. */
  readonly content: string;
  /** The opening line's info string, as written (spaces and a CR excluded at the ends). */
  readonly info: string;
}

/** Every region of one answer, and how many more there were. */
export interface CodeRegions {
  readonly regions: readonly CodeRegion[];
  /** Regions past {@link MAX_CODE_REGIONS}: read as prose, never matched. */
  readonly dropped: number;
}

const BACKTICK = 0x60;
const TILDE = 0x7e;
const SPACE = 0x20;
const CR = 0x0d;

/** The run of `char` starting at `at`, never past `end`. */
function runOf(text: string, at: number, end: number, char: number): number {
  let i = at;
  while (i < end && text.charCodeAt(i) === char) i++;
  return i - at;
}

/** The line's last index (exclusive) with one trailing CR left out. */
function bodyEnd(text: string, lineStart: number, lineEnd: number): number {
  return lineEnd > lineStart && text.charCodeAt(lineEnd - 1) === CR ? lineEnd - 1 : lineEnd;
}

/** An opening fence: its character and length, or `undefined`. */
function openingAt(
  text: string,
  lineStart: number,
  lineEnd: number,
): { readonly char: number; readonly length: number; readonly info: string } | undefined {
  const char = text.charCodeAt(lineStart);
  if (char !== BACKTICK && char !== TILDE) return undefined;
  const length = runOf(text, lineStart, lineEnd, char);
  if (length < 3) return undefined;
  const infoStart = lineStart + length;
  const infoEnd = bodyEnd(text, lineStart, lineEnd);
  if (char === BACKTICK) {
    for (let i = infoStart; i < infoEnd; i++) if (text.charCodeAt(i) === BACKTICK) return undefined;
  }
  let from = infoStart;
  let to = infoEnd;
  while (from < to && text.charCodeAt(from) === SPACE) from++;
  while (to > from && text.charCodeAt(to - 1) === SPACE) to--;
  return { char, length, info: text.slice(from, to) };
}

/** Whether the line closes a fence of `char` at least `length` long. */
function closesAt(
  text: string,
  lineStart: number,
  lineEnd: number,
  char: number,
  length: number,
): boolean {
  if (text.charCodeAt(lineStart) !== char) return false;
  const run = runOf(text, lineStart, lineEnd, char);
  if (run < length) return false;
  const end = bodyEnd(text, lineStart, lineEnd);
  for (let i = lineStart + run; i < end; i++) if (text.charCodeAt(i) !== SPACE) return false;
  return true;
}

/**
 * The fenced code regions of `text`, in order, and how many past the cap.
 * Pure and linear; `max` defaults to {@link MAX_CODE_REGIONS}.
 */
export function codeRegionsOf(text: string, max: number = MAX_CODE_REGIONS): CodeRegions {
  const regions: CodeRegion[] = [];
  let dropped = 0;
  let open:
    | { readonly start: number; readonly contentStart: number; readonly char: number }
    | undefined;
  let openLength = 0;
  let openInfo = '';
  let lineStart = 0;
  while (lineStart < text.length) {
    const lf = text.indexOf('\n', lineStart);
    const lineEnd = lf === -1 ? text.length : lf;
    const next = lf === -1 ? text.length : lf + 1;
    if (open === undefined) {
      // An opening fence must end in an LF: the wrapper's first terminator.
      const opening = lf === -1 ? undefined : openingAt(text, lineStart, lineEnd);
      if (opening !== undefined) {
        open = { start: lineStart, contentStart: next, char: opening.char };
        openLength = opening.length;
        openInfo = opening.info;
      }
    } else if (closesAt(text, lineStart, lineEnd, open.char, openLength)) {
      if (regions.length < max) {
        // The ONE LF before the closing line is the wrapper's; a closing line
        // right after the opening one leaves an empty block.
        const contentEnd = Math.max(open.contentStart, lineStart - 1);
        regions.push({
          block: regions.length + 1,
          start: open.start,
          end: next,
          content: text.slice(open.contentStart, contentEnd),
          info: openInfo,
        });
      } else {
        dropped += 1;
      }
      open = undefined;
    }
    lineStart = next;
  }
  // A fence still open here never closed: prose to the end, not a region.
  return { regions, dropped };
}
