/**
 * hosting/errors — the refusals, authored once so every adapter refuses in the
 * same words.
 *
 * A refusal that varies by adapter is a refusal nobody can write a test or a
 * runbook against. These six carry a stable `code`, name WHO refused, and say
 * what the caller should do instead. Adapters map the codes onto whatever their
 * transport uses to say "no" — that mapping is the adapter's business and lives
 * in the adapter, never here.
 *
 * Note what is NOT here: a run that paused. That is unfinished work rather than
 * a refusal, and it leaves through `reply.awaiting(...)` — its own terminal —
 * not through an error dressed up as one.
 *
 * `requireCapability` is the last refusal and the only one that is a
 * programming mistake rather than a runtime condition, so it throws a plain
 * `Error`: nothing branches on "I forgot to feature-detect", it just needs to
 * say so loudly and name the adapter it is talking about.
 */

import { previewStored } from '../lib/storedPreview.js';
import type { AgentHost, ConversationHost, HostCapability, PendingAsk } from './types.js';

/**
 * Thrown when a request arrives at a host that is shutting down or shut down.
 *
 * `close()` lets in-flight work finish and refuses everything after it; this is
 * what "everything after it" receives.
 */
export class HostClosedError extends Error {
  readonly code = 'ERR_HOST_CLOSED' as const;
  /** Which adapter refused. */
  readonly hostName: string;

  constructor(hostName: string) {
    super(
      `[hosting] the '${hostName}' host is closed and is not accepting new requests. ` +
        `In-flight requests were allowed to finish; this one arrived after close() was called. ` +
        `Serve again on a fresh host to accept new work.`,
    );
    this.name = 'HostClosedError';
    this.hostName = hostName;
  }
}

/**
 * Thrown when a request arrives for a session that already has a run in flight
 * and the policy is `'reject'`.
 *
 * The refusal is about the SESSION, not about load: two turns of one
 * conversation racing each other would each answer from the state the other is
 * about to replace. A request for any OTHER session is never refused — it
 * simply waits.
 */
export class ConcurrentRunError extends Error {
  readonly code = 'ERR_CONCURRENT_RUN' as const;
  /** The session that already has a run going. */
  readonly sessionId: string;
  /** The run that is already going, when it has announced itself. */
  readonly activeRunId?: string;

  constructor(sessionId: string, activeRunId?: string) {
    super(
      `[hosting] session '${sessionId}' already has a run in flight` +
        (activeRunId ? ` (run '${activeRunId}')` : '') +
        `. Refusing rather than running two turns of one conversation at once — ` +
        `they would each answer from state the other is about to replace. ` +
        `Wait for the active run, or build the standing agent with ` +
        `onConcurrentInvoke: 'enqueue' to queue this turn behind it instead.`,
    );
    this.name = 'ConcurrentRunError';
    this.sessionId = sessionId;
    if (activeRunId !== undefined) this.activeRunId = activeRunId;
  }
}

/**
 * Raised when a run paused to ask a person something and there is **nowhere to
 * keep it**.
 *
 * **The run did not fail.** A pause is unfinished work: the agent stopped to ask
 * and is waiting for an answer. Since 7.19 a paused run is stored as
 * `'flowchart-v1'` and continued by a later request carrying a decision — so the
 * one case left where a pause genuinely cannot be carried is a request with no
 * session id. There is no session to store it under, and therefore no later
 * request that could ever answer it.
 *
 * The other half of the old meaning — "the reply cannot carry a pause" — is
 * gone: {@link HostReply.awaiting} carries it now. An adapter that has not
 * implemented that terminal still gets its pause STORED (the store is not the
 * transport's business) and this refusal on the wire, naming the session it can
 * be answered on.
 */
export class PauseNotCarriedError extends Error {
  readonly code = 'ERR_PAUSE_NOT_CARRIED' as const;
  /** The tool that asked, when the run recorded which one it was. */
  readonly toolName?: string;
  /** The session the paused run was stored under, when there was one. */
  readonly sessionId?: string;
  /** Whether the paused run was stored. `false` means it is gone. */
  readonly stored: boolean;

