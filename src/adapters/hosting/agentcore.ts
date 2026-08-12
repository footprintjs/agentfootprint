/**
 * adapters/hosting/agentcore — AWS Bedrock **AgentCore Runtime** adapters for
 * the two hosting ports.
 *
 *   import { agentCoreRuntimeHost, agentCoreSessions } from 'agentfootprint/hosting';
 *   import { standingAgent } from 'agentfootprint/hosting';
 *
 *   const handle = await standingAgent({
 *     agent,
 *     host: agentCoreRuntimeHost(),
 *     sessions: agentCoreSessions({ store: 'session-storage' }),
 *   });
 *
 * ── What this file actually is ───────────────────────────────────────────────
 * Vendor paths, a header name, and two JSON body shapes. That is the whole
 * adapter, and it is the claim the hosting ports were designed to make: a
 * container runtime's contract is a CONFIGURATION of HTTP work that already
 * exists, not a second implementation of it. Nothing here reaches into the
 * ports, and nothing here needed the ports to change.
 *
 * AgentCore Runtime is a **container contract**: an ARM64 image serving HTTP on
 * `0.0.0.0:8080` —
 *
 *   POST /invocations   JSON `{ "prompt": "..." }` → JSON `{ "response", "status" }`
 *   GET  /ping          → `{ "status": "Healthy", "time_of_last_update": <unix seconds> }`
 *   GET  /ws            a bidirectional WebSocket, on the SAME port
 *
 * and the caller's conversation arrives in the
 * `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` header rather than in the body,
 * which is the one thing paths-and-bodies configuration alone could not
 * express before this release. Its sibling
 * `X-Amzn-Bedrock-AgentCore-Runtime-User-Id` carries WHO is calling (9.12.0) —
 * two headers, two different facts, and the second is why a served run can name
 * an actor in its audit trail without anybody configuring one.
 *
 * ── The second door ──────────────────────────────────────────────────────────
 * `/ws` is this runtime's answer for a caller that cannot host an inbound
 * endpoint — a browser, most obviously — and so dials out and parks a channel
 * instead. It is the same container and the same port, which is exactly why the
 * two doors here share one socket.
 *
 * Its wire facts are ADAPTER facts and live nowhere but this file: 32KB frames,
 * a 15-minute idle ceiling, the bearer credential carried as a
 * `Sec-WebSocket-Protocol` offer because a browser's WebSocket API cannot set a
 * header, and session affinity that has to be readable from the query string
 * for the same reason. The port knows none of it — it is handed a session id
 * and a header bag, the same two things every other transport hands it.
 *
 * ── Verification status, stated plainly ──────────────────────────────────────
 * `agentCoreRuntimeHost` is **plain HTTP and is really verified**: it runs the
 * same host conformance suite as `nodeHost`, over a real socket, in
 * `test/hosting/host-contract.test.ts`. There is no AWS SDK on its path.
 *
 * `agentCoreSessions({ store: 'memory' })` is **contract-mapped and
 * injection-tested**: its AgentCore Memory calls are exercised through the
 * `_client` seam, never against AWS. Confirm the command and field names
 * against your installed `@aws-sdk/client-bedrock-agentcore` before you rely
 * on it.
 *
 * Both modes have now been exercised against the real service by a production
 * integration, and the `'memory'` mode came back with a defect no injected fake
 * could have shown: given an OBJECT as an event's blob, the service stores its
 * own host language's `toString()` of it and returns a string that is not JSON
 * and cannot be decoded. This shim writes JSON text for exactly that reason.
 * Envelopes written by any build before 7.22.1 are unrecoverable — the mangling
 * is lossy, so there is nothing to migrate, and the honest response is a loud
 * refusal rather than a silent fresh start.
 *
 * Pattern: Adapter (GoF). Role: outer ring. The file-backed session store uses
 * `node:fs` and nothing else; the event-backed one lazy-loads the AWS SDK, so
 * importing this module costs zero peer-dep load.
 */

import { checkEnvelope } from '../../hosting/envelope.js';
import { headerValue, httpHost } from '../../hosting/httpHost.js';
import type {
  ConversationHandshake,
  HandshakeFacts,
  HttpHost,
  HttpRequestFacts,
  HttpWire,
} from '../../hosting/httpHost.js';
import type { CheckpointEnvelope, SessionLifecycle } from '../../hosting/types.js';
import { lazyRequire } from '../../lib/lazyRequire.js';

// ─── The runtime host ────────────────────────────────────────────────

const HOST_NAME = 'agentCoreRuntimeHost';

/** The runtime's container contract, as constants rather than as scattered literals. */
const INVOKE_PATH = '/invocations';
const HEALTH_PATH = '/ping';
const CONVERSATION_PATH = '/ws';
const RUNTIME_PORT = 8080;
/**
 * The header the runtime puts the caller's conversation in. Matched
 * case-insensitively — HTTP header names are case-insensitive and a proxy in
 * front of the container is free to re-case them.
 */
