/**
 * hosting/types — the ports an agent needs to stand up and stay up.
 *
 * `AgentHost` is "something can call me". `ConversationHost` is "something can
 * TALK to me" — a door that stays open, because `HostRequest → HostReply` is
 * one exchange and some doors are not. `SessionLifecycle` is "the conversation
 * outlives the request". All three are deliberately written in the vocabulary
 * every transport and every store already has — an input, a reply, a frame, a
 * session id, a stored blob — and in nothing else.
 *
 * **The rule these types are written under:** no runtime, product or protocol
 * gets a field, a name or an assumption here. A port shaped around one
 * provider's request envelope stops being a port and becomes that provider's
 * SDK with extra steps, and every later adapter pays for it. If a decision only
 * makes sense for one place you might deploy, it belongs in the adapter for
 * that place, not in this file. `nodeHost` is the first adapter and it does not
 * get special treatment either: its paths, its status codes and its JSON body
 * shape all live in `nodeHost.ts`, and nothing in this file knows they exist.
 *
 * Pattern: Ports & adapters (hexagonal). Role: the port side, exclusively.
 */

import type { FlowchartCheckpoint } from 'footprintjs';

import type { Agent } from '../core/Agent.js';
import type { AskComponent } from '../core/askComponent.js';
import type { CheckInRequest } from '../core/checkin.js';
import type { MiddlewareAsk } from '../core/pause.js';
import type { AgentRunCheckpoint } from '../core/runCheckpoint.js';
import type { Unsubscribe } from '../events/dispatcher.js';
import type { ArtifactWireRequest, ArtifactWireResult } from './artifactWire.js';
import type { IdentityVerificationOptions } from './identityVerification.js';
import type { AdmissionPolicy } from './admission.js';
import type { SessionSummary, SessionWireRequest, SessionWireResult } from './sessionWire.js';

export type { Unsubscribe };

// ─── The host port ───────────────────────────────────────────────────

/**
 * Something a host can do BEYOND the baseline of "accept a request, deliver one
 * reply". Read it from {@link AgentHost.capabilities} and branch on it — never
 * assume it, and never infer it from the adapter's name.
 *
 * The union starts at exactly what a shipped adapter can honour today. A name
 * is added when an adapter can actually keep the promise, never in anticipation
 * of a transport that does not exist yet: a capability nobody implements is a
 * promise the library cannot keep, and pre-minting one for an imagined future
 * transport would bake that transport's assumptions in before it arrives.
 *
 *  - `'streaming'` — the caller SEES `reply.emit(...)` pieces as they arrive.
 *  - `'conversation'` — this host can also carry a two-way channel that stays
 *    open ({@link ConversationHost.serveConversations}). It joined the union
 *    when two shipped adapters honoured it, not when it was imagined.
 *
 * Declared at CONSTRUCTION and static thereafter, which is a constraint worth
 * knowing about: a capability whose truth depended on what happened to be
 * installed at call time could not be declared here honestly, so an adapter
 * that can only sometimes keep a promise does not make it.
 */
export type HostCapability = 'streaming' | 'conversation';

/**
 * One inbound request, as the transport described it.
 */
