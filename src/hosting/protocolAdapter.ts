/**
 * protocolAdapter — the port a wire protocol implements to speak for a run.
 *
 * OUR side of the port is the run's typed event stream, exactly as the record
 * serves it (every listener's view: the placeholder wherever a redaction policy
 * selected a value), and how the run settled. A protocol adapter turns that
 * into its own events; a framing strategy (`stream.ts` · `SseFraming`) turns
 * each of those into bytes. AG-UI (`agentfootprint/ag-ui`) is one adapter; a
 * future protocol is one more, with no change to the runner, the event stream
 * or the framing seam.
 *
 * An adapter reads the SERVED stream only. That is the whole redaction story
 * for every protocol at once: what a policy hides never reaches an adapter, so
 * no adapter can put it on a wire.
 *
 * A host that serves a protocol over a request (`streamHandler`) asks one more
 * thing of it — {@link ProtocolAdapter}: read a request as UNTRUSTED input, and
 * plan the turn from it and from what the SERVER holds for the conversation.
 * The request decides nothing the server owns: who is calling, which thread is
 * theirs, what was said before, what a paused run is waiting on.
 */

import type { AgentfootprintEvent } from '../events/registry.js';
import type { MemoryIdentity } from '../memory/identity/types.js';
import type { Tool } from '../tools/tools.js';
import type { SseFraming } from './stream.js';
import type { PendingAsk } from './types.js';

/** How a run ended, as an adapter is told — once, after its last event. */
export type RunSettlement =
  /** `run()` resolved with an answer. */
  | { readonly kind: 'finished' }
  /**
   * `run()` resolved with a pause (its `pause.request` came first). `awaiting`
   * says on whom: a PERSON's answer (the default — an approval, a question), or
   * the CALLER's — a tool whose work the caller does (an AG-UI frontend tool),
   * whose result arrives with the caller's next request. Read by whoever ran
   * the run from the pause it got back, never from a served value.
   */
  | { readonly kind: 'paused'; readonly awaiting?: 'person' | 'caller' }
  /** The run was stopped by whoever was running it, and did not fail. */
  | { readonly kind: 'cancelled' }
  /**
   * `run()` rejected. Deliberately carries NOTHING of the rejection: the
   * thrown value is the caller's own, never served — its message, stack or a
   * provider's response body may hold anything — so an adapter is never
   * handed it. It states the failure in the words of the record's served
   * `error.fatal` event when the run filed one, else in fixed words of its own.
   */
  | { readonly kind: 'failed' };

/**
 * One run's translation into a protocol's events. Opened per run, fed every
 * served event of that run in order, then settled exactly once; whatever it
 * must remember between events (open messages, ids it minted) lives in it.
 */
export interface RunTranslation<TEvent> {
  /** The protocol events one served event of the run means — zero, one or several. */
  event(event: AgentfootprintEvent): readonly TEvent[];
  /** The closing events. After this, `event` returns nothing. */
  settle(settlement: RunSettlement): readonly TEvent[];
  /**
   * What the protocol needs to continue this run in a later request once it
   * pauses — the ids it hands the caller for the answer. Plain JSON, kept with
   * the paused run.
   *
   * Asked BEFORE settling `'paused'` (with the same `awaiting`), it is the
   * record that settlement will hand out — so a host stores the pause first
   * and tells the caller only once it is kept (and settles `'failed'` when it
   * could not be). Asked after, it is what the pause handed out; after any
   * other settlement, `undefined`. Optional: a protocol with nothing to
   * remember omits it.
   */
  suspension?(awaiting?: 'person' | 'caller'): unknown;
}

// ─── The request half: what a host asks of a protocol ─────────────────

