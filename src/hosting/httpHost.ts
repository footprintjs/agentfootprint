/**
 * hosting/httpHost — one HTTP host, parameterised by the JSON dialect it speaks.
 *
 * Everything hard about serving an agent over HTTP happens once, here: draining
 * on close, aborting when the caller hangs up, failing a handler that throws,
 * failing a handler that answers nothing, mapping refusal codes onto status
 * codes, and choosing between one JSON body and Server-Sent Events based on
 * what the caller asked for.
 *
 * Everything a deployment target gets to re-decide is an {@link HttpWire}: the
 * two paths, and the JSON body shapes — how a request names its input and its
 * session, and what a health probe, a completion, a failure, a streamed piece,
 * a pending question and a resolved artifact look like on the wire.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * `nodeHost` shipped first and hard-coded its own dialect: `{ input }` in,
 * `{ output }` out, `{ status: 'ok' }` on the health path. That was fine while
 * it was the only HTTP adapter and wrong the moment there was a second one. A
 * container runtime dictates its own body shape as surely as it dictates its
 * paths, and an adapter for it should be a CONFIGURATION of the HTTP work, not
 * a second copy of it — a copy is where the drain semantics of two adapters
 * silently diverge.
 *
 * Note what did NOT have to change for that: the ports. `AgentHost`,
 * `HostRequest` and `HostReply` say exactly what they said before. The gap was
 * in the first adapter, which had no seam, not in the port, which needed none.
 *
 * ── The second thing a deployment gets to re-decide: who owns the socket ─────
 * By default this file creates a server and listens on it. Pass `server` and it
 * attaches to yours instead — because a container is sometimes given exactly
 * one port, and an agent that privately owns the socket cannot share it with a
 * WebSocket upgrade or with routes that were there first. Attached, the host
 * answers its two paths, writes nothing on anyone else's, and `close()`
 * detaches and drains without closing a socket it never opened. That is the
 * whole difference; every other law on this page is the same either way.
 *
 * ── …and the same seam, inverted: `onUnhandled` ──────────────────────────────
 * `server` lends the host a socket somebody else owns. `onUnhandled` lends the
 * CALLER every path this host does not own on a socket the host owns. One port
 * either way; which side binds it is the only difference. The host still never
 * answers for the application — with this hook it no longer has to 404 for it
 * either. Refused alongside `server`, where unmatched paths are already the
 * caller's and a second answer would just race the first.
 *
 * ── The law under all of it ──────────────────────────────────────────────────
 * **Nothing in a request's lifecycle may ever be the process's failure.** Every
 * listener body on this page that computes is wrapped, because node calls them
 * from its own stack and a throw there is uncaught — the death of a container,
 * bought with one malformed request. Stated in full at `readJson`, which is
 * where the field found it.
 *
 * ── The third door: a conversation ───────────────────────────────────────────
 * `serveConversations(handler)` sits beside `serve(handler)` and takes upgrades
 * on `conversationPath`, because `HostRequest → HostReply` is one exchange and
 * some doors are not. Give a host a `conversationPath` and it declares
 * `'conversation'`; leave it out and `serveConversations` refuses by name.
 *
 * **Both doors share ONE socket.** That is not an optimisation, it is the
 * premise: the runtimes that need a conversation are the ones that hand a
 * container exactly one port, so a host whose two doors each bound their own
 * would fail with `EADDRINUSE` on the deployment it exists for. On a private
 * socket the server is created by whichever door opens first and closed by
 * whichever closes last; on a caller-owned one each door attaches and detaches
 * its own listener and neither touches the socket.
 *
 * Pattern: Template method via configuration (Strategy on the wire format).
 * Everything HTTP lives here and in the wires; `types.ts` knows none of it.
 */

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

import { encodeSSE } from '../stream.js';
import type { ArtifactWireRequest, ArtifactWireResult } from './artifactWire.js';
import {
  ArtifactNotCarriedError,
  HostClosedError,
  InvalidWireOpError,
  RequestTooLargeError,
  SessionsNotCarriedError,
  WireRequestRefusal,
} from './errors.js';
import type { SessionWireRequest, SessionWireResult } from './sessionWire.js';
import { SESSION_LIST_OP, SESSION_TRANSCRIPT_OP } from './sessionWire.js';
import { lowerCasedHeaders } from './headers.js';
import type {
  AgentHost,
  ConversationHandler,
  ConversationHost,
  ConversationLimits,
  HostCapability,
  HostHandle,
  HostHandler,
  HostReply,
  PendingAsk,
} from './types.js';
import {
  conversationDoor,
  type ConversationHandshake,
  type HandshakeFacts,
} from './webSocketConversation.js';

export type { ConversationHandshake, HandshakeFacts };

/** Everything a {@link HttpWire} may read when pulling a request apart. */
export interface HttpRequestFacts {
  /** The parsed JSON body, or `{}` for an empty one. */
  readonly body: Readonly<Record<string, unknown>>;
  /** Request headers with lower-cased names — so a wire never has to guess casing. */
  readonly headers: Readonly<Record<string, string>>;
  /** The query string, already parsed. */
  readonly query: URLSearchParams;
}

/**
 * The JSON dialect one deployment target speaks.
 *
 * A wire is pure: it reads facts and returns values. It never touches the
 * socket, never decides a status code, and never knows whether the reply is
 * going out as one body or as a stream of frames — those are {@link httpHost}'s
 * job, identical for every wire, which is the entire point of separating them.
 */
/**
 * One Server-Sent Event: the name it is announced under, and the body that
 * rides with it.
 */
/**
 * Where a failure came from.
 *
 * `'refused'` is the handler CHOOSING to fail with words it picked for the
 * caller. `'threw'` is an exception this host caught — the message is the
 * author's note to their own logs, and may name a query, a path or a token.
 *
 * The distinction exists because a dialect that sanitises has to sanitise the
 * right one: replacing both silences deliberate refusals, and replacing
 * neither publishes stack-trace prose to whoever is on the other end.
 */
export type FailureOrigin = 'refused' | 'threw';

export interface StreamFrame {
  readonly event: string;
  readonly data: unknown;
}

/**
 * The frames ONE streaming response is made of.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * A wire's body methods answer "what do the fields say". This answers a
 * different question: "what SHAPE is a stream". This host's own dialect frames
 * one homogeneous `chunk` per piece and one terminal frame, and that is a real
 * shape — but it is not the only one. Several protocols in wide use frame a
 * stream as a LIFECYCLE instead: named events that open a response, announce
 * that output is beginning, carry deltas, close each part, and close the
 * response — every event referring to one response object by id, often
 * numbered.
 *
 * Those cannot be expressed as "a body shape per chunk", because one host
 * lifecycle point becomes SEVERAL frames, and because the frames share state
 * (an id minted once, a counter that only goes up). So a dialect that frames
 * this way supplies one of these PER RESPONSE and keeps that state in it.
 *
 * ── The default is one of these ──────────────────────────────────────────────
 * A wire that supplies none gets framing built from its own body methods —
 * `chunk`/`complete`/`error`, exactly as before. The incumbent shape is an
 * INSTANCE of this seam rather than a special case beside it, which is the
 * reason to believe the seam is in the right place.
 */
