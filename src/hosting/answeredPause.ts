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
 *           unanswerablePause   a pause no answer can reach any more, and
 *           closedConversation  the conversation it goes on from
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
 * ── A PAUSE NO ANSWER CAN REACH IS CLOSED, NOT HELD ─────────────────────────
 * A consent pause that recorded no request (stored before requests were
 * named), whose call changed after the ask, or an ask made under rules the
 * resuming agent no longer runs (a redeploy) can never be answered — every
 * decision is refused. Held, it would hold the session for good. So a door
 * closes it: the next message continues the conversation with the calls it
 * left open settled as not run ({@link NOT_RUN_UNANSWERABLE}), and a decision
 * refused for one of those reasons — having used nothing — closes it too, when
 * its question names the request it asked (one stored before requests were
 * named names none: the next message closes that one).
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
import {
  consentRulesOf,
  pausedCallIdOf,
  unanswerableReason,
  watchDecisionUse,
  type DecisionUseWatch,
  type UnanswerableReason,
} from '../core/consentRequest.js';
import { pauseDemandsDecision, ResumeDecisionError } from '../core/pause.js';
import type { AgentRunCheckpoint } from '../core/runCheckpoint.js';
import type { LLMMessage } from '../provider-contract/types.js';
import { readEnvelope, readPausedRun, toEnvelope, toPausedEnvelope } from './envelope.js';
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

/**
 * What {@link afterFailedAnswer} did to the stored pause: marked it answered,
 * closed it (no answer could ever reach it), or kept it as it was.
 */
export type FailedAnswerOutcome = 'marked' | 'closed' | 'kept';

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
 * Unused, and refused for a reason no decision can change (`error` is a
 * `'request-not-recorded'`, `'call-changed'` or `'chain-changed'` refusal):
 * the pause is CLOSED instead — it could only ever hold the session. Read
 * from the refusal's own code, which is safe only because nothing was used:
 * whatever it claims, the calls it leaves open did not run.
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
  /** What the resume — or what followed it — threw. */
  readonly error?: unknown;
  readonly settle?: () => Promise<void> | undefined;
}): Promise<FailedAnswerOutcome> {
  const { store, sessionId, paused, watch } = input;
  const asked = askedRequestOf(paused);
  // Only a consent gate's pause is answered by a decision.
  if (asked === undefined || watch === undefined) return 'kept';
  if (!(await watch.mayHaveBeenUsed())) {
    const reason = unanswerableRefusalOf(input.error);
    return reason === undefined ? 'kept' : closeUnanswerable(store, sessionId, asked);
  }
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

/** The reason a refusal no decision can change names, read from its code and reason. */
function unanswerableRefusalOf(error: unknown): UnanswerableReason | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { code, reason } = error as { code?: unknown; reason?: unknown };
  return code === 'ERR_RESUME_DECISION' &&
    (reason === 'request-not-recorded' || reason === 'call-changed' || reason === 'chain-changed')
    ? reason
    : undefined;
}

/**
 * Close the stored pause for `asked` — only over that same pause, still
 * waiting, read back from the store: never over a newer pause, a mark, or a
 * store that cannot be read. A store that refuses the write leaves it held,
 * and that is said on the console.
 */
async function closeUnanswerable(
  store: SessionLifecycle,
  sessionId: string,
  asked: string,
): Promise<FailedAnswerOutcome> {
  let stored: PausedRun;
  try {
    const current = await store.hydrate(sessionId);
    if (current === undefined || current.format !== 'flowchart-v1') return 'kept';
    stored = readPausedRun(current);
  } catch {
    return 'kept';
  }
  if (stored.answered !== undefined || askedRequestOf(stored) !== asked) return 'kept';
  try {
    await store.persist(sessionId, toEnvelope(closedConversation(stored)));
    return 'closed';
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[hosting] a paused request no decision can answer could not be closed in the session ' +
        'store; the session keeps refusing new messages until it is. Store error:',
      err instanceof Error ? err.name : typeof err,
    );
    return 'kept';
  }
}

/**
 * What the model reads for a call whose question no answer can reach any more
 * — its pause was closed, and the call did not run.
 */
export const NOT_RUN_UNANSWERABLE =
  'That call did not run: the question it waited on could no longer be answered.';

/**
 * Why the stored pause can never be answered by `runner` — `undefined` when it
 * can, or when that cannot be told (`core/consentRequest.ts` ·
 * `unanswerableReason`). Without a runner, or with one whose rules a host
 * cannot see (a composition, an app's own), an ask's chain is not checked.
 */
export function unanswerablePause(
  paused: PausedRun,
  runner?: unknown,
): UnanswerableReason | undefined {
  let gate: ReturnType<typeof pauseDemandsDecision>;
  try {
    gate = pauseDemandsDecision(paused.checkpoint.pauseData);
  } catch {
    return undefined;
  }
  if (gate === undefined) return undefined;
  return unanswerableReason(paused.checkpoint, gate.kind, consentRulesOf(runner));
}

/**
 * The conversation a pause no answer can reach goes on from: every call it
 * left open settled as not run ({@link NOT_RUN_UNANSWERABLE}) — none of them
 * ran, none of them can, and the model is told so.
 */
export function closedConversation(paused: PausedRun): AgentRunCheckpoint {
  const { history } = paused.conversation;
  const findings = servesFindings(paused);
  return {
    ...paused.conversation,
    history: [
      ...history,
      ...openToolCalls(history).map((call) =>
        noticeFor(call, NOT_RUN_UNANSWERABLE, findings ? 'not-entered' : undefined),
      ),
    ],
  };
}

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
  const findings = servesFindings(paused);
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
    ...openToolCalls(history).map((call) =>
      call.id === declined?.toolCallId
        ? noticeFor(call, declinedResult(declined.note), findings ? 'not-entered' : undefined)
        : noticeFor(call, OUTCOME_NOT_RECORDED, findings ? 'outcome-unknown' : undefined),
    ),
  ];
}

/**
 * The host's notice for an open call — never its result — marked for findings
 * admission when `origin` is given.
 */
function noticeFor(
  call: { readonly id: string; readonly name: string },
  content: string,
  origin: 'not-entered' | 'outcome-unknown' | undefined,
): LLMMessage {
  return {
    role: 'tool',
    toolName: call.name,
    toolCallId: call.id,
    ...(origin !== undefined && { toolResultOrigin: origin }),
    content,
  };
}

/** Whether the paused run served findings — its notices then say what they are. */
function servesFindings(paused: PausedRun): boolean {
  return (
    (paused.checkpoint.sharedState as { findingsServe?: unknown } | undefined)?.findingsServe !==
    undefined
  );
}