const SESSION_HEADER = 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id';
/**
 * The header the runtime puts the caller's END USER in — the second half of
 * "who is this request for", and the documented inbound source for per-user
 * identity (9.12.0).
 *
 * **Both names are the SDK's, not a guess.** `InvokeAgentRuntimeRequest` binds
 * `runtimeSessionId` to {@link SESSION_HEADER} and `runtimeUserId` to this one,
 * and the SDK describes this one as "an identifier for the end user making the
 * request… passed through to the runtime container" — which is what makes the
 * container's side of it this adapter's business. Verified against a real
 * install of `@aws-sdk/client-bedrock-agentcore` before this shipped.
 *
 * Matched case-insensitively, through the same `headerValue` the session uses,
 * for the same reason: a proxy in front of the container re-cases freely, and
 * two header readers that disagree about casing is how one door sees a user the
 * other cannot.
 *
 * **What it is worth, plainly.** The runtime passes this through from its front
 * door, so its trustworthiness is that door's inbound-auth configuration — with
 * JWT auth in front, it is the authenticated caller; on a container somebody
 * exposed directly, it is a string anyone can send. It is read HERE and nowhere
 * else for exactly that reason: the generic JSON wire has no such door in front
 * of it, so it reads no such header.
 */
const USER_HEADER = 'X-Amzn-Bedrock-AgentCore-Runtime-User-Id';
/**
 * What the `/ws` door caps, as the runtime imposes it — **32KB per frame and a
 * 15-minute idle timeout.**
 *
 * Declared rather than worked around. A 32KB cap hidden inside auto-chunking
 * would have this adapter deciding, for every consumer at once, how a message
 * is split and how the far side knows the last piece landed; a 15-minute idle
 * answered with an invented heartbeat would put bytes on the wire that the
 * consumer's parser never agreed to. Both belong to the protocol above this
 * door, and both are actionable only if the number is visible.
 *
 * `maxFrameBytes` is enforced here, in both directions, because a frame past it
 * would be cut by the front door anyway and a refusal that names the ceiling
 * beats a truncation that does not. `idleMs` is REPORTED: the timeout belongs
 * to what sits in front of this container, and the honest thing is to say so
 * rather than to close a channel the runtime might have kept.
 */
const CONVERSATION_LIMITS = { maxFrameBytes: 32_768, idleMs: 900_000 } as const;
/**
 * The subprotocol a browser offers to carry its bearer credential, because the
 * WebSocket API gives it no way to send an `Authorization` header.
 *
 * **The vendor spells it, so the vendor's spelling is the contract.** From
 * *Get started with bidirectional streaming using WebSocket* → "Browser
 * JavaScript client with OAuth": "The token must be base64url-encoded and
 * prefixed with `base64UrlBearerAuthorization.`, followed by the sentinel
 * subprotocol `base64UrlBearerAuthorization`." Its example offers the pair, in
 * this order:
 *
 *     new WebSocket(url, [`base64UrlBearerAuthorization.${base64url}`,
 *                          'base64UrlBearerAuthorization'])
 *
 * and the same page notes: "Subprotocols other than
 * `base64UrlBearerAuthorization` are not yet supported."
 *
 * Three things follow, and all three are the difference between a mapping and
 * a mapping that works:
 *
 *   • **Only this word.** Until 7.27.1 this adapter looked for `bearer` and
 *     `bearer.<token>` — spellings nobody documented and no browser can send
 *     through this front door, which forwards no other subprotocol. A real
 *     documented handshake matched neither and yielded `{}`: the credential
 *     silently dropped. Invented spellings are gone rather than kept beside
 *     the real one, because a door nobody can walk through should not be
 *     advertised. A generic bearer-subprotocol mapping, if one is ever wanted
 *     off this runtime, belongs to the generic wire and its own evidence.
 *
 *   • **The value is encoded.** It is base64url (unpadded), so it is decoded
 *     before it becomes `Bearer <jwt>`. A value that is not valid base64url
 *     refuses the upgrade by name: a token that does not decode is not a
 *     credential, and "authenticated with garbage" is the failure this library
 *     exists to refuse.
 *
 *   • **The echo is the sentinel.** RFC 6455 lets a server select only a
 *     subprotocol the client OFFERED, so what comes back in the 101 is the
 *     sentinel, in the client's exact spelling — never lower-cased, and never
 *     the dotted value, because a credential in a response header is a
 *     credential in every proxy log on the way home. Offer the dotted token
 *     without the sentinel and the upgrade is refused: there is then nothing
 *     safe to echo, and the browser's handshake fails either way.
 */
const BEARER_SUBPROTOCOL = 'base64UrlBearerAuthorization';