export interface StreamFraming {
  /**
   * Frames to write the moment the stream opens, before the handler runs.
   * Absent or empty means the stream announces itself with nothing, which is
   * this host's own behaviour.
   */
  open?(): readonly StreamFrame[];
  /** Frames for one piece of streamed output. */
  chunk(text: string): readonly StreamFrame[];
  /** Frames that close a response that completed. */
  complete(output: string): readonly StreamFrame[];
  /** Frames that close a response that failed. */
  failure(message: string, code?: string, origin?: FailureOrigin): readonly StreamFrame[];
  /**
   * Frames that close a response ending in one of the other terminals. Absent
   * means the single-frame default, so a framing written for text alone keeps
   * working when an artifact or a paused run comes back through it.
   */
  awaiting?(pending: PendingAsk): readonly StreamFrame[];
  artifact?(result: ArtifactWireResult): readonly StreamFrame[];
  sessions?(result: SessionWireResult): readonly StreamFrame[];
}

export interface HttpWire {
  /**
   * Pull the port's vocabulary out of one request. Anything the wire cannot
   * find is simply absent — a missing input is the empty string, and a missing
   * session id means "no session", never an error, because refusing a request
   * on the shape of its body is a policy decision that belongs above the
   * transport.
   */
  readRequest(facts: HttpRequestFacts): {
    readonly input: string;
    readonly sessionId?: string;
    /**
     * The end user this request is for, when this dialect has a place the
     * transport puts one (9.12.0). Lands on {@link HostRequest.userId}, whose
     * note says what it is worth and what it is not.
     *
     * Optional, and a dialect with no such place returns nothing — the honest
     * answer for a wire whose transport never carried a user. Deriving one from
     * the session id would be this file inventing an actor.
     */
    readonly userId?: string;
    /**
     * A person's answer to an outstanding question, when this request carries
     * one. Its presence is what makes a request a RESUME rather than a new
     * message, so a wire that never returns it can only ever start new turns.
     */
    readonly decision?: unknown;
    /**
     * An artifact operation this request carries instead of a message
     * (9.23.0). Read it with `readArtifactWireOp(facts.body)` — the one owner
     * of the `{ op: 'artifact-head' | 'artifact-get', ref }` grammar — rather
     * than re-deriving the op names per dialect. A dialect that never returns
     * it simply cannot serve artifact resolution; a dialect that DOES must
     * also implement {@link HttpWire.artifact}, or every resolved ref answers
     * with the named not-carried refusal.
     */
    readonly artifact?: ArtifactWireRequest;
    /**
     * A session-history operation this request carries instead of a message
     * (9.26.0). Read it with `readSessionWireOp(facts.body)` — the one owner
     * of the `{ op: 'session-list' | 'session-transcript', sessionId? }`
     * grammar. A dialect that returns it must also implement
     * {@link HttpWire.sessions}, or every resolved listing answers with the
     * named not-carried refusal.
     */
    readonly session?: SessionWireRequest;
    /**
     * Headers to put on THIS request's reply, whatever terminal it ends with
     * (9.10.0).
     *
     * It exists for one shape: a dialect that ISSUES the session it just read —
     * a `Set-Cookie` for a session the caller did not carry. The wire stays
     * pure either way; it returns a value and this file writes it, the same as
     * the body shapes beside it.
     *
     * They are merged over the reply's own `content-type` (or the SSE headers),
     * so a dialect cannot accidentally break the framing this host chose:
     * `content-type` set here is ignored.
     */
    readonly responseHeaders?: Readonly<Record<string, string>>;
  };
  /**
   * Did THIS caller ask for a stream?
   *
   * Absent, the answer is the HTTP one: an `Accept` of `text/event-stream`.
   * That is the right default and the wrong rule for dialects that carry the
   * choice in the body instead — where a client sets a field and never touches
   * `Accept`, and a host reading only the header answers one JSON body to a
   * caller waiting for events.
   *
   * Present, this is the whole answer: a dialect that says how its callers ask
   * is not second-guessed by the header. Read before any reply is framed, so it
   * decides `content-type` for the request.
   */
  wantsStream?(facts: HttpRequestFacts): boolean;
  /**
   * Framing for ONE streaming response — see {@link StreamFraming}.
   *
   * Called once per streaming request, so whatever the framing has to remember
   * across its frames (an id minted for this response, a sequence counter) is
   * per-response state and never shared between callers. Absent, this host
   * frames the stream with the wire's own body shapes.
   */
  stream?(facts: HttpRequestFacts): StreamFraming;
  /** Body for a health probe. `uptimeMs` is how long this host has been serving. */
  health(uptimeMs: number): unknown;
  /**
   * Body for a reply that completed.
   *
   * `facts` is the request that produced it, for dialects whose reply repeats
   * something the request said — a model name, a conversation id. Absent only
   * where there is no request to show: this host has none to give when a body
   * is built outside a request's own lifecycle.
   */
  output(output: string, facts?: HttpRequestFacts): unknown;
  /**
   * Body for a reply that failed. `code` is the refusal's stable code, when it
   * has one — and its PRESENCE is the signal that the message was authored by
   * this library rather than thrown by somebody's handler, which is what lets a
   * dialect decide what is safe to repeat to a caller.
   */
  failure(
    message: string,
    code?: string,
    facts?: HttpRequestFacts,
    origin?: FailureOrigin,
  ): unknown;
  /** Body for one streamed piece, when the caller asked for Server-Sent Events. */
  chunk(text: string): unknown;
  /**
   * Body for a reply that is WAITING on a person — the run paused, it is stored,
   * and a later request carrying a decision continues it.
   *
   * Optional so a wire written before this terminal existed keeps compiling and
   * keeps working. A host whose wire has no `awaiting` cannot describe the
   * question, so it reports the named refusal instead — the run is still stored
   * either way.
   */
  awaiting?(pending: PendingAsk): unknown;
  /**
   * Body for a RESOLVED artifact operation (9.23.0) — the metadata for a
   * `head`, metadata + payload for a `get`. Compose it with
   * `artifactWireBody(result)` (both shipped dialects do) so clients read one
   * shape; add dialect envelope fields beside it when the deployment's
   * contract demands them.
   *
   * Optional exactly as `awaiting` is: a wire without it keeps compiling, and
   * a resolved ref on such a wire is answered with the named
   * `ArtifactNotCarriedError` refusal instead of an improvised body.
   */
  artifact?(result: ArtifactWireResult): unknown;
  /**
   * Body for a RESOLVED session-history operation (9.26.0) — the caller's own
   * sessions for a list, one owned session's messages for a transcript.
   * Compose it with `sessionWireBody(result)` (both shipped dialects do) so
   * clients read one shape.
   *
   * Optional exactly as `artifact` is: a wire without it keeps compiling, and
   * a resolved listing on such a wire is answered with the named
   * `SessionsNotCarriedError` refusal instead of an improvised body.
   */
  sessions?(result: SessionWireResult): unknown;
  /**
   * Pull the port's vocabulary out of one conversation handshake — the session
   * this conversation claims, any header mapping this dialect performs, and the
   * subprotocol to echo.
   *
   * Optional, and absent means "raw headers, no session": there is no body in a
   * handshake, so a dialect that wants a session id has to name where it looks,
   * and guessing on its behalf would invent an affinity rule the deployment
   * never agreed to.
   */
  readConversation?(facts: HandshakeFacts): ConversationHandshake;
}

