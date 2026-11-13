/**
 * The fixed words a person reads in `TOOL_CALL_RESULT` for a call that ended
 * in an error, under the default `toolErrors: 'withheld'`.
 *
 * WHY. The record's result for such a call is the thrown text, which may hold
 * a connection string, a path or a provider's response body, so a page gets
 * fixed words instead. But "The tool failed." is false for a call that never
 * reached a tool: the model named a tool that does not exist, its arguments
 * failed the schema, a credential was blocked. Whether the call's tool ran is
 * read off its `tool_end` by the one reader every other reader asks
 * (`semantics/toolRan.ts` · `toolRanOf`), so the page and the answer account
 * cannot disagree about it.
 *
 * @example failedCallWords({ error: true, entered: false }) // 'The call was not executed.'
 * @example failedCallWords({ error: true, entered: true })  // 'The tool failed.'
 */

import { toolRanOf, type ToolRanFields } from '../semantics/toolRan.js';

/** Said for a failed call whose tool ran, or whose record does not say. */
export const AG_UI_TOOL_FAILED = 'The tool failed.';

/** Said for a failed call whose tool's function was never entered. */
export const AG_UI_TOOL_NOT_EXECUTED = 'The call was not executed.';

/** The fixed words for one failed call's `tool_end` bracket. */
export function failedCallWords(bracket: ToolRanFields): string {
  return toolRanOf(bracket) === 'not-run' ? AG_UI_TOOL_NOT_EXECUTED : AG_UI_TOOL_FAILED;
}