export interface HostRequest {
  /** What the caller is asking. */
  readonly input: string;
  /**
   * A person's answer to an outstanding {@link PendingAsk} — and **the one
   * thing that distinguishes a resume from a new message.**
   *
   * Present ⇒ this request answers the run that paused on this session. Absent
   * ⇒ this request is a new message. That is the whole contract, and it is a
   * FIELD rather than an inference on purpose: reading approval out of prose
   * ("yes, go ahead") is a guess, and a guess is not something a consent gate
   * may be built on.
   *
   * The port never interprets it. It is handed to `agent.resume(checkpoint,
   * decision)` exactly as it arrived — a {@link CheckInRequest} or a middleware
   * `ask` is answered with the shipped `checkInApproved()` / `checkInDeclined()`
   * vocabulary; a plain `askHuman` pause is answered with whatever that tool's
   * author documented. Typed `unknown` because the library does not get to
   * decide what a tool asked for.
   */
  readonly decision?: unknown;
  /**
   * The conversation this request CLAIMS to belong to — caller data, exactly as
   * the transport declared it (a JSON field, a header, a path segment).
   *
   * It is **not identity** and must never be trusted as identity on its own:
   * anyone who can reach the host can put any string here, including someone
   * else's. Authenticate the caller by your own means, then check that the
   * authenticated principal is allowed this session, before you serve it.
   */
  readonly sessionId?: string;
  /**
   * WHO the transport says is calling — the end user's id, exactly as the
   * transport declared it (9.12.0).
   *
   * A different fact from {@link sessionId} beside it, and the difference is
   * the whole reason it is a second field: a session is a THREAD and this is a
   * PERSON. One conversation belongs to one user; one user has many
   * conversations; and an audit trail that reports the thread where the actor
   * belongs names the wrong party in a way nobody can see from the outside.
   *
   * **Absent when absent.** No wire derives it from the session id, from the
   * body, or from anything else — a request that carried no user is a request
   * with no `userId`, and inventing one would be worse than reporting none.
   *
   * **How much it is worth is the transport's answer, not this port's.** A
   * managed runtime whose front door authenticates the caller and forwards the
   * result is a transport whose wire can fill this in, and its adapter does. A
   * container you expose directly is not: a header there is a string anybody
   * can send, and the generic JSON wire therefore reads none — a wire that
   * promoted one to "who did this" would hand every caller the ability to sign
   * somebody else's name. Which is which is decided in the adapter, by whoever
   * knows what stands in front of it.
   */
  readonly userId?: string;
  /**
   * An artifact operation this request carries INSTEAD of a message (9.23.0)
   * — `head` (the claim ticket's metadata) or `get` (metadata + payload), for
   * one ref.
   *
   * Its PRESENCE is the discriminant, exactly as {@link decision}'s is: a
   * request carrying `artifact` redeems a ticket and never starts or resumes
   * a run — `input` and `decision` do not ride it. A handler that serves
   * artifacts answers with {@link HostReply.artifact}; a handler that does
   * not should refuse it by name rather than treat it as a message, because a
   * redemption silently answered by a model turn is a caller told nothing and
   * billed anyway. `standingAgent` answers it: the ref is resolved against
   * the serving agent's store under the requesting session's
   * identity-composed scope — exactly the scope the run's own tools used.
   */
  readonly artifact?: ArtifactWireRequest;
  /**
   * A session-history operation this request carries INSTEAD of a message
   * (9.26.0) — `list` (the verified caller's own sessions) or `transcript`
   * (one owned session's messages).
   *
   * Its PRESENCE is the discriminant, exactly as {@link artifact}'s is: a
   * request carrying `session` reads history and never starts or resumes a
   * run. Both ops REQUIRE a door that verifies identity
   * ({@link StandingAgentBaseOptions.identity}) — reading "your" conversations
   * from an unverified header is enumeration — and both are refused by name
   * where the session store keeps no owner index.
   */
  readonly session?: SessionWireRequest;
  /**
   * Transport headers with lower-cased names, as delivered. Present so a
   * handler can map its own conventions (a correlation id, a tenant) without
   * the port having to guess which ones matter.
   *
   * Since 9.26.0 this is also where a door that verifies identity reads the
   * caller's credential from — `authorization: Bearer <token>`, the one
   * vocabulary every transport in this package normalizes onto. The port still
   * does not interpret headers itself; it hands them to whoever was configured
   * to.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /** Aborted when the caller goes away. */
  readonly signal?: AbortSignal;
}

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
  /** End the reply with a failure. */
  fail(error: Error): void;
}

/**
 * What you hand {@link AgentHost.serve}. Throwing is treated exactly like
 * calling `reply.fail(err)` — a handler that throws is a failed request, never
 * a hung one.
 */
export type HostHandler = (request: HostRequest, reply: HostReply) => void | Promise<void>;

/** A live host. */
export interface HostHandle {
  /**
   * Stop taking new requests, let the in-flight ones finish, then release the
   * transport. Idempotent, so a shutdown hook and an explicit close can
   * coexist. Requests arriving after it are refused with a
   * {@link HostClosedError} naming the adapter.
   *
   * "Release the transport" is as strong as the port can be, because an
   * adapter may be serving on a transport the CALLER owns rather than one it
   * created. Releasing one of those means handing the routes back — never
   * closing it — and a request arriving afterwards is the caller's to answer,
   * not this host's to refuse.
   */
  close(): Promise<void>;
}

/**
 * The port: something that can carry requests to one handler and carry its
 * replies back.
 */
export interface AgentHost {
  /**
   * Which adapter this is. Every refusal names it, so an error tells you WHO
   * refused rather than leaving you to guess which layer you are looking at.
   */
  readonly name: string;
  /** What this adapter can do beyond the baseline. Feature-detect; never assume. */
  readonly capabilities: readonly HostCapability[];
  /** Start serving. Resolves once the host is actually live. */
  serve(handler: HostHandler): Promise<HostHandle>;
}

// ─── The conversation port ───────────────────────────────────────────

/**
 * A door that stays open: one session-scoped, two-way channel.
 *
 * The distinction this type exists for, in the words of the field report that
 * bought it: **`HostRequest → HostReply` is one exchange, and this door is a
 * conversation.** A request has one reply and then it is over. A conversation
 * has neither side taking turns by rule, no reply count, and an end that either
 * side can call.
 *
 * ── Frames are STRINGS here, deliberately ───────────────────────────────────
 * What the frames MEAN is the consumer's contract, not this port's: one
 * consumer pushes tool calls down the channel, another speaks a standardized
 * agent↔UI protocol, a third exchanges long-running task updates. JSON is what
 * all three happen to use and none of them agree on beyond that, so the port
 * carries text and stays out of it. Binary is a capability question, deferred
 * until a consumer needs it rather than guessed at now.
 *
 * ── What is NOT here ────────────────────────────────────────────────────────
 * No authentication, no chunking, no heartbeat, no protocol framing. See
 * {@link ConversationLimits} for why the last two are absences with a reason
 * rather than gaps.
 */