/** Options for {@link agentCoreRuntimeHost}. */
export interface AgentCoreRuntimeHostOptions {
  /**
   * Port to bind. Default `8080` — the port the container contract specifies.
   * Pass `0` in tests to take an ephemeral one.
   */
  readonly port?: number;
  /**
   * Interface to bind. Default `'0.0.0.0'`, which the contract requires: bind
   * to loopback inside the container and the runtime's health probe cannot
   * reach you.
   */
  readonly hostname?: string;
  /**
   * Report `'HealthyBusy'` instead of `'Healthy'` on the health path.
   *
   * A function, not a flag, because busy is a live fact about the process, not
   * a setting: the runtime reads it on every probe to decide whether to send
   * you more work. Omit it and the host reports `'Healthy'`, which is the
   * honest answer for an agent that answers synchronously.
   */
  readonly busy?: () => boolean;
  /**
   * A `node:http` server **you** own, already listening. Given one, this
   * adapter attaches `/invocations` and `/ping` to it instead of binding a
   * socket of its own — which is the only way to serve something else on the
   * same port, and a container gets one port.
   *
   * The case this exists for: a container that must also answer a WebSocket
   * upgrade beside the runtime's two routes. Add your `'upgrade'` listener to
   * the server, listen on 8080 yourself, and attach the agent to it.
   *
   * Every law is `httpHost`'s: unmatched paths are YOURS (this adapter writes
   * no 404 on a server it does not own), and `close()` detaches and drains
   * without closing your socket. `port` and `hostname` are refused alongside
   * it — a server you own already has an address.
   *
   * @example
   *   const server = createServer();
   *   server.on('upgrade', handleWebSocket);
   *   await new Promise<void>((r) => server.listen(8080, '0.0.0.0', r));
   *   const handle = await standingAgent({
   *     agent,
   *     host: agentCoreRuntimeHost({ server }),
   *     sessions: agentCoreSessions({ store: 'session-storage' }),
   *   });
   */
  readonly server?: import('node:http').Server;
  /**
   * Path that takes a conversation upgrade. Default `'/ws'` — the runtime's
   * own second door, beside `/invocations` on the same port.
   *
   * You do not need `server` for this: both doors share one socket by
   * construction, which is what the single-port container required.
   */
  readonly conversationPath?: string;
  /**
   * Answer a request whose path this adapter does not own — your code, on this
   * host's socket, instead of its 404.
   *
   * The inverse of `server`, and the cheaper half of it when all you need is a
   * route of your own: the host binds the container's one port as usual and
   * hands you everything it does not answer. The runtime's own three paths
   * never reach it, a throw inside it is that request's 500, and passing it
   * beside `server` is refused by name — there, unmatched paths already reach
   * your own listeners.
   *
   * @example  A diagnostic route inside the container, on the one port it has
   *   agentCoreRuntimeHost({
   *     onUnhandled: (req, res) => {
   *       res.writeHead(req.url === '/debug/trace' ? 200 : 404, {
   *         'content-type': 'application/json',
   *       });
   *       res.end(JSON.stringify(req.url === '/debug/trace' ? lastTrace : { error: 'no route' }));
   *     },
   *   });
   */
  readonly onUnhandled?: (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ) => void;
}

/**
 * The AgentCore Runtime contract as an {@link HttpWire}.
 *
 * Exported so the body shapes are inspectable and testable without binding a
 * socket, and so a deployment that must serve the same bodies from somewhere
 * else can reuse them by name.
 */
export function agentCoreRuntimeWire(busy?: () => boolean): HttpWire {
  return {
    readRequest(facts: HttpRequestFacts) {
      // `prompt` is the field the runtime's own quickstart and this repo's
      // deploy template use. `input` is accepted too because the runtime passes
      // the payload through verbatim — it is the CALLER who picks the field —
      // and refusing a caller who used the port's own word would be a rule this
      // adapter invented rather than one the contract imposes.
      const prompt = facts.body.prompt ?? facts.body.input;
      const input = typeof prompt === 'string' ? prompt : '';
      // The conversation id arrives in a header, never in the body. It is
      // caller-adjacent data, not identity — the port says so and it is just as
      // true here.
      const sessionId = headerValue(facts, SESSION_HEADER);
      // WHO the request is for — the other header the runtime forwards, and a
      // different fact from the session beside it: a session is a thread, this
      // is a person. Read as-is and absent when absent; the runtime sends it
      // only when the caller supplied one, and deriving a user from a session
      // id would put a thread's name in the actor's place.
      const userId = headerValue(facts, USER_HEADER);
      // A person's answer to a run that stopped to ask. Read as-is: what a
      // decision looks like is the tool author's business, not this dialect's.
      // Without it a deployment here could start turns but never finish one
      // that asked a question.
      const decision = facts.body.decision;
      return {
        input,
        ...(sessionId !== undefined && { sessionId }),
        ...(userId !== undefined && { userId }),
        ...(decision !== undefined && { decision }),
      };
    },
    // The runtime polls this to decide whether the container is ready and
    // whether to send it more work. `time_of_last_update` is unix SECONDS.
    health: () => ({
      status: busy?.() === true ? 'HealthyBusy' : 'Healthy',
      time_of_last_update: Math.floor(Date.now() / 1000),
    }),
    output: (response) => ({ response, status: 'success' }),
    // The message only — never a stack. The runtime surfaces the status code;
    // the body is read by whoever called the agent.
    failure: (error, code) => ({ error, status: 'error', ...(code !== undefined && { code }) }),
    // A distinct field from `response` on purpose: a caller concatenating
    // stream frames must not be able to double-count the final answer by
    // reading the same key twice.
    chunk: (chunk) => ({ chunk }),
    // Unfinished work, in this dialect's own vocabulary. `status` is neither
    // 'success' nor 'error' because it is neither: the run stopped to ask a
    // person, it is stored, and a later call carrying `decision` finishes it.
    awaiting: (pending) => ({ awaiting: pending, status: 'awaiting' }),
    readConversation: readAgentCoreConversation,
  };
}