  constructor(toolName?: string, sessionId?: string, stored = false) {
    super(
      `[hosting] the run paused to ask a person about ` +
        (toolName ? `'${toolName}'` : 'a tool') +
        `. The run did not fail — it is unfinished, waiting on an answer. ` +
        (stored
          ? `It IS stored: send another request for session '${String(sessionId)}' carrying ` +
            `a 'decision' to continue it. This reply could not describe the question ` +
            `because the host it arrived on does not implement reply.awaiting(); read the ` +
            `pending ask from the session store, or serve on a host that has it.`
          : `Nothing was written: ` +
            (sessionId === undefined
              ? `this request carried no session id, so there is nowhere to store a paused ` +
                `run and no later request that could ever answer it. Send a sessionId, or `
              : `session '${sessionId}' still holds what it held before this request. `) +
            `carry the pause yourself with agent.run() / agent.resume().`),
    );
    this.name = 'PauseNotCarriedError';
    if (toolName !== undefined) this.toolName = toolName;
    if (sessionId !== undefined) this.sessionId = sessionId;
    this.stored = stored;
  }
}

/**
 * Thrown when a new message arrives for a session whose run is waiting on a
 * person's decision.
 *
 * The message is NOT run and the pause is NOT discarded — those are the two ways
 * this could have gone wrong. Answering the message would step over an
 * outstanding consent gate; dropping the paused run to make room for the message
 * would throw away work a person was asked about. So the request is refused, the
 * pending question is named, and the session sits exactly where it was.
 *
 * Answer it by sending the same session a request carrying
 * {@link HostRequest.decision}.
 */
export class AwaitingDecisionError extends Error {
  readonly code = 'ERR_AWAITING_DECISION' as const;
  /** The session that is waiting. */
  readonly sessionId: string;
  /** What it is waiting on — the same payload `reply.awaiting()` delivered. */
  readonly pending: PendingAsk;

  constructor(sessionId: string, pending: PendingAsk) {
    const asked =
      pending.question ?? pending.ask?.question ?? pending.checkIn?.evidence.willDo ?? 'a decision';
    super(
      `[hosting] session '${sessionId}' is waiting on a person: ` +
        (pending.tool ? `'${pending.tool}' asked "${asked}"` : `"${asked}"`) +
        `. This message was NOT run and the paused run was NOT discarded — answering a ` +
        `new message would step over the question, and dropping the question to answer ` +
        `the message would throw away work somebody was asked to approve. ` +
        `Send this session a request carrying 'decision' (checkInApproved(...) / ` +
        `checkInDeclined(...) for a check-in or a middleware ask) to continue the run.`,
    );
    this.name = 'AwaitingDecisionError';
    this.sessionId = sessionId;
    this.pending = pending;
  }
}

/**
 * Thrown when a request carries a decision for a session that is not waiting on
 * one.
 *
 * Usually a duplicate delivery: the run was already continued, or already
 * answered, and the same decision arrived twice. Running it as an ordinary
 * message would put a raw approval into the conversation as if the user had
 * typed it, so it is refused by name instead.
 */
export class NoPendingAskError extends Error {
  readonly code = 'ERR_NO_PENDING_ASK' as const;
  /** The session the decision was addressed to. */
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(
      `[hosting] this request carries a 'decision' but session '${sessionId}' is not ` +
        `waiting on one — nothing is paused. The run it answered has most likely already ` +
        `been continued (a duplicate delivery). Refusing rather than treating an approval ` +
        `as if a person had typed it into the conversation. Send it as 'input' if that is ` +
        `genuinely what you meant.`,
    );
    this.name = 'NoPendingAskError';
    this.sessionId = sessionId;
  }
}

/**
 * Thrown when something is sent down a conversation that has already ended.
 *
 * A closed channel that accepts frames and drops them is the worst of the three
 * options: the sender believes the far side got it, the far side never did, and
 * nothing anywhere says so. Refusing by name is the only version of this that
 * leaves a trace.
 *
 * `onClose` is how you avoid meeting this — subscribe, and stop sending.
 */
export class ConversationClosedError extends Error {
  readonly code = 'ERR_CONVERSATION_CLOSED' as const;
  /** Which adapter's door this was. */
  readonly hostName: string;
  /** The session the conversation claimed, when it claimed one. */
  readonly sessionId?: string;

  constructor(hostName: string, sessionId?: string) {
    super(
      `[hosting] this conversation on the '${hostName}' host has ended` +
        (sessionId !== undefined ? ` (session '${sessionId}')` : '') +
        `, so there is nowhere for that frame to go. Refusing rather than accepting it ` +
        `and dropping it — a send that silently goes nowhere looks identical to a send ` +
        `that worked. Subscribe with onClose(...) and stop sending when it fires, or open ` +
        `a new conversation.`,
    );
    this.name = 'ConversationClosedError';
    this.hostName = hostName;
    if (sessionId !== undefined) this.sessionId = sessionId;
  }
}

