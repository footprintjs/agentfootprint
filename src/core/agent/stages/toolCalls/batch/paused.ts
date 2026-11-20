import { splitFindings } from '../../../findings/reserved.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import {
  readCallOccurrenceKey,
  type CallOccurrenceKey,
} from '../../../../../lib/callOccurrence.js';

/**
 * The args a `pauseHere` / `askHuman` call was running with, read back on the
 * far side of the pause (8.13.0).
 *
 * Normally `scope.pausedToolArgs`: written at pause time from `callArgs`, so it
 * is the post-transform args `ToolResultContext.args` promises.
 *
 * A checkpoint written BEFORE 8.13.0 does not carry the field — a real case
 * during a rolling deploy. Those args are recovered from the assistant turn in
 * `history` by `toolCallId`: real values the model proposed, identical to the
 * running args unless a before-tool middleware transformed them, and that one
 * difference is not recoverable from a checkpoint that never recorded it.
 *
 * `{}` is the last resort and only when the turn is gone (a window strategy
 * folded it away). It is returned rather than skipping the after-tool moment,
 * because a rule that never runs is the bug this release is fixing — but it is
 * genuinely "we do not know", never a claim that the tool ran with none.
 *
 * `peel` (9.101.0, `.findings()`): the history fallback recovers the
 * EMISSION — `toolCalls[].args` keep the reserved `_findings` argument by
 * design — so under the arm it is peeled here exactly as the dispatch loop
 * peeled it; `pausedToolArgs` was set from `callArgs` and is already peeled.
 */
export function argsForPausedCall(
  scope: TypedScope<AgentState>,
  toolCallId: string,
  peel = false,
  callOccurrenceKey?: CallOccurrenceKey,
): Readonly<Record<string, unknown>> {
  const carried = scope.pausedToolArgs as Readonly<Record<string, unknown>> | undefined;
  if (carried !== undefined) return { ...carried };
  const history = scope.history as readonly LLMMessage[];
  if (callOccurrenceKey !== undefined) {
    const proposal = proposalWithOccurrence(history, toolCallId, callOccurrenceKey);
    const recovered = { ...proposal?.args };
    return peel ? splitFindings(recovered).args : recovered;
  }
  for (const message of history) {
    for (const call of message.toolCalls ?? []) {
      if (call.id === toolCallId && readCallOccurrenceKey(call) === undefined) {
        const recovered = { ...call.args };
        return peel ? splitFindings(recovered).args : recovered;
      }
    }
  }
  return {};
}

/** One call the model proposed on an assistant turn (`LLMMessage.toolCalls`). */
export type ProposedCall = NonNullable<LLMMessage['toolCalls']>[number];

export function proposalWithOccurrence(
  history: readonly LLMMessage[],
  toolCallId: string,
  callOccurrenceKey: CallOccurrenceKey,
): ProposedCall | undefined {
  const key = readCallOccurrenceKey({ callOccurrenceKey });
  if (typeof key !== 'string') return undefined;
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index];
    if (message?.role !== 'assistant') continue;
    const proposal = message.toolCalls?.find(
      (call) => call.id === toolCallId && readCallOccurrenceKey(call) === key,
    );
    if (proposal !== undefined) return proposal;
  }
  return undefined;
}

/**
 * THE PAUSED BATCH (9.113.0) — the turn that proposed the paused call, and
 * the calls on it that a pause left un-dispatched.
 *
 * The batch loop in `execute` dispatches a turn's calls one at a time, in the
 * order the model proposed them, and every pause RETURNS from inside it: the
 * checkpoint is taken on call k, and calls k+1..N were never reached — no
 * gate judged them, no tool ran, no bracket opened. The resume paths used to
 * answer call k and stop, so the next request carried N `tool_use` blocks and
 * fewer `tool_result`s (a provider builds results only from `role: 'tool'`
 * messages), and `iteration_end` counted one call.
 *
 * READ FROM `history`, NEVER CARRIED. Every pause site commits
 * `scope.history = newHistory` before it returns, so the assistant turn that
 * proposed the batch is on the checkpoint — and it is the very message a
 * provider turns into the `tool_use` blocks the settlement must answer. It is
 * therefore the one owner of "which calls does the next request carry", and
 * the checkpoint gains no key: a checkpoint written before this release
 * settles the same way. The window never removes the turn holding the paused
 * call (`../../../window/turns.ts` · `refusalFor`, its `paused-tool` arm).
 *
 * The kept occurrence identifies the paused call. For a keyless checkpoint
 * use the latest proposal with the paused ID as before. No matching turn
 * leaves nothing to settle.
 *
 * A call after the paused one that history ALREADY answers — a `role: 'tool'`
 * message for its id after that turn — is not un-dispatched, whoever wrote
 * the answer. No library door writes one before the resume; a checkpoint is
 * data, though, and an app may have patched results into a stored one.
 * Settling such a call again would put a second result for its id on the
 * next request, a shape a provider rejects.
 */
export function pausedBatchOf(
  history: readonly LLMMessage[],
  pausedToolCallId: string,
  callOccurrenceKey?: CallOccurrenceKey,
): { readonly size: number; readonly undispatched: readonly ProposedCall[] } {
  const key =
    callOccurrenceKey === undefined ? undefined : readCallOccurrenceKey({ callOccurrenceKey });
  if (key === null) return { size: 0, undispatched: [] };
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (message?.role !== 'assistant') continue;
    const proposed = message.toolCalls ?? [];
    const at = proposed.findIndex(
      (call) => call.id === pausedToolCallId && readCallOccurrenceKey(call) === key,
    );
    if (at < 0) continue;
    const answered = new Set<string | undefined>();
    for (const message of history.slice(i + 1)) {
      if (message.role !== 'tool') continue;
      const occurrence = readCallOccurrenceKey(message);
      if (key === undefined && occurrence === undefined) answered.add(message.toolCallId);
      if (key !== undefined && typeof occurrence === 'string') answered.add(occurrence);
    }
    return {
      size: proposed.length,
      undispatched: proposed.slice(at + 1).filter((call) => {
        const occurrence = readCallOccurrenceKey(call);
        return key === undefined
          ? occurrence === undefined && !answered.has(call.id)
          : typeof occurrence === 'string' && !answered.has(occurrence);
      }),
    };
  }
  return { size: 0, undispatched: [] };
}
