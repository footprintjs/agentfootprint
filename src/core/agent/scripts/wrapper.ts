/**
 * scripts/wrapper — the Markdown wrapper the library puts around a program,
 * with both of its line terminators pinned.
 *
 * Pattern: pure leaf. The renderer half of the wrapper law; the reader half is
 *          `../evidence/codeRegions.ts`, and the two agree byte for byte
 *          (`test/core/agent/evidence/script-wrapper.test.ts`).
 * Role:    core/ layer leaf, asked by the attachment (`attachment.ts`).
 * Emits:   N/A.
 *
 * THE LAW (design § 4.2, § 5.2). The fence is `max(3, longestRun + 1)`
 * backticks, where `longestRun` is the longest run of backticks inside the
 * program (the CommonMark closing rule), so a program that holds ```` ``` ````
 * cannot close the library's block early. The renderer writes the opening
 * fence line, ONE LF, the program's bytes unchanged, ONE LF, then the closing
 * fence line. The two LFs are the wrapper's; what sits between them is the
 * program exactly — so a program ending in a line break shows an empty line
 * before the closing fence, and a program ending in a lone CR, in LF or in
 * CRLF reads back unchanged.
 *
 * @example
 * ```ts
 * wrapProgram('print(1)', 'python');      // '```python\nprint(1)\n```'
 * fenceFor('s = "```"');                   // '````'
 * codeRegionsOf(wrapProgram(p)).regions[0].content === p; // for every p
 * ```
 */

/** The longest run of backticks in `text` — one linear pass. */
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

/** The fence for `program`: `max(3, longestRun + 1)` backticks. */
export function fenceFor(program: string): string {
  return '`'.repeat(Math.max(3, longestBacktickRun(program) + 1));
}

/**
 * The program inside the library's fence: opening line (fence + `language` as
 * the info string), LF, the program unchanged, LF, closing fence. `language`
 * is a declared token (`tools/script.ts` refuses a backtick or line break in
 * it), so the info string cannot end the opening line early.
 */
export function wrapProgram(program: string, language?: string): string {
  const fence = fenceFor(program);
  return `${fence}${language ?? ''}\n${program}\n${fence}`;
}
