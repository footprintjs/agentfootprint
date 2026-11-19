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
 * reflects what actually dispatched, not what was attempted. Nor are the
 * calls a paused batch never dispatched (9.113.0): the resume settles each
 * with a fixed sentence and no gate ever saw it, so counting it would let a
 * precondition policy ("verify before transfer") be met by a call that never
 * ran.
 *
 * The proposal's recorded position owns its answer. A provider can repeat an
 * id, including when a fresh instance resumes a stored checkpoint and restarts
 * its id counter. The same pairing serves all three questions: an unanswered
 * proposal is outside the sequence, a synthetic denial never dispatched, and a
 * settled result carries `LLMMessage.notDispatched` regardless of its text.
 * The reader adds no settlement to an unanswered call. The remaining settlement
 * producers are described in `src/core/README.md`.
 *
 * INNER CALLS. A call a tool made through `ctx.tools.call` whose function was
 * entered rides the result message of the call the model made
 * (`LLMMessage.calls`, `provider-contract/innerCalls.ts`). Each one
 * follows that call in the sequence, in the order the tool made them, marked
 * `inner: true` — so a rule over "read a secret, then post it" sees a step a
 * composing tool took exactly where it took it. A refused inner call is not on
 * the message, as a denied model call is not in the sequence. These entries
 * come from the very same result used for the outer call.
 */

import type { InnerCallRan } from '../provider-contract/innerCalls.js';
import type { LLMMessage, ToolCallEntry } from '../provider-contract/types.js';

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
  return deriveSequence(history, iteration, options.resolveProviderId, (call) => call.args);
}

/** The gate's sequence uses the working values. Its public counterparts use the shown view. */
export function extractSequenceForPolicy(
  history: readonly LLMMessage[],
  iteration: number,
  innerArgsOf: (call: InnerCallRan) => InnerCallRan['args'],
): ToolCallEntry[] {
  return deriveSequence(history, iteration, undefined, innerArgsOf);
}

function deriveSequence(
  history: readonly LLMMessage[],
  iteration: number,
  resolveProviderId: ExtractSequenceOptions['resolveProviderId'],
  innerArgsOf: (call: InnerCallRan) => InnerCallRan['args'],
): ToolCallEntry[] {
  const sequence: ToolCallEntry[] = [];
  const results = pairedResults(history);

  // Track iteration as we walk: each assistant turn with toolCalls
  // increments the iteration counter for the entries it produces. The
  // exact iteration mapping is approximate because we don't store it
  // per-message, but the sequence ORDER is what matters for governance
  // — iteration is an informational hint.
  let iterCounter = 1;
  for (const [turnAt, msg] of history.entries()) {
    if (msg.role !== 'assistant' || !msg.toolCalls || msg.toolCalls.length === 0) continue;
    for (const [callAt, tc] of msg.toolCalls.entries()) {
      const answer = results.get(proposalKey(turnAt, callAt));
      if (answer === undefined || answer.notDispatched !== undefined) continue;
      const result = typeof answer.content === 'string' ? answer.content : '';
      if (result.startsWith(SYNTHETIC_DENY_PREFIX)) continue; // denied, never ran
      const entry: ToolCallEntry = {
        name: tc.name,
        args: tc.args,
        iteration: iterCounter,
        ...(resolveProviderId && {
          providerId: resolveProviderId(tc.name) ?? 'local',
        }),
      };
      sequence.push(entry);
      for (const inner of answer.calls ?? []) {
        sequence.push({
          name: inner.toolName,
          args: innerArgsOf(inner),
          iteration: iterCounter,
          ...(resolveProviderId && {
            providerId: resolveProviderId(inner.toolName) ?? 'local',
          }),
          inner: true,
        });
      }
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

/** One proposal's place: its assistant turn's index in history, and the call's on that turn. */
function proposalKey(turnAt: number, callAt: number): string {
  return `${turnAt}:${callAt}`;
}

/**
 * Recorded replies by proposal position, keyed by
 * {@link proposalKey}. Pairing is POSITIONAL — the rule the settlement itself
 * writes by (`core/agent/stages/toolCalls/batch/paused.ts` · `pausedBatchOf`: only an
 * answer AFTER the proposing turn counts): a `role: 'tool'` message answers
 * the first still-unanswered call of its id on the LATEST assistant turn
 * before it that proposed that id. A later answer for an id already answered
 * answers nothing, and a turn that proposes the id again opens a new
 * proposal — which is how a reused id keeps its two calls apart.
 */
function pairedResults(history: readonly LLMMessage[]): Map<string, LLMMessage> {
  const results = new Map<string, LLMMessage>();
  /** id → the still-unanswered proposals of it on the latest turn that proposed it, in call order. */
  const open = new Map<string, string[]>();
  for (const [turnAt, msg] of history.entries()) {
    if (msg.role === 'assistant') {
      const proposed = new Map<string, string[]>();
      for (const [callAt, call] of (msg.toolCalls ?? []).entries()) {
        if (!call.id) continue;
        proposed.set(call.id, [...(proposed.get(call.id) ?? []), proposalKey(turnAt, callAt)]);
      }
      for (const [id, keys] of proposed) open.set(id, keys);
      continue;
    }
    if (msg.role !== 'tool' || !msg.toolCallId) continue;
    const answered = open.get(msg.toolCallId)?.shift();
    if (answered !== undefined) results.set(answered, msg);
  }
  return results;
}
