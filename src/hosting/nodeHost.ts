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
 * `GET /health` answers `{ status: 'ok' }`. Both paths are
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
 * Pattern: Adapter. What is specific to THIS adapter is its two paths and its
 * JSON dialect (`jsonWire` below) — nothing else. The HTTP work itself lives in
 * `httpHost.ts` and is shared with every other HTTP adapter, so two of them can
 * never quietly drift apart on what `close()` drains or what a handler that
 * throws does. `types.ts` knows none of it either way.
 */

import { httpHost, type HttpHost, type HttpHostHandle, type HttpWire } from './httpHost.js';

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

/**
 * What {@link nodeHost}'s `serve()` resolves to — a `HostHandle` that also
 * reports the `url` and `port` it actually bound, which is the only way to find
 * out when you asked for port `0`.
 */
export type NodeHostHandle = HttpHostHandle;

/** `AgentHost` narrowed to this adapter's handle. */
export type NodeHost = HttpHost;

const HOST_NAME = 'nodeHost';

/**
 * This adapter's own JSON dialect: `{ input, sessionId? }` in, `{ output }`
 * out, `{ status: 'ok', uptimeMs }` on the health path.
 *
 * Exported by name so a deployment that has to keep these exact bodies while
 * changing something else about the host reuses them rather than retyping them
 * and getting one field subtly wrong.
 */
export const jsonWire: HttpWire = {
  readRequest(facts) {
    const input = typeof facts.body.input === 'string' ? facts.body.input : '';
    // sessionId is caller data whichever way it arrives; the body wins so a
    // caller that sets both is not surprised by which one the server preferred.
    const fromBody = typeof facts.body.sessionId === 'string' ? facts.body.sessionId : undefined;
    const sessionId = fromBody ?? facts.headers['x-session-id'];
    // Read as-is and never coerced: `decision` is a person's answer to whatever
    // a tool asked, and this dialect does not get to decide what that looks
    // like. Its PRESENCE is the whole signal.
    const decision = facts.body.decision;
    return {
      input,
      ...(sessionId !== undefined && { sessionId }),
      ...(decision !== undefined && { decision }),
    };
  },
  health: (uptimeMs) => ({ status: 'ok', uptimeMs }),
  output: (output) => ({ output }),
  failure: (error, code) => ({ error, ...(code !== undefined && { code }) }),
  chunk: (text) => ({ text }),
  awaiting: (pending) => ({ awaiting: pending }),
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
  return httpHost({
    name: HOST_NAME,
    wire: jsonWire,
    // Chosen, not inherited — see the test in this folder that greps for one
    // particular runtime's container-contract path literal.
    invokePath: options.invokePath ?? '/invoke',
    healthPath: options.healthPath ?? '/health',
    ...(options.port !== undefined && { port: options.port }),
    ...(options.hostname !== undefined && { hostname: options.hostname }),
  });
}