export interface HostConversation {
  /**
   * The conversation this channel CLAIMS to belong to — caller data, exactly as
   * the transport declared it, and **not identity**. The whole of
   * {@link HostRequest.sessionId}'s warning applies here word for word: anyone
   * who can reach the host can put any string here, including someone else's.
   *
   * A conversation and a request carrying the same string are the same
   * session's, as far as this port is concerned. What that entitles either of
   * them to is yours to decide, above the port.
   */
  readonly sessionId?: string;
  /**
   * Transport headers with lower-cased names, as delivered — so a handler can
   * map its own conventions without the port guessing which ones matter.
   *
   * This is also where an adapter puts credentials that its transport spells
   * some other way: a bearer token a browser could only send as a subprotocol
   * arrives here as an ordinary `authorization` header, because a port field
   * spelled the way one vendor spells it is how a port stops being one.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Host → far side. One frame, delivered whole.
   *
   * Refuses BY NAME rather than dropping quietly in two cases: a conversation
   * that has ended (`ConversationClosedError`), and a frame past the ceiling the
   * adapter declared (`FrameTooLargeError`). A dropped frame on a channel that
   * looks open is the failure mode this port exists to make impossible.
   */
  send(frame: string): void;
  /**
   * Far side → host. Returns an unsubscribe.
   *
   * Frames that arrive BEFORE the first subscriber are held and delivered to
   * it, up to the bound the adapter declares
   * ({@link ConversationLimits.maxPendingBytes}) — an `async` handler that
   * awaits anything before subscribing would otherwise silently lose the far
   * side's opening frame, which on a channel whose first frame is a greeting is
   * every conversation.
   */
  onFrame(cb: (frame: string) => void): Unsubscribe;
  /**
   * The end, delivered exactly once per subscriber — including to a subscriber
   * that arrives after it already happened, which is answered immediately
   * rather than never.
   */
  onClose(cb: (reason: ConversationClose) => void): Unsubscribe;
  /**
   * End it politely: flush what is queued, tell the far side, then stop.
   * Idempotent — the first call owns the ending and later ones do nothing.
   */
  close(reason?: string): void;
}

/**
 * How a conversation ended, in terms every transport can answer.
 *
 * `by` is the fact a consumer branches on and the reason there is no numeric
 * code here: what all three of "a browser-parked channel", "a UI protocol" and
 * "a long-running task exchange" need to know is whether the far side said
 * goodbye, whether we did, or whether it broke — and a transport's own numbers
 * answer that only if you already know that transport. Adapters render their
 * own vocabulary (a close code, a timeout, a ceiling) into {@link reason}.
 */
export interface ConversationClose {
  /**
   *  - `'far-side'` — they ended it.
   *  - `'host'` — we did, through {@link HostConversation.close}.
   *  - `'transport'` — nobody ended it; it broke or timed out.
   */
  readonly by: 'far-side' | 'host' | 'transport';
  /** What was said about it, when anything was. */
  readonly reason?: string;
}

/**
 * What you hand {@link ConversationHost.serveConversations} — called once per
 * conversation, with that conversation.
 *
 * Throwing ends THAT conversation with a stated reason and never the host: one
 * caller's bad frame is not an outage.
 */
export type ConversationHandler = (conversation: HostConversation) => void | Promise<void>;

/**
 * The ceilings a door imposes, **declared rather than discovered**.
 *
 * ── Why the port does not just handle them ──────────────────────────────────
 * A transport that caps frame size or idles out must SAY so, and then get out
 * of the way. Hiding a 32KB cap inside auto-chunking would be the adapter
 * deciding a protocol question for every consumer at once — how a message is
 * split, how the pieces are numbered, how the far side knows the last one has
 * landed — and those answers differ per consumer. Same for liveness: a
 * heartbeat is frames on somebody's protocol, and inventing them puts bytes on
 * the wire that the consumer's parser never agreed to.
 *
 * So the port's job is to make the ceiling VISIBLE and let the layer above act:
 * chunk above the port, heartbeat above the port.
 *
 * ── Enforced vs reported ────────────────────────────────────────────────────
 * A door enforces what it IS and reports what it SITS BEHIND, and the doc on
 * each field says which. Absent means "no ceiling this adapter knows of", never
 * "no ceiling" — the runtime in front of you may have one it never told us
 * about.
 */
export interface ConversationLimits {
  /**
   * Largest single frame this door carries, in bytes of UTF-8.
   *
   * **Enforced, both directions**, by the door that declares it: an inbound
   * frame past it ends the conversation with a stated reason, and
   * {@link HostConversation.send} past it refuses by name instead of
   * truncating or silently splitting.
   *
   * A frame the transport delivered in pieces counts in TOTAL — the port's
   * frame is the whole message, not the transport's packet, so fragmentation
   * cannot be used to walk around the ceiling.
   */
  readonly maxFrameBytes?: number;
  /**
   * How long the transport tolerates silence before it closes the channel.
   *
   * **Reported, not imposed.** The door declaring it usually is not the thing
   * enforcing it — a runtime's front door idles a socket out long before the
   * process inside notices — and a consumer that needs the channel to stay up
   * sends its own heartbeat frames on its own protocol. Making that possible is
   * the whole reason this number is written down.
   */
  readonly idleMs?: number;
  /**
   * How much the door holds for you before the first
   * {@link HostConversation.onFrame} subscriber exists, in bytes.
   *
   * **Enforced**, and a ceiling on the DOOR rather than on the transport: the
   * pre-subscribe buffer that stops an `async` handler from losing the opening
   * frame is a queue somebody else fills and this process pays for, so it gets
   * a number and a stated overflow instead of growing until the host dies. Past
   * it, the conversation ends with a reason naming this bound.
   *
   * Bounded in BYTES rather than in frames on purpose: a frame count would
   * still admit `count × maxFrameBytes` of memory, which is the same unbounded
   * queue with an extra step.
   */
  readonly maxPendingBytes?: number;
}

