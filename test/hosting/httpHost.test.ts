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

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import { headerValue, httpHost, jsonWire } from '../../src/hosting/index.js';
import { lowerCasedHeaders } from '../../src/hosting/headers.js';
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

/**
 * POST a body in TWO writes, with the split placed wherever the caller says.
 *
 * `fetch` decides its own framing, so it cannot be asked to cut a body in the
 * middle of a character. This can — which is the only way to prove that a
 * multi-byte character split across chunks comes back whole. Returns the
 * response body as text.
 */
async function rawPostSplit(
  port: number,
  path: string,
  body: Buffer,
  splitAt: number,
): Promise<string> {
  const socket = connect(port, '127.0.0.1');
  openSockets.push(socket);
  const received: Buffer[] = [];
  socket.on('error', () => undefined);
  socket.on('data', (chunk: Buffer) => received.push(chunk));
  await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
  socket.write(
    `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\ncontent-type: application/json\r\n` +
      `content-length: ${body.length}\r\nconnection: close\r\n\r\n`,
  );
  socket.write(body.subarray(0, splitAt));
  // Long enough that the two writes cannot be coalesced into one TCP segment,
  // which is the entire point of the fixture.
  await new Promise((resolve) => setTimeout(resolve, 30));
  socket.write(body.subarray(splitAt));
  await new Promise<void>((resolve) => socket.once('close', () => resolve()));
  const whole = Buffer.concat(received);
  const split = whole.indexOf('\r\n\r\n');
  const head = whole.subarray(0, split).toString('utf8');
  const payload = whole.subarray(split + 4);
  // `connection: close` invites node to answer in chunks, and a raw client that
  // ignored the framing would be reading the chunk sizes as content.
  return /transfer-encoding:\s*chunked/i.test(head)
    ? dechunk(payload).toString('utf8')
    : payload.toString('utf8');
}