/**
 * The `/ws` handshake, in this runtime's spelling: **header-or-query session
 * affinity, and the bearer subprotocol mapped into headers.**
 *
 * ── Why the query string is read at all ──────────────────────────────────────
 * The same header carries the session on `/invocations`, and it is preferred
 * here too. But the caller this door exists for is a browser, and the browser
 * WebSocket API cannot set a header — so a session id has nowhere to travel
 * except the URL. Both the runtime's header name and the plain `sessionId` are
 * accepted as query parameters, case-insensitively; **the header wins** when
 * both arrive, so a caller that sets both is never surprised by which one the
 * server preferred. That is the same precedence rule the request dialect uses.
 *
 * ── Why the credential becomes a header ──────────────────────────────────────
 * A bearer token offered as a subprotocol is this runtime's spelling of
 * `Authorization`, and a port field spelled the way one vendor spells it is how
 * a port stops being one. So it lands in `headers.authorization` as
 * `Bearer <token>` — the vocabulary every other transport already uses, with
 * the vendor's base64url wrapper already undone — and the raw
 * `sec-websocket-protocol` header is left in place, so an application that
 * reads the offer itself still can. **Nothing here authenticates anything**:
 * the port never proves who is calling, and a token that arrived is a claim,
 * exactly like the session id beside it.
 *
 * ── When it refuses ──────────────────────────────────────────────────────────
 * Two shapes throw rather than degrade, and both throws end this one upgrade
 * with a message naming the reason: a dotted value that is not valid base64url
 * (see {@link BEARER_SUBPROTOCOL}), and a dotted value offered without the
 * sentinel beside it. The alternative — mapping a credential nobody can read,
 * or echoing the token back to the client — is the failure shape this adapter
 * is built to refuse.
 *
 * Exported by name so the mapping is inspectable and testable without binding a
 * socket, the same way the body shapes are.
 */
export function readAgentCoreConversation(facts: HandshakeFacts): ConversationHandshake {
  const sessionId =
    headerValue(facts, SESSION_HEADER) ?? queryValue(facts, SESSION_HEADER, 'sessionId');
  const offered = bearerFromSubprotocols(facts.headers['sec-websocket-protocol']);
  return {
    ...(sessionId !== undefined && { sessionId }),
    ...(offered !== undefined && {
      headers: { authorization: `Bearer ${offered.token}` },
      // Echoed so the client's handshake completes: the SENTINEL, in the exact
      // spelling the client offered it in — RFC 6455 lets a server select only
      // something the client offered. Never the dotted value: putting the
      // token in a response header would hand the credential to every proxy on
      // the way home.
      protocol: offered.echo,
    }),
  };
}

/** A query parameter by any of several names, matched case-insensitively. */
function queryValue(facts: HandshakeFacts, ...names: string[]): string | undefined {
  const wanted = names.map((name) => name.toLowerCase());
  for (const [key, value] of facts.query.entries()) {
    if (wanted.includes(key.toLowerCase()) && value.length > 0) return value;
  }
  return undefined;
}

/**
 * The decoded token, and the sentinel to echo, out of a `Sec-WebSocket-Protocol`
 * offer written in the vendor's documented scheme. See {@link BEARER_SUBPROTOCOL}
 * for the scheme and the quotes it comes from.
 *
 * `undefined` means no credential was offered — an absence, not a failure.
 * A credential that was offered and cannot be honoured throws instead.
 */