/**
 * The port: something that can carry conversations to one handler.
 *
 * It sits BESIDE {@link AgentHost} rather than inside it, because a transport
 * that can carry a request cannot necessarily carry a conversation, and one
 * that carries conversations need not answer requests at all. A host that does
 * both implements both and declares `'conversation'` in
 * {@link AgentHost.capabilities}.
 */
export interface ConversationHost {
  /** Which adapter this is. Every refusal names it. */
  readonly name: string;
  /** What this adapter can do beyond the baseline. Feature-detect; never assume. */
  readonly capabilities: readonly HostCapability[];
  /**
   * What this door caps, as declared facts. Absent means this adapter knows of
   * no ceiling — never that there is none.
   */
  readonly conversationLimits?: ConversationLimits;
  /**
   * Start taking conversations. Resolves once the door is actually open.
   *
   * The handle's `close()` ends every live conversation politely and then
   * releases the door.
   */
  serveConversations(handler: ConversationHandler): Promise<HostHandle>;
}

// ─── The session port ────────────────────────────────────────────────

/**
 * A session packed for storage.
 *
 * `format` names WHAT is inside, so a reader that does not know the shape
 * refuses BY NAME instead of restoring a session it cannot actually read.
 * Formats are ADDED, never redefined: an old runtime meeting a new format says
 * so and stops, which is the only safe thing it can do with a payload it cannot
 * interpret. Two exist:
 *
 *   • `'conversation-v1'` — a conversation and only a conversation. Every turn
 *     that ran to an answer stores this.
 *   • `'flowchart-v1'` — a run that stopped mid-flow to ask a person something:
 *     the engine's own checkpoint, the conversation as of the pause, and the
 *     outstanding ask. 7.14 shipped the version field for exactly this day, and
 *     said so; this is that day.
 *
 * The union is discriminated on `format`, so a reader that switches on it is
 * exhaustive by construction and a third format tomorrow breaks the switch at
 * compile time rather than at 3am.
 */
export type CheckpointEnvelope = ConversationEnvelope | PausedRunEnvelope;

/** A conversation packed for storage — what a turn that ANSWERED leaves behind. */
export interface ConversationEnvelope {
  /** Names the shape of `data`. Unknown values are refused, never guessed at. */
  readonly format: 'conversation-v1';
  /** The conversation itself. */
  readonly data: AgentRunCheckpoint;
  /** Wall-clock when it was packed. Diagnostic. */
  readonly savedAt: number;
}

/** A paused run packed for storage — what a turn that ASKED leaves behind. */
export interface PausedRunEnvelope {
  /** Names the shape of `data`. Unknown values are refused, never guessed at. */
  readonly format: 'flowchart-v1';
  /** The paused run. */
  readonly data: PausedRun;
  /** Wall-clock when it was packed. Diagnostic. */
  readonly savedAt: number;
}

/**
 * A run that stopped to ask a person something, in the three pieces a session
 * actually needs: what continues it, what it has said so far, and what it is
 * waiting on.
 *
 * ── JSON, honestly ───────────────────────────────────────────────────────────
 * A `FlowchartCheckpoint` is **JSON-safe to resume from, and not byte-identical
 * through JSON.** `JSON.stringify` drops any property whose value is
 * `undefined`, and a real paused agent run has a dozen of them. Every one
 * measured sits in `executionTree` / `subflowResults` — the diagnostic halves
 * the engine keeps for narrative and BTS. `sharedState`, which is the half
 * `agent.resume()` actually reads, round-trips unchanged, because footprintjs's
 * TypedScope already JSON-round-trips every object write on its way into
 * committed state.
 *
 * So: store it anywhere that speaks JSON and resume works. Do not assert that
 * what came back deep-equals what went in — `key: undefined` comes back as no
 * key at all, and a test written to expect otherwise is testing `JSON`, not
 * this library.
 */
export interface PausedRun {
  /** The engine checkpoint — everything `agent.resume(checkpoint, decision)` needs. */
  readonly checkpoint: FlowchartCheckpoint;
  /**
   * The conversation as of the pause, in the same shape every other turn stores.
   *
   * Kept alongside the checkpoint so a session that is waiting on a person is
   * still a readable conversation: a support view can show what was said, and a
   * runtime that cannot resume this run can still see the turn that led to the
   * question.
   */
  readonly conversation: AgentRunCheckpoint;
  /** What the run is waiting on, as data. */
  readonly pending: PendingAsk;
}

