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
 * two paths, and the five JSON shapes — how a request names its input and its
 * session, and what a health probe, a completion, a failure and a streamed
 * piece look like on the wire.
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
 * Pattern: Template method via configuration (Strategy on the wire format).
 * Everything HTTP lives here and in the wires; `types.ts` knows none of it.
 */

import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { encodeSSE } from '../stream.js';
import { HostClosedError } from './errors.js';
import type {
  AgentHost,
  HostCapability,
  HostHandle,
  HostHandler,
  HostReply,
  PendingAsk,
} from './types.js';

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
     * A person's answer to an outstanding question, when this request carries
     * one. Its presence is what makes a request a RESUME rather than a new
     * message, so a wire that never returns it can only ever start new turns.
     */
    readonly decision?: unknown;
  };
  /** Body for a health probe. `uptimeMs` is how long this host has been serving. */
  health(uptimeMs: number): unknown;
  /** Body for a reply that completed. */
  output(output: string): unknown;
  /** Body for a reply that failed. `code` is the refusal's stable code, when it has one. */
  failure(message: string, code?: string): unknown;
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

/** {@link AgentHost} narrowed to an HTTP handle. */
export interface HttpHost extends AgentHost {
  serve(handler: HostHandler): Promise<HttpHostHandle>;
}

/**
 * Status codes mapped by refusal code. Anything else is a 500.
 *
 * Not one of them is a 5xx: none of them is the agent breaking. A closed host is
 * shutting down (503); the other four are conflicts with the state the session
 * is already in (409) — a run already going, a question already outstanding, a
 * decision with nothing to decide, a pause this reply cannot describe. A 500
 * would tell every dashboard that ever sees it something untrue.
 */
const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  ERR_HOST_CLOSED: 503,
  ERR_CONCURRENT_RUN: 409,
  ERR_PAUSE_NOT_CARRIED: 409,
  ERR_AWAITING_DECISION: 409,
  ERR_NO_PENDING_ASK: 409,
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
 * An HTTP host for one handler, speaking the dialect you hand it.
 *
 * @example  The same machinery, two dialects
 *   httpHost({ name: 'nodeHost', wire: jsonWire, invokePath: '/invoke', healthPath: '/health' });
 *   httpHost({ name: 'myRuntime', wire: myWire, invokePath: '/v1/run', healthPath: '/up' });
 */
export function httpHost(options: HttpHostOptions): HttpHost {
  const { name, wire, invokePath, healthPath } = options;
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
  const port = options.port ?? 8080;
  const hostname = options.hostname ?? '0.0.0.0';
  const capabilities = options.capabilities ?? DEFAULT_CAPABILITIES;

  return {
    name,
    capabilities,
    async serve(handler: HostHandler): Promise<HttpHostHandle> {
      const startedAt = Date.now();
      const inFlight = new Set<Promise<void>>();
      let accepting = true;
      let closing: Promise<void> | undefined;

      const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
        // On a shared server an earlier listener may already have answered.
        // Writing again would corrupt its reply; there is nothing to add.
        if (res.headersSent) return;
        const path = (req.url ?? '').split('?')[0];

        if (req.method === 'GET' && path === healthPath) {
          sendJson(res, 200, wire.health(Date.now() - startedAt));
          return;
        }
        if (req.method !== 'POST' || path !== invokePath) {
          // On a server we own, an unmatched path is nobody else's, so saying
          // so is the honest answer. On a server the CALLER owns it is theirs,
          // and a 404 from us would answer for their application.
          if (ownServer) return;
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

        const served = serveOne(req, res, handler, wire);
        inFlight.add(served);
        void served.finally(() => inFlight.delete(served));
      };

      let server: Server;
      if (ownServer) {
        server = ownServer;
        if (!server.listening) {
          throw new Error(
            `[hosting] httpHost('${name}') was handed a server that is not listening yet. ` +
              `This handle promises the url and port it is answering on, and a server with ` +
              `no address has neither. Call server.listen(...) first, then serve() — ` +
              `attaching after listen() is safe and is the intended order.`,
          );
        }
        server.on('request', onRequest);
      } else {
        const { createServer } = await import('node:http');
        server = createServer(onRequest);
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(port, hostname, resolve);
        });
      }

      const address = server.address();
      const tcp = typeof address === 'object' && address !== null ? address : undefined;
      if (ownServer && !tcp) {
        server.off('request', onRequest);
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

      return {
        url: `http://${displayHost}:${boundPort}`,
        port: boundPort,
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
            server.closeIdleConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
          })();
          return closing;
        },
      };
    },
  };
}