/**
 * Thrown when a frame is bigger than the ceiling the adapter DECLARED.
 *
 * This is the other half of {@link ConversationLimits} — a declared ceiling
 * nothing enforces is a number in a doc comment. The port neither chunks nor
 * truncates, on purpose: how a message is split, numbered and reassembled is
 * the consumer's protocol question, and answering it inside the adapter would
 * answer it for every consumer at once. So the ceiling is visible, the refusal
 * names it, and the splitting happens above the port where the protocol lives.
 */
export class FrameTooLargeError extends Error {
  readonly code = 'ERR_FRAME_TOO_LARGE' as const;
  /** Which adapter's door refused. */
  readonly hostName: string;
  /** How big the frame was, in bytes of UTF-8. */
  readonly bytes: number;
  /** The declared ceiling it crossed. */
  readonly maxFrameBytes: number;

  constructor(hostName: string, bytes: number, maxFrameBytes: number) {
    super(
      `[hosting] this frame is ${bytes} bytes and the '${hostName}' host declares a ` +
        `maxFrameBytes of ${maxFrameBytes}. Refusing rather than truncating it or splitting ` +
        `it for you: how a message is chunked, numbered and put back together is your ` +
        `protocol's question, and an adapter that answered it would answer it for every ` +
        `consumer at once. Read host.conversationLimits and chunk above the port.`,
    );
    this.name = 'FrameTooLargeError';
    this.hostName = hostName;
    this.bytes = bytes;
    this.maxFrameBytes = maxFrameBytes;
  }
}

/**
 * Thrown when a request body names a wire operation this host does not speak,
 * or names one and leaves out what it needs (an artifact op without a `ref`).
 *
 * The law it enforces: **a body that named an `op` never falls through to a
 * model turn.** A caller who typo'd `'artifact-head'` and silently got a
 * conversation turn — with the ref as garbage input — would be told nothing
 * and billed anyway, which is the accepted-and-silently-wrong failure this
 * refusal exists to prevent. Adapters answer it as that request's 400: the
 * request is what is wrong, and the same caller can send the right shape.
 */
export class InvalidWireOpError extends Error {
  readonly code = 'ERR_INVALID_WIRE_OP' as const;

  constructor(detail: string) {
    super(`[hosting] ${detail}`);
    this.name = 'InvalidWireOpError';
  }
}

/**
 * Thrown when an artifact operation arrives with no session id.
 *
 * Artifact resolution is governed by the requesting session's identity —
 * a ref is redeemed under exactly the scope the run's tools minted it in, and
 * a request that names no session presents no scope to resolve under. (A run
 * served without a session scopes its artifacts to its own runId, which no
 * later request can name — so there is genuinely nothing this request could
 * ever redeem.) There is deliberately no bare-ref mode: an id alone opens
 * nothing, ever.
 */
export class ArtifactSessionRequiredError extends Error {
  readonly code = 'ERR_ARTIFACT_SESSION_REQUIRED' as const;

  constructor(op: 'head' | 'get') {
    super(
      `[hosting] artifact-${op} needs the session whose run minted the ref: refs resolve ` +
        `under the requesting session's identity-composed scope, and this request named no ` +
        `session. Send sessionId the same way the conversation's own requests do — in the ` +
        `body, the session header, or the session cookie. There is no bare-ref mode: a ref ` +
        `alone opens nothing.`,
    );
    this.name = 'ArtifactSessionRequiredError';
  }
}

/**
 * Thrown when an artifact operation arrives and the agent serving this
 * session has no artifact store attached.
 *
 * The teaching refusal of the fail-closed capability (`ctx.artifacts` with no
 * store), spoken at the hosting door: it names the attach rather than
 * answering "not found" — a deployment gap and a missing ref are different
 * facts, and only one of them is the operator's to fix.
 */
export class NoArtifactStoreError extends Error {
  readonly code = 'ERR_NO_ARTIFACT_STORE' as const;

  constructor(op: 'head' | 'get') {
    super(
      `[hosting] artifact-${op} has no artifact store behind it: the agent serving this ` +
        `session was built without one, so no ref could ever resolve here. Pass ` +
        `\`artifacts\` to Agent.create({ ..., artifacts }) — inMemoryArtifacts() for an ` +
        `in-process store, fileArtifacts({ directory }) or sqliteArtifacts({ file }) for ` +
        `one that survives a restart — and the wire operations answer from it.`,
    );
    this.name = 'NoArtifactStoreError';
  }
}