/**
 * The question a paused run is waiting on — the part of a pause that is safe to
 * hand to whoever asked.
 *
 * **It deliberately carries no checkpoint.** The engine checkpoint holds the
 * entire shared state of the run: the system prompt, the whole conversation,
 * every tool result. That belongs in the store, which the operator chose and
 * controls, and not in a reply to whoever posted the request. The caller gets
 * the question; the store gets the state.
 */
export interface PendingAsk {
  /** The session holding the paused run — where the decision has to be sent back. */
  readonly sessionId?: string;
  /** The tool that asked, when the run recorded which one it was. */
  readonly tool?: string;
  /** The question in plain words, when the pause carried one. */
  readonly question?: string;
  /**
   * Present ONLY when a tool declared `checkIn` — the typed ask plus its
   * evidence pack (what the tool will do, what context the run read, which
   * context drove the choice, the run so far). Answer with `checkInApproved()`
   * / `checkInDeclined()`.
   */
  readonly checkIn?: CheckInRequest;
  /**
   * Present ONLY when a `toolMiddleware` answered `ask` — the question and the
   * middleware that put it. Answered with the same decision vocabulary a
   * check-in uses, deliberately: a person approving is a person approving.
   */
  readonly ask?: MiddlewareAsk;
  /**
   * Which REGISTERED screen component collects the answer (9.24.0) — the
   * typed half of the question, lifted from whichever pause kind carried it
   * so a screen has ONE place to look. Ids and props only, never markup: the
   * registry lives in the frontend, and a screen that does not know the id
   * falls back to the prose `question` exactly as before.
   *
   * `props` is the small inline half; `propsRef` is a claim ticket the screen
   * redeems through the artifact wire (`head` then `get`) under the SAME
   * session identity every other redemption presents — a 200-option picker
   * rides the store, not this reply and not the checkpoint. The ref was
   * validated to resolve when the ask was raised.
   *
   * The answer comes back through {@link HostRequest.decision} unchanged —
   * the component changes how the question is asked, never what the answer
   * is. A screen may render the decision as words; the words are display,
   * the structured decision is the record.
   */
  readonly component?: AskComponent;
  /**
   * Exactly what the tool passed to `askHuman()` / `pauseHere()`, uninterpreted.
   * For a plain pause this is the whole of what the tool's author chose to say,
   * and the library is not entitled to summarise it.
   */
  readonly pauseData: unknown;
}

/**
 * How often a run's progress is written to the session store — the trade
 * between latency and how much a crash can cost you.
 *
 *  - `'exit'` (default) — one write, when the run finishes. The behaviour every
 *    release before 7.19 had, spelled out rather than implied. A crash mid-run
 *    loses the whole turn.
 *  - `'async'` — a write is STARTED whenever the conversation changes and never
 *    waited on. The run never slows down; the store is behind by however much
 *    the newest un-landed write carried. At most one write is in flight and the
 *    newest snapshot supersedes any queued one, so what a crash leaves is always
 *    a PREFIX of the run, never a mixture.
 *  - `'sync'` — persist-then-proceed. The same trigger, but **iteration N's
 *    tools do not execute until iteration N-1's write has landed**, and the
 *    answer is not delivered until the last write has landed. You pay the
 *    store's latency once per iteration, knowingly, and in exchange the amount
 *    of work a crash can re-run has a number: **the current iteration, and
 *    nothing before it.**
 *
 * ── The bound, stated exactly ────────────────────────────────────────────────
 * A commit boundary is a whole stage, and the agent dispatches ALL of one
 * iteration's tool calls inside one stage body. So under `'sync'` a crash
 * re-executes the tools of the iteration that was in flight — never an earlier
 * one. That is the same idempotency requirement `resumeOnError` has always
 * carried, now with a boundary instead of a warning: mutating tools must be
 * idempotent, keyed on stable call content rather than `ctx.toolCallId`.
 */
export type DurabilityMode = 'exit' | 'async' | 'sync';

/**
 * Why a session is being woken.
 *
 *  - `'invoke'` — a request arrived for that session.
 *  - `'resume'` — that request carries a person's decision for a run which
 *    paused earlier.
 *  - `'artifact'` — that request redeems an artifact ref, and the session's
 *    stored identity is needed to compose the scope it resolves under. Fired
 *    only when the resolution actually reads the store (a request carrying a
 *    `userId`); a session-only resolution composes its scope from the request
 *    alone and wakes nothing.
 *  - `'transcript'` — a verified owner is READING that session's messages back
 *    (9.26.0). Nothing runs and nothing is written; the store is woken because
 *    it is about to be read from, which is the only promise this hook ever
 *    made.
 *
 * `'resume'` was absent until 7.19, `'artifact'` until 9.23 and `'transcript'`
 * until 9.26, because nothing could produce them: naming reasons nothing fires
 * would be an interface describing a system that does not exist. Something
 * produces each of them now.
 */
export type WakeReason = 'invoke' | 'resume' | 'artifact' | 'transcript';

/**
 * The port: where a conversation lives between requests.
 *
 * Deliberately two required methods. Anything a real store also wants — a TTL,
 * a scan, a delete — is that store's own API, not a demand this port makes of
 * every store that will ever implement it.
 */
