/**
 * hosting/nodeHost — the plain HTTP adapter, built on `node:http` and nothing
 * else.
 *
 *   const host = nodeHost({ port: 8080 });
 *   const handle = await host.serve(async (request, reply) => {
 *     reply.complete(await answer(request.input));
 *   });
 *
 * Two routes: `POST /invoke` takes `{ input, sessionId?, decision? }` and
 * answers `{ output }` — or `{ awaiting }` with a **202** when the run stopped
 * to ask a person something, which a later `POST` carrying `decision` continues;
 * `GET /health` answers `{ status: 'ok' }`. The same `POST` also carries the
 * artifact wire operations (9.23.0): `{ op: 'artifact-head', ref, sessionId }`
 * answers `{ artifact: { ref, meta } }` and `{ op: 'artifact-get', … }` adds
 * `data` — a screen redeeming a claim ticket under the same session identity
 * the conversation's own requests present. Both paths are
 * options, because the paths are the part most likely to be dictated to you by
 * whatever is in front of the process — a load balancer, a container contract,
 * a colleague's convention. A path is a deployment detail, so it is a knob
 * here and absent from the port entirely.
 *
 * **The socket can be yours.** Pass `server` — a `node:http` server you
 * created and listened on — and this adapter attaches its two routes to it
 * instead of binding one, so a WebSocket upgrade or your own routes can share
 * the port. `close()` then detaches and drains, and your socket stays up.
 *
 * **Or the socket can be the host's and the routes yours.** Pass `onUnhandled`
 * and every path this adapter does not own is handed to your code instead of
 * collecting its 404 — the same one port, bound by the host rather than by you.
 * The two are opposite ends of one seam and are refused together.
 *
 * **There is a third door.** `serveConversations(handler)` takes WebSocket
 * upgrades on `/conversation` and hands each one to your handler as a
 * `HostConversation` — a channel that stays open, for the callers that cannot
 * host an inbound endpoint and dial out instead. It shares this host's socket
 * with `/invoke` and `/health`, needs nothing installed, and declares what it
 * caps.
 *
 * **Streaming is the caller's choice, not the server's.** Send
 * `Accept: text/event-stream` and the reply is Server-Sent Events, one `chunk`
 * event per `reply.emit(...)` then a final `complete`. Send anything else and
 * the same handler produces one JSON body — it emits into a buffer that the
 * completion settles. The handler cannot tell the difference and does not need
 * to, which is the property `capabilities` exists to describe.
 *
 * Pattern: Adapter. What is specific to THIS adapter is its two paths and its
 * JSON dialect (`jsonWire` below) — nothing else. The HTTP work itself lives in
 * `httpHost.ts` and is shared with every other HTTP adapter, so two of them can
 * never quietly drift apart on what `close()` drains or what a handler that
 * throws does. `types.ts` knows none of it either way.
 */

import { artifactWireBody, readArtifactWireOp } from './artifactWire.js';
import {
  headerValue,
  httpHost,
  type HttpHost,
  type HttpHostHandle,
  type HttpWire,
} from './httpHost.js';
import type { ConversationLimits } from './types.js';