/**
 * Thrown when a ref does not resolve for the requesting session — missing,
 * expired, or minted under a scope this session's identity does not compose.
 *
 * **Deliberately one shape for all three.** Distinguishing "never existed"
 * from "another session's" would let a caller probe scopes it does not own;
 * the store already answers a wrong scope with "no data" rather than a
 * cross-tenant error, and this refusal keeps that ambiguity on the wire.
 * The screen renders a stated absence in place — the `present` result's
 * description snapshot exists exactly so an expired pane can still say what
 * is gone.
 */
export class ArtifactNotFoundError extends Error {
  readonly code = 'ERR_ARTIFACT_NOT_FOUND' as const;
  /** The ref that did not resolve. */
  readonly ref: string;

  constructor(ref: string) {
    super(
      `[hosting] artifact '${ref}' does not resolve for this session — missing, expired, ` +
        `swept, or never stored under this session's scope. Render its stated absence in ` +
        `place (a present(...) result carries a description snapshot for exactly this ` +
        `moment); re-run to regenerate the data.`,
    );
    this.name = 'ArtifactNotFoundError';
    this.ref = ref;
  }
}

/**
 * Raised when an artifact RESOLVED and the reply cannot describe it — a host
 * without {@link HostReply.artifact}, or an `HttpWire` dialect without an
 * `artifact` body shape.
 *
 * The `PauseNotCarriedError` shape, for the other optional terminal: the
 * resolution itself succeeded and nothing about the store is wrong — it is
 * THIS REPLY that has no vocabulary for the answer. Named rather than
 * improvised, because an adapter inventing a body shape on the spot would be
 * a body no client was written against.
 */
export class ArtifactNotCarriedError extends Error {
  readonly code = 'ERR_ARTIFACT_NOT_CARRIED' as const;
  /** The ref that resolved but could not be delivered. */
  readonly ref: string;

  constructor(ref: string, hostName?: string) {
    super(
      `[hosting] artifact '${ref}' resolved, but ` +
        (hostName !== undefined
          ? `the '${hostName}' host's wire has no artifact() body shape, `
          : `this host does not implement reply.artifact(), `) +
        `so the result cannot be described on this wire. Nothing is wrong with the ` +
        `artifact — serve on an adapter that carries artifact results (nodeHost does), or ` +
        `add the artifact body shape to the dialect.`,
    );
    this.name = 'ArtifactNotCarriedError';
    this.ref = ref;
  }
}

/**
 * An already-computed preview, so {@link UnreadableEnvelopeError.withSession}
 * can copy a refusal without being handed the stored bytes a second time. Not
 * exported: nothing outside this file should be able to hand-write a preview.
 */
class StoredPreview {
  constructor(readonly text: string) {}
}

/**
 * Thrown when a store hands back something that is **present but unreadable**
 * where a `CheckpointEnvelope` should be.
 *
 * The law, in the words of the field report that bought it:
 *
 * > *An unreadable stored conversation and an absent one are different facts,
 * > and only one of them is safe to answer with a fresh start.*
 *
 * Absent is ordinary — a new session has no conversation, and answering it
 * fresh is exactly right. Unreadable is not ordinary: a conversation EXISTS,
 * somebody is in the middle of it, and starting fresh over the top of it looks
 * identical to the happy path from the outside. Nobody finds that until a
 * deployment boundary hands a user a stranger's blank slate. So this refuses,
 * loudly, naming the session — the one thing a silent `undefined` could never
 * do.
 *
 * It extends `TypeError` because that is what it always was: the refusal gained
 * a name, a `code` and the session it is about, but a caller who was already
 * catching a `TypeError` from a reader keeps working.
 *
 * `storedPreview` quotes at most 64 characters (`STORED_PREVIEW_LIMIT`, in
 * `lib/storedPreview` — one cap, shared by every adapter that has to describe
 * bytes it could not read) — enough to recognise a mangled encoding at a
 * glance, never the conversation itself.
 */
export class UnreadableEnvelopeError extends TypeError {
  readonly code = 'ERR_UNREADABLE_ENVELOPE' as const;
  /** The session those bytes were stored under, when the refuser knows it. */
  readonly sessionId?: string;
  /** A short, deliberately truncated rendering of what the store handed back. */
  readonly storedPreview: string;