export interface SessionLifecycle {
  /** The stored conversation, or `undefined` for a session that has none yet. */
  hydrate(sessionId: string): Promise<CheckpointEnvelope | undefined>;
  /** Store the conversation for this session. Last write wins. */
  persist(sessionId: string, envelope: CheckpointEnvelope): Promise<void>;
  /**
   * Called once per served request, before `hydrate`, for stores that need to
   * spin something up before they can answer. Errors from it fail the request —
   * a store that could not wake cannot be read from either.
   */
  onWake?(sessionId: string, reason: WakeReason): void | Promise<void>;
  /**
   * OPTIONAL (9.26.0) — the sessions this user owns, newest first.
   *
   * Feature-detected, never assumed. The two required methods are a key/value
   * map and most stores are exactly that; demanding a secondary index of every
   * implementation that will ever exist would be this port breaking its own
   * rule ("anything a real store also wants is that store's API, not a demand
   * this port makes"). A store that leaves this absent makes
   * `{ op: 'session-list' }` refuse BY NAME, naming the store's limitation —
   * never answer "you have no sessions", which is an answer nobody could
   * distinguish from the truth.
   *
   * **Ownership is derived, never declared.** `persist` takes no owner and
   * gains none: a store fills its index from the stored envelope itself
   * (`envelopeOwner`), which reads the `principal` on the conversation the
   * composer put there. A store that let a caller state an owner would be a
   * store where owning somebody's session is a matter of asking for it.
   *
   * **And established ONCE.** The first turn that signs for a conversation owns
   * it; no later write moves that — not a leaner identity (which would erase
   * it) and not a different one (which would transfer it). Both shipped stores
   * implement the index that way, and a custom one that let the last writer win
   * would undo every ownership check made against it one turn later.
   *
   * A conversation that ran anonymously has no owner and appears in nobody's
   * list. That is the honest consequence of deriving rather than inventing.
   */
  listByUser?(userId: string, options?: SessionListOptions): Promise<SessionListPage>;
  /**
   * OPTIONAL (9.26.0) — who owns one session, or `undefined` for a session
   * that does not exist OR names no owner.
   *
   * The deliberate ambiguity is the same one `ArtifactStore.get` makes:
   * "missing" and "not yours" must be indistinguishable from the outside, and
   * a store that answered them differently would hand a caller an oracle for
   * which session ids are real.
   *
   * Implement it beside `listByUser` — a door that can list but not check
   * ownership can hand somebody a list and then refuse to open any of it.
   */
  ownerOf?(sessionId: string): Promise<string | undefined>;
}

/** Paging for {@link SessionLifecycle.listByUser} — the cursor convention every
 *  listing in this package follows. */
export interface SessionListOptions {
  /** Continuation token from a previous page. Omit for the first page. */
  readonly cursor?: string;
  /** Maximum rows this page. Stores may cap it lower. */
  readonly limit?: number;
}

/** One page of a user's sessions. Never carries message content — a listing
 *  says WHICH conversations exist, and `session-transcript` says what is in
 *  one. */
export interface SessionListPage {
  readonly sessions: readonly SessionSummary[];
  /** Present iff more pages exist. */
  readonly cursor?: string;
}

// ─── The composer ────────────────────────────────────────────────────

/**
 * What to do when a request arrives for a session that already has a run in
 * flight.
 *
 *  - `'reject'` (default) — refuse it, naming the run that is already going.
 *    A user who double-submits gets one answer and one refusal, not two runs
 *    racing to write the same conversation.
 *  - `'enqueue'` — queue it. It starts after the active run has persisted, so
 *    the second turn sees the first turn's stored state rather than the state
 *    it was about to overwrite.
 *
 * This governs the SAME session only. A request for a different session is
 * never refused — there is nothing wrong with it; it simply waits its turn.
 */
export type ConcurrentInvokePolicy = 'reject' | 'enqueue';

/**
 * Everything {@link standingAgent} takes EXCEPT which agent answers — that is
 * the one choice with two shapes, and it lives on
 * {@link StandingAgentOptions}.
 *
 * Generic in the host's own handle type so composing does not cost you what
 * the adapter told you. `nodeHost` hands back the URL it actually bound —
 * which is the only way to find out when you asked for port `0` — and passing
 * it through `standingAgent` keeps that, without the port having to know that
 * "a URL" is a thing some adapters have.
 */
