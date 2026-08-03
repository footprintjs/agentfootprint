/**
 * hosting/types — the two ports an agent needs to stand up and stay up.
 *
 * `AgentHost` is "something can call me". `SessionLifecycle` is "the
 * conversation outlives the request". Both are deliberately written in the
 * vocabulary every transport and every store already has — an input, a reply,
 * a session id, a stored blob — and in nothing else.
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
import type { CheckInRequest } from '../core/checkin.js';
import type { MiddlewareAsk } from '../core/pause.js';
import type { AgentRunCheckpoint } from '../core/runCheckpoint.js';

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
 */
export type HostCapability = 'streaming';

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
   * Transport headers with lower-cased names, as delivered. Present so a
   * handler can map its own conventions (a correlation id, a tenant) without
   * the port having to guess which ones matter.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /** Aborted when the caller goes away. */
  readonly signal?: AbortSignal;
}

/**
 * The one reply a request gets. Exactly one of {@link HostReply.complete},
 * {@link HostReply.awaiting} or {@link HostReply.fail} ends it; a second call is
 * ignored rather than allowed to corrupt the wire.
 *
 * Three terminals, because a run has three ends and only three: it answered, it
 * stopped to ask a person something, or it failed. Before `'flowchart-v1'` there
 * was nowhere to keep a paused run, so the middle one was delivered through
 * `fail` — an error standing in for unfinished work. It is a terminal of its own
 * now, and a pause is never reported as a failure again.
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
 *
 * `'resume'` was absent until 7.19 because nothing could produce it: naming
 * reasons nothing fires would be an interface describing a system that does not
 * exist. Something produces it now.
 */
export type WakeReason = 'invoke' | 'resume';

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
 * Options for {@link standingAgent}.
 *
 * Generic in the host's own handle type so composing does not cost you what
 * the adapter told you. `nodeHost` hands back the URL it actually bound —
 * which is the only way to find out when you asked for port `0` — and passing
 * it through `standingAgent` keeps that, without the port having to know that
 * "a URL" is a thing some adapters have.
 */
export interface StandingAgentOptions<TH extends HostHandle = HostHandle> {
  /**
   * The agent that answers. ONE instance, shared by every session — which is
   * why the composer runs one request at a time (see
   * {@link ConcurrentInvokePolicy}).
   */
  readonly agent: Agent;
  /** Where conversations live between requests. */
  readonly sessions: SessionLifecycle;
  /** What carries requests in. */
  readonly host: AgentHost & { serve(handler: HostHandler): Promise<TH> };
  /** Default `'reject'`. See {@link ConcurrentInvokePolicy}. */
  readonly onConcurrentInvoke?: ConcurrentInvokePolicy;
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
}
