/**
 * hosting/sessionWire — the wire grammar for "show me my own conversations",
 * owned once.
 *
 * A hosted agent stores conversations so a person can come back to one. Until
 * now the only way back was to already know the session id: the host could
 * hydrate what you named and nothing else. That is fine for a client that
 * remembers, and useless for the screen everyone actually builds — a sidebar of
 * your past chats.
 *
 * Two operations answer it, and the shape of the pair is the security design:
 *
 *   `{ op: 'session-list' }`                      → the VERIFIED caller's own
 *                                                    sessions, newest first
 *   `{ op: 'session-transcript', sessionId }`     → that session's messages,
 *                                                    IF the verified caller
 *                                                    owns it
 *
 * ── Why both REQUIRE verified identity ───────────────────────────────────────
 * `HostRequest.userId` is caller data — a string anybody can send, as the port
 * has said since 9.12. Listing "your" sessions from an unverified header is
 * enumeration with a friendly interface: guess an id, read a stranger's
 * conversations. So these ops are refused outright at a door that does not
 * verify ({@link SessionOpNeedsIdentityError}) rather than served under a name
 * nobody proved. This is the one place in the hosting layer where a feature is
 * gated on a SECURITY control being present, and it is gated because the
 * feature without the control is a vulnerability rather than a smaller feature.
 *
 * ── Why a foreign transcript is a 404 and not a 403 ──────────────────────────
 * "That session exists but is not yours" tells an attacker which ids are real.
 * A session that does not exist, one that exists and belongs to somebody else,
 * and one whose store lost it are ONE answer here, byte-identical but for the
 * id the caller already knew. The same law the artifact wire's not-found
 * follows, for the same reason.
 *
 * ── What a transcript actually contains ──────────────────────────────────────
 * The stored envelope's own messages, read through the envelope readers — the
 * `LLMMessage[]` an agent conversation IS. Roles and text, projected: no tool
 * arguments, no tool results, no system prompt. That projection is stated on
 * {@link TranscriptMessage} rather than implied, because a transcript that
 * looked complete while silently dropping the tool leg would be a transcript
 * somebody reconstructs a decision from and gets wrong.
 */

import { InvalidWireOpError } from './errors.js';
import { isWireOp, refuseUnknownWireOp, WIRE_OPS } from './wireOps.js';

/** The wire spelling of "my sessions". */
export const SESSION_LIST_OP = WIRE_OPS.sessionList;
/** The wire spelling of "one owned session's messages". */
export const SESSION_TRANSCRIPT_OP = WIRE_OPS.sessionTranscript;

/**
 * One session-history operation, as a request carries it — the port-side shape
 * behind the wire's `{ op, sessionId? }`.
 *
 * `op` is the port's own verb vocabulary (`list` | `transcript`), not the wire
 * spelling, for the same reason the artifact request's is: the wire says
 * `'session-list'` because a body field named `op` has to say which domain it
 * belongs to; the port already knows.
 */
export type SessionWireRequest =
  | { readonly op: 'list' }
  | { readonly op: 'transcript'; readonly sessionId: string };

/** One row in a listing — everything a sidebar draws, and nothing from inside
 *  the conversation. */
export interface SessionSummary {
  readonly sessionId: string;
  /** Unix ms of the last write, straight off the stored envelope. */
  readonly savedAt: number;
  /** The stored format — `'conversation-v1'` for a finished turn,
   *  `'flowchart-v1'` for a session waiting on somebody's answer. A sidebar
   *  that wants to badge "awaiting you" reads this and needs nothing else. */
  readonly format: string;
  /** How many messages the transcript would carry. A count is safe in a
   *  listing; content is not, so none rides here. */
  readonly messageCount: number;
}

/**
 * One message, projected for reading.
 *
 * **What is here:** the role and the text, in stored order.
 *
 * **What is deliberately NOT here:** tool call arguments, tool results, tool
 * names and ids, and the system prompt. A transcript is what the two parties
 * SAID, and the tool leg is neither — it is the run's internals, it routinely
 * carries resolved credentials and raw records, and a screen that rendered it
 * would be publishing the inside of the agent to whoever is signed in. The gap
 * is stated because a transcript that quietly dropped a step is one somebody
 * reconstructs a decision from and gets wrong: the count on
 * {@link SessionSummary} counts what THIS projection carries.
 */
export interface TranscriptMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/** What a resolved session operation hands the reply. Exactly one arm. */
export type SessionWireResult =
  | { readonly op: 'list'; readonly sessions: readonly SessionSummary[] }
  | {
      readonly op: 'transcript';
      readonly sessionId: string;
      readonly messages: readonly TranscriptMessage[];
    };

/**
 * Read a session-history operation out of a request body, if the body names
 * one.
 *
 * Returns `undefined` for a body with no `op`, and for an op that belongs to
 * another domain's reader (the artifact ops) — declining is not refusing. An
 * op nobody speaks raises the ONE shared refusal, so the answer is the same
 * whichever reader a dialect happens to call first.
 *
 * Exported for custom {@link import('./httpHost.js').HttpWire} dialects.
 */
export function readSessionWireOp(
  body: Readonly<Record<string, unknown>>,
): SessionWireRequest | undefined {
  const op = body.op;
  if (op === undefined) return undefined;
  if (op !== SESSION_LIST_OP && op !== SESSION_TRANSCRIPT_OP) {
    if (isWireOp(op)) return undefined;
    refuseUnknownWireOp(op);
  }
  if (op === SESSION_LIST_OP) return { op: 'list' };
  const sessionId = body.sessionId;
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    throw new InvalidWireOpError(
      `'${SESSION_TRANSCRIPT_OP}' needs 'sessionId' — which conversation to read. The ids a ` +
        `caller may read are exactly the ones '${SESSION_LIST_OP}' hands back; a session id ` +
        `from anywhere else answers the same not-found as one that never existed.`,
    );
  }
  return { op: 'transcript', sessionId };
}

/**
 * The standard reply body for a resolved session operation:
 * `{ sessions: [...] }` for a list, `{ transcript: { sessionId, messages } }`
 * for a transcript.
 *
 * Authored once so every dialect answers byte-compatibly; a dialect that must
 * add its own envelope fields spreads this and adds them beside (the managed
 * runtime adds its own `status`) — the `artifactWireBody` precedent, verb for
 * verb.
 */
export function sessionWireBody(result: SessionWireResult): Readonly<Record<string, unknown>> {
  if (result.op === 'list') return { sessions: result.sessions };
  return { transcript: { sessionId: result.sessionId, messages: result.messages } };
}
