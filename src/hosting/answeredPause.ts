/**
 * hosting/answeredPause — a stored pause whose resume failed and may have used
 * its decision: answered, with the outcome not known.
 *
 * Role:   the one owner of that state, for EVERY door that keeps a paused run
 *         (`standingAgent`, `streamHandler`). Once a resume's decision may have
 *         reached the ledger the call may have run, so a failure — in the run,
 *         or in storing its result — must stop the pause being offered for an
 *         answer: a retry, a rebuilt instance, a restart or another host on the
 *         same store would answer it again. The conversation must still be able
 *         to go on.
 *
 *           readStoredSession          the one reading of a stored session:
 *                                      an answered pause is a conversation to
 *                                      continue, never a pause to answer
 *           answeredRefusal            what an answer to it is refused with
 *           markAnsweredAfterFailure   the one marking step after a failure
 *
 * ── MARKED UNLESS PROVEN UNUSED ────────────────────────────────────────────
 * A door marks the pause after ANY failed resume of a consent gate, unless the
 * resume itself gives the one positive sign that its decision never reached a
 * ledger: what it threw is a refusal this library registered, for this
 * pause's request, before the ledger (`core/consentRequest.ts` ·
 * `wasRefusedBeforeUse` — registered by `Agent.resume` before its run starts
 * and by the dispatch loop before it spends). What an error calls itself
 * proves nothing, and nothing is read from the caller's decision object, which
 * a door may copy or wrap on its way to the resume.
 *
 * Reads:  the stored session — never the runner's own state, which on a
 *         shared agent may be another session's run, or a run that never
 *         started.
 * Writes: the marked pause, through the door's session store.
 *
 * ── WHY THE OPEN CALLS ARE SETTLED ─────────────────────────────────────────
 * A conversation whose last assistant turn holds a tool call with no result
 * cannot be continued: a provider refuses the next request. So every call left
 * open gets the host's notice ({@link OUTCOME_NOT_RECORDED}) — never a result,
 * because the host kept none and whether the call ran is not known. When the
 * run kept this session's conversation while it ran (a durable writer), that
 * is what goes on, its recorded results included.
 */

import { wasRefusedBeforeUse } from '../core/consentRequest.js';
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
 * After a resume of a consent gate — or what followed it, storing its result
 * included — FAILED with `error`, at any door that keeps the pause: persist
 * the pause marked answered, unless `error` is the positive sign that the
 * resume refused before its decision could reach a ledger, for this pause's
 * request (`wasRefusedBeforeUse`); then nothing was used and the pause stays
 * answerable.
 *
 * Read first, to leave alone what must not be overwritten — but only when the
 * read SUCCEEDS: a newer pause the run stored before the failure (this pause
 * is gone, and a decision for it is refused as another request's) or a mark
 * already there. A store that cannot be read, or holds nothing, or holds what
 * this runtime cannot read, is marked anyway: failing to read is no proof the
 * decision was unused. The conversation the mark goes on from is what the run
 * kept for this session (a durable writer's conversation) when the read shows
 * one, else the conversation as of the pause — never the runner's own state,
 * which on a shared agent may be another session's run.
 *
 * Only a failure of the WRITE itself is swallowed — the run's failure is the
 * one the caller is told, and the ledger still refuses the decision in this
 * process — and it is reported on the console, never silent.
 *
 * @param error  what the resume (or what followed it) threw.
 * @param settle writes still in flight for this session (a durable writer),
 *   drained first so none lands on top of the mark.
 * @returns whether the mark was written.
 */
export async function markAnsweredAfterFailure(input: {
  readonly store: SessionLifecycle;
  readonly sessionId: string;
  readonly paused: PausedRun;
  readonly error: unknown;
  readonly settle?: () => Promise<void> | undefined;
}): Promise<boolean> {
  const { store, sessionId, paused } = input;
  const asked = paused.pending.checkIn?.id ?? paused.pending.ask?.id;
  // Only a consent gate's pause is answered by a decision.
  if (asked === undefined) return false;
  if (wasRefusedBeforeUse(input.error, asked)) return false;
  try {
    await input.settle?.();
  } catch {
    // a write that would not drain does not stop the mark
  }
  let current: CheckpointEnvelope | undefined;
  try {
    current = await store.hydrate(sessionId);
  } catch {
    current = undefined; // unread — marked from the pause's own conversation
  }
  let kept: AgentRunCheckpoint | undefined;
  if (current !== undefined) {
    try {
      if (current.format === 'conversation-v1') {
        kept = readEnvelope(current);
      } else {
        const stored = readPausedRun(current);
        const storedRequest = stored.pending.checkIn?.id ?? stored.pending.ask?.id;
        if (stored.answered !== undefined || storedRequest !== asked) return false;
      }
    } catch {
      kept = undefined; // what the store holds cannot be read — marked anyway
    }
  }
  try {
    await store.persist(sessionId, toPausedEnvelope(markAnswered(paused, kept)));
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[hosting] a paused request whose decision may have been used could not be marked ' +
        "answered in the session store; only this process's ledger refuses that decision " +
        '— give every process one shared decisionLedger. Store error:',
      err instanceof Error ? err.name : typeof err,
    );
    return false;
  }
}

/**
 * What the model reads for a call the run left open: a past fact about that
 * call, and a notice rather than its result.
 */
export const OUTCOME_NOT_RECORDED =
  'No result was kept for that call: the run that took it up stopped before it finished, so ' +
  'whether it ran is not known.';

/**
 * The stored pause, marked answered: a decision for it is refused from here
 * on, and the conversation it goes on from has every call left open settled
 * as unknown.
 *
 * @param progressed this session's conversation as the run kept it, or
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