/** Options for {@link nodeHost}. */
export interface NodeHostOptions {
  /** Port to bind. Default `8080`. Pass `0` for an ephemeral port. Refused alongside `server`. */
  readonly port?: number;
  /** Interface to bind. Default `'0.0.0.0'`. Refused alongside `server`. */
  readonly hostname?: string;
  /** Path that takes a request. Default `'/invoke'`. */
  readonly invokePath?: string;
  /** Path that answers a health probe. Default `'/health'`. */
  readonly healthPath?: string;
  /**
   * Path that takes a conversation upgrade. Default `'/conversation'` — this
   * adapter's own word, chosen the way its other two paths were, and named for
   * what it carries rather than for what any runtime calls it.
   */
  readonly conversationPath?: string;
  /**
   * What the conversation door caps. Defaults to one mebibyte per frame and one
   * mebibyte held before a handler subscribes — declared, so
   * `host.conversationLimits` always reports what is really enforced. This
   * adapter declares no `idleMs`: it does not idle a conversation out, and
   * reporting a ceiling it neither imposes nor sits behind would be inventing
   * a fact.
   */
  readonly conversationLimits?: ConversationLimits;
  /**
   * A `node:http` server **you** own, already listening. Given one, this
   * adapter attaches its two routes to it instead of binding a socket of its
   * own — the only way to serve something else (a WebSocket upgrade, routes
   * that were there first) on the same port, which matters when the thing
   * running your process gives it exactly one.
   *
   * You keep `listen()` and you keep the shutdown; `close()` detaches this
   * host and drains what it was already serving. On a server you own the host
   * never writes a 404 either: a path it does not own is yours to answer. The
   * full set of laws is on `httpHost`'s own `server` option, which this is.
   */
  readonly server?: import('node:http').Server;
  /**
   * Answer a request whose path this adapter does not own — your code, on this
   * host's socket, instead of its 404.
   *
   * The inverse of `server`: there you own the socket and lend the host two
   * paths; here the host owns the socket and lends you every path it does not
   * answer. `/invoke`, `/health` and `/conversation` never reach it, a throw
   * inside it is that request's 500, and passing it beside `server` is refused
   * by name. The full set of laws is on `httpHost`'s own `onUnhandled`, which
   * this is.
   *
   * @example  A diagnostic route beside the agent, on one port
   *   nodeHost({
   *     port: 8080,
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
  readonly onUnhandled?: (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ) => void;
  /**
   * Which header carries the session id. Default `'x-session-id'` — the header
   * this adapter has always read, now named so a deployment can change it.
   *
   * The pairing on the client side is one line:
   * `browserSessionId()` from the main barrel mints the id, keeps it, and hands
   * it back on every call.
   */
  readonly sessionHeader?: string;
  /**
   * Read the session from a cookie of this name, and ISSUE one (HttpOnly,
   * SameSite=Lax) when the request carried none — a durable per-browser
   * conversation with no client code at all.
   *
   * Off by default. The trade-offs are real and are stated in full on
   * {@link JsonWireOptions.sessionCookie} — read them before turning it on;
   * the short version is that a cookie is browser affinity and never identity,
   * and that no `Secure` flag is set because this host cannot know whether it
   * is behind TLS.
   */
  readonly sessionCookie?: string;
}

/**
 * What {@link nodeHost}'s `serve()` resolves to — a `HostHandle` that also
 * reports the `url` and `port` it actually bound, which is the only way to find
 * out when you asked for port `0`.
 */
export type NodeHostHandle = HttpHostHandle;

/** `AgentHost` narrowed to this adapter's handle. */
export type NodeHost = HttpHost;

const HOST_NAME = 'nodeHost';

/** The header this dialect reads a session id from when nobody says otherwise. */
export const DEFAULT_SESSION_HEADER = 'x-session-id';

/** What {@link jsonWireWith} lets a deployment re-decide about sessions. */
export interface JsonWireOptions {
  /**
   * Which header carries the session id. Default `'x-session-id'`, matched
   * case-insensitively (headers reach a wire already lower-cased).
   *
   * Change it when something in front of the process already stamps a
   * conversation id under its own name — a gateway, a CDN, a corporate proxy.
   * The JSON body's `sessionId` still wins over it, unchanged.
   */
  readonly sessionHeader?: string;
  /**
   * Read the session from a COOKIE of this name, and issue one when the request
   * did not carry it. Off by default.
   *
   * ── What it buys ─────────────────────────────────────────────────────────
   * A browser gets a durable conversation with **no client code at all**: the
   * first request comes back with `Set-Cookie`, and every later request carries
   * it automatically. Nothing to mint, nothing to store, nothing to remember to
   * send.
   *
   * ── What it costs, stated rather than discovered ─────────────────────────
   *  - **It is browser affinity, not identity.** The same laws as
   *    {@link HostRequest.sessionId}: a cookie is client data, anyone can send
   *    any value, and nothing here signs or verifies it. Authenticate the
   *    caller by your own means before serving the session they claimed.
   *  - **No `Secure` flag is set**, because this host cannot know whether it is
   *    behind TLS — it is routinely terminated at a proxy and answers plain
   *    HTTP itself. On the public internet, add `Secure` at your proxy or
   *    terminate TLS here; a session cookie on plain HTTP travels in the clear.
   *  - `HttpOnly` and `SameSite=Lax` ARE set: script on the page cannot read
   *    the id, and a cross-site POST does not carry it. `HttpOnly` also means
   *    your own front-end code cannot read it — if the page needs the id in
   *    hand, use `browserSessionId()` and the header instead.
   *  - **It follows the browser, not the person.** One profile is one
   *    conversation; two devices are two, and a shared machine is one.
   *  - A caller that already sent a session (body, header, or an existing
   *    cookie) is never issued a second one — two competing handles for one
   *    conversation is worse than none.
   */
  readonly sessionCookie?: string;
}

