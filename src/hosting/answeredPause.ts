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
 *           readStoredSession   the one reading of a stored session: an
 *                               answered pause is a conversation to
 *                               continue, never a pause to answer
 *           answeredRefusal     what an answer to it is refused with
 *           watchAnswer         opened before a door hands an answer over
 *           afterFailedAnswer   the one step after that answer's resume failed
 *
 * ── MARKED WHEN ITS DECISION MAY HAVE BEEN USED ─────────────────────────────
 * The call may have run only if the decision reached a ledger, and
 * `spendDecision` is the one place it does — so a door asks the watch it
 * opened before handing the answer over (`core/consentRequest.ts` ·
 * `watchDecisionUse`). Spent, refused as spent already, still unanswered, or a
 * failed spend its ledger cannot say never landed: marked. Taken up by this
 * library and never taken to a ledger — refused, or aborted before the spend:
 * the pause stays answerable. Never taken up at all: marked, because that
 * cannot be told apart from a use. What an error calls itself proves nothing,
 * and nothing is read from the decision object for it, which a door may copy
 * or wrap on its way to the resume.
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

import { declinedResult } from '../core/checkin.js';
import { pausedCallIdOf, watchDecisionUse, type DecisionUseWatch } from '../core/consentRequest.js';
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

/** The request a stored consent pause asked, by id — `undefined` for any other pause. */
function askedRequestOf(paused: PausedRun): string | undefined {
  return paused.pending.checkIn?.id ?? paused.pending.ask?.id;
}

/**
 * The watch a door opens BEFORE it hands an answer to its runner, and releases
 * once {@link afterFailedAnswer} has decided — `undefined` for a pause no
 * decision answers. Keyed by the pause's request, never by the answer object.
 */
export function watchAnswer(paused: PausedRun): DecisionUseWatch | undefined {
  const asked = askedRequestOf(paused);
  return asked === undefined ? undefined : watchDecisionUse(asked);
}

/** What {@link afterFailedAnswer} did to the stored pause. */
export type FailedAnswerOutcome = 'marked' | 'kept';

/**
 * After a resume of a consent gate — or what followed it, storing its result
 * included — FAILED, at any door that keeps the pause: when the watch says
 * its decision may have been used (`DecisionUseWatch.mayHaveBeenUsed`),
 * persist the pause marked answered; otherwise nothing of it was used and the
 * pause stays answerable.
 *
 * Read first, to leave alone what must not be overwritten — but only when the
 * read SUCCEEDS: a newer pause the run stored before the failure (this pause
 * is gone, and a decision for it is refused as another request's) or a mark
 * already there. A store that cannot be read, or holds what this runtime
 * cannot read, is marked anyway: failing to read is no proof the decision was
 * unused. A store that holds NOTHING is left so — the session expired or was
 * forgotten while the answer ran, and a mark would bring it back. The
 * conversation the mark goes on from is what the run kept for this session (a
 * durable writer's conversation) when the read shows one, else the
 * conversation as of the pause — never the runner's own state, which on a
 * shared agent may be another session's run.
 *
 * A declined decision never runs its call: when the answer that failed was a
 * decline, the paused call is settled as declined, not as unknown.
 *
 * Only a failure of the WRITE itself is swallowed — the run's failure is the
 * one the caller is told, and the ledger still refuses the decision in this
 * process — and it is reported on the console, never silent.
 *
 * @param watch  the door's {@link watchAnswer}, opened before the resume.
 * @param answer the answer as the door handed it over — read only to tell a
 *   decline, and only from its own data properties.
 * @param settle writes still in flight for this session (a durable writer),
 *   drained first so none lands on top of the mark.
 */
