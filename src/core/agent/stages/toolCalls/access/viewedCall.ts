import { hiddenArgNames, shownArgsOf } from '../../../../toolShownArgs.js';
import type { ToolArgs } from '../../../../../tools/runChain.js';

/** What a check-in shows the person, and the argument names that view hides. */
export interface ViewedCall {
  /** A frozen copy of the tool's view of the call; `undefined` when no copy can be made. */
  readonly shown?: ToolArgs;
  /** The names the view hides (`toolShownArgs.ts` · `hiddenArgNames`), frozen; `[]` for none. */
  readonly hiddenArgs?: readonly string[];
}

/**
 * Run the tool's argument view ONCE for a check-in, on the call's shared
 * frozen copy (`viewOf`), and read the hidden names from that same output.
 *
 * Why on the frozen copy: the view is the tool author's code, and the
 * arguments the call RUNS with are bound right after (`mintConsentRequest`).
 * A view that wrote into its input would otherwise change what runs; on a
 * frozen copy the write throws, and a view that throws hides every argument
 * (`shownArgsOf`). Why once: the person is told about the output they are
 * shown, not about a second run of the view.
 *
 * Example — a wire tool whose view hides `to`:
 *   viewedCall(tool, viewOf, { to: 'acct-9', amount: 5 })
 *     → { shown: { to: 'REDACTED', amount: 5 }, hiddenArgs: ['to'] }
 */
export function viewedCall(
  tool: unknown,
  viewOf: (source: ToolArgs) => ToolArgs | undefined,
  callArgs: ToolArgs,
): ViewedCall {
  const input = viewOf(callArgs) ?? callArgs;
  const raw = shownArgsOf(tool, input);
  const hiddenArgs = Object.freeze([...hiddenArgNames(tool, input, raw)]);
  const shown = viewOf(raw);
  return shown === undefined ? { hiddenArgs } : { shown, hiddenArgs };
}
