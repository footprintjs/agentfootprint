/** One authorized host reply, with optional served observation and protocol delivery. */
import type { AgentfootprintEvent } from '../events/registry.js';
import type { ArtifactWireResult } from './artifactWire.js';
import type { SessionWireResult } from './sessionWire.js';
import type { PendingAsk, TurnArtifacts } from './types.js';

/**
 * The one reply a request gets. Exactly one of {@link HostReply.complete},
 * {@link HostReply.awaiting}, {@link HostReply.artifact} or
 * {@link HostReply.fail} ends it; a second call is ignored rather than allowed
 * to corrupt the wire.
 *
 * Three terminals for a RUN, because a run has three ends and only three: it
 * answered, it stopped to ask a person something, or it failed. Before
 * `'flowchart-v1'` there was nowhere to keep a paused run, so the middle one
 * was delivered through `fail` — an error standing in for unfinished work. It
 * is a terminal of its own now, and a pause is never reported as a failure
 * again. The fourth terminal ends a request that never was a run:
 * {@link HostRequest.artifact} redeems a claim ticket, and `artifact(...)` is
 * how the resolved ticket comes back.
 */
export interface HostReply {
  /** Served native events of this admitted invocation only. */
  event?(event: AgentfootprintEvent): void;
  /** App-authorized reply data; a protocol applies its explicit CUSTOM allow-list. */
  custom?(name: string, payload: Readonly<Record<string, unknown>>): void;
  /** Deliver the final answer and end the reply. */
  complete(output: string): void;
  /**
   * End the reply with **unfinished work**: the run stopped to ask a person
   * something, the paused run is stored, and a later request carrying
   * {@link HostRequest.decision} continues it.
   *
   * This is not a failure and must not be reported as one. The agent did not
   * break, no work was lost, and there is nothing to retry — there is a question
   * outstanding. An adapter that maps this onto a 5xx, an error counter or a
   * dead-letter queue is telling every dashboard it feeds something that is not
   * true.
   *
   * Optional on the TYPE for the same reason {@link HostReply.emit} is: a
   * minimal adapter need not implement it. Every shipped adapter does. When it
   * is absent the composer still STORES the paused run — the store is not the
   * transport's business — and ends the reply with a named refusal instead, so
   * the pause is never lost merely because the wire could not describe it.
   */
  awaiting?(pending: PendingAsk): void;
  /**
   * End the reply with a **resolved artifact** (9.23.0): the metadata for a
   * `head`, metadata + payload for a `get`. The terminal a request carrying
   * {@link HostRequest.artifact} ends through when the ref resolved; a ref
   * that did not resolve ends through `fail` with the one indistinguishable
   * not-found refusal.
   *
   * Optional on the TYPE for the same reason {@link HostReply.awaiting} is: a
   * minimal adapter need not implement it, and every shipped adapter does.
   * When it is absent the composer ends the reply with a named refusal
   * (`ArtifactNotCarriedError`) instead — the resolution is not lost quietly
   * merely because the wire could not describe it.
   */
  artifact?(result: ArtifactWireResult): void;
  /**
   * End the reply with **resolved session history** (9.26.0): the caller's own
   * sessions for a `list`, one owned session's messages for a `transcript`.
   *
   * The terminal a request carrying {@link HostRequest.session} ends through.
   * A session the verified caller does not own does not end here — it ends
   * through `fail` with the one indistinguishable not-found, because "exists
   * but not yours" is an oracle for which ids are real.
   *
   * Optional on the TYPE for the same reason {@link artifact} is: a minimal
   * adapter need not implement it, and every shipped adapter does. When it is
   * absent the composer ends the reply with a named refusal
   * (`SessionsNotCarriedError`) rather than improvising a body shape no client
   * was written against.
   */
  sessions?(result: SessionWireResult): void;
  /**
   * A piece of the answer, as it is produced.
   *
   * Optional on the TYPE so a minimal adapter need not implement it — every
   * shipped adapter does. Whether the caller SEES the pieces as they arrive is
   * the whole difference between hosts, and that is what `'streaming'` in
   * {@link AgentHost.capabilities} reports. A host without it buffers what it is
   * handed and the authoritative `complete(output)` is what the caller
   * receives; the buffer is settled by the completion, never sent alongside it,
   * because a chunk is a preview of the same text and delivering both would
   * hand the caller the answer twice.
   *
   * Handler code is identical either way: emit freely, complete once.
   */
  emit?(chunk: string): void;
  /**
   * The turn's artifact store, **already bound** to the scope this request's
   * claim tickets are redeemed under — so host code that files its OWN
   * artifacts for a turn (a story, the person's clicks, anything joined to it)
   * files them where `artifact-get` will look for the same caller, without
   * ever composing a scope.
   *
   * ── Awaited, inside the turn — and bounded ────────────────────────────────
   * Not a terminal. The composer calls it exactly ONCE per turn, AWAITS it
   * while the session's lane is still held, and only then ends the reply with
   * `complete` or `awaiting` — so a ticket filed here exists before the body
   * that carries it is composed. Never called for a request that is not a turn
   * (an artifact redemption, a session op) or for a turn that ends through
   * `fail`.
   *
   * The wait is BOUNDED: the hook and every operation it started must settle
   * within `turnArtifactsTimeoutMs` (default `TURN_ARTIFACTS_TIMEOUT_MS`, 5 s)
   * and before the request's own `signal` aborts. Whichever comes first ends
   * the hand-over: the binding is revoked, what is in flight is NOT cancelled
   * (it may still land, stamped with this turn's session and run), the cause is
   * reported, and the terminal is delivered. In the shared `{ agent }` shape
   * every session waits behind this turn's lane, so the hook's I/O is paid by
   * everyone — keep it to filing.
   *
   * ── Live only for its turn ─────────────────────────────────────────────────
   * The binding is live while the hand-over is: after the composer has waited
   * for every operation started through it (a `put` that was not awaited
   * included), or after the bound ended the wait, it REVOKES it. A verb called
   * later rejects with `TurnArtifactsExpiredError` — a rejection already
   * handled, so a floating late call cannot crash the process — and is reported
   * as `'expired'`. File inside the hook; never hold the binding.
   *
   * ── Never decides the reply, never silent ──────────────────────────────────
   * A hook that throws or rejects, an operation that fails (awaited or not), the
   * bound, the abort and a late call are all put on the serving agent's stream
   * as `agentfootprint.artifacts.hand_over_failed { cause, op?, errorClass?,
   * errorCode? }` — class only, stamped with the session — and the FIRST of
   * them on the ingress record (`IngressRecord.turnArtifactsFailure`). None of
   * them turns a delivered answer, or a stored question, into a failure.
   * Awaiting another turn of the same standing agent from inside the hook can
   * never finish (that turn queues behind this one); the bound ends the wait.

   * ── The scope, and what it is not ─────────────────────────────────────────
   * The scope is the one {@link HostRequest.artifact} redemption re-composes
   * for this request: the verified user (or the transport's own `userId` when
   * no verifier is configured), the stored conversation's tenant and
   * namespace, else the session rung `{ conversationId: sessionId }`. One
   * owner of that tuple — the library — so an app cannot derive a slightly
   * different one. It is where the DOOR redeems, which is not always where the
   * run filed its own recording: at an unverified door a conversation that
   * carries an identity of its own can put the recording elsewhere (the known
   * edges are listed in `src/hosting/README.md`).
   *
   * Every put is stamped `origin: { runId }` with the run this turn executed,
   * or carries no origin when it executed none (a partial answer to an input
   * request, or its cancellation); a caller's own `origin` is always dropped.
   * A PAUSED turn's run id names a run that files no recording — a pause is
   * not a finished run, and the resumed run records under its own id — so a
   * reader joining on it must say "paused, no recording", not "missing". Each
   * filing lands on the serving agent's record as
   * `agentfootprint.artifacts.minted` with no `tool` field, its meta naming the
   * session and the run it was filed FOR — captured when the binding was
   * built, never read from whichever run is live when a late fact lands.
   *
   * When there is nothing to bind, the value SAYS so rather than inventing a
   * scope — see {@link TurnArtifacts}.
   *
   * Optional, and feature-detected: a host that does not implement it is
   * served exactly as before.
   *
   * @example  File a turn's story and carry its ticket on the reply
   *   turnArtifacts: async (turn) => {
   *     if (!turn.bound) return;
   *     const story = await turn.artifacts.put({ kind: 'story/turn', mediaType: 'application/json', data });
   *     ticketForThisReply = story.ref; // the body `complete` composes next can carry it
   *   },
   */
  turnArtifacts?(turn: TurnArtifacts): void | Promise<void>;
  /** End the reply with a failure. */
  fail(error: Error): void;
}