/** Options for {@link httpHost}. */
export interface HttpHostOptions {
  /**
   * Which adapter this is. Every refusal names it, so a caller reading an error
   * learns which adapter said no rather than which file it came from.
   */
  readonly name: string;
  /** The JSON dialect this host speaks. */
  readonly wire: HttpWire;
  /**
   * Path that takes a request. **Required, deliberately.** A default here would
   * be inherited by every adapter built on this file, and a default that
   * silently matched one runtime's container contract is exactly how a vendor
   * leaks into a library that promises not to know about one.
   */
  readonly invokePath: string;
  /** Path that answers a health probe. Required, for the same reason. */
  readonly healthPath: string;
  /**
   * Port to bind. Default `8080`. Pass `0` for an ephemeral port.
   *
   * Refused together with {@link HttpHostOptions.server}: a server you own
   * already has an address, and a port here would name a socket this host does
   * not bind.
   */
  readonly port?: number;
  /** Interface to bind. Default `'0.0.0.0'`. Refused together with `server`, for the same reason. */
  readonly hostname?: string;
  /** What this adapter claims beyond the baseline. Default `['streaming']`. */
  readonly capabilities?: readonly HostCapability[];
  /**
   * A `node:http` server **you** own. Given one, this host ATTACHES its two
   * routes to it instead of creating and listening on a server of its own.
   *
   * ── Why ──────────────────────────────────────────────────────────────────
   * Some runtimes hand a container exactly one port, and a container that must
   * also answer a WebSocket upgrade — or anything else — on that port cannot
   * use a host that privately owns the socket. Attaching costs nothing anyone
   * else was using: `node:http` calls EVERY `'request'` listener for every
   * request, so this host and your own routes share the port by taking turns.
   *
   * ── What changes, exactly ────────────────────────────────────────────────
   *  - **You own the socket.** `listen()` is yours, and so is closing it. The
   *    server must ALREADY be listening when `serve()` is called — a handle
   *    that promises `url` and `port` cannot honestly report an address that
   *    does not exist yet, so `serve()` refuses rather than guess one.
   *  - **The host never writes a 404.** A path it does not own is yours to
   *    answer, and answering it with a refusal from this host would be this
   *    host answering for your application. Note the consequence: a request no
   *    listener answers is not a 404, it HANGS — if this server has no other
   *    `'request'` listener, unmatched paths go unanswered until the socket
   *    times out. With no `server`, the 404 behaviour is unchanged.
   *  - **`close()` detaches and drains, and leaves your server listening.** It
   *    removes this host's listener, waits for the requests it is already
   *    serving, and touches nothing else — not your connections, not your
   *    socket.
   *  - It never writes to a response an earlier listener already answered.
   *  - **A framework in front of it may mean this host never sees a request at
   *    all.** Frameworks that install a catch-all handler answer everything
   *    that reaches them, and a request they answered is finished before this
   *    host's listener runs. Register the framework's own route for these two
   *    paths and delegate to the host from inside it — or let the host own the
   *    socket and put your routes on {@link HttpHostOptions.onUnhandled}.
   *
   * @example  One port, an agent and a WebSocket upgrade
   *   const server = createServer();
   *   server.on('upgrade', (req, socket, head) => acceptWebSocket(req, socket, head));
   *   await new Promise<void>((r) => server.listen(8080, '0.0.0.0', r));
   *   const handle = await httpHost({ ...wireOptions, server }).serve(handler);
   *   // …later: the host goes away, the socket and the upgrade stay.
   *   await handle.close();
   */
  readonly server?: Server;
  /**
   * Path that takes a conversation upgrade.
   *
   * **No default, for exactly the reason `invokePath` has none** — a default
   * here is inherited by every adapter built on this file, and one that
   * silently matched somebody's runtime contract is that runtime leaking into a
   * library that promises not to know about one.
   *
   * ABSENT is meaningful: the host does not declare `'conversation'` and
   * {@link HttpHost.serveConversations} refuses by name. Present, and the host
   * can carry conversations whether or not anybody serves them.
   */
  readonly conversationPath?: string;
  /**
   * What the conversation door caps. Whatever is left out is filled with this
   * file's defaults and then DECLARED, so `conversationLimits` on the host is
   * always what is actually enforced rather than what was passed in.
   *
   * An unset `maxFrameBytes` would mean an unbounded buffer somebody else
   * fills, which is a way to kill this process; an unset `maxPendingBytes` the
   * same, one layer up. `idleMs` has no default because this door does not idle
   * anything out — it reports the ceiling of whatever sits in front of it, and
   * inventing one would be reporting a fact nobody established.
   */
  readonly conversationLimits?: ConversationLimits;
  /**
   * Answer a request whose path this host does not own — **your** code, on this
   * host's socket, INSTEAD of this host's 404.
   *
   * ── The law it states ────────────────────────────────────────────────────
   * The host never answers for the application. With this hook it no longer has
   * to 404 for it either: an unowned path arrives exactly as it came off the
   * wire, and what happens next is yours — a route of your own, a file, your
   * own 404, or nothing at all.
   *
   * This is the inverse of {@link HttpHostOptions.server}. There, you own the
   * socket and lend the host two paths; here, the host owns the socket and
   * lends you everything else. Same single port, opposite direction, and the
   * one to reach for when the host is the only thing that needs to bind.
   *
   * ── What it never receives ───────────────────────────────────────────────
   * The paths this host OWNS: `invokePath`, `healthPath` and `conversationPath`
   * — including a wrong METHOD on one of them, which is still this host's
   * question to answer. A hook that could claim `POST /invoke` would be a
   * second door wearing the first one's name.
   *
   * Absent, nothing changes: an unmatched path gets the same 404 it always did,
   * byte for byte.
   *
   * ── Private-server mode only ─────────────────────────────────────────────
   * Passed together with a caller-owned {@link HttpHostOptions.server} it is
   * REFUSED at construction, by name. There, unmatched paths are already yours
   * — they fall through to your own `'request'` listeners untouched — so this
   * would be a second answer to one question, and which answer won would depend
   * on the order two listeners were registered in.
   *
   * ── Two costs, stated rather than discovered ─────────────────────────────
   *  - A throw here is THAT REQUEST's 500 and never the process's failure, the
   *    same as everything else in a request's lifecycle.
   *  - A hook that answers NOTHING leaves the request hanging until it times
   *    out — the same price, for the same reason, as the 404 a caller-owned
   *    server does not get.
   *
   * @example  A diagnostic route beside the agent, on one port
   *   httpHost({
   *     ...wireOptions,
   *     onUnhandled: (req, res) => {
   *       if (req.url === '/debug/trace') {
   *         res.writeHead(200, { 'content-type': 'application/json' });
   *         res.end(JSON.stringify(lastTrace));
   *         return;
   *       }
   *       res.writeHead(404, { 'content-type': 'application/json' });
   *       res.end('{"error":"no such route"}');
   *     },
   *   });
   */
  readonly onUnhandled?: (req: IncomingMessage, res: ServerResponse) => void;
  /**
   * Ceiling on a request body, in bytes. Default: **none**.
   *
   * ── Why the default is no ceiling ────────────────────────────────────────
   * Not because unbounded is right — it is not. A body is memory this process
   * pays for while somebody else fills it, and a host without a ceiling can be
   * stopped by one caller with a large POST. The default is absent because
   * every adapter built on this file inherited unbounded reads before this
   * option existed, and a number chosen here would silently start refusing
   * requests that deployments are serving today.
   *
   * **Set it.** A deployment that knows the largest body it legitimately
   * carries should say so; a request over the line is refused with
   * `ERR_REQUEST_TOO_LARGE` (413) and the read is abandoned at the byte that
   * crossed it, rather than buffered to the end and then judged.
   */
  readonly maxBodyBytes?: number;
  /**
   * Answer `HEAD` on the invoke path with 204, instead of the 404 an unowned
   * method gets. Default `false`.
   *
   * Some deployment contracts probe a door before using it — "is the agent
   * here?" — and a probe is not a turn: nothing is read, nothing is run, and
   * the body is empty by definition. Opt-in, because a host that answered it
   * unasked would change what every existing adapter says to a method it has
   * always declined.
   */
  readonly invokeHeadProbe?: boolean;
}