  constructor(stored: unknown, sessionId?: string) {
    const preview = stored instanceof StoredPreview ? stored.text : previewStored(stored);
    super(
      `[hosting] ` +
        (sessionId === undefined
          ? `a stored session is present but unreadable`
          : `session '${sessionId}' has a STORED conversation this runtime cannot read`) +
        `. An unreadable stored conversation and an absent one are different facts, and ` +
        `only one of them is safe to answer with a fresh start — so this refuses instead ` +
        `of starting over on top of a conversation that exists. ` +
        `What the store handed back looks like: ${preview}. ` +
        `Only a short prefix is ever quoted here — the rest of those bytes is the ` +
        `conversation. ` +
        `Expected { format, data, savedAt } as written by toEnvelope() / toPausedEnvelope(). ` +
        `A store that keeps its own encoding must decode back to that object before ` +
        `handing it over.`,
    );
    this.name = 'UnreadableEnvelopeError';
    if (sessionId !== undefined) this.sessionId = sessionId;
    this.storedPreview = preview;
  }

  /**
   * The same refusal, naming the session — for a reader that knew the bytes
   * were unreadable but not whose conversation they were.
   *
   * Returns a copy rather than mutating: an error already thrown past somebody
   * is a fact about a moment, and editing it under them is how two stack traces
   * end up disagreeing about what happened.
   */
  withSession(sessionId: string): UnreadableEnvelopeError {
    if (this.sessionId !== undefined) return this;
    const named = new UnreadableEnvelopeError(new StoredPreview(this.storedPreview), sessionId);
    named.cause = this;
    return named;
  }
}

// ─── Verified identity (9.26.0) ──────────────────────────────────────

/**
 * WHY a presented credential did not identify anybody — the whole vocabulary a
 * refusal is allowed to say about a token.
 *
 * Every value here is a fact about the CHECK, never about the secret. That is
 * the point of enumerating them at all: an operator needs to act differently on
 * each one, and `expired` versus `wrong-audience` versus `unverifiable` is the
 * entire difference between "the client should refresh", "the client is pointed
 * at the wrong API" and "somebody is presenting something we cannot check" —
 * none of which requires printing one character of the token.
 *
 *  - `'no-token'` — no `Authorization: Bearer …` arrived at all.
 *  - `'expired'` — the token's own lifetime is over.
 *  - `'not-yet-valid'` — its `nbf` is in the future (a clock-skew smell).
 *  - `'wrong-audience'` — it was minted for a different API.
 *  - `'wrong-issuer'` — it came from an IdP this door does not accept.
 *  - `'unverifiable'` — the signature did not check out, no key matched, the
 *    algorithm is not allowed, or it is not a token at all. Deliberately ONE
 *    class: distinguishing "bad signature" from "unknown key" tells whoever is
 *    probing which half of a forgery to fix.
 *  - `'claimed-another-user'` — a valid token, and a request that signed
 *    somebody else's name beside it.
 */
export type IdentityFailureClass =
  | 'no-token'
  | 'expired'
  | 'not-yet-valid'
  | 'wrong-audience'
  | 'wrong-issuer'
  | 'unverifiable'
  | 'claimed-another-user';

/**
 * The caller could not be identified, and this door was configured to insist.
 *
 * **The message never contains the token.** Not truncated, not hashed, not "the
 * first eight characters". A bearer token in a refusal is a bearer token in the
 * reply body, in the log line, in the trace and in every sink attached — one
 * echo and the credential has been published. What travels is
 * {@link IdentityFailureClass} and the sentence that tells the caller what to
 * do about it.
 */
export class IdentityNotVerifiedError extends Error {
  readonly code = 'ERR_IDENTITY_NOT_VERIFIED' as const;
  /** What went wrong, in the one vocabulary. Never the token. */
  readonly failure: IdentityFailureClass;
  /** Did the request also NAME a user it could not prove? The impersonation
   *  shape, kept as a fact so a sink can count it separately. */
  readonly claimedUser: boolean;

  constructor(failure: IdentityFailureClass, claimedUser: boolean) {
    super(`[hosting] the caller was not identified: ${sentenceFor(failure, claimedUser)}`);
    this.name = 'IdentityNotVerifiedError';
    this.failure = failure;
    this.claimedUser = claimedUser;
  }
}