function bearerFromSubprotocols(
  offered: string | undefined,
): { token: string; echo: string } | undefined {
  if (!offered) return undefined;
  const parts = offered
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const marker = BEARER_SUBPROTOCOL.toLowerCase();
  const prefix = `${marker}.`;
  const dotted = parts.find((part) => part.toLowerCase().startsWith(prefix));
  if (dotted === undefined) return undefined;

  // The sentinel is what may be echoed, so without it there is nothing this
  // door can answer with: echoing the dotted value would put the credential in
  // a response header, and echoing nothing fails the browser's handshake.
  // The vendor documents the pair — "prefixed with `base64UrlBearerAuthorization.`,
  // followed by the sentinel subprotocol `base64UrlBearerAuthorization`" — so a
  // lone dotted offer is a client that has not met the contract, and saying so
  // beats a connection that silently carries no credential.
  const sentinel = parts.find((part) => part.toLowerCase() === marker);
  if (sentinel === undefined) {
    throw new Error(
      `a '${BEARER_SUBPROTOCOL}.<token>' subprotocol was offered without the ` +
        `'${BEARER_SUBPROTOCOL}' sentinel beside it. AgentCore documents the pair, and the ` +
        'sentinel is the only value this door can echo — the token must never travel back ' +
        `in a response header. Offer both: ['${BEARER_SUBPROTOCOL}.<base64url-token>', ` +
        `'${BEARER_SUBPROTOCOL}']`,
    );
  }

  const encoded = dotted.slice(prefix.length);
  return { token: decodeBase64UrlToken(encoded), echo: sentinel };
}

/**
 * The bearer token out of its base64url wrapper — or a refusal.
 *
 * Node decodes `'base64url'` leniently: invalid characters are skipped and a
 * truncated group yields whatever bytes it can, so decoding alone cannot tell a
 * token from a typo. The alphabet check and the re-encode round trip can, and
 * the failure they catch matters: a value that is not a token, mapped to
 * `authorization` anyway, is a request that looks authenticated and is not.
 */
function decodeBase64UrlToken(encoded: string): string {
  const refuse = (why: string): never => {
    throw new Error(
      `the '${BEARER_SUBPROTOCOL}.<token>' subprotocol carried a value that is not a ` +
        `base64url-encoded bearer token: ${why}. AgentCore's browser scheme base64url-encodes ` +
        'the token (unpadded), and a value that does not decode is not a credential.',
    );
  };

  if (encoded.length === 0) refuse('it is empty');
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) refuse('it is not in the base64url alphabet');

  const bytes = Buffer.from(encoded, 'base64url');
  if (bytes.toString('base64url') !== encoded) refuse('it is not a whole base64url value');

  const token = bytes.toString('utf8');
  if (token.length === 0) refuse('it decodes to nothing');
  // A bearer token is printable ASCII (RFC 6750 `b64token`). Anything else
  // decoded — a control character, a newline — is not a credential, and would
  // be going into a header value.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x20\x7f]/.test(token)) refuse('it decodes to bytes that are not a bearer token');

  return token;
}

/**
 * An `AgentHost` that speaks AgentCore Runtime's container contract.
 *
 * Passes the same conformance suite as `nodeHost` — it is the same HTTP host
 * with this runtime's two paths, its header, and its two body shapes.
 *
 * @example  The container's entry point
 *   const handle = await standingAgent({
 *     agent,
 *     host: agentCoreRuntimeHost(),
 *     sessions: agentCoreSessions({ store: 'session-storage' }),
 *   });
 *   process.on('SIGTERM', () => void handle.close());
 */
export function agentCoreRuntimeHost(options: AgentCoreRuntimeHostOptions = {}): HttpHost {
  return httpHost({
    name: HOST_NAME,
    wire: agentCoreRuntimeWire(options.busy),
    invokePath: INVOKE_PATH,
    healthPath: HEALTH_PATH,
    conversationPath: options.conversationPath ?? CONVERSATION_PATH,
    conversationLimits: CONVERSATION_LIMITS,
    // With a caller-owned server this adapter binds nothing, so it must not
    // invent the contract's port either — the port is whatever the caller
    // listened on, and passing one anyway is refused by `httpHost` rather than
    // quietly ignored. An explicitly passed port still travels, so that refusal
    // reaches a caller who asked for both.
    ...(options.server !== undefined
      ? {
          server: options.server,
          ...(options.port !== undefined && { port: options.port }),
          ...(options.hostname !== undefined && { hostname: options.hostname }),
        }
      : { port: options.port ?? RUNTIME_PORT, hostname: options.hostname ?? '0.0.0.0' }),
    // Travels as given, including next to a `server` — where `httpHost` refuses
    // the pair by name rather than quietly dropping one half of what was asked
    // for.
    ...(options.onUnhandled !== undefined && { onUnhandled: options.onUnhandled }),
  });
}

// ─── The session store ───────────────────────────────────────────────

/**
 * Where {@link agentCoreSessions} keeps a conversation between requests.
 *
 *  - `'session-storage'` — a JSON file under the container's own storage. The
 *    runtime keeps that storage for the life of a session, INCLUDING across a
 *    stop/resume of the container, so a conversation survives the thing most
 *    likely to interrupt it. It does not survive the session ending.
 *  - `'memory'` — one AgentCore Memory event per persist. Outlives the session,
 *    the container and the deployment; costs an API call per turn and the
 *    `@aws-sdk/client-bedrock-agentcore` peer dependency.
 *
 * Chosen at construction, never per call: a store that silently changed where
 * it wrote would be a store you cannot reason about after an incident.
 */