/** A {@link HostHandle} that also says where it landed. */
export interface HttpHostHandle extends HostHandle {
  /**
   * Where it is actually listening, e.g. `http://127.0.0.1:53211`. With a
   * caller-owned {@link HttpHostOptions.server} this is that server's real
   * address — the host reports where it is answering, never where it bound,
   * because with your server it bound nothing.
   */
  readonly url: string;
  /** The port it actually bound — the real one, when you asked for `0`. */
  readonly port: number;
}

/**
 * {@link AgentHost} and {@link ConversationHost} narrowed to an HTTP handle.
 *
 * One object with two doors, because they share one socket. Whether the
 * conversation door is USABLE is `capabilities`' answer, not this type's: a
 * host built without a `conversationPath` still has the method and refuses by
 * name, which is a better error than a method that is missing at runtime on
 * some adapters and present on others.
 */
export interface HttpHost extends AgentHost, ConversationHost {
  serve(handler: HostHandler): Promise<HttpHostHandle>;
  serveConversations(handler: ConversationHandler): Promise<HttpHostHandle>;
}

/**
 * Status codes mapped by refusal code. Anything else is a 500.
 *
 * Not one of them is a 5xx: none of them is the agent breaking. A closed host is
 * shutting down (503); four are conflicts with the state the session is already
 * in (409) — a run already going, a question already outstanding, a decision
 * with nothing to decide, a pause this reply cannot describe. A 500 would tell
 * every dashboard that ever sees it something untrue.
 *
 * `ERR_DECISION_REQUIRED` is the one 400 (8.13.0): the session is in a perfectly
 * consistent state and it is the REQUEST that is wrong — it answered a consent
 * gate with a value instead of a decision. Nothing ran and the pause is still
 * there, so the same caller can send the right shape and continue.
 *
 * The artifact rows (9.23.0) follow the same reading. The two 400s are
 * requests the same caller can fix (a malformed wire op; an op with no
 * session). `ERR_ARTIFACT_NOT_FOUND` is 404 — the honest HTTP word for "no
 * data at this name", and deliberately ONE status for missing, expired and
 * another-session's alike, so the wire teaches a caller nothing about scopes
 * it does not own. The two 501s are deployments that cannot do this at all —
 * an agent without a store, a wire without the body shape — which no retry
 * and no different request will change.
 */
const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  ERR_HOST_CLOSED: 503,
  ERR_CONCURRENT_RUN: 409,
  ERR_PAUSE_NOT_CARRIED: 409,
  ERR_AWAITING_DECISION: 409,
  ERR_NO_PENDING_ASK: 409,
  ERR_DECISION_REQUIRED: 400,
  ERR_INVALID_WIRE_OP: 400,
  ERR_ARTIFACT_SESSION_REQUIRED: 400,
  ERR_ARTIFACT_NOT_FOUND: 404,
  ERR_NO_ARTIFACT_STORE: 501,
  ERR_ARTIFACT_NOT_CARRIED: 501,
  // 9.26.0 — the badge, the bouncer and the history desk.
  //   401: this caller was not identified (a token that did not verify, or one
  //        that was never presented at a door that insists).
  //   503: the VERIFIER could not answer — an outage on this side, and telling
  //        every client to re-authenticate against an unreachable provider is
  //        the wrong instruction at the worst moment.
  //   429: admission said no. The one status a client is expected to back off
  //        on, which is exactly what a spend bound wants it to do.
  //   404: a transcript this caller may not have — one answer for missing,
  //        foreign and owner-less alike.
  //   501: the door was never given what the op needs (no verifier, no owner
  //        index, no wire body shape) — a gap in THIS deployment, not a bad
  //        request the caller could fix by sending something else.
  ERR_IDENTITY_NOT_VERIFIED: 401,
  ERR_IDENTITY_VERIFIER_UNAVAILABLE: 503,
  ERR_ADMISSION_REFUSED: 429,
  ERR_SESSION_NOT_FOUND: 404,
  ERR_SESSION_OP_NEEDS_IDENTITY: 501,
  ERR_SESSION_INDEX_UNAVAILABLE: 501,
  ERR_SESSIONS_NOT_CARRIED: 501,
  ERR_REQUEST_TOO_LARGE: 413,
};

/**
 * What a run that stopped to ask a person answers with: **202 Accepted.**
 *
 * The request was understood and acted on, and the work is not finished — which
 * is what 202 means and what nothing else in the 2xx range means. Not 200: there
 * is no answer. Not 4xx or 5xx: nothing was refused and nothing broke.
 */
const AWAITING_STATUS = 202;

const DEFAULT_CAPABILITIES: readonly HostCapability[] = ['streaming'];

/**
 * What a conversation door caps when the deployment did not say.
 *
 * Both are memory this process pays for while somebody else fills it, so
 * "unlimited" is not one of the options — and since what is enforced must be
 * what is declared, the resolved numbers are what the host reports.
 * One mebibyte is chosen as a number large enough that no ordinary protocol
 * frame meets it and small enough that a hostile one cannot spend the heap;
 * a deployment with a real ceiling passes its own.
 */
const DEFAULT_CONVERSATION_LIMITS = {
  maxFrameBytes: 1_048_576,
  maxPendingBytes: 1_048_576,
} as const;