export async function afterFailedAnswer(input: {
  readonly store: SessionLifecycle;
  readonly sessionId: string;
  readonly paused: PausedRun;
  readonly watch: DecisionUseWatch | undefined;
  readonly answer?: unknown;
  readonly settle?: () => Promise<void> | undefined;
}): Promise<FailedAnswerOutcome> {
  const { store, sessionId, paused, watch } = input;
  const asked = askedRequestOf(paused);
  // Only a consent gate's pause is answered by a decision.
  if (asked === undefined || watch === undefined) return 'kept';
  if (!(await watch.mayHaveBeenUsed())) return 'kept';
  try {
    await input.settle?.();
  } catch {
    // a write that would not drain does not stop the mark
  }
  let current: CheckpointEnvelope | undefined | typeof UNREAD;
  try {
    current = await store.hydrate(sessionId);
  } catch {
    current = UNREAD; // marked from the pause's own conversation
  }
  if (current === undefined) return 'kept';
  let kept: AgentRunCheckpoint | undefined;
  if (current !== UNREAD) {
    try {
      if (current.format === 'conversation-v1') {
        kept = readEnvelope(current);
      } else {
        const stored = readPausedRun(current);
        if (stored.answered !== undefined || askedRequestOf(stored) !== asked) return 'kept';
      }
    } catch {
      kept = undefined; // what the store holds cannot be read — marked anyway
    }
  }
  try {
    await store.persist(
      sessionId,
      toPausedEnvelope(
        markAnswered(paused, kept, Date.now(), declinedCallOf(paused, input.answer)),
      ),
    );
    return 'marked';
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[hosting] a paused request whose decision may have been used could not be marked ' +
        "answered in the session store; only this process's ledger refuses that decision " +
        '— give every process one shared decisionLedger. Store error:',
      err instanceof Error ? err.name : typeof err,
    );
    return 'kept';
  }
}

/** A read of the store that threw — told apart from a store that holds nothing. */
const UNREAD = Symbol('unread');

/** The paused call a person declined — that call never ran. */
export interface DeclinedCall {
  readonly toolCallId: string;
  /** The person's note, when the decline carried one. */
  readonly note?: string;
}

/**
 * The paused call, when the answer that failed declined it: `approved` is
 * `false`, read from the answer's own data — a getter is never invoked.
 */
function declinedCallOf(paused: PausedRun, answer: unknown): DeclinedCall | undefined {
  if (typeof answer !== 'object' || answer === null) return undefined;
  const toolCallId = pausedCallIdOf(paused.checkpoint);
  if (toolCallId === undefined || ownData(answer, 'approved') !== false) return undefined;
  const note = ownData(answer, 'note');
  return { toolCallId, ...(typeof note === 'string' && note.length > 0 && { note }) };
}

/** `record[key]` when it is an own DATA property — never a getter's answer. */
function ownData(record: object, key: string): unknown {
  try {
    const field = Object.getOwnPropertyDescriptor(record, key);
    return field !== undefined && 'value' in field ? (field.value as unknown) : undefined;
  } catch {
    return undefined;
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
 * as unknown — the call a person declined, as declined: it did not run.
 *
 * @param progressed this session's conversation as the run kept it, or
 *   `undefined` to go on from the conversation as of the pause.
 * @param declined the paused call, when the answer declined it.
 */
export function markAnswered(
  paused: PausedRun,
  progressed: AgentRunCheckpoint | undefined,
  now: number = Date.now(),
  declined?: DeclinedCall,
): PausedRun {
  const conversation = progressed ?? paused.conversation;
  // Under findings admission the notice says what it is — not a result.
  const findings =
    (paused.checkpoint.sharedState as { findingsServe?: unknown } | undefined)?.findingsServe !==
    undefined;
  return {
    ...paused,
    conversation: {
      ...conversation,
      history: settleOpenCalls(conversation.history, findings, declined),
    },
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
 *   (`toolResultOrigin`: `'outcome-unknown'`, or `'not-entered'` for a declined call).
 * @param declined the call a person declined, settled as declined — the
 *   result the dispatch loop records for a decline — instead of as unknown.
 */
export function settleOpenCalls(
  history: readonly LLMMessage[],
  findings = false,
  declined?: DeclinedCall,
): LLMMessage[] {
  return [
    ...history,
    ...openToolCalls(history).map(
      (call): LLMMessage =>
        call.id === declined?.toolCallId
          ? {
              role: 'tool',
              toolName: call.name,
              toolCallId: call.id,
              ...(findings && { toolResultOrigin: 'not-entered' as const }),
              content: declinedResult(declined.note),
            }
          : {
              role: 'tool',
              toolName: call.name,
              toolCallId: call.id,
              ...(findings && { toolResultOrigin: 'outcome-unknown' as const }),
              content: OUTCOME_NOT_RECORDED,
            },
    ),
  ];
}