export type AgentCoreSessionStore = 'session-storage' | 'memory';

/** The default file the `'session-storage'` mode writes to. */
export const DEFAULT_SESSION_STORAGE_PATH = '/tmp/agentcore-session';

/** Options for the file-backed mode. */
export interface AgentCoreFileSessionsOptions {
  readonly store: 'session-storage';
  /**
   * Where to write. Default {@link DEFAULT_SESSION_STORAGE_PATH}. One file
   * holds every session this container has seen, keyed by session id — the
   * runtime already gives each session its own storage, so the keying is
   * belt-and-braces for the case where it does not.
   */
  readonly path?: string;
}

/** One AgentCore Memory event, as this adapter cares about it. */
export interface AgentCoreSessionEvent {
  /** Server-assigned event id. */
  readonly eventId: string;
  /**
   * The envelope decoded from the event's blob payload.
   *
   * `null` means the event carried **no blob at all** — nothing here ever
   * claimed to be a session, which is an absence and hydrates as "no
   * conversation".
   *
   * A blob that IS present but could not be decoded travels here **as-is**, so
   * the shared reading law refuses it by name rather than this adapter quietly
   * calling a conversation that exists an absent one. Those are different facts
   * and only one of them is safe to answer with a fresh start.
   */
  readonly envelope: unknown;
}

/**
 * The minimal AgentCore Memory surface the session store calls. The real SDK is
 * adapted to this shape in one function below; tests inject a fake via
 * `_client` and never touch AWS.
 */
export interface AgentCoreSessionClientLike {
  /**
   * Append one envelope as an event (the server assigns the event id).
   *
   * The envelope arrives as an OBJECT; how it reaches the wire is the
   * implementation's business. The shipped shim writes it as JSON text, because
   * this service returns an object blob back as its own host language's
   * `toString()` of it — see `createSessionClient`.
   */
  createEvent(input: {
    memoryId: string;
    actorId: string;
    sessionId: string;
    envelope: CheckpointEnvelope;
  }): Promise<void>;
  /** The session's events, newest first — the adapter reads only the newest. */
  listEvents(input: {
    memoryId: string;
    actorId: string;
    sessionId: string;
    maxResults?: number;
  }): Promise<{ events: readonly AgentCoreSessionEvent[] }>;
}

/** Options for the event-backed mode. */
export interface AgentCoreMemorySessionsOptions {
  readonly store: 'memory';
  /** AgentCore Memory ARN or id. Required. */
  readonly memoryId: string;
  /** AWS region, when the adapter constructs the SDK client itself. */
  readonly region?: string;
  /**
   * The AgentCore `actorId` these conversations belong to. Default
   * `'afp-standing-agent'`. One actor per deployed agent is the usual shape.
   */
  readonly actorId?: string;
  /** Pre-built client, to share one SDK config across the host app. */
  readonly client?: AgentCoreSessionClientLike;
  /** @internal Test injection — skips the SDK require entirely. */
  readonly _client?: AgentCoreSessionClientLike;
  /** @internal Test injection — the AWS SDK module, to exercise the real shim with a fake SDK. */
  readonly _sdk?: BedrockAgentCoreSessionSdkModule;
}

/** Options for {@link agentCoreSessions}. */
export type AgentCoreSessionsOptions =
  | AgentCoreFileSessionsOptions
  | AgentCoreMemorySessionsOptions;

/**
 * A `SessionLifecycle` backed by AgentCore, with the checkpoint's home chosen
 * at construction.
 *
 * Both modes store the SAME `CheckpointEnvelope` the port defines — a
 * conversation or a paused run — and both refuse an unknown `format` by name
 * through the shared `checkEnvelope`: a session written by a newer runtime is
 * refused, never half-restored. That law is inherited, not re-implemented, and
 * so is its other half: a stored session that is present but **unreadable** is
 * refused by name too (`UnreadableEnvelopeError`), never answered with a fresh
 * start. Only a session that was never written hydrates as `undefined`.
 *
 * @example  Survive a stop/resume, no AWS SDK required
 *   agentCoreSessions({ store: 'session-storage' });
 *
 * @example  Outlive the session entirely
 *   agentCoreSessions({ store: 'memory', memoryId: process.env.MEMORY_ID!, region: 'us-west-2' });
 */
export function agentCoreSessions(options: AgentCoreSessionsOptions): SessionLifecycle {
  return options.store === 'memory' ? memoryEventSessions(options) : fileSessions(options);
}

// ─── 'session-storage': a JSON file ──────────────────────────────────

interface SessionFile {
  readonly version: 1;
  readonly sessions: Record<string, CheckpointEnvelope>;
}

