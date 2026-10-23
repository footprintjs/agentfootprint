/**
 * hosting/answeredPause — a stored pause whose decision a resume USED, and
 * which that resume did not finish.
 *
 * Role:   the one owner of that state, for EVERY door that keeps a paused run
 *         (`standingAgent`, `streamHandler`). A resume that fails after it took
 *         its decision to the ledger (`core/consentRequest.ts` ·
 *         `requestWasUsed`) may have run the call. The door that keeps the
 *         pause must stop offering it for an answer — a retry, a rebuilt
 *         instance, a restart or another host on the same store would answer it
 *         again — and the conversation must still be able to go on.
 *
 *           readStoredSession   the one reading of a stored session: an
 *                               answered pause is a conversation to continue,
 *                               never a pause to answer
 *           answeredRefusal     what an answer to it is refused with
 *           markAnsweredIfUsed  the one marking step after a failed resume
 *
 * Reads:  the stored session, and the failed run's own conversation when it
 *         has one.
 * Writes: the marked pause, through the door's session store.
 *
 * ── WHY THE OPEN CALLS ARE SETTLED ─────────────────────────────────────────
 * A conversation whose last assistant turn holds a tool call with no result
 * cannot be continued: a provider refuses the next request. So every call the
 * run left open gets the host's notice ({@link OUTCOME_NOT_RECORDED}) — never a
 * result, because none was recorded and whether the call ran is not known. A
 * call whose result the run DID record keeps it: the conversation is the run's
 * own, as far as it got.
 */

import { requestWasUsed } from '../core/consentRequest.js';
import { ResumeDecisionError } from '../core/pause.js';
import type { AgentRunCheckpoint } from '../core/runCheckpoint.js';
import type { LLMMessage } from '../provider-contract/types.js';
import { readEnvelope, readPausedRun, toPausedEnvelope } from './envelope.js';
import type { CheckpointEnvelope, PausedRun, SessionLifecycle } from './types.js';

/** What a stored session holds, for a door that continues it ({@link readStoredSession}). */
export interface StoredSession {
  /** The conversation the next message continues — a stored one, or an answered pause's. */
  readonly prior?: AgentRunCheckpoint;
  /** The pause still waiting on a person: the only one a door may offer for an answer. */
  readonly waiting?: PausedRun;
  /** A pause whose decision a resume already used — an answer to it is refused. */
  readonly answered?: PausedRun;
}

/**
 * Read a stored session the way every door must: a pause still waiting is
 * offered for an answer; an ANSWERED pause is the conversation the next
 * message continues and is never offered again; a conversation is a
 * conversation. Throws as the envelope readers do on a format this runtime
 * cannot read.
 */
export function readStoredSession(stored: CheckpointEnvelope): StoredSession {
  if (stored.format !== 'flowchart-v1') return { prior: readEnvelope(stored) };
  const paused = readPausedRun(stored);
  return paused.answered === undefined
    ? { waiting: paused }
    : { prior: paused.conversation, answered: paused };
}

/**
 * What an answer to an answered pause is refused with: `'already-answered'`,
 * whose message says the earlier resume's outcome is not known here.
 */
export function answeredRefusal(answered: PausedRun): ResumeDecisionError {
  return new ResumeDecisionError(
    'already-answered',
    answered.pending.ask !== undefined ? 'ask' : 'checkIn',
  );
}

/**
 * After a resume that FAILED, at any door that keeps the pause: when the
 * pause's decision was already taken to a ledger in this process
 * ({@link requestWasUsed} — the call may have run), persist the pause marked
 * answered, so no later request answers it again. Asked of the request THIS
 * pause recorded, so a resume refused before its ledger leaves the pause
 * answerable.
 *
 * A store that refuses the mark is the run's second failure: the run's is
 * the one the caller is told, and the ledger still refuses the decision in
 * this process — so it is swallowed here, and only here.
 *
 * @param progressed the failed run's own conversation, when its runner keeps
 *   one (`agent.checkpoint()`); the pause's conversation otherwise.
 * @param settle     writes still in flight for this session (a durable
 *   writer), drained first so none lands on top of the mark.
 */
export async function markAnsweredIfUsed(input: {
  readonly store: SessionLifecycle;
  readonly sessionId: string;
  readonly paused: PausedRun;
  readonly progressed: () => AgentRunCheckpoint | undefined;
  readonly settle?: () => Promise<void> | undefined;
}): Promise<void> {
  const { store, sessionId, paused } = input;
  const asked = paused.pending.checkIn?.id ?? paused.pending.ask?.id;
  if (asked === undefined || !requestWasUsed(asked)) return;
  await input.settle?.()?.catch(() => undefined);
  let progressed: AgentRunCheckpoint | undefined;
  try {
    progressed = input.progressed();
  } catch {
    progressed = undefined;
  }
  await store
    .persist(sessionId, toPausedEnvelope(markAnswered(paused, progressed)))
    .catch(() => undefined);
}

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