export interface StandingAgentBaseOptions<TH extends HostHandle = HostHandle> {
  /** Where conversations live between requests. */
  readonly sessions: SessionLifecycle;
  /** What carries requests in. */
  readonly host: AgentHost & { serve(handler: HostHandler): Promise<TH> };
  /** Default `'reject'`. See {@link ConcurrentInvokePolicy}. */
  readonly onConcurrentInvoke?: ConcurrentInvokePolicy;
  /**
   * Verify WHO is calling, instead of believing a header (9.26.0).
   *
   * With this set, every request's `Authorization: Bearer <token>` is checked
   * BEFORE the run's identity/scope is composed, and the proven user id is the
   * one that reaches `EventMeta.principal`, `ctx.identity`, the memory
   * namespace and the artifact scope. A request that NAMES a user it cannot
   * prove is refused by name — never downgraded to anonymous, never served
   * under the name it claimed.
   *
   * **It also decides whose sessions are whose.** With a verifier configured,
   * EVERY door that opens a stored conversation asks one question first — the
   * two session-history ops and an ordinary turn alike: does this session
   * belong to the caller who proved who they are? A turn naming somebody
   * else's session is refused with the same indistinguishable
   * `SessionNotFoundError` a transcript gets, before a line of that
   * conversation is hydrated into a model's context and before anything is
   * written back. Ownership is the `principal` the first turn signed with, and
   * no later turn moves it.
   *
   * The consequence to plan for: conversations stored BEFORE a door started
   * verifying name no owner, so they cannot be continued at one that does. That
   * is a loud refusal by design — the alternative is a door that hands old
   * conversations to whoever names them first.
   *
   * Unset — the default — nothing changes: `HostRequest.userId` is read exactly
   * as it has been since 9.12.0, and every release's behaviour before this one
   * is byte-identical. Which is right depends on what stands in front of you,
   * and that is a fact only the deployment knows.
   *
   * @example
   *   identity: { verify: jwksIdentity({
   *     jwksUrl: 'https://idp.example.com/.well-known/jwks.json',
   *     issuer:  'https://idp.example.com/',
   *     audience:'my-api',
   *   }).verify }
   */
  readonly identity?: IdentityVerificationOptions;
  /**
   * Decide whether a request runs at all, BEFORE any model is called (9.26.0).
   *
   * Called once per turn with the verified caller, the session and what that
   * caller has spent inside a rolling window; it answers `'allow'`,
   * `{ queue: true }` (run it, but behind this session's other work) or
   * `{ refuse: '<sentence>' }`. `turnsPerHour({ limit })` is the shipped
   * reference policy.
   *
   * Unset — the default — no accounting is kept, no listener is installed, and
   * not one line of this runs.
   *
   * **The honest boundary, stated once:** accounting is PER PROCESS. Two
   * containers each keep their own window, so a limit of 20 across three
   * replicas is a limit of 60. Centralize by writing a policy that consults
   * your own store — the `decide` seam is exactly where that goes.
   *
   * And the second one: a turn is counted when it is ADMITTED, so a request
   * the lane then refuses as a concurrent run still counts against the
   * window. Counting later would let a burst of simultaneous requests each be
   * decided against a window none of them had joined.
   */
  readonly admission?: AdmissionPolicy;
  /**
   * How often a run's progress becomes crash-survivable. Default `'exit'` —
   * one write when the run finishes, which is what every release before this
   * one did. See {@link DurabilityMode} for what the other two buy and cost.
   *
   * Under `'exit'` nothing is attached to the agent at all: no observer, no
   * per-commit work, no barrier. An agent served this way behaves and performs
   * exactly as it did in 7.18.
   */
  readonly durability?: DurabilityMode;
  /**
   * What `close()` does to the telemetry enabled on the agent (8.12.0).
   * Default `'flush'`.
   *
   *  - `'flush'` — drain every strategy the agent has enabled, and leave them
   *    running. This is the default because it is what everyone already
   *    believed happened: an exporter that batches otherwise loses whatever it
   *    had buffered when the server stops. Draining is safe on an agent this
   *    composer only BORROWED — it ships data and disables nothing.
   *  - `'flush-and-stop'` — drain, then release: timers cleared, clients
   *    closed, further events dropped. Say this only when the agent's life
   *    ends with the host, because stopping is terminal.
   *  - `'none'` — touch nothing, exactly as releases before 8.12.0 did.
   */
  readonly shutdown?: 'flush' | 'flush-and-stop' | 'none';
  /**
   * Signals whose arrival should close this host (8.12.0). Off by default,
   * and that is a deliberate refusal rather than an omission.
   *
   * **A library must not grab signals.** `process.on('SIGTERM', …)` is not
   * observation: Node's default action for SIGTERM is to terminate, and
   * ADDING any listener suppresses that default. A library that installs one
   * behind your back can turn a container's graceful stop into a thirty-second
   * wait for SIGKILL in an application that never asked for it. Handlers are
   * process-global and cannot be arbitrated between libraries, ten runners
   * would mean ten handlers and a `MaxListenersExceededWarning`, only Node has
   * signals at all, and no library can know your exit policy.
   *
   * A composition root may, because it already owns the shape of the process
   * — and this one asks first. When you pass signals here, this composer:
   *
   *   1. installs one listener per signal;
   *   2. on arrival, runs the same `close()` you would have called — the host
   *      stops taking requests, in-flight runs finish, telemetry drains per
   *      {@link StandingAgentBaseOptions.shutdown};
   *   3. removes its own listeners and RE-RAISES the signal, so the process
   *      dies exactly the way the platform expects rather than by an exit code
   *      this library invented.
   *
   * `close()` removes the listeners too, so a handle you close yourself leaves
   * nothing installed.
   *
   * @example
   *   await standingAgent({ agent, sessions, host, shutdownOn: ['SIGTERM', 'SIGINT'] });
   */
  readonly shutdownOn?: readonly NodeJS.Signals[];
}