function fileSessions(options: AgentCoreFileSessionsOptions): SessionLifecycle {
  const path = options.path ?? DEFAULT_SESSION_STORAGE_PATH;

  async function readFile(): Promise<SessionFile> {
    const { readFile: read } = await import('node:fs/promises');
    let raw: string;
    try {
      raw = await read(path, 'utf8');
    } catch {
      // No file yet is the ordinary first-request state, not an error.
      return { version: 1, sessions: {} };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new TypeError(
        `[hosting] the session file at '${path}' is not JSON (${(err as Error).message}). ` +
          `Refusing rather than starting every conversation over silently — delete the file ` +
          `to start fresh, or point 'path' somewhere else.`,
      );
    }
    const sessions = (parsed as Partial<SessionFile> | null)?.sessions;
    return sessions && typeof sessions === 'object'
      ? { version: 1, sessions: sessions as Record<string, CheckpointEnvelope> }
      : { version: 1, sessions: {} };
  }

  return {
    async hydrate(sessionId: string): Promise<CheckpointEnvelope | undefined> {
      const file = await readFile();
      const stored = file.sessions[sessionId];
      if (stored === undefined) return undefined;
      // Validate HERE as well as in the composer, so a refusal points at the
      // store that produced the bytes rather than at whoever read them next.
      // `checkEnvelope` accepts either format: a store keeps sessions, and
      // whether a session is mid-conversation or mid-question is not its
      // business — only whether it can be read at all.
      return checkEnvelope(stored, sessionId);
    },
    async persist(sessionId: string, envelope: CheckpointEnvelope): Promise<void> {
      const { writeFile, rename, mkdir } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      const file = await readFile();
      const next: SessionFile = {
        version: 1,
        sessions: { ...file.sessions, [sessionId]: envelope },
      };
      await mkdir(dirname(path), { recursive: true }).catch(() => undefined);
      // Write-then-rename: a container killed mid-write leaves the previous
      // conversation intact rather than a truncated file that refuses to parse.
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(next), 'utf8');
      await rename(temporary, path);
    },
  };
}

// ─── 'memory': one AgentCore Memory event per persist ────────────────

const DEFAULT_ACTOR_ID = 'afp-standing-agent';

function memoryEventSessions(options: AgentCoreMemorySessionsOptions): SessionLifecycle {
  if (!options.memoryId) {
    throw new Error(`agentCoreSessions({ store: 'memory' }) requires 'memoryId'.`);
  }
  const memoryId = options.memoryId;
  const actorId = options.actorId ?? DEFAULT_ACTOR_ID;
  const client =
    options._client ?? options.client ?? createSessionClient(options.region, options._sdk);

  return {
    async hydrate(sessionId: string): Promise<CheckpointEnvelope | undefined> {
      // AgentCore Memory is an append-only log and lists newest-first, so the
      // newest readable event IS the conversation. Older ones are the earlier
      // turns and deliberately left where they are — they are the audit trail.
      const page = await client.listEvents({
        memoryId,
        actorId,
        sessionId: safeSessionId(sessionId),
        maxResults: 1,
      });
      const newest = page.events[0];
      // No event, or an event carrying no blob: nothing here ever claimed to be
      // a session, so this really is a fresh start. Anything else — including a
      // blob that came back mangled — goes to `checkEnvelope`, which refuses a
      // conversation it cannot read BY NAME instead of returning `undefined`
      // and letting the agent answer as if the session were new.
      if (!newest || newest.envelope === null || newest.envelope === undefined) return undefined;
      // `decodeBlob` again rather than only inside the shim: a caller-supplied
      // `client` is free to hand back the stored text as it found it, and text
      // this adapter can plainly read is not something to refuse on a
      // technicality. Anything it cannot read still reaches `checkEnvelope`.
      return checkEnvelope(decodeBlob(newest.envelope), sessionId);
    },
    async persist(sessionId: string, envelope: CheckpointEnvelope): Promise<void> {
      await client.createEvent({
        memoryId,
        actorId,
        sessionId: safeSessionId(sessionId),
        envelope,
      });
    },
  };
}

const SESSION_ID_MAX = 99;

