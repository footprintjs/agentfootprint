/**
 * innerCallOuter — what ONE call the model made holds for the inner calls its
 * tool makes through `ctx.tools`: whether it has ended, and the halt one of
 * them drew.
 *
 * Role: core/agent, beside `toolDispatch.ts`. Made by the invocation that runs
 * the outer tool (`stages/toolCalls/execution/initialInvocation.ts`, and the
 * resumed twin), handed to the dispatch and to the gates, read back when the
 * outer call settles.
 *
 * WHY IT ENDS. A tool can keep `ctx.tools` past its own `execute` — in a
 * module variable, a timer, a promise it never awaited. A call made through it
 * then would be judged with facts of a call that is over (its iteration, its
 * history) and filed under that call's id. So the outer call ENDS the binding
 * when its `execute` settles, and inner dispatch refuses every later call by
 * name — the footprintjs rule for a handle held past its stage.
 *
 * WHY A HALT WAITS. A checker's `'halt'` ends the run. For an inner call it
 * cannot end it from inside another tool's `execute`: the outer tool is still
 * running and its result is owed to the model's history (every tool call is
 * answered). So the inner call is refused at once, the first halt is kept
 * here, and the outer call's own halt path runs it after the outer call
 * settles: `permission.halt` under the inner call's id, naming the inner tool,
 * then `PolicyHaltError` — as for a model call the checker halted.
 */

import type { ToolArgs } from '../../tools/runChain.js';

/** A checker's `'halt'` on an inner call, carried to its outer call. */
export interface InnerCallHalt {
  /** The checker's telemetry tag (`PermissionDecision.reason`), never shown to the model. */
  readonly reason: string;
  /** What the model would have read for the halted call. */
  readonly tellLLM: string;
  readonly checkerId?: string;
  /** The halted inner call: its own id, tool and arguments (the copy the gates judged). */
  readonly call: {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly args: ToolArgs;
  };
}

/** One outer call's hold on its inner calls. */
export interface OuterCallBinding {
  /** `true` once the outer call's `execute` settled. */
  readonly ended: boolean;
  /** The first halt an inner call drew; `undefined` if none. */
  readonly halt: InnerCallHalt | undefined;
  /** End the binding: the outer call has settled. */
  end(): void;
  /** Keep a halt. The first one is the run's; a later one changes nothing. */
  halted(halt: InnerCallHalt): void;
}

/** A fresh binding for one outer call. */
export function bindOuterCall(): OuterCallBinding {
  let ended = false;
  let halt: InnerCallHalt | undefined;
  return {
    get ended() {
      return ended;
    },
    get halt() {
      return halt;
    },
    end() {
      ended = true;
    },
    halted(next) {
      if (halt === undefined) halt = next;
    },
  };
}