/** The teaching half of {@link IdentityNotVerifiedError}, per class. */
function sentenceFor(failure: IdentityFailureClass, claimedUser: boolean): string {
  switch (failure) {
    case 'no-token':
      return claimedUser
        ? `this request named a user but presented no credential, and this host verifies ` +
            `identity. A user id in a header is a string anyone can send — it is accepted only ` +
            `beside a token that proves it. Send 'Authorization: Bearer <token>', or drop the ` +
            `user id and call anonymously (allowed only when the host was built with ` +
            `identity: { verify, allowAnonymous: true }).`
        : `this host verifies identity and the request presented no credential. Send ` +
            `'Authorization: Bearer <token>'. If some callers here are genuinely anonymous, ` +
            `build the host with identity: { verify, allowAnonymous: true } — anonymous ` +
            `requests may then carry no user id at all.`;
    case 'expired':
      return (
        `the presented token has expired. Refresh it at your identity provider and retry; ` +
        `nothing is wrong with this host or with the token's contents.`
      );
    case 'not-yet-valid':
      return (
        `the presented token is not valid yet (its 'nbf' is in the future). That is ` +
        `usually clock skew between the issuer and this host rather than a bad token.`
      );
    case 'wrong-audience':
      return (
        `the presented token was minted for a different audience — it is a valid token ` +
        `for somebody else's API. Request one for this API's audience.`
      );
    case 'wrong-issuer':
      return (
        `the presented token came from an issuer this host does not accept. Check which ` +
        `identity provider the host was configured with.`
      );
    case 'claimed-another-user':
      return (
        `the presented token identifies one user and the request named a different one. ` +
        `One of those two facts is untrue and this door cannot know which, so it serves ` +
        `neither. Send the user id the token proves, or send none.`
      );
    case 'unverifiable':
      return (
        `the presented credential could not be verified — the signature did not check ` +
        `out, no key matched it, or it is not a token this host reads. Deliberately one ` +
        `answer for all three: naming which would tell whoever is probing what to fix.`
      );
  }
}

/**
 * The verifier itself could not do its job — its key set was unreachable, its
 * introspection endpoint timed out.
 *
 * A DIFFERENT fact from a token that failed, and the difference is who is at
 * fault: this is the deployment's outage, not the caller's bad credential, and
 * answering it with a 401 would send every client off to re-authenticate
 * against an identity provider that is already down. It maps to 503.
 */
export class VerifierUnavailableError extends Error {
  readonly code = 'ERR_IDENTITY_VERIFIER_UNAVAILABLE' as const;
  /** Which verifier could not answer — its name, never its configuration. */
  readonly verifier: string;

  constructor(verifier: string, detail?: string) {
    super(
      `[hosting] identity could not be verified because the '${verifier}' verifier could not ` +
        `answer${detail !== undefined ? ` (${detail})` : ''}. This is an outage on this side, ` +
        `not a bad credential — the caller's token was never judged. Retry once the identity ` +
        `provider is reachable.`,
    );
    this.name = 'VerifierUnavailableError';
    this.verifier = verifier;
  }
}

// ─── Admission (9.26.0) ──────────────────────────────────────────────

/**
 * An admission policy refused this request before any work started.
 *
 * The policy authors the sentence — this class only carries it — because the
 * limit and its reset are the operator's facts, not the library's. What this
 * class guarantees is the SHAPE: a refusal that names a limit is a refusal a
 * client can act on, and one that says "denied" is a support ticket.
 */
export class AdmissionRefusedError extends Error {
  readonly code = 'ERR_ADMISSION_REFUSED' as const;
  /** WHO was refused, when the request identified anybody. Never a token. */
  readonly userId?: string;

  constructor(reason: string, userId?: string) {
    super(`[hosting] this request was not admitted: ${reason}`);
    this.name = 'AdmissionRefusedError';
    if (userId !== undefined) this.userId = userId;
  }
}

// ─── Session history ops (9.26.0) ────────────────────────────────────

/**
 * A session-history operation arrived at a door that does not verify identity.
 *
 * Listing a person's conversations is answering "which sessions belong to
 * you?", and a door that reads WHO from an unverified header would answer that
 * for anyone who guesses a user id — enumeration with a friendly interface.
 * So the ops are refused outright rather than served under a claimed name.
 */
export class SessionOpNeedsIdentityError extends Error {
  readonly code = 'ERR_SESSION_OP_NEEDS_IDENTITY' as const;
  /** The op that was refused. */
  readonly op: string;

  constructor(op: string) {
    super(
      `[hosting] '${op}' needs a VERIFIED caller and this host does not verify identity. ` +
        `Listing or reading a person's conversations under a user id nobody proved is ` +
        `enumeration: anyone who guesses an id reads somebody's transcript. Build the host ` +
        `with identity: { verify: jwksIdentity({ jwksUrl, issuer, audience }).verify } — or ` +
        `any IdentityVerifier — and these ops answer for the caller the token proves.`,
    );
    this.name = 'SessionOpNeedsIdentityError';
    this.op = op;
  }
}