/** AgentCore ids accept `[A-Za-z0-9_-]`; a session id is caller data and need not. */
function safeSessionId(raw: string): string {
  const slug = raw.replace(/[^A-Za-z0-9_-]/g, '-');
  if (slug.length <= SESSION_ID_MAX) return slug;
  // Keep a readable head plus a stable tail so two long ids stay distinct.
  return `${slug.slice(0, SESSION_ID_MAX - 9)}-${fnv1a(raw)}`;
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The slice of `@aws-sdk/client-bedrock-agentcore` this shim touches. */
export interface BedrockAgentCoreSessionSdkModule {
  readonly BedrockAgentCoreClient?: new (config: { region?: string }) => {
    send(cmd: unknown): Promise<unknown>;
  };
  readonly CreateEventCommand?: new (input: unknown) => unknown;
  readonly ListEventsCommand?: new (input: unknown) => unknown;
}

/**
 * Turn one stored blob back into an envelope — the adapter's ONE decode step.
 *
 * ── Why a string is the normal case, not the exotic one ──────────────────────
 * This adapter writes the envelope as **JSON text** (see `createEvent` below),
 * so the blob that comes back is a string and is parsed here. Objects are still
 * accepted: a caller who supplies their own `client` can hand back a real
 * object, and refusing it would break a seam that never had this problem.
 *
 * A blob it cannot decode is handed back **AS-IS**, never as `null`. `null`
 * means "no blob", which is an absence, and an absence is answered with a fresh
 * start; a conversation that exists and cannot be read must not be. Passing the
 * raw value on puts it in front of `checkEnvelope`, which refuses by name.
 */
function decodeBlob(blob: unknown): unknown {
  if (typeof blob !== 'string') return blob;
  try {
    const parsed: unknown = JSON.parse(blob);
    // JSON.parse('"x"') is a string, not an envelope. Hand back the ORIGINAL
    // bytes so the refusal quotes what the store actually holds.
    return parsed !== null && typeof parsed === 'object' ? parsed : blob;
  } catch {
    return blob;
  }
}

/** Pull the envelope out of an event's `payload` (a single `blob` document). */
function envelopeFromPayload(payload: unknown): unknown {
  if (!Array.isArray(payload)) return null;
  for (const part of payload) {
    if (!part || typeof part !== 'object' || !('blob' in part)) continue;
    const blob = (part as { blob?: unknown }).blob;
    // A part with no blob VALUE is not a session either — keep looking.
    if (blob === null || blob === undefined) continue;
    return decodeBlob(blob);
  }
  return null;
}

/**
 * Map {@link AgentCoreSessionClientLike} onto the real SDK commands. If AWS
 * renames a command, only this function changes — which is also why every test
 * injects past it.
 */
function createSessionClient(
  region: string | undefined,
  injected?: BedrockAgentCoreSessionSdkModule,
): AgentCoreSessionClientLike {
  let mod: BedrockAgentCoreSessionSdkModule;
  if (injected) {
    mod = injected;
  } else {
    try {
      mod = lazyRequire<BedrockAgentCoreSessionSdkModule>('@aws-sdk/client-bedrock-agentcore');
    } catch {
      throw new Error(
        `agentCoreSessions({ store: 'memory' }) requires the ` +
          '`@aws-sdk/client-bedrock-agentcore` peer dependency.\n' +
          '  Install:  npm install @aws-sdk/client-bedrock-agentcore\n' +
          "  Or use { store: 'session-storage' }, which needs no SDK at all.",
      );
    }
  }
  if (!mod.BedrockAgentCoreClient) {
    throw new Error(
      'agentCoreSessions: `@aws-sdk/client-bedrock-agentcore` is installed but ' +
        '`BedrockAgentCoreClient` was not found. Update the SDK.',
    );
  }
  const sdk = new mod.BedrockAgentCoreClient({ ...(region && { region }) });

  const send = async (
    Ctor: (new (input: unknown) => unknown) | undefined,
    name: string,
    input: unknown,
  ): Promise<unknown> => {
    if (!Ctor) {
      throw new Error(
        `agentCoreSessions: \`@aws-sdk/client-bedrock-agentcore\` is missing ${name}. Upgrade the SDK.`,
      );
    }
    return sdk.send(new Ctor(input));
  };

  return {
    async createEvent({ memoryId, actorId, sessionId, envelope }) {
      await send(mod.CreateEventCommand, 'CreateEventCommand', {
        memoryId,
        actorId,
        sessionId,
        eventTimestamp: new Date(),
        // JSON TEXT, not the object. Field-learned, and the whole reason for
        // this release: given an object, the service stores its own host
        // language's `toString()` rendering of it and returns THAT string —
        // `{format=conversation-v1, data={...}}`, which is not JSON and which
        // nothing can turn back into a conversation. The envelope is defined as
        // something a store can hold as text (`toEnvelope` round-trips through
        // `JSON.stringify` by construction), so the encoding is ours to pick and
        // the honest pick is the one whose bytes come back unchanged.
        payload: [{ blob: JSON.stringify(envelope) }],
      });
    },
    async listEvents({ memoryId, actorId, sessionId, maxResults }) {
      const result = (await send(mod.ListEventsCommand, 'ListEventsCommand', {
        memoryId,
        actorId,
        sessionId,
        includePayloads: true,
        ...(maxResults !== undefined && { maxResults }),
      })) as { events?: ReadonlyArray<{ eventId?: string; payload?: unknown }> } | null;
      const events: AgentCoreSessionEvent[] = (result?.events ?? []).map((event) => ({
        eventId: event.eventId ?? '',
        envelope: envelopeFromPayload(event.payload),
      }));
      return { events };
    },
  };
}
