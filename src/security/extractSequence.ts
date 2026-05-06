/**
 * extractSequence — derive the in-flight tool-call sequence from
 * `scope.history` for `PermissionChecker.check()`.
 *
 * Pattern: Pure function over conversation history.
 * Role:    Single source of truth — sequence is reconstructed on
 *          demand from `LLMMessage[]` instead of maintained as
 *          parallel state in scope. Survives `agent.resumeOnError`
 *          correctly because the history IS the durable artifact.
 * Emits:   N/A (pure compute).
 *
 * The sequence reads the assistant turns' `toolCalls` blocks in order.
 * Calls that were denied at the gate (synthetic tool_results in history
 * but no `tool.execute()` invocation) are NOT included — the sequence
 * reflects what actually dispatched, not what was attempted.
 *
 * Detection of "did this call dispatch?" — we look at the matching
 * `tool` message and check its content. Synthetic deny messages match
 * a known prefix; everything else is a real dispatch. This pairs the
 * sender (assistant.toolCalls[i].id) with the receiver (tool.toolCallId).
 */

import type { LLMMessage, ToolCallEntry } from '../adapters/types.js';

/** Prefix the framework writes on synthetic deny tool_results. Used to
 *  distinguish "denied but in history" from "actually dispatched". */
export const SYNTHETIC_DENY_PREFIX = '[permission denied:';

export interface ExtractSequenceOptions {
  /**
   * Resolver: tool name → providerId. When the tool was registered via
   * `staticTools(...)` / `.tool(...)`, returns `'local'` (or the resolver's
   * choice). When registered via a `discoveryProvider`, returns the
   * provider's `id`. Lets policies match cross-hub patterns.
   */
  readonly resolveProviderId?: (toolName: string) => string | undefined;
}

/**
 * Walk `history` in order, collect each dispatched tool call into the
 * sequence. Only calls that produced a non-denied tool_result are
 * included.
 *
 * @param history Conversation history at check time.
 * @param iteration Current ReAct iteration (used to tag the proposed
 *                  call's iteration if you append it).
 * @param options Optional resolver for `providerId`.
 * @returns The dispatched-call sequence, in chronological order.
 */
export function extractSequence(
  history: readonly LLMMessage[],
  iteration: number,
  options: ExtractSequenceOptions = {},
): ToolCallEntry[] {
  const sequence: ToolCallEntry[] = [];
  const resolveProviderId = options.resolveProviderId;

  // Walk history once and map every tool message by toolCallId so we
  // know:
  //   • which proposed calls actually dispatched (have a tool_result
  //     in history) vs are still in-flight from the current turn
  //     (no tool_result yet)
  //   • which dispatches were synthetic denies (filtered out — they
  //     never executed)
  // A call is in the sequence only if BOTH a tool_result exists AND
  // it isn't a synthetic deny.
  const toolMsgsByCallId = new Map<string, string>();
  for (const msg of history) {
    if (msg.role === 'tool' && msg.toolCallId) {
      const content = typeof msg.content === 'string' ? msg.content : '';
      toolMsgsByCallId.set(msg.toolCallId, content);
    }
  }

  // Track iteration as we walk: each assistant turn with toolCalls
  // increments the iteration counter for the entries it produces. The
  // exact iteration mapping is approximate because we don't store it
  // per-message, but the sequence ORDER is what matters for governance
  // — iteration is an informational hint.
  let iterCounter = 1;
  for (const msg of history) {
    if (msg.role !== 'assistant' || !msg.toolCalls || msg.toolCalls.length === 0) continue;
    for (const tc of msg.toolCalls) {
      if (!tc.id) continue;
      const toolMsg = toolMsgsByCallId.get(tc.id);
      if (toolMsg === undefined) continue; // no tool_result yet → in-flight
      if (toolMsg.startsWith(SYNTHETIC_DENY_PREFIX)) continue; // denied, never ran
      const entry: ToolCallEntry = {
        name: tc.name,
        args: tc.args,
        iteration: iterCounter,
        ...(resolveProviderId && {
          providerId: resolveProviderId(tc.name) ?? 'local',
        }),
      };
      sequence.push(entry);
    }
    iterCounter += 1;
  }

  // The iteration we report on the LAST entries should reflect the
  // current ReAct iteration so policies that key on iteration count
  // see consistent values.
  if (sequence.length > 0 && iteration > iterCounter - 1) {
    // Patch the last batch's iteration to current. Approximation —
    // good enough for sequence-pattern matching, which is the use case.
    const lastEntry = sequence[sequence.length - 1];
    const lastIter = lastEntry ? lastEntry.iteration : 0;
    for (let i = sequence.length - 1; i >= 0; i--) {
      const entry = sequence[i];
      if (!entry || entry.iteration !== lastIter) break;
      (entry as ToolCallEntry & { iteration: number }).iteration = iteration;
    }
  }

  return sequence;
}