/**
 * A session-history operation arrived at a session store that keeps no
 * owner index.
 *
 * The two members are OPTIONAL on the port on purpose — most stores are a
 * key/value map and owe nobody a secondary index — so this refusal names the
 * store's limitation instead of pretending the answer is "you have no
 * sessions". An empty list and an unanswerable question are different facts,
 * and only one of them is safe to render as "nothing here".
 */
export class SessionIndexUnavailableError extends Error {
  readonly code = 'ERR_SESSION_INDEX_UNAVAILABLE' as const;
  readonly op: string;

  constructor(op: string, missing: string) {
    super(
      `[hosting] '${op}' needs the session store to answer '${missing}', and the store this ` +
        `host was given does not implement it. That is a limitation of the store, not an ` +
        `empty result — reporting "no sessions" here would be an answer nobody could ` +
        `distinguish from the truth. memorySessions() and sqliteSessions({ file }) both ` +
        `implement it; a custom SessionLifecycle can add ${missing} additively.`,
    );
    this.name = 'SessionIndexUnavailableError';
    this.op = op;
  }
}

/**
 * Retention was asked of a session store that has no answer for it (9.42.0).
 *
 * `retention` is OPTIONAL on the port for the same reason the two index
 * members are — most stores are a key/value map and owe nobody a way to expire
 * one — so this refusal names the store's limitation rather than doing
 * nothing quietly. That distinction is the whole point here: an unanswerable
 * question and a sweep that deleted nothing look identical from a cron job's
 * exit code, and a deployment can run for a year believing conversations are
 * being expired because a call returned without complaining.
 *
 * It names which stores DO implement it, because the answer to "my store
 * cannot do this" is usually "then use one that can", and a refusal that makes
 * somebody go and find that out is a refusal that gets caught and ignored. The
 * two it names by hand are the two that ship in this folder; the cloud
 * adapters are pointed at rather than listed, because a hand-maintained list
 * of them inside a PORT is both a vendor name where none belongs and a list
 * that goes stale the release after somebody adds one.
 *
 * No identity material, like every refusal here: retention is about a store,
 * and nothing about who was signed in belongs in it.
 */
export class SessionRetentionUnavailableError extends Error {
  readonly code = 'ERR_SESSION_RETENTION_UNAVAILABLE' as const;
  /** What was being attempted, in the caller's words. */
  readonly purpose: string;

  constructor(purpose: string) {
    super(
      `[hosting] ${purpose} needs the session store to answer 'retention()', and the store ` +
        `this was given does not implement it. That is a limitation of the store, not a ` +
        `conversation that has already been expired — a sweep that quietly did nothing is ` +
        `indistinguishable from retention that is working, which is how a deployment keeps ` +
        `every conversation it ever had for a year. memorySessions() and ` +
        `sqliteSessions({ file }) both implement it, as does every cloud session adapter in ` +
        `this package whose backend can express an expiry — each states which in its own ` +
        `docs. A custom SessionLifecycle can add retention() additively, with nothing else ` +
        `changed: an absent member refuses like this one, it never silently keeps data.`,
    );
    this.name = 'SessionRetentionUnavailableError';
    this.purpose = purpose;
  }
}

/**
 * The ONE answer for a session the caller may not have — read OR continued.
 *
 * A session that does not exist, one that belongs to somebody else, and one
 * whose stored conversation names no owner all end here, byte-identical but
 * for the id the caller already knew. Told apart, they would be an oracle for
 * which session ids are real — the same law
 * {@link ArtifactNotFoundError} follows, for the same reason.
 *
 * Raised by BOTH doors that open a session at a verifying host: the two
 * session-history ops, and an ordinary turn that named somebody else's session
 * (9.26.0). One refusal, so the answer cannot depend on which door a caller
 * knocked at — the mistake this class of hole is always made of.
 */
export class SessionNotFoundError extends Error {
  readonly code = 'ERR_SESSION_NOT_FOUND' as const;
  /** The id that was asked for — the caller's own string, nothing learned. */
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(
      `[hosting] session '${sessionId}' is not one you can open. Deliberately one answer for ` +
        `"no such session", "somebody else's session" and "a session nobody signed for": ` +
        `distinguishing them would tell a caller which ids are real. The ids you can read — ` +
        `and continue — are exactly the ones session-list hands back.`,
    );
    this.name = 'SessionNotFoundError';
    this.sessionId = sessionId;
  }
}