/** How many sessions a `agentFactory` pool holds before it evicts the least
 *  recently used one. See {@link StandingAgentPoolOptions.maxActiveSessions}. */
export const DEFAULT_MAX_ACTIVE_SESSIONS = 100;

/**
 * One shared agent, serving every session — the original shape, and still the
 * right one for most deployments.
 *
 * An `Agent` instance holds per-run state on itself, so one instance can only
 * be in one run at a time. That is why this shape SERIALIZES globally: not a
 * tuning choice, a correctness requirement. See
 * {@link StandingAgentPoolOptions.agentFactory} for the shape that runs
 * sessions in parallel, and `standingAgent`'s own doc for the full comparison.
 */
export interface StandingAgentSharedOptions<TH extends HostHandle = HostHandle>
  extends StandingAgentBaseOptions<TH> {
  /**
   * The agent that answers. ONE instance, shared by every session — which is
   * why this shape runs one request at a time, globally (see
   * {@link ConcurrentInvokePolicy} for the separate question of two turns of
   * the SAME conversation).
   *
   * The composer only BORROWS it: `close()` drains its telemetry and leaves it
   * usable, per {@link StandingAgentBaseOptions.shutdown}.
   */
  readonly agent: Agent;
  /** Refused beside `agent` — see {@link StandingAgentPoolOptions.agentFactory}. */
  readonly agentFactory?: undefined;
  /** Meaningless without a pool; refused rather than ignored. */
  readonly maxActiveSessions?: undefined;
}

/**
 * One agent PER ACTIVE SESSION, built on demand — sessions run in parallel
 * (9.10.0).
 */
export interface StandingAgentPoolOptions<TH extends HostHandle = HostHandle>
  extends StandingAgentBaseOptions<TH> {
  /** Refused beside `agentFactory` — two spellings of one choice. */
  readonly agent?: undefined;
  /**
   * Build an agent. Called once per session that arrives and is not already in
   * the pool; the instance it returns serves that session and nobody else.
   *
   * ── What it buys ──────────────────────────────────────────────────────────
   * **Sessions run at the same time.** Two people asking two questions are two
   * instances and two runs; neither waits for the other. Within one session the
   * turns still serialize — on that session's own instance — which is the same
   * correctness rule the shared shape enforces globally, applied where it
   * actually binds.
   *
   * ── What it costs ─────────────────────────────────────────────────────────
   * An instance per active session: memory, and whatever your agent builds at
   * construction (a provider client, tool wiring). The pool is bounded by
   * {@link StandingAgentPoolOptions.maxActiveSessions} and evicts least
   * recently used, which is invisible to the user because the CONVERSATION
   * lives in the session store — an evicted session re-hydrates onto a fresh
   * instance on its next request.
   *
   * ── The one law ───────────────────────────────────────────────────────────
   * **Return a NEW agent every call.** A factory that hands back an instance it
   * has already handed back is refused BY NAME on the spot: two sessions on one
   * instance is the exact corruption the pool exists to prevent, and it would
   * otherwise show up as one user's answer appearing in another user's
   * conversation with nothing in the recording to say so. Build the agent
   * INSIDE the factory; do not close over one.
   *
   * Instances the factory makes are the composer's, so it stops them — on
   * eviction, and on `close()` unless
   * {@link StandingAgentBaseOptions.shutdown} is `'none'`.
   *
   * @example
   *   await standingAgent({
   *     agentFactory: () => Agent.create({ provider, model }).system('…').build(),
   *     sessions: sqliteSessions({ file: './sessions.db' }),
   *     host: nodeHost({ port: 8080 }),
   *     maxActiveSessions: 200,
   *   });
   */
  readonly agentFactory: () => Agent;
  /**
   * How many sessions hold an instance at once. Default
   * {@link DEFAULT_MAX_ACTIVE_SESSIONS} (100). Must be a positive integer.
   *
   * When a new session arrives at a full pool, the least recently used session
   * that is NOT running is retired: its tool sessions are closed with reason
   * `'evicted'`, its agent is shut down, and its conversation stays in the
   * session store. Nothing about that is visible to the person on the other
   * end — their next message hydrates the same conversation onto a fresh
   * instance.
   *
   * **A running session is never evicted.** If every session in the pool is
   * busy, the pool grows past this number rather than tearing down a live run:
   * the bound is on how many idle instances are RETAINED, and losing somebody's
   * answer to a cache policy is not a trade this composer will make on your
   * behalf. It comes back under the bound as soon as a run finishes.
   */
  readonly maxActiveSessions?: number;
}

/**
 * Options for {@link standingAgent} — pick ONE of the two agent shapes.
 *
 *  - `{ agent }` — one instance shared by every session, serialized globally.
 *    See {@link StandingAgentSharedOptions}.
 *  - `{ agentFactory }` — one instance per active session, sessions in
 *    parallel. See {@link StandingAgentPoolOptions}.
 *
 * Passing both is refused by name at construction: they are two spellings of
 * the same decision, and which one won would be invisible.
 */
export type StandingAgentOptions<TH extends HostHandle = HostHandle> =
  | StandingAgentSharedOptions<TH>
  | StandingAgentPoolOptions<TH>;
