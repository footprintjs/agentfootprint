import { argumentViewOf } from '../../../../toolShownArgs.js';
import type { ToolArgs } from '../../../../../tools/runChain.js';

/** What a check-in shows the person, and the argument names that view hides. */
export interface ViewedCall {
  /** A frozen copy of the tool's view of the call; `undefined` when no copy can be made. */
  readonly shown?: ToolArgs;
  /** The names the view hides (`toolShownArgs.ts` · `hiddenArgNames`), frozen; `[]` for none. */
  readonly hiddenArgs?: readonly string[];
}

/**
 * Build the display and hidden names together from the post-admission call.
 * The view receives the shared frozen copy. The request's binding still uses
 * the original arguments, kept separately for execution.
 */
export function viewedCall(
  tool: unknown,
  viewOf: (source: ToolArgs) => ToolArgs | undefined,
  callArgs: ToolArgs,
): ViewedCall {
  return argumentViewOf(tool, callArgs, viewOf(callArgs)) ?? {};
}
