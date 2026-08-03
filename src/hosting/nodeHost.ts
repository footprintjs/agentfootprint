/**
 * hosting/nodeHost — the plain HTTP adapter, built on `node:http` and nothing
 * else.
 *
 *   const host = nodeHost({ port: 8080 });
 *   const handle = await host.serve(async (request, reply) => {
 *     reply.complete(await answer(request.input));
 *   });
 *
 * Two routes: `POST /invoke` takes `{ input, sessionId? }` and answers
 * `{ output }`; `GET /health` answers `{ status: 'ok' }`. Both paths are
 * options, because the paths are the part most likely to be dictated to you by
 * whatever is in front of the process — a load balancer, a container contract,
 * a colleague's convention. A path is a deployment detail, so it is a knob
 * here and absent from the port entirely.
 *
 * **Streaming is the caller's choice, not the server's.** Send
 * `Accept: text/event-stream` and the reply is Server-Sent Events, one `chunk`
 * event per `reply.emit(...)` then a final `complete`. Send anything else and
 * the same handler produces one JSON body — it emits into a buffer that the
 * completion settles. The handler cannot tell the difference and does not need
 * to, which is the property `capabilities` exists to describe.
 *
 * Pattern: Adapter. Everything specific to HTTP — the paths, the JSON body
 * shape, the status codes, the SSE framing — lives in this file. `types.ts`
 * knows none of it, and a future adapter for somewhere else re-decides all of
 * it without touching a port.
 */

import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { encodeSSE } from '../stream.js';
import { HostClosedError } from './errors.js';
import type { AgentHost, HostCapability, HostHandle, HostHandler, HostReply } from './types.js';

/** Options for {@link nodeHost}. */
export interface NodeHostOptions {
  /** Port to bind. Default `8080`. Pass `0` for an ephemeral port. */
  readonly port?: number;
  /** Interface to bind. Default `'0.0.0.0'`. */
  readonly hostname?: string;
  /** Path that takes a request. Default `'/invoke'`. */
  readonly invokePath?: string;
  /** Path that answers a health probe. Default `'/health'`. */
  readonly healthPath?: string;
}

/** What {@link nodeHost}'s `serve()` resolves to — a {@link HostHandle} that also says where it landed. */
export interface NodeHostHandle extends HostHandle {
  /** Where it is actually listening, e.g. `http://127.0.0.1:53211`. */
  readonly url: string;
  /** The port it actually bound — the real one, when you asked for `0`. */
  readonly port: number;
}

/** {@link AgentHost} narrowed to this adapter's handle. */
export interface NodeHost extends AgentHost {
  serve(handler: HostHandler): Promise<NodeHostHandle>;
}

const HOST_NAME = 'nodeHost';
const CAPABILITIES: readonly HostCapability[] = ['streaming'];

/**
 * Status codes this adapter maps by error code. Anything else is a 500.
 *
 * All three are deliberately NOT 5xx: none of them is the agent breaking. A
 * closed host is shutting down (503), a concurrent turn conflicts with the run
 * already going (409), and a paused run conflicts with the state this reply can
 * carry (409) — the run is unfinished, not failed, and a 500 would say
 * otherwise to every dashboard that ever sees it.
 */
const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  ERR_HOST_CLOSED: 503,
  ERR_CONCURRENT_RUN: 409,
  ERR_PAUSE_NOT_CARRIED: 409,
};

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
  const port = options.port ?? 8080;
  const hostname = options.hostname ?? '0.0.0.0';
  const invokePath = options.invokePath ?? '/invoke';
  const healthPath = options.healthPath ?? '/health';

  return {
    name: HOST_NAME,
    capabilities: CAPABILITIES,
    async serve(handler: HostHandler): Promise<NodeHostHandle> {
      const { createServer } = await import('node:http');
      const startedAt = Date.now();
      const inFlight = new Set<Promise<void>>();
      let accepting = true;
      let closing: Promise<void> | undefined;

      const server: Server = createServer((req, res) => {
        const path = (req.url ?? '').split('?')[0];

        if (req.method === 'GET' && path === healthPath) {
          sendJson(res, 200, { status: 'ok', uptimeMs: Date.now() - startedAt });
          return;
        }
        if (req.method !== 'POST' || path !== invokePath) {
          sendJson(res, 404, { error: `no route for ${req.method ?? '?'} ${path}` });
          return;
        }
        if (!accepting) {
          const refusal = new HostClosedError(HOST_NAME);
          sendJson(res, STATUS_BY_CODE[refusal.code] ?? 500, {
            error: refusal.message,
            code: refusal.code,
          });
          return;
        }

        const served = serveOne(req, res, handler);
        inFlight.add(served);
        void served.finally(() => inFlight.delete(served));
      });

      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, hostname, resolve);
      });

      const address = server.address();
      const boundPort = typeof address === 'object' && address ? address.port : port;
      const displayHost = hostname === '0.0.0.0' || hostname === '::' ? '127.0.0.1' : hostname;

      return {
        url: `http://${displayHost}:${boundPort}`,
        port: boundPort,
        close(): Promise<void> {
          // Idempotent: the first call owns the shutdown, later ones await it.
          closing ??= (async () => {
            accepting = false;
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
): Promise<void> {
  const wantsStream = (req.headers.accept ?? '').includes('text/event-stream');
  const controller = new AbortController();

  let body: Record<string, unknown>;
  try {
    body = await readJson(req);
  } catch (err) {
    sendJson(res, 400, { error: `invalid JSON body: ${asError(err).message}` });
    return;
  }

  const input = typeof body.input === 'string' ? body.input : '';
  // sessionId is caller data whichever way it arrives; the body wins so a
  // caller that sets both is not surprised by which one the server preferred.
  const sessionId =
    typeof body.sessionId === 'string'
      ? body.sessionId
      : typeof req.headers['x-session-id'] === 'string'
      ? req.headers['x-session-id']
      : undefined;

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
      res.write(encodeSSE('chunk', { text: chunk }));
    },
    complete(output: string): void {
      if (settled) return;
      settled = true;
      if (wantsStream) {
        res.write(encodeSSE('complete', { output }));
        res.end();
      } else {
        sendJson(res, 200, { output });
      }
    },
    fail(error: Error): void {
      if (settled) return;
      settled = true;
      const code = (error as { code?: string }).code;
      const payload = { error: error.message, ...(code !== undefined && { code }) };
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
        headers: lowerCased(req.headers),
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
