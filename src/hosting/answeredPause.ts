/**
 * hosting/answeredPause — a stored pause whose resume failed after its
 * decision could have been used: answered, with the outcome not known.
 *
 * Role:   the one owner of that state, for EVERY door that keeps a paused run
 *         (`standingAgent`, `streamHandler`). A resume that fails after its
 *         decision could have reached the ledger may have run the call. The
 *         door that keeps the pause must stop offering it for an answer — a
 *         retry, a rebuilt instance, a restart or another host on the same
 *         store would answer it again — and the conversation must still be
 *         able to go on.
 *
 *           readStoredSession          the one reading of a stored session:
 *                                      an answered pause is a conversation to
 *                                      continue, never a pause to answer
 *           answeredRefusal            what an answer to it is refused with
 *           markAnsweredAfterFailure   the one marking step after a failed
 *                                      resume — fails CLOSED
 *
 * ── WHY IT FAILS CLOSED ────────────────────────────────────────────────────
 * Whether a failed resume used its decision is not a fact a door can read
 * reliably from outside the run, and guessing "not used" re-opens the replay
 * this exists to close. So a door marks the pause answered after ANY failed
 * resume of a consent gate, except the refusals that are decided before a
 * decision can reach a ledger (`refusedBeforeUse`). The cost is the other way
 * round and visible: a resume that failed early for some other reason leaves
 * a pause the person cannot answer again — the conversation goes on, and the
 * question is asked afresh.
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
 * The refusals a resume makes BEFORE a decision can reach a ledger — so the
 * pause it was asked to answer is still unanswered: the caller is not the
 * paused run's, the answer is not a decision, the decision is stale, the
 * stored redaction cannot be read, or the decision cannot answer this pause
 * (every `ResumeDecisionError` but `'already-answered'`, which is a ledger's
 * answer). Read by `code`, so a second copy of the library's classes still
 * counts.
 */
function refusedBeforeUse(error: unknown): boolean {
  const { code, reason } = (error ?? {}) as { code?: unknown; reason?: unknown };
  switch (code) {
    case 'ERR_RESUME_DECISION':
      return reason !== 'already-answered';
    case 'ERR_DECISION_REQUIRED':
    case 'ERR_STALE_DECISION':
    case 'ERR_SESSION_OWNERSHIP_CONFLICT':
    case 'ERR_RESUME_REDACTION':
      return true;
    default:
      return false;
  }
}

/**
 * After a resume of a consent gate that FAILED with `error`, at any door that
 * keeps the pause: persist the pause marked answered — unless the failure is
 * a refusal decided before the decision could reach a ledger
 * (`refusedBeforeUse`), which leaves the pause answerable. Fails closed (see
 * the module header): whatever else failed may have come after the ledger,
 * and the call may have run.
 *
 * The conversation the mark goes on from is read from THIS session's store:
 * what the run kept while it ran (a durable writer replaced the pause with a
 * conversation), else the conversation as of the pause. Never the runner's own
 * state — on a shared agent a resume that failed before its run started would
 * hand back another session's last run.
 *
 * A store that refuses the mark is the run's second failure: the run's is
 * the one the caller is told, and the ledger still refuses the decision in
 * this process — so it is swallowed here, and only here.
 *
 * @param error  what the resume (or what followed it) threw.
 * @param settle writes still in flight for this session (a durable writer),
 *   drained first so none lands on top of the mark.
 */
export async function markAnsweredAfterFailure(input: {
  readonly store: SessionLifecycle;
  readonly sessionId: string;
  readonly paused: PausedRun;
  readonly error: unknown;
  readonly settle?: () => Promise<void> | undefined;
}): Promise<void> {
  const { store, sessionId, paused } = input;
  // Only a consent gate's pause is answered by a decision.
  if (paused.pending.checkIn === undefined && paused.pending.ask === undefined) return;
  if (refusedBeforeUse(input.error)) return;
  await input.settle?.()?.catch(() => undefined);
  let kept: AgentRunCheckpoint | undefined;
  try {
    const current = await store.hydrate(sessionId);
    if (current?.format === 'conversation-v1') kept = readEnvelope(current);
  } catch {
    kept = undefined; // the conversation as of the pause
  }
  await store
    .persist(sessionId, toPausedEnvelope(markAnswered(paused, kept)))
    .catch(() => undefined);
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