/** The chunked body, unframed. Just enough of RFC 9112 §7.1 for one small reply. */
function dechunk(body: Buffer): Buffer {
  const pieces: Buffer[] = [];
  let at = 0;
  for (;;) {
    const eol = body.indexOf('\r\n', at);
    if (eol < 0) break;
    const size = parseInt(body.subarray(at, eol).toString('utf8'), 16);
    if (!Number.isFinite(size) || size === 0) break;
    pieces.push(body.subarray(eol + 2, eol + 2 + size));
    at = eol + 2 + size + 2;
  }
  return Buffer.concat(pieces);
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

// ── the defect this release exists for: a co-listener's encoding ────
//
// Field-reported against a shared socket. A co-listener called `req.setEncoding`
// in its own `'request'` handler — an ordinary thing to do before deciding the
// path is not yours — and from that moment the host received the body as
// STRINGS. `Buffer.concat` on strings throws, and it threw inside the `'end'`
// listener, which node calls from its OWN stack: not a rejected promise, not a
// failed request, an UNCAUGHT exception. The container died, taking every other
// request and every open conversation with it.
//
// Reachable only through `{ server }` — the mode built for co-listeners — which
// is why the fixture below is a real second listener on a real shared socket
// rather than a stubbed request.

describe('httpHost — a co-listener that set an encoding', () => {
  /** The field shape: somebody else reads the request first, and sets an encoding. */
  async function sharedWithEncodingCoListener(): Promise<{
    base: string;
    port: number;
    chunkTypes: string[];
  }> {
    const { server, base, port } = await callerServer();
    const chunkTypes: string[] = [];
    // Registered BEFORE the host, exactly as a listener that was there first
    // is. It answers nothing: the path is not its own.
    server.on('request', (req) => {
      req.setEncoding('utf8');
      req.on('data', (chunk: unknown) => chunkTypes.push(typeof chunk));
    });
    await attachOdd(server);
    return { base, port, chunkTypes };
  }

  it('is what the OLD reader could not survive — pinned as the contrast', async () => {
    const { base, chunkTypes } = await sharedWithEncodingCoListener();
    await (await say(base, 'hello')).json();

    // The fixture is real, not assumed: the chunks really did arrive as text.
    expect(chunkTypes).toEqual(['string']);

    // The pre-7.27.0 reader, quoted so the regression has a shape a reader can
    // recognise rather than a description of one:
    //
    //     req.on('data', (c: Buffer) => chunks.push(c));
    //     req.on('end', () => {
    //       const raw = Buffer.concat(chunks).toString('utf8');
    //       …
    //     });
    //
    // Handed what this fixture delivers, the concat dies:
    const asTheOldReaderKeptThem = [JSON.stringify({ say: 'hello' })] as unknown as Buffer[];
    expect(() => Buffer.concat(asTheOldReaderKeptThem)).toThrow(TypeError);
    // …and it died INSIDE the 'end' listener, which is the entire severity.
    // A throw there is nobody's rejection and everybody's crash.
  });

  it('LAW: the request answers normally now, and the host keeps serving', async () => {
    const { base } = await sharedWithEncodingCoListener();

    expect(await (await say(base, 'hello')).json()).toEqual({ said: 'hello/none' });
    // The proof that nothing died: the socket is still answering afterwards.
    expect(await (await say(base, 'again')).json()).toEqual({ said: 'again/none' });
    expect(((await (await fetch(`${base}/alive`)).json()) as { alive: boolean }).alive).toBe(true);
  });

  it('LAW: multi-byte text survives a chunk boundary drawn through a character', async () => {
    // `setEncoding` decodes through a StringDecoder, which HOLDS a partial
    // multi-byte sequence rather than splitting it — so coercing the text back
    // to bytes is lossless. Proven the only way worth proving: by writing the
    // body in two TCP writes with the split placed INSIDE a 4-byte character.
    const { base, port, chunkTypes } = await sharedWithEncodingCoListener();
    const text = 'ünïcödé — 😀 — 漢字 — ẞ';
    const body = Buffer.from(JSON.stringify({ say: text }), 'utf8');
    const midCharacter = body.indexOf(Buffer.from('😀', 'utf8')) + 2;
    expect(midCharacter).toBeGreaterThan(2);

    const answer = await rawPostSplit(port, '/say', body, midCharacter);

    expect(JSON.parse(answer)).toEqual({ said: `${text}/none` });
    // …and it really did arrive in more than one piece, as text.
    expect(chunkTypes.length).toBeGreaterThan(1);
    expect(new Set(chunkTypes)).toEqual(new Set(['string']));
    // The base URL is unused by the raw client; asserted so the fixture cannot
    // silently stop being the shared-socket one.
    expect(base).toContain(`:${port}`);
  });
});

// ── the deeper law: a request's failure is never the process's ──────

describe('httpHost — nothing in a request’s lifecycle is the process’s failure', () => {
  /** A dialect that breaks in whichever place the test names. */
  function brittleWire(breaks: 'health' | 'readRequest' | 'failure'): HttpWire {
    return {
      ...oddWire,
      health: (uptimeMs) => {
        if (breaks === 'health') throw new Error('the health body threw');
        return oddWire.health(uptimeMs);
      },
      readRequest: (facts) => {
        if (breaks === 'readRequest') throw new Error('the request dialect threw');
        return oddWire.readRequest(facts);
      },
      failure: (message, code) => {
        if (breaks === 'failure') throw new Error('even the failure body threw');
        return oddWire.failure(message, code);
      },
    };
  }

  async function serveBrittle(breaks: 'health' | 'readRequest' | 'failure'): Promise<string> {
    const handle = (await httpHost({
      name: 'brittleHost',
      wire: brittleWire(breaks),
      invokePath: '/say',
      healthPath: '/alive',
      port: 0,
      hostname: '127.0.0.1',
    }).serve(defaultHandler)) as HttpHostHandle;
    open.push(handle);
    return handle.url;
  }

  it('a wire that throws on the HEALTH path is a 500, not an uncaught exception', async () => {
    // The health path is answered INSIDE the 'request' listener, with nothing
    // between the wire and node's own stack. It was the shortest road to a dead
    // container in the whole file.
    const base = await serveBrittle('health');
    expect((await fetch(`${base}/alive`)).status).toBe(500);
    // Still up, still serving, which is the whole claim.
    expect(await (await say(base, 'after')).json()).toEqual({ said: 'after/none' });
  });

  it('a wire that throws while READING a request is that request’s 500', async () => {
    // This one never reached a listener: it rejected the promise the request
    // was being served on, which nobody awaited — an unhandled rejection, and
    // node's default answer to one of those is the same dead process.
    const base = await serveBrittle('readRequest');
    const response = await say(base, 'x');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ broke: 'the request dialect threw' });
    expect((await fetch(`${base}/alive`)).status).toBe(200);
  });

  it('a wire whose FAILURE body also throws still answers, in the plainest shape there is', async () => {
    // The floor under the law: when the dialect itself is what broke, the
    // refusal cannot be written in that dialect. It is written in the one shape
    // nothing can refuse.
    const base = await serveBrittle('failure');
    const response = await fetch(`${base}/nowhere`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'even the failure body threw' });
    expect(await (await say(base, 'after')).json()).toEqual({ said: 'after/none' });
  });
});