/** Run one request through the handler and write whatever it decides. */
async function serveOne(
  req: IncomingMessage,
  res: ServerResponse,
  handler: HostHandler,
  wire: HttpWire,
): Promise<void> {
  const wantsStream = (req.headers.accept ?? '').includes('text/event-stream');
  const controller = new AbortController();

  let body: Record<string, unknown>;
  try {
    body = await readJson(req);
  } catch (err) {
    sendJson(res, 400, wire.failure(`invalid JSON body: ${asError(err).message}`));
    return;
  }

  const headers = lowerCased(req.headers);
  const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
  const { input, sessionId, decision } = wire.readRequest({ body, headers, query });

  if (wantsStream) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
  }

  let settled = false;
  // The caller hung up before we answered — tell the handler so it can stop
  // paying for work nobody is waiting for.
  res.once('close', () => {
    if (!settled) controller.abort();
  });

  const reply: HostReply = {
    emit(chunk: string): void {
      // Not streaming? The chunk is a preview of text `complete` will deliver
      // in full, so there is nothing to send and nothing to keep.
      if (settled || !wantsStream) return;
      res.write(encodeSSE('chunk', wire.chunk(chunk)));
    },
    complete(output: string): void {
      if (settled) return;
      settled = true;
      if (wantsStream) {
        res.write(encodeSSE('complete', wire.output(output)));
        res.end();
      } else {
        sendJson(res, 200, wire.output(output));
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
        res.write(encodeSSE('awaiting', payload));
        res.end();
      } else {
        sendJson(res, AWAITING_STATUS, payload);
      }
    },
    fail(error: Error): void {
      if (settled) return;
      settled = true;
      const code = (error as { code?: string }).code;
      const payload = wire.failure(error.message, code);
      if (wantsStream) {
        res.write(encodeSSE('error', payload));
        res.end();
      } else {
        sendJson(res, code !== undefined ? STATUS_BY_CODE[code] ?? 500 : 500, payload);
      }
    },
  };

  try {
    await handler(
      {
        input,
        ...(sessionId !== undefined && { sessionId }),
        ...(decision !== undefined && { decision }),
        headers,
        signal: controller.signal,
      },
      reply,
    );
  } catch (err) {
    // A handler that throws is a failed request, never a hung one.
    reply.fail(asError(err));
  }
  // A handler that returned without answering gets one authored answer rather
  // than a socket the caller waits on until it times out.
  if (!settled) {
    reply.fail(new Error('[hosting] the handler returned without calling complete() or fail().'));
  }
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('error', reject);
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        const parsed: unknown = JSON.parse(raw);
        resolve(parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function lowerCased(headers: IncomingMessage['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') out[name.toLowerCase()] = value;
    else if (Array.isArray(value)) out[name.toLowerCase()] = value.join(', ');
  }
  return out;
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
 */
export function headerValue(
  facts: HttpRequestFacts,
  name: string,
  ...fallbacks: string[]
): string | undefined {
  for (const candidate of [name, ...fallbacks]) {
    const found = facts.headers[candidate.toLowerCase()];
    if (typeof found === 'string' && found.length > 0) return found;
  }
  return undefined;
}