/**
 * An HTTP host for one handler, speaking the dialect you hand it.
 *
 * @example  The same machinery, two dialects
 *   httpHost({ name: 'nodeHost', wire: jsonWire, invokePath: '/invoke', healthPath: '/health' });
 *   httpHost({ name: 'myRuntime', wire: myWire, invokePath: '/v1/run', healthPath: '/up' });
 */
export function httpHost(options: HttpHostOptions): HttpHost {
  const { name, wire, invokePath, healthPath, conversationPath } = options;
  const { maxBodyBytes, invokeHeadProbe = false } = options;
  if (maxBodyBytes !== undefined && (!Number.isInteger(maxBodyBytes) || maxBodyBytes <= 0)) {
    throw new TypeError(
      `[hosting] ${name}: maxBodyBytes must be a positive integer; received ${String(
        maxBodyBytes,
      )}.`,
    );
  }
  const ownServer = options.server;
  // Refused at construction, not ignored at serve time: a `port` next to a
  // server this host does not bind is a caller who believes something untrue
  // about where their agent will answer, and silently dropping it is how they
  // stay believing it.
  if (ownServer && (options.port !== undefined || options.hostname !== undefined)) {
    throw new Error(
      `[hosting] httpHost('${name}') was given both a caller-owned 'server' and a ` +
        `'${options.port !== undefined ? 'port' : 'hostname'}'. A server you own already has ` +
        `an address, and this host binds nothing when you pass one. Drop the port/hostname, ` +
        `or drop the server and let this host bind its own socket.`,
    );
  }
  // Refused at construction for the same reason and in the same breath: on a
  // server the caller owns, unmatched paths ALREADY reach their own listeners,
  // so a hook for them here is a second answer to one question and the winner
  // would be whichever listener was registered first.
  const onUnhandled = options.onUnhandled;
  if (ownServer && onUnhandled !== undefined) {
    throw new Error(
      `[hosting] httpHost('${name}') was given both a caller-owned 'server' and an ` +
        `'onUnhandled'. On a server you own, a path this host does not own is already yours — ` +
        `it falls through to your own 'request' listeners untouched — so this hook would be a ` +
        `second answer to the same question. Route unmatched paths on your server, or drop ` +
        `'server' and let this host own the socket and hand you what it does not answer.`,
    );
  }
  const port = options.port ?? 8080;
  const hostname = options.hostname ?? '0.0.0.0';
  /**
   * The paths this host answers on. Everything else is unowned and may be
   * handed to `onUnhandled` — the conversation path included in the ownership,
   * because a door that takes upgrades still OWNS its path when something
   * arrives on it that is not one.
   */
  const ownsPath = (path: string): boolean =>
    path === invokePath || path === healthPath || path === conversationPath;
  // A door that exists is a capability that can be honoured; one built without
  // a path is not, and says so rather than being discovered at runtime.
  const capabilities =
    options.capabilities ??
    (conversationPath !== undefined
      ? ([...DEFAULT_CAPABILITIES, 'conversation'] as const)
      : DEFAULT_CAPABILITIES);
  // Resolved once, declared as resolved: `host.conversationLimits` is what is
  // actually enforced, never what was passed in and quietly topped up.
  const conversationLimits: ConversationLimits = {
    ...DEFAULT_CONVERSATION_LIMITS,
    ...options.conversationLimits,
  };

  // ── The socket both doors stand on ─────────────────────────────────
  //
  // Refcounted, because the deployment this exists for hands a container ONE
  // port: two doors that each bound their own would be `EADDRINUSE` on exactly
  // the machine that needed both. First door in creates and listens; last door
  // out drains and closes. On a caller-owned server there is nothing to count —
  // the socket was never ours to open or to close.
  let socket: Promise<Server> | undefined;
  let holders = 0;

  async function acquireSocket(): Promise<Server> {
    if (ownServer) {
      if (!ownServer.listening) {
        throw new Error(
          `[hosting] httpHost('${name}') was handed a server that is not listening yet. ` +
            `This handle promises the url and port it is answering on, and a server with ` +
            `no address has neither. Call server.listen(...) first, then serve() — ` +
            `attaching after listen() is safe and is the intended order.`,
        );
      }
      return ownServer;
    }
    holders += 1;
    socket ??= (async () => {
      const { createServer } = await import('node:http');
      const created = createServer();
      await new Promise<void>((resolve, reject) => {
        created.once('error', reject);
        created.listen(port, hostname, resolve);
      });
      return created;
    })();
    try {
      return await socket;
    } catch (err) {
      // A socket that never came up is not one anybody is holding.
      holders -= 1;
      socket = undefined;
      throw err;
    }
  }

  async function releaseSocket(): Promise<void> {
    if (ownServer) return;
    holders -= 1;
    if (holders > 0) return;
    const held = socket;
    socket = undefined;
    if (!held) return;
    const server = await held.catch(() => undefined);
    if (!server) return;
    server.closeIdleConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** Where this host is answering — the caller's address, or the one we bound. */
  function addressOf(server: Server): { url: string; port: number } {
    const address = server.address();
    const tcp = typeof address === 'object' && address !== null ? address : undefined;
    if (ownServer && !tcp) {
      throw new Error(
        `[hosting] httpHost('${name}') was handed a server bound to ${JSON.stringify(address)}` +
          ` — a pipe or socket path, which has no port. This handle promises a url and a ` +
          `port, and inventing one would be worse than refusing. Serve on a TCP server, or ` +
          `drive the handler yourself.`,
      );
    }
    const boundPort = tcp ? tcp.port : port;
    // With our own socket the requested hostname IS the answer; with the
    // caller's we ask the socket, because we never chose it.
    const boundHost = ownServer ? tcp?.address ?? '127.0.0.1' : hostname;
    const displayHost = boundHost === '0.0.0.0' || boundHost === '::' ? '127.0.0.1' : boundHost;
    return { url: `http://${displayHost}:${boundPort}`, port: boundPort };
  }

  let conversationsServing = false;

  return {
    name,
    capabilities,
    conversationLimits,

    async serveConversations(handler: ConversationHandler): Promise<HttpHostHandle> {
      if (conversationPath === undefined) {
        throw new Error(
          `[hosting] the '${name}' host was built without a 'conversationPath', so it has no ` +
            `door to take conversations on and does not declare 'conversation' in its ` +
            `capabilities. Build it with a conversationPath, or feature-detect with ` +
            `host.capabilities.includes('conversation') and use serve() instead.`,
        );
      }
      if (conversationsServing) {
        throw new Error(
          `[hosting] the '${name}' host is already serving conversations on ` +
            `'${conversationPath}'. One door, one handler — two would make which handler ` +
            `receives a conversation depend on registration order. Close the first handle ` +
            `before serving again.`,
        );
      }
      conversationsServing = true;

      let accepting = true;
      let closing: Promise<void> | undefined;
      const door = conversationDoor({
        hostName: name,
        path: conversationPath,
        limits: conversationLimits,
        ...(wire.readConversation && { readConversation: wire.readConversation.bind(wire) }),
        handler,
        accepting: () => accepting,
      });

      const onUpgrade = (request: IncomingMessage, socketOfConversation: Duplex): void => {
        // THE LAW again, on the other door: an `'upgrade'` listener runs on
        // node's own stack too, so a throw here is uncaught and would end every
        // OTHER conversation — and every request — for one bad handshake.
        let claimed: boolean;
        try {
          claimed = door.handleUpgrade(request, socketOfConversation);
        } catch {
          // The door answers its own refusals; anything that got past them
          // costs THIS socket and nothing else.
          socketOfConversation.destroy();
          return;
        }
        if (claimed) return;
        // Not our path. On the caller's server that is theirs to answer or to
        // ignore, exactly as an unmatched request path is; on ours nobody else
        // can, so leaving the socket hanging would be the one dishonest option.
        //
        // `onUnhandled` deliberately does NOT extend here: it is a hook for
        // ROUTES, and an upgrade is a protocol handover with a socket to answer
        // by hand rather than a response to write. An unclaimed upgrade on a
        // private socket keeps exactly the answer it has always had.
        if (ownServer) return;
        socketOfConversation.end(
          'HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n' +
            `[hosting] the '${name}' host takes conversations on ${conversationPath}.`,
        );
      };

      let server: Server;
      try {
        server = await acquireSocket();
      } catch (err) {
        conversationsServing = false;
        throw err;
      }
      server.on('upgrade', onUpgrade);
      let where: { url: string; port: number };
      try {
        where = addressOf(server);
      } catch (err) {
        server.off('upgrade', onUpgrade);
        conversationsServing = false;
        await releaseSocket();
        throw err;
      }

      return {
        url: where.url,
        port: where.port,
        close(): Promise<void> {
          closing ??= (async () => {
            accepting = false;
            if (ownServer) server.off('upgrade', onUpgrade);
            // End the live conversations BEFORE letting go of the socket. An
            // upgraded socket keeps `server.close()` waiting forever — measured,
            // not assumed — so a door that walked away from its conversations
            // would hang every shutdown that shares this socket.
            await door.closeAll(`the '${name}' host is shutting down`);
            if (!ownServer) server.off('upgrade', onUpgrade);
            conversationsServing = false;
            await releaseSocket();
          })();
          return closing;
        },
      };
    },

    async serve(handler: HostHandler): Promise<HttpHostHandle> {
      const startedAt = Date.now();
      const inFlight = new Set<Promise<void>>();
      let accepting = true;
      let closing: Promise<void> | undefined;

      const route = (req: IncomingMessage, res: ServerResponse): void => {
        // On a shared server an earlier listener may already have answered.
        // Writing again would corrupt its reply; there is nothing to add.
        if (res.headersSent) return;
        const path = (req.url ?? '').split('?')[0];

        if (req.method === 'GET' && path === healthPath) {
          sendJson(res, 200, wire.health(Date.now() - startedAt));
          return;
        }
        // A capability probe, not a turn: nothing is read and nothing is run,
        // so it is answered before the body machinery below ever sees it.
        if (invokeHeadProbe && req.method === 'HEAD' && path === invokePath) {
          res.writeHead(204, { allow: 'HEAD, POST' });
          res.end();
          return;
        }
        if (req.method !== 'POST' || path !== invokePath) {
          // On a server we own, an unmatched path is nobody else's, so saying
          // so is the honest answer. On a server the CALLER owns it is theirs,
          // and a 404 from us would answer for their application.
          if (ownServer) return;
          // …and on a socket THIS host owns, the caller can still claim the
          // paths it does not: their code, here, INSTEAD of our 404. What the
          // host owns never reaches them — a wrong method on an owned path is
          // still this host's question to answer, and a route that could shadow
          // a door would be a second door with the same name.
          if (onUnhandled !== undefined && !ownsPath(path)) {
            onUnhandled(req, res);
            return;
          }
          sendJson(res, 404, wire.failure(`no route for ${req.method ?? '?'} ${path}`));
          return;
        }
        if (!accepting) {
          const refusal = new HostClosedError(name);
          sendJson(
            res,
            STATUS_BY_CODE[refusal.code] ?? 500,
            wire.failure(refusal.message, refusal.code),
          );
          return;
        }

        const served = serveOne(req, res, handler, wire, name, maxBodyBytes);
        inFlight.add(served);
        // `serveOne` never rejects, by construction — see its doc.
        void served.finally(() => inFlight.delete(served));
      };

      // THE LAW (see `readJson`): nothing in a request's lifecycle may ever be
      // the process's failure. Routing computes — a wire's `health()`, a body
      // that has to stringify, a caller's `onUnhandled` — and every one of
      // those is somebody else's code running on node's own stack, where a
      // throw is uncaught. So the whole body is wrapped, and whatever went
      // wrong is answered to the request that caused it.
      const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
        try {
          route(req, res);
        } catch (err) {
          failSafely(res, wire, err);
        }
      };

      const server = await acquireSocket();
      server.on('request', onRequest);
      let where: { url: string; port: number };
      try {
        where = addressOf(server);
      } catch (err) {
        server.off('request', onRequest);
        await releaseSocket();
        throw err;
      }

      return {
        url: where.url,
        port: where.port,
        close(): Promise<void> {
          // Idempotent: the first call owns the shutdown, later ones await it.
          closing ??= (async () => {
            accepting = false;
            if (ownServer) {
              // Detach FIRST. The paths stop being ours the moment close() is
              // called, so a request arriving now falls through to the caller
              // rather than collecting a refusal from a host that is leaving.
              server.off('request', onRequest);
              // Then drain what we are already serving — and stop there. The
              // socket, the idle connections and the shutdown are the caller's.
              await Promise.allSettled([...inFlight]);
              return;
            }
            // Drain BEFORE touching sockets — an in-flight request is work the
            // caller is still waiting on, and dropping it would be the exact
            // thing close() promises not to do.
            await Promise.allSettled([...inFlight]);
            server.off('request', onRequest);
            // The socket goes only when the LAST door lets go of it. A
            // conversation still open on this port is not this door's to end.
            await releaseSocket();
          })();
          return closing;
        },
      };
    },
  };
}

