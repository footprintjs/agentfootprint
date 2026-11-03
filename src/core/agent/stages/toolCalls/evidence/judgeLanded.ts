import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { Classifier } from '../../../../../classify/types.js';
import type { TurnStamp } from '../../../findings/ledger.js';

/**
 * The judge's turn on ONE landed result (9.104.0) — called at the five
 * places a result joins the batch (the execute loop and the four resume
 * doors), right after the `toolResults` entry exists and before the next
 * model call. Value-gated on `deps.findingsJudge`: unarmed, or armed with
 * no judge, this is a no-op that awaits nothing. `judgeResult` never
 * throws — a failed call is an error row and the run continues.
 *
 * `ran` is the caller's word that the TOOL produced this text: a permission
 * denial, a halt, a fail-closed refusal, a declined check-in, a chain deny
 * are sentences the library wrote about a call that never ran, and a
 * denial text is not a tool result — asking a judge what it is worth for
 * the proposition would file a standing for evidence nobody collected. The
 * execute loop passes the nudge's own predicate (`executed && !denied &&
 * !skillRejected`); the resume doors pass `dispatched.executed === true`;
 * the `pauseHere` / `askHuman` door passes `true` because the person's
 * answer IS that tool's result by the handler's contract.
 */
export async function judgeLanded(
  scope: TypedScope<AgentState>,
  judge: Classifier | undefined,
  ran: boolean,
  entry: { toolName: string; result: string; toolCallId: string },
  iteration: number,
  /** The honesty layers' turn stamp — passed only while an honesty layer is armed. */
  stamp?: TurnStamp,
): Promise<void> {
  if (judge === undefined || !ran) return;
  // Dynamic import — the optional-family law of docs-next's site budget: a
  // family that exists only behind a builder option reaches the bundle
  // through `import()` at the point the option is enabled, and dispatch is
  // already async. An agent without a judge never loads `findings/judge.ts`
  // (the `selfExplain.ts · lazilyMountedTraceTools` precedent).
  const { judgeResult } = await import('../../../findings/judge.js');
  await judgeResult(
    scope as unknown as Parameters<typeof judgeResult>[0],
    judge,
    entry,
    iteration,
    scope.$getEnv().signal,
    stamp,
  );
}