/** One request as the host read it — UNTRUSTED: a body anyone could have sent. */
export interface ProtocolRequestFacts {
  /** The request's JSON body, parsed. */
  readonly body: unknown;
  /** Header names lower-cased. */
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * The app's port: WHO is calling, and which of their conversations a request
 * continues.
 *
 * A request NAMES a conversation (AG-UI's `threadId`); naming one proves
 * nothing — anyone can send any id. So the host never keys anything by the
 * named id: it hands it, with the request's headers, to this port, which
 * authenticates the caller the app's own way (a session cookie, a bearer
 * token through `verifyRequestIdentity`) and answers with the key the server
 * keeps that conversation under — or refuses (throw a `WireRequestRefusal`,
 * or an `IdentityNotVerifiedError`, and the caller gets its status). Two
 * callers naming the same id must get two keys, or one refusal.
 */
export interface ThreadBinder {
  bind(claim: {
    /** The conversation the request names — format-checked caller data, never authority. */
    readonly conversation: string;
    /** The request's headers, names lower-cased — where a credential travels. */
    readonly headers: Readonly<Record<string, string>>;
  }): ThreadBinding | Promise<ThreadBinding>;
}

/** A conversation bound to the caller the app authenticated. */
export interface ThreadBinding {
  /**
   * The server-side key of the conversation — the session its stored turns,
   * its paused run and the agent's memory are kept under. Never the named id
   * alone: compose it from the authenticated caller.
   */
  readonly sessionId: string;
  /**
   * Who the run is for — the run's `identity` (memory namespaces on it, a
   * credential provider scopes its vault on it, a stored conversation records
   * its `principal` as the owner). From the app's authentication, never from
   * a request body.
   */
  readonly identity?: MemoryIdentity;
}

/** What the SERVER holds for the bound conversation — nothing a request carried. */
export interface HeldConversation {
  /** A stored conversation the turn continues (an Agent's). */
  readonly continues: boolean;
  /** The run waiting on an answer, when one is: what it asked, and what the protocol recorded. */
  readonly awaiting?: {
    readonly pending: PendingAsk;
    /** The protocol's own record of the pause (`RunTranslation.suspension`) — absent when another wire stored it. */
    readonly suspension?: unknown;
  };
}

/** What a request asks of its conversation: a new message, or the answer a paused run waits on. */
export type ProtocolTurn =
  | { readonly kind: 'message'; readonly message: string }
  | { readonly kind: 'answer'; readonly answer: unknown };

/** What the host knows when a protocol plans a turn. */
export interface PlanFacts {
  /** The request's headers, names lower-cased. */
  readonly headers: Readonly<Record<string, string>>;
  /** The bound conversation — absent when the host binds none. */
  readonly thread?: ThreadBinding;
  /**
   * The host keeps the conversation: it binds threads, so a run has a session
   * the agent's memory or the session store keeps. Without it, every request is
   * a conversation of one message.
   */
  readonly keepsConversation: boolean;
  /** The host keeps a paused run until the next request (threads AND a session store). */
  readonly keepsPauses: boolean;
}

/** One request's plan: the turn, and what this request's runner is built with. */
export interface ProtocolPlan {
  readonly turn: ProtocolTurn;
  /** Tools the CALLER runs this request (AG-UI frontend tools) — see {@link StreamRunContext.tools}. */
  readonly tools?: readonly Tool[];
  /** Request values the app's own validators accepted, by name. */
  readonly accepted?: Readonly<Record<string, unknown>>;
}

/**
 * What one request's runner is built with — handed to the host's runner
 * factory (`streamHandler({ agent })`), which builds a FRESH runner for every
 * request.
 */
export interface StreamRunContext {
  /**
   * The tools this request lets the CALLER run: AG-UI frontend tools the app
   * allow-listed and the page declared. Add them to the agent's own tools
   * (`.tools([...yours, ...run.tools])`). Each runs nothing on the server: a
   * call pauses the run, the page runs it, and its result arrives with the
   * page's next request. A name a server tool already has is refused when the
   * agent is built — a frontend tool never shadows a server tool.
   */
  readonly tools: readonly Tool[];
  /** Request values the app's own validators accepted, by name (AG-UI: `state`, `context`). */
  readonly accepted: Readonly<Record<string, unknown>>;
  /** The conversation this request was bound to — absent when the host binds none. */
  readonly thread?: ThreadBinding;
}

/**
 * A wire protocol a host serves runs in — `streamHandler({ agent, adapter })`.
 * AG-UI (`agUi()` from `agentfootprint/ag-ui`) is one; a future protocol is one
 * more adapter, with nothing in the host to change.
 *
 * Every method that reads the request treats it as UNTRUSTED: shapes are
 * checked field by field and refused by the field's NAME (a
 * `WireRequestRefusal`, whose status and code reach the caller), never by
 * echoing what was sent.
 */
export interface ProtocolAdapter<TRequest, TEvent> {
  /** Names the protocol — in refusals, and on a paused run's wire record. */
  readonly name: string;
  /** Read a request's body. Nothing here trusts it, and nothing the server holds is read. */
  readRequest(facts: ProtocolRequestFacts): TRequest;
  /** The conversation the request NAMES — handed to the host's {@link ThreadBinder}, never used as a key. */
  conversation(request: TRequest): string;
  /**
   * Plan the turn from the request and what the server holds for its bound
   * conversation. Refuse what cannot be served — an answer to nothing, a new
   * message while a run waits on an answer, anything the protocol carries that
   * the app did not accept.
   */
  plan(request: TRequest, held: HeldConversation, facts: PlanFacts): ProtocolPlan;
  /**
   * Does a pause wait on the CALLER — a tool this protocol let the caller run?
   * Read from the pause's own data (the host's, never served); absent means
   * every pause waits on a person.
   */
  awaitsCaller?(pauseData: unknown): boolean;
  /**
   * One translation per run. `resumed` is this protocol's own record of the
   * pause the run continues ({@link HeldConversation.awaiting}), when the turn
   * answers one.
   */
  open(request: TRequest, resumed?: unknown): RunTranslation<TEvent>;
  /**
   * How its events are written — built once per host, so a framing that loads
   * an optional peer refuses when the host is built, not mid-request. One
   * framing serves every stream at once, so it keeps nothing per stream: the
   * host counts each stream's frames and hands the number to `frame`
   * (`SseFramePosition`).
   */
  framing(): SseFraming<TEvent>;
}
