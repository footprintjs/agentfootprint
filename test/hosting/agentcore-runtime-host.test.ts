/**
 * agentCoreRuntimeHost — the container contract, asserted against a real socket.
 *
 * The host conformance suite (host-contract.test.ts) already proves this
 * adapter behaves like every other host. THIS file asserts the part that is
 * specific to it and that the suite therefore cannot see: the two paths, the
 * port, the two body shapes, the health payload, and the one thing paths alone
 * could not express — the conversation id arriving in a header, matched
 * case-insensitively.
 *
 * Nothing here is mocked. `agentCoreRuntimeHost` is plain `node:http` with no
 * AWS SDK anywhere on its path, so every assertion below is real verification
 * of the wire, not a mapping asserted in prose.
 */

import { createServer, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import {
  agentCoreRuntimeHost,
  agentCoreRuntimeWire,
  readAgentCoreConversation,
} from '../../src/hosting-providers.js';
import { nodeHost } from '../../src/hosting/index.js';
import type { ConversationHandler, HostHandle, HostHandler } from '../../src/hosting/index.js';
import type { NodeHostHandle } from '../../src/hosting/nodeHost.js';
import { connectConversation } from './wsClient.js';

const SESSION_HEADER = 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id';

const open: HostHandle[] = [];
/** Servers and sockets the TEST owns, for the attached-host scenario below. */
const servers: Server[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((h) => h.close()));
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

/** Echo everything the port delivered, so a body/header mapping bug is visible. */
const echo: HostHandler = (request, reply) => {
  reply.complete(`in=${request.input}|session=${request.sessionId ?? 'none'}`);
};

async function serving(handler: HostHandler = echo, options = {}): Promise<string> {
  const handle = (await agentCoreRuntimeHost({
    port: 0,
    hostname: '127.0.0.1',
    ...options,
  }).serve(handler)) as NodeHostHandle;
  open.push(handle);
  return handle.url;
}

function post(base: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}/invocations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

// ── unit: what the adapter declares ─────────────────────────────────

describe('agentCoreRuntimeHost — unit', () => {
  it('names itself, so a refusal says which adapter said no', () => {
    expect(agentCoreRuntimeHost().name).toBe('agentCoreRuntimeHost');
  });

  it('declares streaming and conversation, and only from the known capability set', () => {
    // Two doors, both honoured by the shipped adapter with nothing installed:
    // SSE on /invocations and the runtime's /ws channel on the same socket.
    expect(agentCoreRuntimeHost().capabilities).toEqual(['streaming', 'conversation']);
  });

  it('defaults to the port and interface the container contract requires', async () => {
    // Binding :8080 for real would collide with anything else on the box, so
    // the default is read off the options the adapter builds rather than bound.
    // 0.0.0.0 matters: bind to loopback in a container and the health probe
    // never reaches you.
    const wire = agentCoreRuntimeWire();
    expect(wire.health(0)).toMatchObject({ status: 'Healthy' });
  });

  it('the wire reads a prompt, a session header, and nothing else it was not given', () => {
    const wire = agentCoreRuntimeWire();
    expect(
      wire.readRequest({ body: { prompt: 'hi' }, headers: {}, query: new URLSearchParams() }),
    ).toEqual({ input: 'hi' });
  });
});

// ── scenario: the documented contract, over the wire ────────────────

describe('agentCoreRuntimeHost — the container contract', () => {
  it('GET /ping answers Healthy with a unix-SECONDS timestamp', async () => {
    const base = await serving();
    const before = Math.floor(Date.now() / 1000);
    const res = await fetch(`${base}/ping`);
    const body = (await res.json()) as { status: string; time_of_last_update: number };
    expect(res.status).toBe(200);
    expect(body.status).toBe('Healthy');
    // Seconds, not milliseconds — a ms value here would be ~1000x too large and
    // is exactly the kind of unit slip a health probe never tells you about.
    expect(body.time_of_last_update).toBeGreaterThanOrEqual(before);
    expect(body.time_of_last_update).toBeLessThan(before + 60);
  });

  it('reports HealthyBusy while the process says it is busy', async () => {
    let busy = false;
    const base = await serving(echo, { busy: () => busy });
    expect(((await (await fetch(`${base}/ping`)).json()) as { status: string }).status).toBe(
      'Healthy',
    );
    busy = true;
    // Read live on every probe: busy is a fact about the process, not a setting.
    expect(((await (await fetch(`${base}/ping`)).json()) as { status: string }).status).toBe(
      'HealthyBusy',
    );
  });

  it('POST /invocations takes { prompt } and answers { response, status }', async () => {
    const base = await serving();
    const res = await post(base, { prompt: 'hello' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ response: 'in=hello|session=none', status: 'success' });
  });

  it('accepts { input } too — the runtime passes the payload through verbatim', async () => {
    const base = await serving();
    // The CALLER picks the field. Refusing the port's own word would be a rule
    // this adapter invented rather than one the contract imposes.
    expect(await (await post(base, { input: 'hello' })).json()).toMatchObject({
      response: 'in=hello|session=none',
    });
  });

  it('prefers prompt when a caller sends both', async () => {
    const base = await serving();
    expect(await (await post(base, { prompt: 'p', input: 'i' })).json()).toMatchObject({
      response: 'in=p|session=none',
    });
  });

  it('a missing prompt is an empty input, not a crash', async () => {
    const base = await serving();
    expect(await (await post(base, { notPrompt: 1 })).json()).toMatchObject({
      response: 'in=|session=none',
    });
  });

  it('an unknown route is 404 with the adapter error shape', async () => {
    const base = await serving();
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ status: 'error' });
  });

  it('malformed JSON is a 400 naming the problem, not a 500', async () => {
    const base = await serving();
    const res = await fetch(`${base}/invocations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ status: 'error' });
  });

  it('the invoke path is POST-only — GET /invocations is a 404', async () => {
    const base = await serving();
    expect((await fetch(`${base}/invocations`)).status).toBe(404);
  });
});

// ── integration: the session header, which is the whole mapping ─────

describe('agentCoreRuntimeHost — the session header', () => {
  it('reads the conversation id from the runtime header', async () => {
    const base = await serving();
    const res = await post(base, { prompt: 'x' }, { [SESSION_HEADER]: 'conv-7' });
    expect(await res.json()).toMatchObject({ response: 'in=x|session=conv-7' });
  });

  it.each([
    ['exact', SESSION_HEADER],
    ['lower', SESSION_HEADER.toLowerCase()],
    ['upper', SESSION_HEADER.toUpperCase()],
    ['mixed', 'x-amzn-BEDROCK-agentcore-Runtime-Session-Id'],
  ])('matches the header case-insensitively (%s)', async (_label, header) => {
    // HTTP header names are case-insensitive and a proxy in front of the
    // container is free to re-case them. Matching one exact spelling would work
    // in every test and fail in exactly one deployment.
    const base = await serving();
    const res = await post(base, { prompt: 'x' }, { [header]: 'conv-cased' });
    expect(await res.json()).toMatchObject({ response: 'in=x|session=conv-cased' });
  });

  it('an empty header value is no session, not an empty-string session', async () => {
    const base = await serving();
    const res = await post(base, { prompt: 'x' }, { [SESSION_HEADER]: '' });
    expect(await res.json()).toMatchObject({ response: 'in=x|session=none' });
  });

  it('a sessionId in the BODY is ignored — this contract puts it in the header', async () => {
    const base = await serving();
    // Silently honouring a body field the runtime never sends would make local
    // tests pass and the deployment quietly single-session.
    const res = await post(base, { prompt: 'x', sessionId: 'from-body' });
    expect(await res.json()).toMatchObject({ response: 'in=x|session=none' });
  });

  it('every header still reaches the handler, lower-cased', async () => {
    let seen: Readonly<Record<string, string>> | undefined;
    const base = await serving((request, reply) => {
      seen = request.headers;
      reply.complete('ok');
    });
    await post(base, { prompt: 'x' }, { 'X-Tenant': 'acme' });
    expect(seen?.['x-tenant']).toBe('acme');
  });
});

// ── property: streaming keeps the completion authoritative ──────────

describe('agentCoreRuntimeHost — streaming', () => {
  it('chunks use a DIFFERENT field from the answer, so nothing double-counts', async () => {
    const base = await serving((_request, reply) => {
      reply.emit?.('one ');
      reply.emit?.('two');
      reply.complete('one two');
    });
    const res = await post(base, { prompt: 'x' }, { accept: 'text/event-stream' });
    const body = await res.text();
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    // A caller concatenating `chunk` fields gets the preview; a caller reading
    // `response` gets the answer. Reading both cannot produce it twice.
    expect(body).toContain('"chunk":"one "');
    expect(body).toContain('"response":"one two"');
  });

  it('without Accept: text/event-stream the same handler produces one JSON body', async () => {
    const base = await serving((_request, reply) => {
      reply.emit?.('ignored');
      reply.complete('final');
    });
    expect(await (await post(base, { prompt: 'x' })).json()).toEqual({
      response: 'final',
      status: 'success',
    });
  });
});

// ── security: what a failing run tells the caller ───────────────────

describe('agentCoreRuntimeHost — failures', () => {
  it('a throwing handler returns the message and NO stack trace', async () => {
    const base = await serving(() => {
      const error = new Error('boom');
      error.stack = 'Error: boom\n    at secret/internal/path.ts:42';
      throw error;
    });
    const res = await post(base, { prompt: 'x' });
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toMatchObject({ error: 'boom', status: 'error' });
    expect(JSON.stringify(body)).not.toContain('secret/internal/path.ts');
  });

  it('a refusal keeps its code and its non-5xx status', async () => {
    const base = await serving();
    const handle = open[open.length - 1];
    await handle.close();
    const res = await post(base, { prompt: 'x' }).catch(() => undefined);
    // The socket may already be gone; when it is not, the refusal is a 503 and
    // carries its stable code rather than being flattened into a 500.
    if (res) {
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ code: 'ERR_HOST_CLOSED', status: 'error' });
    }
  });
});

// ── scenario: one container, one port, two protocols ────────────────

describe('agentCoreRuntimeHost — attached to a server the caller owns', () => {
  /** A listening server the test owns, with an upgrade listener beside the agent. */
  async function containerServer(): Promise<{ server: Server; base: string; port: number }> {
    const server = createServer();
    server.on('upgrade', (_req, socket) => {
      // Upgraded sockets detach from the server, so the teardown must know
      // about them — server.close() would otherwise wait forever.
      sockets.push(socket as Socket);
      socket.on('error', () => undefined);
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n',
      );
      socket.on('data', (chunk: Buffer) => socket.write(chunk));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    servers.push(server);
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return { server, base: `http://127.0.0.1:${port}`, port };
  }

  it('LAW: the container contract answers on the caller’s socket, beside a live upgrade', async () => {
    // The field shape this exists for: a runtime hands the container ONE port,
    // and the container has to serve /invocations, /ping AND a WebSocket
    // upgrade on it. Nothing about the adapter changes except who listens.
    const { server, base, port } = await containerServer();
    const handle = (await agentCoreRuntimeHost({ server }).serve(echo)) as NodeHostHandle;
    open.push(handle);

    expect(handle.port).toBe(port);
    expect(handle.url).toBe(base);

    const invoked = await post(base, { prompt: 'hi' }, { [SESSION_HEADER]: 'sess-9' });
    expect(await invoked.json()).toEqual({
      response: 'in=hi|session=sess-9',
      status: 'success',
    });
    expect(((await (await fetch(`${base}/ping`)).json()) as { status: string }).status).toBe(
      'Healthy',
    );

    // The upgrade — the thing a privately-owned socket made impossible.
    const socket = connect(port, '127.0.0.1');
    sockets.push(socket);
    let transcript = '';
    socket.on('data', (chunk: Buffer) => {
      transcript += chunk.toString('utf8');
    });
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
    socket.write(
      `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\n` +
        `Upgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
        `Sec-WebSocket-Version: 13\r\n\r\n`,
    );
    for (let waited = 0; waited < 300 && !transcript.includes('101'); waited += 10) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(transcript).toContain('101 Switching Protocols');

    // close() gives the routes back and leaves the socket — and the upgrade —
    // exactly where the caller left them.
    await handle.close();
    expect(server.listening).toBe(true);
    socket.write('still-connected');
    for (let waited = 0; waited < 300 && !transcript.includes('still-connected'); waited += 10) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(transcript).toContain('still-connected');
  });

  it('refuses a port next to a caller-owned server rather than bind a second one', async () => {
    const { server } = await containerServer();
    // The contract's own default port is NOT smuggled in either: with a server
    // the adapter binds nothing, so it names nothing.
    expect(() => agentCoreRuntimeHost({ server, port: 8080 })).toThrow(/both a caller-owned/);
    expect(() => agentCoreRuntimeHost({ server })).not.toThrow();
  });
});

// ── ROI: the adapter is a configuration, not a second implementation ─

describe('agentCoreRuntimeHost — the thesis', () => {
  it('shares its HTTP behaviour with nodeHost rather than reimplementing it', async () => {
    // Same handler, same class of failure, same words — because there is one
    // HTTP implementation underneath and two wire dialects on top. If somebody
    // forks the machinery to "just tweak one thing", these diverge.
    const silent: HostHandler = () => undefined;
    const cloudBase = await serving(silent);
    const nodeHandle = (await nodeHost({ port: 0, hostname: '127.0.0.1' }).serve(
      silent,
    )) as NodeHostHandle;
    open.push(nodeHandle);

    const cloud = (await (await post(cloudBase, { prompt: 'x' })).json()) as { error: string };
    const plain = (await (
      await fetch(`${nodeHandle.url}/invoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'x' }),
      })
    ).json()) as { error: string };

    expect(cloud.error).toBe(plain.error);
    expect(cloud.error).toMatch(/complete\(\) or fail\(\)/);
  });
});