/**
 * Build this adapter's JSON dialect: `{ input, sessionId? }` in, `{ output }`
 * out, `{ status: 'ok', uptimeMs }` on the health path — with the session
 * plumbing a deployment gets to re-decide.
 *
 * Exported by name so a deployment that has to keep these exact bodies while
 * changing something else about the host reuses them rather than retyping them
 * and getting one field subtly wrong.
 */
export function jsonWireWith(options: JsonWireOptions = {}): HttpWire {
  const sessionHeader = options.sessionHeader ?? DEFAULT_SESSION_HEADER;
  const sessionCookie = options.sessionCookie;

  return {
    readRequest(facts) {
      const input = typeof facts.body.input === 'string' ? facts.body.input : '';
      // sessionId is caller data whichever way it arrives; the body wins so a
      // caller that sets both is not surprised by which one the server preferred.
      // The cookie is last, because a caller that named a session explicitly
      // meant that one — the cookie is what the BROWSER remembered, and the
      // explicit value is what this request said.
      const fromBody = typeof facts.body.sessionId === 'string' ? facts.body.sessionId : undefined;
      const fromHeader = headerValue(facts, sessionHeader);
      const fromCookie =
        sessionCookie !== undefined ? cookieValue(facts.headers.cookie, sessionCookie) : undefined;
      const carried = fromBody ?? fromHeader ?? fromCookie;
      // Issued ONLY in cookie mode, and only when this request carried no
      // session at all. A caller holding a session already has a conversation;
      // handing it a second handle would split it in two.
      const minted =
        sessionCookie !== undefined && carried === undefined ? mintSessionId() : undefined;
      const sessionId = carried ?? minted;
      // Read as-is and never coerced: `decision` is a person's answer to whatever
      // a tool asked, and this dialect does not get to decide what that looks
      // like. Its PRESENCE is the whole signal.
      const decision = facts.body.decision;
      // The artifact wire operations (9.23.0): a body naming `op` redeems a
      // claim ticket instead of starting a turn. One reader owns the grammar;
      // an op this dialect does not speak refuses there rather than quietly
      // becoming a conversation turn. The session rides body/header/cookie
      // above, exactly as every other request's does — the resolution is
      // governed by that same session identity.
      const artifact = readArtifactWireOp(facts.body);
      return {
        input,
        ...(sessionId !== undefined && { sessionId }),
        ...(decision !== undefined && { decision }),
        ...(artifact !== undefined && { artifact }),
        ...(minted !== undefined &&
          sessionCookie !== undefined && {
            responseHeaders: { 'set-cookie': sessionCookieHeader(sessionCookie, minted) },
          }),
      };
    },
    health: (uptimeMs) => ({ status: 'ok', uptimeMs }),
    output: (output) => ({ output }),
    failure: (error, code) => ({ error, ...(code !== undefined && { code }) }),
    chunk: (text) => ({ text }),
    awaiting: (pending) => ({ awaiting: pending }),
    artifact: (result) => artifactWireBody(result),
    readConversation(facts) {
      // A handshake has no body, so this dialect names the three places a
      // session id can be: the header a server-side caller sets, the cookie the
      // browser sends on its own (when cookie mode is on), and the query a
      // BROWSER has to use because the WebSocket API gives it no way to set a
      // header. Header wins, so a caller that sets both is not surprised by
      // which one the server preferred — the same rule the request dialect uses
      // for body-vs-header.
      //
      // Nothing is MINTED here, in either mode: the 101 this door writes is not
      // a reply a wire composes, so a session issued on a handshake could never
      // reach the client and would be a conversation nobody could resume.
      const sessionId =
        headerValue(facts, sessionHeader) ??
        (sessionCookie !== undefined
          ? cookieValue(facts.headers.cookie, sessionCookie)
          : undefined) ??
        facts.query.get('sessionId') ??
        undefined;
      return { ...(sessionId !== undefined && sessionId.length > 0 && { sessionId }) };
    },
  };
}

