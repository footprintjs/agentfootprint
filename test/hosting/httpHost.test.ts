/**
 * httpHost — one HTTP implementation, many dialects.
 *
 * `nodeHost` and `agentCoreRuntimeHost` are both configurations of this file,
 * and their own suites cover what each one says on the wire. What is asserted
 * HERE is the seam: that a wire really does get to re-decide the five body
 * shapes and nothing else, that both paths are required rather than defaulted
 * (a default here would be inherited by every future adapter), and that
 * `headerValue` is genuinely case-insensitive — the helper that exists so no
 * adapter re-derives header matching and gets it subtly wrong.
 *
 * Since 7.22.0 it also asserts the other half of the seam: WHO owns the socket.
 * `{ server }` attaches the same routes to a `node:http` server the caller owns
 * — the shape a container with exactly one port needs — and the laws that come
 * with it (never a 404 on someone else's path, an upgrade beside us keeps
 * working, close() detaches without closing) are pinned over real sockets,
 * because every one of them is about behaviour node itself decides.
 */

import { createServer, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import { headerValue, httpHost, jsonWire } from '../../src/hosting/index.js';
import type { HostHandle, HttpHostHandle, HttpWire } from '../../src/hosting/index.js';

const open: HostHandle[] = [];
const openServers: Server[] = [];
const openSockets: Socket[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((h) => h.close()));
  for (const socket of openSockets.splice(0)) socket.destroy();
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

/** A deliberately eccentric dialect — nothing about it resembles the default. */
const oddWire: HttpWire = {
  readRequest: (facts) => {
    const say = facts.body.say;
    const sessionId = facts.query.get('thread') ?? facts.headers['x-thread'];
    return {
      input: typeof say === 'string' ? say : '',
      ...(sessionId !== null && sessionId !== undefined && { sessionId }),
    };
  },
  health: (uptimeMs) => ({ alive: true, ms: uptimeMs }),
  output: (said) => ({ said }),
  failure: (broke, code) => ({ broke, ...(code !== undefined && { code }) }),
  chunk: (bit) => ({ bit }),
};

async function serveOdd(handler = defaultHandler, paths = {}): Promise<string> {
  const handle = (await httpHost({
    name: 'oddHost',
    wire: oddWire,
    invokePath: '/say',
    healthPath: '/alive',
    port: 0,
    hostname: '127.0.0.1',
    ...paths,
  }).serve(handler)) as HttpHostHandle;
  open.push(handle);
  return handle.url;
}

const defaultHandler = (
  request: { input: string; sessionId?: string },
  reply: { complete(v: string): void },
): void => reply.complete(`${request.input}/${request.sessionId ?? 'none'}`);

// ── unit: the seam ──────────────────────────────────────────────────

describe('httpHost — the seam', () => {
  it('takes its name from the adapter, so refusals name the adapter', () => {
    const host = httpHost({
      name: 'oddHost',
      wire: oddWire,
      invokePath: '/say',
      healthPath: '/alive',
    });
    expect(host.name).toBe('oddHost');
  });

  it('lets an adapter declare fewer capabilities than the default', () => {
    const host = httpHost({
      name: 'quiet',
      wire: oddWire,
      invokePath: '/x',
      healthPath: '/y',
      capabilities: [],
    });
    expect(host.capabilities).toEqual([]);
  });

  it('exports the default dialect by name, so it can be reused rather than retyped', () => {
    expect(jsonWire.output('hi')).toEqual({ output: 'hi' });
    expect(jsonWire.health(5)).toMatchObject({ status: 'ok' });
  });
});

// ── scenario: the wire really does own the bodies ───────────────────

describe('httpHost — a custom dialect', () => {
  it('reads the input from whatever field the wire says', async () => {
    const base = await serveOdd();
    const res = await fetch(`${base}/say`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ say: 'hello' }),
    });
    expect(await res.json()).toEqual({ said: 'hello/none' });
  });

  it('answers the health path in the wire’s own shape', async () => {
    const base = await serveOdd();
    const body = (await (await fetch(`${base}/alive`)).json()) as { alive: boolean; ms: number };
    expect(body.alive).toBe(true);
    expect(typeof body.ms).toBe('number');
  });

  it('can take the session id from the QUERY STRING, which the default never does', async () => {
    // Proof the facts a wire receives are complete: body, headers AND query.
    const base = await serveOdd();
    const res = await fetch(`${base}/say?thread=q-1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ say: 'hi' }),
    });
    expect(await res.json()).toEqual({ said: 'hi/q-1' });
  });

  it('routes only the paths it was given — the default paths are not smuggled in', async () => {
    const base = await serveOdd();
    expect((await fetch(`${base}/health`)).status).toBe(404);
    expect((await fetch(`${base}/invoke`, { method: 'POST', body: '{}' })).status).toBe(404);
  });

  it('the query string never leaks into path matching', async () => {
    const base = await serveOdd();
    expect((await fetch(`${base}/alive?probe=1`)).status).toBe(200);
  });

  it('failures use the wire’s error shape, keeping the refusal code', async () => {
    const base = await serveOdd(() => {
      throw new Error('nope');
    });
    const res = await fetch(`${base}/say`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ say: 'x' }),
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ broke: 'nope' });
  });

  it('streams with the wire’s chunk shape when the caller asks', async () => {
    const base = await serveOdd((_request, reply) => {
      (reply as { emit?(c: string): void }).emit?.('piece');
      reply.complete('whole');
    });
    const body = await (
      await fetch(`${base}/say`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ say: 'x' }),
      })
    ).text();
    expect(body).toContain('"bit":"piece"');
    expect(body).toContain('"said":"whole"');
  });
});

// ── scenario: a server the CALLER owns ──────────────────────────────

/** A listening `node:http` server nobody has attached anything to yet. */
async function callerServer(): Promise<{ server: Server; base: string; port: number }> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  openServers.push(server);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, base: `http://127.0.0.1:${port}`, port };
}

/** Attach the eccentric-dialect host to a server the test owns. */
async function attachOdd(server: Server, handler = defaultHandler): Promise<HttpHostHandle> {
  const handle = (await httpHost({
    name: 'oddHost',
    wire: oddWire,
    invokePath: '/say',
    healthPath: '/alive',
    server,
  }).serve(handler)) as HttpHostHandle;
  open.push(handle);
  return handle;
}

const say = (base: string, text: string): Promise<Response> =>
  fetch(`${base}/say`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ say: text }),
  });