/**
 * Run one request through the handler and write whatever it decides.
 *
 * Total by construction: this promise NEVER rejects. It is held in a Set and
 * voided at the call site, so a rejection would be an unhandled rejection —
 * which on node's defaults is the same crash the law above forbids, reached by
 * a different road.
 */
async function serveOne(
  req: IncomingMessage,
  res: ServerResponse,
  handler: HostHandler,
  wire: HttpWire,
  hostName: string,
  maxBodyBytes: number | undefined,
): Promise<void> {
  try {
    await dispatchOne(req, res, handler, wire, hostName, maxBodyBytes);
  } catch (err) {
    // Everything inside answers its own failures; anything that got past them
    // — a dialect that threw, a body that would not stringify — is still this
    // REQUEST's failure and not the process's.
    failSafely(res, wire, err);
  }
}

async function dispatchOne(
  req: IncomingMessage,
  res: ServerResponse,
  handler: HostHandler,
  wire: HttpWire,
  hostName: string,
  maxBodyBytes: number | undefined,
): Promise<void> {
  const controller = new AbortController();

  let body: Record<string, unknown>;
  try {
    body = await readJson(req, maxBodyBytes, hostName);
  } catch (err) {
    // A body over the ceiling is not a malformed body, and telling the caller
    // its JSON was invalid would send them looking for a syntax error that is
    // not there.
    if (err instanceof RequestTooLargeError) {
      sendJson(res, STATUS_BY_CODE[err.code] ?? 413, wire.failure(err.message, err.code));
      return;
    }
    sendJson(res, 400, wire.failure(`invalid JSON body: ${asError(err).message}`));
    return;
  }

  const headers = lowerCasedHeaders(req.headers);
  const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
  const facts: HttpRequestFacts = { body, headers, query };
  // Read AFTER the body, because a dialect that carries the choice in the body
  // cannot answer before there is one. Defaults to the HTTP question when the
  // dialect does not say.
  const wantsStream = wire.wantsStream
    ? wire.wantsStream(facts)
    : (req.headers.accept ?? '').includes('text/event-stream');
  let read: ReturnType<HttpWire['readRequest']>;
  try {
    read = wire.readRequest(facts);
  } catch (err) {
    // A body that NAMED a wire operation this dialect does not speak — or
    // named one and left out what it needs. The request is what is wrong, so
    // it gets its own 400 with the teaching refusal, and never falls through
    // to a model turn. Anything else a dialect throws stays what it always
    // was: this request's 500, via serveOne's catch.
    if (err instanceof InvalidWireOpError) {
      sendJson(res, STATUS_BY_CODE[err.code] ?? 400, wire.failure(err.message, err.code, facts));
      return;
    }
    // A dialect that looked at the body and refused it by name — an input kind
    // it does not carry, a field of the wrong type. Same law as above: the
    // REQUEST is what is wrong, so it gets a status the caller can act on and
    // never falls through to a model turn.
    if (err instanceof WireRequestRefusal) {
      sendJson(res, err.status, wire.failure(err.message, err.code, facts));
      return;
    }
    throw err;
  }
  const { input, sessionId, userId, decision, artifact, session, responseHeaders } = read;
  // The dialect's own reply headers — a `Set-Cookie` that issues a session, and
  // nothing else so far. Stripped of `content-type` because the framing below
  // is this host's to decide: a dialect that set it would be choosing between
  // one JSON body and Server-Sent Events on the caller's behalf.
  const extraHeaders = withoutContentType(responseHeaders);

  // One framing per streaming response, so whatever it remembers across its
  // frames belongs to this caller alone.
  const framing = wantsStream ? wire.stream?.(facts) ?? defaultFraming(wire, facts) : undefined;

  if (wantsStream) {
    res.writeHead(200, {
      ...extraHeaders,
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    writeFrames(res, framing?.open?.() ?? []);
  }

  let settled = false;
  let handlerThrew = false;
  // The caller hung up before we answered — tell the handler so it can stop
  // paying for work nobody is waiting for.
  res.once('close', () => {
    try {
      if (!settled) controller.abort();
    } catch {
      // An abort listener the HANDLER installed threw while being told the
      // caller left. That is a fault in somebody's teardown, and a fault in
      // teardown is not a reason for this process to stop serving everyone.
    }
  });

  const reply: HostReply = {
    emit(chunk: string): void {
      // Not streaming? The chunk is a preview of text `complete` will deliver
      // in full, so there is nothing to send and nothing to keep.
      if (settled || !wantsStream) return;
      writeFrames(res, framing?.chunk(chunk) ?? []);
    },
    complete(output: string): void {
      if (settled) return;
      settled = true;
      if (wantsStream) {
        writeFrames(res, framing?.complete(output) ?? []);
        res.end();
      } else {
        sendJson(res, 200, wire.output(output, facts), extraHeaders);
      }
    },
    artifact(result): void {
      if (settled) return;
      // A wire that cannot describe an artifact result must not answer 200
      // with an improvised body — a shape no client was written against is a
      // blank pane with extra steps. The named refusal says what resolved and
      // why this wire could not carry it.
      if (!wire.artifact) {
        reply.fail(new ArtifactNotCarriedError(result.ref, hostName));
        return;
      }
      settled = true;
      const payload = wire.artifact(result);
      if (wantsStream) {
        writeFrames(res, framing?.artifact?.(result) ?? [{ event: 'artifact', data: payload }]);
        res.end();
      } else {
        sendJson(res, 200, payload, extraHeaders);
      }
    },
    sessions(result): void {
      if (settled) return;
      // Same law as `artifact` above: a wire that cannot describe the result
      // says so by name rather than answering 200 with a shape no client was
      // written against.
      if (!wire.sessions) {
        reply.fail(
          new SessionsNotCarriedError(
            result.op === 'list' ? SESSION_LIST_OP : SESSION_TRANSCRIPT_OP,
            hostName,
          ),
        );
        return;
      }
      settled = true;
      const payload = wire.sessions(result);
      if (wantsStream) {
        writeFrames(res, framing?.sessions?.(result) ?? [{ event: 'sessions', data: payload }]);
        res.end();
      } else {
        sendJson(res, 200, payload, extraHeaders);
      }
    },
    awaiting(pending): void {
      if (settled) return;
      // A wire that cannot describe a question must not answer 202 with an
      // empty body — that would look like a completed request. Fall through to
      // the named refusal, which at least says what happened and where the
      // paused run is.
      if (!wire.awaiting) {
        const refusal = new Error(
          `[hosting] the run is waiting on a person and this host's wire has no ` +
            `awaiting() body shape, so the question cannot be described on the wire. ` +
            `The paused run is stored; read the pending ask from the session store.`,
        );
        (refusal as { code?: string }).code = 'ERR_PAUSE_NOT_CARRIED';
        reply.fail(refusal);
        return;
      }
      settled = true;
      const payload = wire.awaiting(pending);
      if (wantsStream) {
        writeFrames(res, framing?.awaiting?.(pending) ?? [{ event: 'awaiting', data: payload }]);
        res.end();
      } else {
        sendJson(res, AWAITING_STATUS, payload, extraHeaders);
      }
    },
    fail(error: Error): void {
      if (settled) return;
      settled = true;
      const code = (error as { code?: string }).code;
      const origin: FailureOrigin = handlerThrew ? 'threw' : 'refused';
      const payload = wire.failure(error.message, code, facts, origin);
      if (wantsStream) {
        writeFrames(res, framing?.failure(error.message, code, origin) ?? []);
        res.end();
      } else {
        sendJson(
          res,
          code !== undefined ? STATUS_BY_CODE[code] ?? 500 : 500,
          payload,
          extraHeaders,
        );
      }
    },
  };

  try {
    await handler(
      {
        input,
        ...(sessionId !== undefined && { sessionId }),
        ...(userId !== undefined && { userId }),
        ...(decision !== undefined && { decision }),
        ...(artifact !== undefined && { artifact }),
        ...(session !== undefined && { session }),
        headers,
        signal: controller.signal,
      },
      reply,
    );
  } catch (err) {
    // A handler that throws is a failed request, never a hung one — and the
    // words it threw are not the same kind of thing as the words a handler
    // CHOOSES to fail with. Dialects that care are told which this was.
    handlerThrew = true;
    reply.fail(asError(err));
  }
  // A handler that returned without answering gets one authored answer rather
  // than a socket the caller waits on until it times out.
  if (!settled) {
    reply.fail(new Error('[hosting] the handler returned without calling complete() or fail().'));
  }
}

/**
 * The body, as JSON — and never as the process's failure.
 *
 * ── A chunk is not always a Buffer ───────────────────────────────────────────
 * `'data'` delivers whatever encoding the stream is in, and the encoding is not
 * this host's to assume. Anything else holding the same request may have called
 * `req.setEncoding(...)` — a co-listener on a shared server, a framework that
 * installs its own catch-all `'request'` handler — and from that moment every
 * chunk arrives as a STRING. `Buffer.concat` on strings throws, and it threw
 * INSIDE the `'end'` listener. Field-reported, and process-fatal: see the law
 * below.
 *
 * A string chunk is coerced back rather than refused, and no bytes are lost
 * doing it: `setEncoding` decodes through a `StringDecoder`, which holds a
 * partial multi-byte sequence across a chunk boundary rather than splitting it,
 * so what arrives is whole text and `Buffer.from(chunk, 'utf8')` reproduces
 * exactly the bytes that were sent.
 *
 * ── THE LAW, stated where it was broken ─────────────────────────────────────
 * **Nothing in a request's lifecycle may ever be the process's failure.**
 * `node:http` calls these listeners from its own stack: a throw inside one is
 * not a rejected promise anybody awaits and not an exception anybody catches —
 * it is an UNCAUGHT exception, and an uncaught exception ends the process. One
 * malformed request would take every other request with it, every open
 * conversation, and — on the shared socket this file exists for — everything
 * else the container was serving.
 *
 * So every listener body here that COMPUTES is wrapped, not just the line that
 * was found to break: a surprise this file has not imagined yet becomes THIS
 * REQUEST's 400 or 500, the failure of the thing that caused it.
 */
/**
 * Write a framing's frames, in order, as Server-Sent Events.
 *
 * A framing that returns nothing writes nothing — which is how "this lifecycle
 * point has no frame in this dialect" is said.
 */
function writeFrames(res: ServerResponse, frames: readonly StreamFrame[]): void {
  for (const frame of frames) res.write(encodeSSE(frame.event, frame.data));
}

/**
 * This host's own stream shape, expressed as a {@link StreamFraming}.
 *
 * One `chunk` frame per piece, one terminal frame, both carrying the wire's own
 * body shapes — byte for byte what this file wrote before the seam existed. It
 * lives here as an ordinary framing rather than as a branch, so the shape every
 * shipped adapter depends on is exercised by the same code path a dialect's own
 * framing takes.
 */
function defaultFraming(wire: HttpWire, facts: HttpRequestFacts): StreamFraming {
  return {
    chunk: (text) => [{ event: 'chunk', data: wire.chunk(text) }],
    complete: (output) => [{ event: 'complete', data: wire.output(output, facts) }],
    failure: (message, code, origin) => [
      { event: 'error', data: wire.failure(message, code, facts, origin) },
    ],
  };
}

/**
 * Read one JSON body, refusing at the ceiling rather than after it.
 *
 * The refusal fires on the chunk that CROSSES the line: what was buffered is
 * dropped and nothing further is kept, so a caller cannot spend this process's
 * memory by sending a body it was always going to be refused for. With no
 * ceiling the read is what it has always been.
 */
function readJson(
  req: IncomingMessage,
  maxBodyBytes: number | undefined,
  hostName: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let chunks: Buffer[] = [];
    let bytes = 0;
    let refused = false;
    req.on('data', (c: Buffer | string) => {
      if (refused) return;
      try {
        const chunk = typeof c === 'string' ? Buffer.from(c, 'utf8') : c;
        bytes += chunk.byteLength;
        if (maxBodyBytes !== undefined && bytes > maxBodyBytes) {
          refused = true;
          // Let go of what was read: this request is already answered, and
          // holding its bytes until the socket drains is the cost the ceiling
          // exists to refuse.
          chunks = [];
          reject(new RequestTooLargeError(maxBodyBytes, hostName));
          return;
        }
        chunks.push(chunk);
      } catch (err) {
        reject(asError(err));
      }
    });
    req.on('error', (err) => {
      if (!refused) reject(err);
    });
    req.on('end', () => {
      if (refused) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) return resolve({});
        const parsed: unknown = JSON.parse(raw);
        resolve(parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {});
      } catch (err) {
        reject(asError(err));
      }
    });
  });
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Readonly<Record<string, string>>,
): void {
  res.writeHead(status, { ...extraHeaders, 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * A dialect's reply headers, minus the one it does not get to choose.
 *
 * `content-type` is the framing, and the framing is this host's decision — one
 * JSON body or a stream of SSE frames, picked from what the CALLER asked for. A
 * wire that set it would be answering that question for every caller at once.
 */
function withoutContentType(
  headers: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined {
  if (headers === undefined) return undefined;
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'content-type') continue;
    kept[name] = value;
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/**
 * The last answer a request can be given: its own 500.
 *
 * This is the floor under the law — reached where the ORDINARY reply path is
 * what went wrong (a dialect that threw, a body that would not stringify, a
 * caller's route handler that raised), so it assumes as little as possible and
 * cannot itself throw.
 *
 * A response already committed to the wire is ENDED rather than overwritten:
 * two half-answers on one socket is worse than one answer that stopped early,
 * and a status line cannot be taken back.
 */
function failSafely(res: ServerResponse, wire: HttpWire, err: unknown): void {
  const message = asError(err).message;
  try {
    if (res.writableEnded) return;
    if (res.headersSent) {
      res.end();
      return;
    }
    let body: string;
    try {
      body = JSON.stringify(wire.failure(message));
    } catch {
      // The DIALECT is what broke. Answer in the one shape nothing can refuse.
      body = JSON.stringify({ error: message });
    }
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(body);
  } catch {
    // The socket went away while we were answering it. There is nothing left
    // to say, and nothing here that is the process's business either.
  }
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Read a header case-insensitively from already-lower-cased facts.
 *
 * Exported because every wire that maps a header needs it and re-deriving it
 * per adapter is how one of them ends up matching only the exact casing the
 * author happened to test with.
 *
 * Takes anything carrying lower-cased headers, so a request wire and a
 * handshake wire read a header the same way rather than each growing their own.
 */
export function headerValue(
  facts: { readonly headers: Readonly<Record<string, string>> },
  name: string,
  ...fallbacks: string[]
): string | undefined {
  for (const candidate of [name, ...fallbacks]) {
    const found = facts.headers[candidate.toLowerCase()];
    if (typeof found === 'string' && found.length > 0) return found;
  }
  return undefined;
}
