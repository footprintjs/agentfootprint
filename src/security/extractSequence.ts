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
 * Detection of "did this call dispatch?" — the `tool` messages are read two
 * ways, each with the pairing its question needs:
 *
 *   • IN FLIGHT or DENIED — by id (`resultsById`, the rule this file always
 *     had): the latest RESULT for the id decides. None yet → the call is
 *     still in flight; the synthetic deny prefix → it was refused at the
 *     gate. A settled message is no result, so it answers neither question.
 *     Kept by id on purpose, limits included: a call denied at the gate still
 *     counts once a later call that runs reuses its id, and a call that ran
 *     drops out once a later reuse of its id is denied. Pairing the deny by
 *     position too would change the sequence of runs that never met a
 *     settlement, which this release does not do.
 *   • SETTLED — by position (`settledProposals`, 9.113.0): a settled message
 *     carries `LLMMessage.notDispatched` — the marker, never its sentence —
 *     and it settles the ONE proposal it answers. An id alone cannot say
 *     which proposal that is: a provider may reuse an id across turns, and
 *     the library's own fallback ids are minted per provider INSTANCE
 *     (`adapters/llm/OllamaProvider.ts` · `nextToolCallId`, and its
 *     Foundry Local and Gemini twins), so a fresh process that resumes a
 *     stored checkpoint mints the settled call's id again for a call that
 *     really runs. Paired by id, that real call would bring the settled one
 *     back into the sequence — a "verify before transfer" policy met by a
 *     verify that never ran — and a settled reuse would drop a call that
 *     did run. Paired by position, each proposal is judged by its own answer.
 *
 * A history without a settled message pairs exactly as before 9.113.0.
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
  const results = resultsById(history);
  const settled = settledProposals(history);

  // Track iteration as we walk: each assistant turn with toolCalls
  // increments the iteration counter for the entries it produces. The
  // exact iteration mapping is approximate because we don't store it
  // per-message, but the sequence ORDER is what matters for governance
  // — iteration is an informational hint.
  let iterCounter = 1;
  for (const [turnAt, msg] of history.entries()) {
    if (msg.role !== 'assistant' || !msg.toolCalls || msg.toolCalls.length === 0) continue;
    for (const [callAt, tc] of msg.toolCalls.entries()) {
      if (!tc.id) continue;
      const result = results.get(tc.id);
      if (result === undefined) continue; // no tool_result yet → in-flight
      if (result.startsWith(SYNTHETIC_DENY_PREFIX)) continue; // denied, never ran
      if (settled.has(proposalKey(turnAt, callAt))) continue; // settled on resume, never dispatched
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

/** One proposal's place: its assistant turn's index in history, and the call's on that turn. */
function proposalKey(turnAt: number, callAt: number): string {
  return `${turnAt}:${callAt}`;
}

/**
 * The latest RESULT for each call id — what the in-flight and deny checks
 * read, paired by id as they always were. A settled message
 * (`LLMMessage.notDispatched`) is left out: it is the library's sentence for a
 * call that never ran, not a result, so a settled id is not answered by it —
 * and a deny the id carried before a later settlement still reads as a deny.
 */
function resultsById(history: readonly LLMMessage[]): Map<string, string> {
  const results = new Map<string, string>();
  for (const msg of history) {
    if (msg.role !== 'tool' || !msg.toolCallId || msg.notDispatched !== undefined) continue;
    results.set(msg.toolCallId, typeof msg.content === 'string' ? msg.content : '');
  }
  return results;
}

/**
 * The proposals the batch settlement answered (9.113.0), keyed by
 * {@link proposalKey}. Pairing is POSITIONAL — the rule the settlement itself
 * writes by (`core/agent/stages/toolCalls.ts` · `pausedBatchOf`: only an
 * answer AFTER the proposing turn counts): a `role: 'tool'` message answers
 * the first still-unanswered call of its id on the LATEST assistant turn
 * before it that proposed that id. A later answer for an id already answered
 * answers nothing, and a turn that proposes the id again opens a new
 * proposal — which is how a reused id keeps its two calls apart.
 */
function settledProposals(history: readonly LLMMessage[]): Set<string> {
  const settled = new Set<string>();
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
    if (answered !== undefined && msg.notDispatched !== undefined) settled.add(answered);
  }
  return settled;
}
