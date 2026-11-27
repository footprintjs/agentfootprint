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
 * history) and filed under that call's id. When `execute` settles, the binding
 * closes to new admissions and entry. An admission already deciding can
 * still file its verdict until the queue drains or the run is cancelled.
 *
 * WHY A HALT WAITS. A checker's `'halt'` ends the run. For an inner call it
 * cannot end it from inside another tool's `execute`: the outer tool is still
 * running and its result is owed to the model's history (every tool call is
 * answered). So the inner call is refused at once, the first halt is kept
 * here, and the outer call's own halt path runs it after the outer call
 * settles: `permission.halt` under the inner call's id, naming the inner tool,
 * then `PolicyHaltError` — as for a model call the checker halted.
 */

import type { InnerCallRan } from '../../provider-contract/innerCalls.js';
import { untilAborted } from '../../lib/abort.js';
import type { ToolArgs } from '../../tools/runChain.js';
import type { MessageRecord } from '../../provider-contract/toolResultRecord.js';

export interface ListingCapture {
  skillListingFor?: (content: string) => Pick<MessageRecord, 'skillListing'>;
}

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
  /** Aborted when the first halt is kept, for work that has already entered. */
  readonly haltSignal: AbortSignal;
  /** Run one admission at a time, including its synchronous entry boundary. */
  scheduleAdmission<T>(admit: () => Promise<T>): Promise<T>;
  /** Record the bound arguments immediately before entering an admitted tool. */
  admit(call: InnerCallRan): void;
  /** Return a detached view of calls already admitted by this owner. */
  admitted(): readonly InnerCallRan[];
  /** Keep the catalog origin at the point the built-in adapter returns it. */
  recordSkillListing(ids: readonly string[], text: string, inner: boolean): void;
  /** Close to entry, then drain admission decisions while the run is live. */
  close(signal?: AbortSignal): Promise<void>;
  /** Keep the first halt before the drain ends. True if this halt was kept. */
  halted(halt: InnerCallHalt): boolean;
}

/** A fresh binding for one outer call. */
export function bindOuterCall(capture?: ListingCapture): OuterCallBinding {
  let ended = false;
  let halt: InnerCallHalt | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  let runSignal: AbortSignal | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  const admitted: InnerCallRan[] = [];
  const listedIds = new Set<string>();
  let directListing: { readonly text: string; readonly ids: readonly string[] } | undefined;
  let derivedListing = false;
  const controller = new AbortController();
  return {
    get ended() {
      return ended;
    },
    get halt() {
      return halt;
    },
    haltSignal: controller.signal,
    scheduleAdmission(admit) {
      const next = tail.then(admit);
      // A refusal rejects its own caller without stopping later admissions.
      tail = next.catch(() => undefined);
      return next;
    },
    admit(call) {
      admitted.push(call);
    },
    admitted() {
      return structuredClone(admitted);
    },
    recordSkillListing(ids, text, inner) {
      if (capture === undefined || ended) return;
      for (const id of ids) listedIds.add(id);
      derivedListing ||= inner || directListing !== undefined;
      if (!inner) directListing = { text, ids: [...ids] };
      capture.skillListingFor = (content) => ({
        skillListing:
          !derivedListing && directListing?.text === content
            ? { kind: 'rows', ids: directListing.ids }
            : { kind: 'derived', ids: [...listedIds] },
      });
    },
    close(signal) {
      if (closing !== undefined) return closing;
      ended = true;
      runSignal = signal;
      // The tail reports completion even for a refusal. Only cancellation
      // abandons this wait, and the invocation owns reporting that cancellation.
      closing = untilAborted(tail, signal)
        .catch(() => undefined)
        .then(() => {
          closed = true;
        });
      return closing;
    },
    halted(next) {
      if (closed || runSignal?.aborted || halt !== undefined) return false;
      halt = next;
      controller.abort();
      return true;
    },
  };
}