// ── the /ws door: this runtime's second contract ─────────────────────

describe('agentCoreRuntimeHost — the /ws conversation door', () => {
  /** Serve conversations on an ephemeral port and hand back what a caller needs. */
  async function servingConversations(
    handler: ConversationHandler = (conversation) =>
      conversation.onFrame((frame) =>
        conversation.send(
          `echo:${frame}|session:${conversation.sessionId ?? 'none'}` +
            `|auth:${conversation.headers?.authorization ?? 'none'}`,
        ),
      ),
  ): Promise<NodeHostHandle> {
    const handle = (await agentCoreRuntimeHost({
      port: 0,
      hostname: '127.0.0.1',
    }).serveConversations(handler)) as NodeHostHandle;
    open.push(handle);
    return handle;
  }

  it('declares this runtime’s ceilings — 32KB frames, a 15-minute idle — rather than hiding them', () => {
    // Declared, not worked around. Auto-chunking a 32KB cap would decide, for
    // every consumer at once, how a message is split and how the far side
    // knows the last piece landed.
    expect(agentCoreRuntimeHost().conversationLimits).toMatchObject({
      maxFrameBytes: 32_768,
      idleMs: 900_000,
    });
  });

  it('serves /ws and /invocations on ONE socket — the container gets one port', async () => {
    const host = agentCoreRuntimeHost({ port: 0, hostname: '127.0.0.1' });
    const requests = (await host.serve(echo)) as NodeHostHandle;
    open.push(requests);
    const conversations = (await host.serveConversations((conversation) =>
      conversation.onFrame((frame) => conversation.send(`ws:${frame}`)),
    )) as NodeHostHandle;
    open.push(conversations);

    expect(conversations.port).toBe(requests.port);
    const invoked = await post(requests.url, { prompt: 'over http' });
    expect(await invoked.json()).toMatchObject({ status: 'success' });

    const client = connectConversation(requests.port, { path: '/ws' });
    expect((await client.opened).status).toBe(101);
    client.send('over the socket');
    expect(await client.waitForFrames(1)).toEqual(['ws:over the socket']);
    client.destroy();
  });

  it('reads session affinity from the runtime’s header, and from the query a browser must use', async () => {
    const handle = await servingConversations();

    const viaHeader = connectConversation(handle.port, {
      path: '/ws',
      headers: { [SESSION_HEADER]: 'sess-header' },
    });
    await viaHeader.opened;
    viaHeader.send('who am i');
    expect((await viaHeader.waitForFrames(1))[0]).toContain('session:sess-header');
    viaHeader.destroy();

    // A browser's WebSocket API cannot set a header, so the runtime's own
    // header name is accepted as a query parameter too — case-insensitively.
    const viaQuery = connectConversation(handle.port, {
      path: `/ws?${SESSION_HEADER.toLowerCase()}=sess-query`,
    });
    await viaQuery.opened;
    viaQuery.send('who am i');
    expect((await viaQuery.waitForFrames(1))[0]).toContain('session:sess-query');
    viaQuery.destroy();

    // …and the port's own plain spelling, for a caller who never learned the
    // runtime's header name.
    const viaPlain = connectConversation(handle.port, { path: '/ws?sessionId=sess-plain' });
    await viaPlain.opened;
    viaPlain.send('who am i');
    expect((await viaPlain.waitForFrames(1))[0]).toContain('session:sess-plain');
    viaPlain.destroy();
  });

  it('the header wins when a caller sends both', async () => {
    const handle = await servingConversations();
    const client = connectConversation(handle.port, {
      path: '/ws?sessionId=from-query',
      headers: { [SESSION_HEADER]: 'from-header' },
    });
    await client.opened;
    client.send('who am i');
    // The same precedence the request dialect uses, so a caller that sets both
    // is never surprised by which one the server preferred.
    expect((await client.waitForFrames(1))[0]).toContain('session:from-header');
    client.destroy();
  });

  it('maps a Sec-WebSocket-Protocol bearer INTO headers, and never into a port field', async () => {
    const handle = await servingConversations();
    for (const protocols of [
      ['bearer', 'tok-123'], // two offers: the shape a browser writes
      ['bearer.tok-123'], // one offer, dotted: the other shape it can write
    ]) {
      const client = connectConversation(handle.port, { path: '/ws', protocols });
      const opened = await client.opened;
      // Echoed so the client's handshake completes — the WORD, never the token.
      expect(opened.protocol).toBe('bearer');
      expect(opened.protocol).not.toContain('tok-123');

      client.send('who am i');
      const [reply] = await client.waitForFrames(1);
      // It arrives as an ordinary header, in the vocabulary every other
      // transport already uses. Nothing on HostConversation is spelled the way
      // one vendor spells it.
      expect(reply).toContain('auth:Bearer tok-123');
      client.destroy();
    }
  });

  it('the raw subprotocol header survives the mapping, so an app can read the offer itself', async () => {
    const seen: (string | undefined)[] = [];
    const handle = await servingConversations((conversation) => {
      seen.push(conversation.headers?.['sec-websocket-protocol']);
      conversation.onFrame(() => conversation.send('ok'));
    });
    const client = connectConversation(handle.port, {
      path: '/ws',
      protocols: ['bearer', 'tok-9'],
    });
    await client.opened;
    client.send('x');
    await client.waitForFrames(1);
    expect(seen[0]).toBe('bearer, tok-9');
    client.destroy();
  });

  it('readAgentCoreConversation is inspectable without binding a socket', () => {
    // Exported for the same reason the body shapes are: a mapping you can only
    // observe by running a server is a mapping nobody reviews.
    const facts = {
      headers: { 'sec-websocket-protocol': 'bearer, tok-7' },
      query: new URLSearchParams('sessionId=c-1'),
    };
    expect(readAgentCoreConversation(facts)).toEqual({
      sessionId: 'c-1',
      headers: { authorization: 'Bearer tok-7' },
      protocol: 'bearer',
    });
    // No bearer offered: nothing invented, and no subprotocol echoed.
    expect(readAgentCoreConversation({ headers: {}, query: new URLSearchParams() })).toEqual({});
  });

  it('SECURITY: a frame past this runtime’s 32KB ceiling ends the conversation, naming it', async () => {
    const handle = await servingConversations();
    const client = connectConversation(handle.port, { path: '/ws' });
    await client.opened;
    client.send('x'.repeat(32_769));

    const closed = await client.closed;
    expect(closed.code).toBe(1009);
    expect(closed.reason).toContain('32768');
  });
});