/** True when nobody answered inside the window — which is what "not ours" looks like. */
async function unanswered(url: string, init: RequestInit = {}): Promise<boolean> {
  try {
    await fetch(url, { ...init, signal: AbortSignal.timeout(250) });
    return false;
  } catch {
    return true;
  }
}

/** A raw client that speaks the upgrade handshake — no `ws` dependency needed. */
function upgradeClient(port: number): {
  socket: Socket;
  transcript: () => string;
  waitFor: (needle: string) => Promise<void>;
} {
  const socket = connect(port, '127.0.0.1');
  openSockets.push(socket);
  let transcript = '';
  socket.on('data', (chunk: Buffer) => {
    transcript += chunk.toString('utf8');
  });
  const waitFor = (needle: string): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 3000;
      const tick = setInterval(() => {
        if (transcript.includes(needle)) {
          clearInterval(tick);
          resolve();
        } else if (Date.now() > deadline) {
          clearInterval(tick);
          reject(
            new Error(`never saw '${needle}'. Transcript so far: ${JSON.stringify(transcript)}`),
          );
        }
      }, 10);
    });
  return { socket, transcript: () => transcript, waitFor };
}

describe('httpHost — a server the caller owns', () => {
  it('LAW: the host answers its own routes on the caller’s socket', async () => {
    const { server, base } = await callerServer();
    await attachOdd(server);

    expect(await (await say(base, 'hello')).json()).toEqual({ said: 'hello/none' });
    const health = (await (await fetch(`${base}/alive`)).json()) as { alive: boolean };
    expect(health.alive).toBe(true);
  });

  it('LAW: the handle reports the caller’s real address, since it bound none of its own', async () => {
    const { server, port, base } = await callerServer();
    const handle = await attachOdd(server);

    expect(handle.port).toBe(port);
    expect(handle.url).toBe(base);
  });

  it('LAW: a path the host does not own is never a 404 from us — it falls through untouched', async () => {
    const { server, base } = await callerServer();
    server.on('request', (req, res) => {
      if ((req.url ?? '').split('?')[0] === '/caller') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ from: 'caller' }));
      }
    });
    await attachOdd(server);

    // The caller's route answers, unchanged, beside ours.
    expect(await (await fetch(`${base}/caller`)).json()).toEqual({ from: 'caller' });
    // And a path NOBODY routed is nobody's answer to give — least of all ours.
    // (This is the documented consequence of never writing a 404: unanswered,
    // not 404, when the caller has no fallback of their own.)
    expect(await unanswered(`${base}/nothing-here`)).toBe(true);
    expect(await unanswered(`${base}/say`, { method: 'GET' })).toBe(true);
  });

  it('LAW: an upgrade on the same port keeps working beside the host', async () => {
    // The whole reason this option exists: one port, a WebSocket upgrade AND
    // an agent. `node:http` routes upgrades to their own event, so attaching a
    // request listener must not touch them — pinned with a real handshake.
    const { server, port, base } = await callerServer();
    server.on('upgrade', (_req, socket) => {
      // An upgraded socket is detached from the server, so the teardown has to
      // know about it — `server.close()` waits for it forever otherwise.
      openSockets.push(socket as Socket);
      socket.on('error', () => undefined);
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n',
      );
      socket.on('data', (chunk: Buffer) => socket.write(chunk));
    });
    await attachOdd(server);

    const client = upgradeClient(port);
    client.socket.write(
      `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\n` +
        `Upgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
        `Sec-WebSocket-Version: 13\r\n\r\n`,
    );
    await client.waitFor('101 Switching Protocols');
    client.socket.write('ping-over-the-upgraded-socket');
    await client.waitFor('ping-over-the-upgraded-socket');

    // …and the agent still answers on the same port, with the socket held open.
    expect(await (await say(base, 'beside')).json()).toEqual({ said: 'beside/none' });
  });

  it('LAW: close() detaches and drains, and leaves the caller’s server listening', async () => {
    const { server, base } = await callerServer();
    server.on('request', (req, res) => {
      if ((req.url ?? '').split('?')[0] === '/caller') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ from: 'caller' }));
      }
    });
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The handler ANNOUNCES that the request is ours, rather than the test
    // sleeping and hoping: closing before the request arrived would prove
    // nothing about draining, and would be a flake on a loaded machine.
    let arrived = (): void => undefined;
    const inHandler = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const handle = await attachOdd(server, async (request, reply) => {
      arrived();
      await gate;
      reply.complete(`slow:${request.input}`);
    });

    const inFlight = say(base, 'work');
    await inHandler;
    const closing = handle.close();
    release();
    await closing;

    // The request that was already ours finished, rather than being dropped.
    expect(await (await inFlight).json()).toEqual({ said: 'slow:work' });
    // The socket is untouched: still listening, caller's routes still answering.
    expect(server.listening).toBe(true);
    expect(await (await fetch(`${base}/caller`)).json()).toEqual({ from: 'caller' });
    // And our path stopped being ours — not a 503 from a host that is leaving,
    // and not a 404 either: it is the caller's path now, and they answer nothing.
    expect(await unanswered(`${base}/say`, { method: 'POST', body: '{}' })).toBe(true);
  });

  it('never writes to a response an earlier listener already answered', async () => {
    const { server, base } = await callerServer();
    // Registered BEFORE the host, so it runs first — and it claims the host's
    // own path, which is the one case where two listeners could both write.
    server.on('request', (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ from: 'first-listener' }));
    });
    await attachOdd(server);

    expect(await (await say(base, 'x')).json()).toEqual({ from: 'first-listener' });
    expect(await (await fetch(`${base}/alive`)).json()).toEqual({ from: 'first-listener' });
  });

  it('refuses a server that is not listening yet, rather than promise an address it has not got', async () => {
    const server = createServer();
    openServers.push(server);
    await expect(
      httpHost({
        name: 'oddHost',
        wire: oddWire,
        invokePath: '/say',
        healthPath: '/alive',
        server,
      }).serve(defaultHandler),
    ).rejects.toThrow(/not listening yet/);
  });

  it('refuses a port or hostname next to a server it does not bind', () => {
    const base = { name: 'oddHost', wire: oddWire, invokePath: '/say', healthPath: '/alive' };
    const server = createServer();
    openServers.push(server);
    expect(() => httpHost({ ...base, server, port: 8080 })).toThrow(/both a caller-owned/);
    expect(() => httpHost({ ...base, server, port: 8080 })).toThrow(/'port'/);
    expect(() => httpHost({ ...base, server, hostname: '0.0.0.0' })).toThrow(/'hostname'/);
    // Without a server, both are exactly as ordinary as they were.
    expect(() => httpHost({ ...base, port: 8080, hostname: '0.0.0.0' })).not.toThrow();
  });

  it('refuses a pipe-bound server, which has no port for the handle to report', async () => {
    const path = join(tmpdir(), `afp-httphost-${process.pid}-${Date.now()}.sock`);
    await rm(path, { force: true });
    const server = createServer();
    openServers.push(server);
    await new Promise<void>((resolve) => server.listen(path, () => resolve()));
    try {
      await expect(
        httpHost({
          name: 'oddHost',
          wire: oddWire,
          invokePath: '/say',
          healthPath: '/alive',
          server,
        }).serve(defaultHandler),
      ).rejects.toThrow(/pipe or socket path/);
      // The refusal leaves nothing attached behind it.
      expect(server.listenerCount('request')).toBe(0);
    } finally {
      await rm(path, { force: true });
    }
  });

  it('REGRESSION: with no server of the caller’s, close() still closes the socket', async () => {
    // The other half of the law: everything above is additive, and a host that
    // binds its own socket must still release it exactly as it did before.
    const url = await serveOdd();
    expect((await fetch(`${url}/alive`)).status).toBe(200);
    await open.splice(0)[0]!.close();
    expect(await unanswered(`${url}/alive`)).toBe(true);
  });
});

// ── unit: headerValue, the helper adapters share ────────────────────

describe('headerValue', () => {
  const facts = {
    body: {},
    headers: { 'x-thread': 'abc', 'x-empty': '' },
    query: new URLSearchParams(),
  };

  it('finds a header whatever case you ask in', () => {
    for (const name of ['x-thread', 'X-Thread', 'X-THREAD', 'x-ThReAd']) {
      expect(headerValue(facts, name)).toBe('abc');
    }
  });

  it('treats an empty value as absent, not as an empty answer', () => {
    expect(headerValue(facts, 'x-empty')).toBeUndefined();
  });

  it('falls back through alternative spellings in order', () => {
    expect(headerValue(facts, 'x-missing', 'x-also-missing', 'x-thread')).toBe('abc');
  });

  it('returns undefined when nothing matches', () => {
    expect(headerValue(facts, 'x-nope')).toBeUndefined();
  });
});
