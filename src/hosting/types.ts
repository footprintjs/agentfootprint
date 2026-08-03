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

import type { Agent } from '../core/Agent.js';
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
 * The one reply a request gets. Exactly one of {@link HostReply.complete} or
 * {@link HostReply.fail} ends it; a second call is ignored rather than allowed
 * to corrupt the wire.
 */
export interface HostReply {
  /** Deliver the final answer and end the reply. */
  complete(output: string): void;
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
 * A conversation packed for storage.
 *
 * `format` names WHAT is inside, so a reader that does not know the shape
 * refuses BY NAME instead of restoring a conversation it cannot actually read.
 * Formats are ADDED, never redefined: an old runtime meeting a new format says
 * so and stops, which is the only safe thing it can do with a payload it cannot
 * interpret.
 *
 * `'conversation-v1'` stores a conversation and only a conversation. A run that
 * paused mid-flow is a conversation PLUS an engine checkpoint, and this format
 * has nowhere to put the second half — which is why `standingAgent` refuses to
 * store a paused run rather than storing half of it. Carrying a pause would be
 * a NEW format name in this same envelope, read by a runtime that knows it and
 * refused by name everywhere else. That is what the version field is for.
 */
export interface CheckpointEnvelope {
  /** Names the shape of `data`. Unknown values are refused, never guessed at. */
  readonly format: 'conversation-v1';
  /** The conversation itself — an `AgentRunCheckpoint` for `'conversation-v1'`. */
  readonly data: AgentRunCheckpoint;
  /** Wall-clock when it was packed. Diagnostic. */
  readonly savedAt: number;
}

/**
 * Why a session is being woken.
 *
 * One member, because one thing in this release can actually fire it: a request
 * arrived for that session. Naming reasons nothing can produce would be an
 * interface describing a system that does not exist.
 */
export type WakeReason = 'invoke';

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
}
