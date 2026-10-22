/**
 * hosting/answeredPause — a stored pause whose decision a resume USED, and
 * which that resume did not finish.
 *
 * Role:   the one owner of that state. A resume that fails after it took its
 *         decision to the ledger (`core/consentRequest.ts` · `requestUsedBy`)
 *         may have run the call. The host that keeps the pause must stop
 *         offering it for an answer — a retry, a rebuilt instance, a restart
 *         or another host on the same store would answer it again — and the
 *         conversation must still be able to go on.
 * Reads:  the stored pause, and the failed run's own conversation when it has
 *         one.
 * Writes: nothing — `standingAgent` persists what {@link markAnswered} returns.
 *
 * ── WHY THE OPEN CALLS ARE SETTLED ─────────────────────────────────────────
 * A conversation whose last assistant turn holds a tool call with no result
 * cannot be continued: a provider refuses the next request. So every call the
 * run left open gets the host's notice ({@link OUTCOME_NOT_RECORDED}) — never a
 * result, because none was recorded and whether the call ran is not known. A
 * call whose result the run DID record keeps it: the conversation is the run's
 * own, as far as it got.
 */

import type { AgentRunCheckpoint } from '../core/runCheckpoint.js';
import type { LLMMessage } from '../provider-contract/types.js';
import type { PausedRun } from './types.js';

/**
 * What the model reads for a call the run left open: a past fact about that
 * call, and a notice rather than its result.
 */
export const OUTCOME_NOT_RECORDED =
  'No result was recorded for that call: the run that took it up stopped before reporting ' +
  'one, so whether it ran is not known.';

/**
 * The stored pause, marked answered: a decision for it is refused from here
 * on, and the conversation it goes on from is the failed run's own (when it
 * has one) with every call it left open settled as unknown.
 *
 * @param progressed the failed run's conversation (`agent.checkpoint()`), or
 *   `undefined` to go on from the conversation as of the pause.
 */
export function markAnswered(
  paused: PausedRun,
  progressed: AgentRunCheckpoint | undefined,
  now: number = Date.now(),
): PausedRun {
  const conversation = progressed ?? paused.conversation;
  // Under findings admission the notice says what it is — not a result.
  const findings =
    (paused.checkpoint.sharedState as { findingsServe?: unknown } | undefined)?.findingsServe !==
    undefined;
  return {
    ...paused,
    conversation: { ...conversation, history: settleOpenCalls(conversation.history, findings) },
    answered: { at: now },
  };
}

/**
 * The tool calls in `history` that no tool message answered, in the order the
 * model made them.
 */
export function openToolCalls(
  history: readonly LLMMessage[],
): readonly { readonly id: string; readonly name: string }[] {
  const open = new Map<string, { readonly id: string; readonly name: string }>();
  for (const message of history) {
    if (message.role === 'tool' && message.toolCallId !== undefined)
      open.delete(message.toolCallId);
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? [])
        open.set(call.id, { id: call.id, name: call.name });
    }
  }
  return [...open.values()];
}

/**
 * `history` with every open tool call settled by the host's notice — the same
 * history when none is open.
 *
 * @param findings mark each notice for findings admission
 *   (`toolResultOrigin: 'outcome-unknown'`).
 */
export function settleOpenCalls(history: readonly LLMMessage[], findings = false): LLMMessage[] {
  return [
    ...history,
    ...openToolCalls(history).map(
      (call): LLMMessage => ({
        role: 'tool',
        toolName: call.name,
        toolCallId: call.id,
        ...(findings && { toolResultOrigin: 'outcome-unknown' as const }),
        content: OUTCOME_NOT_RECORDED,
      }),
    ),
  ];
}