/**
 * A `persist` would have left the ownership index naming one person and the
 * stored conversation naming another (9.36.1).
 *
 * ── The split brain this exists to prevent ──────────────────────────────────
 * The write-once rule protects the INDEX and said nothing about the PAYLOAD.
 * Two writers signing the same fresh session therefore produced a store where
 * `ownerOf(session)` answered the FIRST writer and the stored envelope carried
 * the SECOND writer's whole conversation — and the envelope carries its own
 * identity. The first writer lists the session, opens it, and reads somebody
 * else's conversation. That is not a race in one backend: it was reproduced in
 * a live trial and then found, by inspection, in every store implementing this
 * contract, because the flaw was in the contract rather than in any of them.
 *
 * So the rule gained its missing half: **a different non-empty identity is
 * refused, and an absent one is allowed.** A leaner turn claims nobody and
 * cannot contradict anybody — the contract explicitly blesses it — while a
 * turn signed by somebody else is a contradiction, and a store that stored it
 * would be a store where ownership is decided by who wrote last.
 *
 * ── What this refusal will not tell you ─────────────────────────────────────
 * Neither name. Not the owner, not the caller, not a line of either
 * conversation. An error is read by whoever provoked it, and a refusal that
 * names the person who owns a session is an oracle for who is signed in — the
 * same law {@link SessionNotFoundError} and {@link ArtifactNotFoundError}
 * follow. The session id is here because it is the caller's own string, which
 * is the one thing the message teaches nobody anything by repeating.
 */
export class SessionOwnershipConflictError extends Error {
  readonly code = 'ERR_SESSION_OWNERSHIP_CONFLICT' as const;
  /** The id that was written to — the caller's own string, nothing learned. */
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(
      `[hosting] refusing to persist session '${sessionId}': it already belongs to a ` +
        `different signed-in person than the one this conversation is signed by. ` +
        `Ownership is established by the FIRST turn that signs for a conversation and no ` +
        `later write moves it, so storing this envelope would leave the ownership index ` +
        `naming one person and the stored conversation naming another — and the person the ` +
        `index names would open it and read the other one's conversation. ` +
        `Neither name appears in this message on purpose. ` +
        `What to do: write this turn under a NEW session id, or continue the existing one ` +
        `under the identity that already owns it. Configuring 'identity' on standingAgent ` +
        `refuses a foreign turn at the door, before it ever reaches the store.`,
    );
    this.name = 'SessionOwnershipConflictError';
    this.sessionId = sessionId;
  }
}

/**
 * A session-history result resolved and the reply cannot describe it.
 *
 * The {@link ArtifactNotCarriedError} shape, for the other new terminal.
 */
export class SessionsNotCarriedError extends Error {
  readonly code = 'ERR_SESSIONS_NOT_CARRIED' as const;
  readonly op: string;

  constructor(op: string, hostName?: string) {
    super(
      `[hosting] '${op}' resolved, but ` +
        (hostName !== undefined
          ? `the '${hostName}' host's wire has no sessions() body shape, `
          : `this host does not implement reply.sessions(), `) +
        `so the result cannot be described on this wire. Nothing is wrong with the session ` +
        `store — serve on an adapter that carries session results (nodeHost does), or add ` +
        `the sessions body shape to the dialect.`,
    );
    this.name = 'SessionsNotCarriedError';
    this.op = op;
  }
}

/**
 * Assert that a host can do something, and throw a corrective error naming the
 * adapter when it cannot.
 *
 * This is the feature-detection law with teeth: capabilities are read, never
 * assumed, and asking for one that is absent tells you which adapter you are
 * actually holding rather than failing quietly somewhere downstream.
 *
 * Takes either port, because both declare the same two facts — who they are and
 * what they can do — and a caller holding a conversation-only host is entitled
 * to the same answer as one holding a request host.
 *
 * @example
 *   requireCapability(host, 'streaming'); // throws unless this host streams
 *
 *   // or branch instead of insisting:
 *   if (host.capabilities.includes('streaming')) { ... }
 */
export function requireCapability(
  host: AgentHost | ConversationHost,
  capability: HostCapability,
): void {
  if (host.capabilities.includes(capability)) return;
  const has = host.capabilities.length > 0 ? host.capabilities.join(', ') : 'none';
  throw new Error(
    `[hosting] the '${host.name}' host does not support '${capability}'. ` +
      `It reports: ${has}. Feature-detect with ` +
      `host.capabilities.includes('${capability}') and fall back, or serve on a host ` +
      `that has it — capabilities are read from the adapter, never assumed from its name.`,
  );
}