// ── scenario: the inverse seam — the caller's routes, our socket ────
//
// `{ server }` lends the host a socket somebody else owns. `onUnhandled` lends
// the CALLER every path the host does not own, on a socket the host owns. The
// field case is the second one: a container with a single port that wants a
// diagnostic route beside the agent and has no reason to bind the socket
// itself.

describe('httpHost — onUnhandled, the inverse seam', () => {
  /** The odd-dialect host, private socket, with a hook for what it does not own. */
  async function serveWithHook(
    onUnhandled: (req: IncomingMessage, res: ServerResponse) => void,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const handle = (await httpHost({
      name: 'oddHost',
      wire: oddWire,
      invokePath: '/say',
      healthPath: '/alive',
      conversationPath: '/talk',
      port: 0,
      hostname: '127.0.0.1',
      onUnhandled,
      ...extra,
    }).serve(defaultHandler)) as HttpHostHandle;
    open.push(handle);
    return handle.url;
  }

  /** A hook that answers everything it is given, and records what that was. */
  function recordingHook(seen: string[]): (req: IncomingMessage, res: ServerResponse) => void {
    return (req, res) => {
      seen.push(`${req.method ?? '?'} ${req.url ?? ''}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ from: 'the caller', path: req.url }));
    };
  }

  it('LAW: the caller answers the paths this host does not own', async () => {
    const seen: string[] = [];
    const base = await serveWithHook(recordingHook(seen));

    expect(await (await fetch(`${base}/debug/trace`)).json()).toEqual({
      from: 'the caller',
      path: '/debug/trace',
    });
    expect(seen).toEqual(['GET /debug/trace']);
    // Any method, any shape — it is their path, not this host's.
    await fetch(`${base}/debug/trace?run=7`, { method: 'DELETE' });
    expect(seen).toEqual(['GET /debug/trace', 'DELETE /debug/trace?run=7']);
  });

  it('LAW: the paths this host OWNS never leak to it — including the conversation door', async () => {
    const seen: string[] = [];
    const base = await serveWithHook(recordingHook(seen));

    // The two doors answer as they always did…
    expect(await (await say(base, 'mine')).json()).toEqual({ said: 'mine/none' });
    expect(((await (await fetch(`${base}/alive`)).json()) as { alive: boolean }).alive).toBe(true);
    // …and a WRONG METHOD on an owned path is still this host's question. A
    // hook that could claim `GET /say` could shadow the invoke door tomorrow.
    expect((await fetch(`${base}/say`)).status).toBe(404);
    expect((await fetch(`${base}/alive`, { method: 'POST' })).status).toBe(404);
    // The conversation path is owned too: an upgrade is not the only thing that
    // can arrive on it, and the door still owns the address either way.
    expect((await fetch(`${base}/talk`)).status).toBe(404);
    expect((await fetch(`${base}/talk`, { method: 'POST', body: '{}' })).status).toBe(404);

    expect(seen).toEqual([]);
  });

  it('LAW: absent, the 404 is byte-identical to the one that shipped before', async () => {
    const withHook = await serveWithHook(() => undefined, {});
    const withoutHook = (await httpHost({
      name: 'oddHost',
      wire: oddWire,
      invokePath: '/say',
      healthPath: '/alive',
      conversationPath: '/talk',
      port: 0,
      hostname: '127.0.0.1',
    }).serve(defaultHandler)) as HttpHostHandle;
    open.push(withoutHook);

    // Same host, same dialect, one with the hook and one without: the paths the
    // hook never sees must be answered identically by both.
    for (const path of ['/say', '/talk']) {
      const hooked = await fetch(`${withHook}${path}`);
      const plain = await fetch(`${withoutHook.url}${path}`);
      expect(hooked.status).toBe(plain.status);
      expect(await hooked.text()).toBe(await plain.text());
    }
    // …and with no hook at all, an unowned path is the same 404 it always was.
    const unowned = await fetch(`${withoutHook.url}/debug/trace`);
    expect(unowned.status).toBe(404);
    expect(await unowned.json()).toEqual({ broke: 'no route for GET /debug/trace' });
  });

  it('LAW: refused BY NAME beside a caller-owned server', async () => {
    const { server } = await callerServer();
    const base = { name: 'oddHost', wire: oddWire, invokePath: '/say', healthPath: '/alive' };
    expect(() => httpHost({ ...base, server, onUnhandled: () => undefined })).toThrow(
      /'onUnhandled'/,
    );
    // The refusal says why, not just that: there, unmatched paths are already
    // the caller's, and a second answer would race the first.
    expect(() => httpHost({ ...base, server, onUnhandled: () => undefined })).toThrow(
      /already yours/,
    );
    // Without the server, the same hook is perfectly ordinary.
    expect(() => httpHost({ ...base, port: 0, onUnhandled: () => undefined })).not.toThrow();
  });

  it('LAW: a hook that throws is THAT request’s 500, never the process’s failure', async () => {
    const base = await serveWithHook(() => {
      throw new Error('the diagnostic route threw');
    });

    const response = await fetch(`${base}/debug/trace`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ broke: 'the diagnostic route threw' });
    // The agent door is untouched by somebody else's broken route.
    expect(await (await say(base, 'still here')).json()).toEqual({ said: 'still here/none' });
  });

  it('a hook that already answered is not overwritten when it then throws', async () => {
    const base = await serveWithHook((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ from: 'the caller' }));
      throw new Error('after answering');
    });

    const response = await fetch(`${base}/debug/trace`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ from: 'the caller' });
    expect(await (await say(base, 'after')).json()).toEqual({ said: 'after/none' });
  });

  it('a hook that threw HALF an answer has the request ended, not left hanging', async () => {
    // The floor's other branch: headers are on the wire, so the status line
    // cannot be taken back and a 500 would be a second answer. The request is
    // ended instead — one answer that stopped early beats two half-answers on
    // one socket, and beats a caller waiting for a timeout.
    const base = await serveWithHook((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"partial":');
      throw new Error('threw mid-answer');
    });

    const response = await fetch(`${base}/debug/trace`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"partial":');
    expect(await (await say(base, 'after')).json()).toEqual({ said: 'after/none' });
  });

  it('the conversation door still opens on a host that has the hook', async () => {
    // The hook answers REQUESTS. An upgrade is a protocol handover on its own
    // event, and this pins that the two never got tangled.
    const seen: string[] = [];
    const handle = (await httpHost({
      name: 'oddHost',
      wire: oddWire,
      invokePath: '/say',
      healthPath: '/alive',
      conversationPath: '/talk',
      port: 0,
      hostname: '127.0.0.1',
      onUnhandled: recordingHook(seen),
    }).serveConversations((conversation) => {
      conversation.onFrame((frame) => conversation.send(`echo:${frame}`));
    })) as HttpHostHandle;
    open.push(handle);

    const client = upgradeClient(handle.port);
    client.socket.write(
      `GET /talk HTTP/1.1\r\nHost: 127.0.0.1:${handle.port}\r\nConnection: Upgrade\r\n` +
        `Upgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
        `Sec-WebSocket-Version: 13\r\n\r\n`,
    );
    await client.waitFor('101 Switching Protocols');
    expect(seen).toEqual([]);
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

describe('lowerCasedHeaders — one lower-casing, shared by both doors', () => {
  it('lower-cases names so no wire ever has to guess at casing', () => {
    expect(lowerCasedHeaders({ 'X-Session-Id': 'c-1', ACCEPT: 'application/json' })).toEqual({
      'x-session-id': 'c-1',
      accept: 'application/json',
    });
  });

  it('joins a header the client sent more than once, rather than keeping one and dropping the rest', () => {
    // node hands repeated headers over as an array. Keeping only the first
    // would silently lose whichever one the caller meant — and the two doors
    // share this function precisely so they cannot disagree about it.
    expect(lowerCasedHeaders({ 'Sec-WebSocket-Protocol': ['bearer', 'tok-1'] })).toEqual({
      'sec-websocket-protocol': 'bearer, tok-1',
    });
  });

  it('drops what is not a string or an array — there is nothing honest to render it as', () => {
    expect(lowerCasedHeaders({ 'x-odd': undefined, 'x-fine': 'yes' })).toEqual({ 'x-fine': 'yes' });
  });
});