/**
 * This adapter's own JSON dialect with its defaults: the session on
 * `x-session-id`, no cookie.
 */
export const jsonWire: HttpWire = jsonWireWith();

/**
 * One cookie's value out of a `Cookie` header, or `undefined`.
 *
 * Deliberately small: it splits on `;`, takes the first `=`, and trims. It does
 * not decode, because a session id this library minted is URL-safe and a value
 * somebody else's system minted is theirs to interpret — guessing at an
 * encoding is how a session id silently becomes a different string.
 */
function cookieValue(header: string | undefined, name: string): string | undefined {
  if (header === undefined || header.length === 0) return undefined;
  for (const pair of header.split(';')) {
    const at = pair.indexOf('=');
    if (at < 0) continue;
    if (pair.slice(0, at).trim() !== name) continue;
    const value = pair.slice(at + 1).trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

/** The `Set-Cookie` this dialect issues. See {@link JsonWireOptions.sessionCookie}. */
function sessionCookieHeader(name: string, value: string): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax`;
}

/** A session id for a caller that carried none. Node 20+ has global `crypto`. */
function mintSessionId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * An HTTP host for one handler.
 *
 * @example
 *   const handle = await nodeHost({ port: 0 }).serve(handler);
 *   await fetch(`${handle.url}/invoke`, {
 *     method: 'POST',
 *     headers: { 'content-type': 'application/json' },
 *     body: JSON.stringify({ input: 'hello', sessionId: 'c-1' }),
 *   });
 *   await handle.close();
 */
export function nodeHost(options: NodeHostOptions = {}): NodeHost {
  // The shared default instance when nothing about sessions was re-decided, so
  // a host built with no options is the same object graph it always was.
  const wire =
    options.sessionHeader === undefined && options.sessionCookie === undefined
      ? jsonWire
      : jsonWireWith({
          ...(options.sessionHeader !== undefined && { sessionHeader: options.sessionHeader }),
          ...(options.sessionCookie !== undefined && { sessionCookie: options.sessionCookie }),
        });
  return httpHost({
    name: HOST_NAME,
    wire,
    // Chosen, not inherited — see the test in this folder that greps for one
    // particular runtime's container-contract path literal.
    invokePath: options.invokePath ?? '/invoke',
    healthPath: options.healthPath ?? '/health',
    conversationPath: options.conversationPath ?? '/conversation',
    ...(options.conversationLimits !== undefined && {
      conversationLimits: options.conversationLimits,
    }),
    // Passed through as given, never defaulted: with a caller-owned server
    // there is no port to default, and a port passed WITH one is a caller who
    // believes something untrue about where their agent answers — `httpHost`
    // refuses that pair by name rather than picking a winner.
    ...(options.port !== undefined && { port: options.port }),
    ...(options.hostname !== undefined && { hostname: options.hostname }),
    ...(options.server !== undefined && { server: options.server }),
    // Passed through as given for the same reason: with a caller-owned server
    // this hook is refused BY NAME rather than dropped, so a caller who asked
    // for both learns which one this host cannot honour.
    ...(options.onUnhandled !== undefined && { onUnhandled: options.onUnhandled }),
  });
}
