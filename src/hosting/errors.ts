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
