import { type CheckpointEnvelope, type HostReply } from '../../types.js';
import { type Configuration } from '../configuration/read.js';
import {
  SESSION_LIST_OP,
  SESSION_TRANSCRIPT_OP,
  type SessionWireRequest,
} from '../../sessionWire.js';
import {
  SessionIndexUnavailableError,
  SessionNotFoundError,
  SessionOpNeedsIdentityError,
  SessionOwnershipConflictError,
  UnreadableEnvelopeError,
} from '../../errors.js';
import { type VerifiedIdentity } from '../../identityVerification.js';
import { deliverSessions } from '../artifacts/facts.js';
import { envelopeOwner, envelopeTranscript } from '../../envelope.js';
import { readStoredSession, unanswerablePause } from '../../answeredPause.js';
import { resolveSessionOwner } from '../../sessionOwnership.js';

type HistoryOptions = Pick<Configuration, 'sessions' | 'sharedAgent' | 'identityOptions'>;

export function createSessionHistory({ sessions, sharedAgent, identityOptions }: HistoryOptions) {
  /**
   * Answer "which conversations are mine?" and "what did we say?" — the two
   * session-history ops (9.26.0) — and "what is it waiting on?" (`pending`).
   *
   * `pending` is the one that needs no verifier: it opens a session exactly
   * as a turn or an answer would (`mayOpenSession`, and a caller who names a
   * user other than the conversation's owner is refused with the one
   * not-found). The refusals below are for the other two.
   *
   * ── Three refusals before an answer is even attempted ────────────────────
   *  1. no verifier on this door → {@link SessionOpNeedsIdentityError}. Reading
   *     "your" sessions off an unverified header is enumeration.
   *  2. a verifier, and this caller proved nothing (an anonymous request at a
   *     door built with `allowAnonymous`) → the same refusal shape: anonymous
   *     owns nothing, and answering an empty list would imply the question was
   *     honoured.
   *  3. the session store keeps no owner index →
   *     {@link SessionIndexUnavailableError}, naming the missing member. An
   *     unanswerable question is not an empty result.
   *
   * ── And ONE indistinguishable not-found ──────────────────────────────────
   * A transcript for a session that does not exist, one owned by somebody
   * else, and one whose stored conversation names no owner all end the same
   * way. Told apart, they would be an oracle for which session ids are real.
   *
   * Read-only and lane-free: history is answered out of the session store,
   * which no run holds, so nothing here queues behind a turn or is refused as
   * a concurrent one.
   */
  async function answerSessionOp(
    op: SessionWireRequest,
    verified: VerifiedIdentity | undefined,
    reply: HostReply,
    /** The user the request names: the verified one, else the transport's claim. */
    namedUser: string | undefined,
  ): Promise<void> {
    if (op.op === 'pending') {
      // Reloading the current question uses the same session admission as a
      // reply. It neither enumerates sessions nor exposes a checkpoint.
      await sessions.onWake?.(op.sessionId, 'transcript');
      const stored = await sessions.hydrate(op.sessionId);
      // …and the same owner rule as answering it: a caller who names another
      // user is refused here as the store refuses that caller's answer
      // (r3-47-hosting-1). A caller naming nobody is still served at a door
      // with no verifier, where the session id is the key.
      if (
        stored !== undefined &&
        (!mayOpenSession(stored, verified) || namesAnotherOwner(op.sessionId, stored, namedUser))
      ) {
        reply.fail(new SessionNotFoundError(op.sessionId));
        return;
      }
      // The one reading every door uses (`answeredPause.ts`): a pause whose
      // decision a resume already used is not pending, and neither is one no
      // answer can reach any more — the next message closes it.
      const held = stored === undefined ? undefined : readStoredSession(stored);
      const waiting =
        held?.waiting !== undefined && unanswerablePause(held.waiting, sharedAgent) === undefined
          ? held.waiting
          : undefined;
      deliverSessions(reply, 'session-pending', {
        op: 'pending',
        pending: waiting?.pending ?? null,
      });
      return;
    }
    const opName = op.op === 'list' ? SESSION_LIST_OP : SESSION_TRANSCRIPT_OP;
    if (identityOptions === undefined || verified === undefined) {
      reply.fail(new SessionOpNeedsIdentityError(opName));
      return;
    }
    if (op.op === 'list') {
      if (sessions.listByUser === undefined) {
        reply.fail(new SessionIndexUnavailableError(opName, 'listByUser'));
        return;
      }
      const page = await sessions.listByUser(verified.userId);
      deliverSessions(reply, opName, { op: 'list', sessions: page.sessions });
      return;
    }
    if (sessions.ownerOf === undefined) {
      reply.fail(new SessionIndexUnavailableError(opName, 'ownerOf'));
      return;
    }
    const owner = await sessions.ownerOf(op.sessionId);
    if (owner === undefined || owner !== verified.userId) {
      // The ONE not-found. Missing, foreign and owner-less are one answer.
      reply.fail(new SessionNotFoundError(op.sessionId));
      return;
    }
    await sessions.onWake?.(op.sessionId, 'transcript');
    let stored;
    try {
      stored = await sessions.hydrate(op.sessionId);
    } catch (err) {
      throw err instanceof UnreadableEnvelopeError ? err.withSession(op.sessionId) : err;
    }
    if (stored === undefined) {
      // The index said one thing and the store another — a session forgotten
      // between the two calls. Same not-found: the caller learns nothing it
      // did not already know.
      reply.fail(new SessionNotFoundError(op.sessionId));
      return;
    }
    deliverSessions(reply, opName, {
      op: 'transcript',
      sessionId: op.sessionId,
      messages: envelopeTranscript(stored),
    });
  }

  /**
   * Whose conversation is this — and may THIS caller open it? (9.26.0)
   *
   * The ownership question, asked ONCE and answered the same way at every door
   * that opens a session. `session-transcript` asks it of the store's index;
   * a TURN asks it of the conversation it just hydrated — the same derivation
   * (`envelopeOwner`, the `principal` the composer itself wrote), so a store
   * with no index is protected exactly as well as one with a fast one, and no
   * second round-trip is spent to learn something already in hand.
   *
   * That a turn had to ask at all is the lesson: the ops that READ history were
   * gated from the day they were written, while the ordinary door beside them
   * hydrated any named session, answered from it, and re-stamped its owner —
   * one handler, two answers, and the strict one was the decoration. A gate
   * that only some doors honour is not a gate.
   *
   * The rule, whole:
   *
   *  - **No verifier configured → no question asked.** A door that reads
   *    `userId` off a header has no proof to compare against, and inventing
   *    one would refuse turns that worked in every earlier release. Byte-
   *    identical, deliberately: how much a header is worth is the deployment's
   *    answer, and this is the option that says so.
   *  - **Verified caller, owned session → the owner, and only the owner.**
   *  - **Verified caller, session that names no owner → refused.** The same
   *    answer `session-transcript` gives, for the same reason: a conversation
   *    nobody signed for is not evidence that it is yours. A store written
   *    before this door verified anything therefore holds sessions that cannot
   *    be continued — a stated migration boundary, and a loud one, rather than
   *    a door that hands over conversations to whoever names them first.
   *  - **Anonymous caller (`allowAnonymous`) → only a session nobody owns.**
   *    Which is the same rule spelled with `undefined` on both sides.
   *
   * A session that does not exist YET is not this function's business: the
   * caller's own first turn creates it, and the ownership fact is written when
   * it persists.
   *
   * ── A conversation this runtime cannot read has no owner it can name ───────
   * The question is asked BEFORE the strict readers, so a stored session in a
   * format this build does not know refuses as "not one you can open" rather
   * than describing the state of somebody's storage to a stranger. The
   * consequence, stated: at a verifying door that is also the answer its real
   * owner gets, because a runtime that cannot read a conversation genuinely
   * cannot tell whose it is, and "this is yours, but broken" is a claim it
   * would be making up. A door with no verifier is untouched — it still fails
   * loudly by name (`UnreadableEnvelopeError`), which is where an operator
   * mid-migration meets that fact.
   *
   * ── The one thing this cannot hide ─────────────────────────────────────────
   * A refused turn tells the caller the id is taken, because the alternative
   * (starting a fresh conversation over somebody else's) destroys it. That is
   * the only fact a door which lets callers choose their own session ids can
   * never conceal — and it is a long way from the conversation itself, which is
   * what the refusal keeps.
   */
  function mayOpenSession(
    stored: CheckpointEnvelope,
    verified: VerifiedIdentity | undefined,
  ): boolean {
    if (identityOptions === undefined) return true;
    return envelopeOwner(stored) === verified?.userId;
  }
  return { answerSessionOp, mayOpenSession };
}

/**
 * Does `named` contradict the owner the stored conversation names? Asked of
 * `resolveSessionOwner`, the one owner rule every store applies to a write, so
 * a read cannot be looser than the answer it would lead to.
 */
function namesAnotherOwner(
  sessionId: string,
  stored: CheckpointEnvelope,
  named: string | undefined,
): boolean {
  try {
    resolveSessionOwner(sessionId, envelopeOwner(stored), named);
    return false;
  } catch (err) {
    if (err instanceof SessionOwnershipConflictError) return true;
    throw err;
  }
}

export type SessionHistory = ReturnType<typeof createSessionHistory>;
