/**
 * The upgrade adapter's own laws — the ones the conformance suite cannot state
 * because they are about sockets rather than about the port.
 *
 * Three groups, and the first is the release's one change to existing
 * behaviour:
 *
 *  1. **The shared socket.** Both doors stand on ONE socket, they are
 *     independent of each other, and only the last one out closes it. The
 *     regression being prevented is concrete: before this, a second `serve`
 *     bound a second socket, so an agent and a conversation on one port —
 *     the deployment this whole feature exists for — was `EADDRINUSE`.
 *  2. **The upgrade beside everything else**, on a server we own and on a
 *     server the caller owns.
 *  3. **The ceilings, enforced where they were declared** — including the
 *     pre-subscribe buffer, which is a ceiling on this process's memory and
 *     therefore gets a number rather than a hope.
 */

import { createServer, type Server } from 'node:http';
import { connect, createServer as createTcpServer, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';

import { httpHost, type HttpHostHandle } from '../../src/hosting/httpHost.js';
import { jsonWire, nodeHost } from '../../src/hosting/index.js';
import { memorySessions, standingAgent } from '../../src/hosting/index.js';
import type {
  AgentHost,
  ConversationHandler,
  HostConversation,
  HostHandle,
} from '../../src/hosting/index.js';
import { Agent } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { connectConversation, oversizedHeader } from './wsClient.js';

const open: HostHandle[] = [];
const servers: Server[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
  for (const handle of open.splice(0)) await handle.close().catch(() => undefined);
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 20_000);

/** An echo handler: everything it receives comes back with a prefix. */
const echo: ConversationHandler = (conversation) => {
  conversation.onFrame((frame) => conversation.send(`echo:${frame}`));
};

/** A handler that never subscribes — for the pre-subscribe buffer's bound. */
function neverSubscribes(seen: HostConversation[]): ConversationHandler {
  return (conversation) => {
    seen.push(conversation);
    // Deliberately no onFrame: this is the shape the pre-subscribe buffer
    // exists for, taken to its worst case.
  };
}

/** A port nobody is listening on — so a test can prove two doors share one. */
async function freePort(): Promise<number> {
  const probe = createTcpServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** True when something is listening there. */
async function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1');
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

async function invoke(url: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${url}/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return (await response.json()) as { output?: string; error?: string };
}

describe('the shared socket — two doors, one port', () => {
  it('LAW: serve() and serveConversations() bind ONE socket, not two', async () => {
    // The regression, made concrete: with a FIXED port, two doors that each
    // bound their own would be EADDRINUSE on the second — which is exactly the
    // container this feature exists for.
    const port = await freePort();
    const host = nodeHost({ port, hostname: '127.0.0.1' });

    const requests = (await host.serve((request, reply) =>
      reply.complete(`said:${request.input}`),
    )) as HttpHostHandle;
    open.push(requests);
    const conversations = (await host.serveConversations(echo)) as HttpHostHandle;
    open.push(conversations);

    expect(requests.port).toBe(port);
    expect(conversations.port).toBe(port);
    expect(conversations.url).toBe(requests.url);

    // Both doors really answer, on that one socket.
    expect(await invoke(requests.url, { input: 'hi' })).toEqual({ output: 'said:hi' });
    const client = connectConversation(port);
    expect((await client.opened).status).toBe(101);
    client.send('hello');
    expect(await client.waitForFrames(1)).toEqual(['echo:hello']);
    client.destroy();
  });

  it('LAW: closing one door leaves the other one serving — in both orders', async () => {
    const port = await freePort();
    const host = nodeHost({ port, hostname: '127.0.0.1' });
    const requests = (await host.serve((request, reply) =>
      reply.complete(`said:${request.input}`),
    )) as HttpHostHandle;
    const conversations = (await host.serveConversations(echo)) as HttpHostHandle;

    // Close the REQUEST door: the conversation door is untouched, and a
    // conversation opened afterwards still works.
    await requests.close();
    const client = connectConversation(port);
    expect((await client.opened).status).toBe(101);
    client.send('still here');
    expect(await client.waitForFrames(1)).toEqual(['echo:still here']);
    client.destroy();
    await conversations.close();

    // And the other order: close the CONVERSATION door, requests keep answering.
    const second = nodeHost({ port, hostname: '127.0.0.1' });
    const secondRequests = (await second.serve((request, reply) =>
      reply.complete(`said:${request.input}`),
    )) as HttpHostHandle;
    open.push(secondRequests);
    const secondConversations = await second.serveConversations(echo);
    await secondConversations.close();
    expect(await invoke(secondRequests.url, { input: 'after' })).toEqual({ output: 'said:after' });
  });

  it('LAW: the socket goes only when the LAST door lets go of it', async () => {
    const port = await freePort();
    const host = nodeHost({ port, hostname: '127.0.0.1' });
    const requests = await host.serve((_request, reply) => reply.complete('ok'));
    const conversations = await host.serveConversations(echo);

    await requests.close();
    // Still listening: one door left, and it is answering on this socket.
    expect(await isListening(port)).toBe(true);

    await conversations.close();
    // Now nobody holds it, so it is really gone — a half-released socket would
    // leave the port unbindable for the next process.
    expect(await isListening(port)).toBe(false);
  });

  it('LAW: a live conversation cannot outlive its door — close() ends it first', async () => {
    // Measured behaviour this protects: an upgraded socket keeps
    // `server.close()` waiting forever. A door that walked away from its
    // conversations would hang every shutdown that shares the socket.
    const port = await freePort();
    const host = nodeHost({ port, hostname: '127.0.0.1' });
    const conversations = await host.serveConversations(echo);
    const client = connectConversation(port);
    await client.opened;
    client.send('hold the socket open');
    await client.waitForFrames(1);

    const closed = await Promise.race([
      conversations.close().then(() => 'closed'),
      new Promise((resolve) => setTimeout(() => resolve('HUNG'), 2000)),
    ]);
    expect(closed).toBe('closed');
    expect((await client.closed).code).toBe(1001);
    expect(await isListening(port)).toBe(false);
  });
});

describe('the conversation door on a socket the CALLER owns', () => {
  async function callerServer(): Promise<{ server: Server; port: number; url: string }> {
    const server = createServer();
    servers.push(server);
    // Every server-side socket, tracked by the TEST — because an upgrade that
    // NOBODY answers is nobody's to close, and `server.close()` waits for it
    // forever. That is the documented cost of never answering for the caller's
    // application, and here it is, in the cleanup that has to pay it.
    server.on('connection', (socket: Socket) => sockets.push(socket));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return { server, port, url: `http://127.0.0.1:${port}` };
  }

  it('LAW: it attaches beside the caller’s own upgrade listener and takes only its path', async () => {
    const { server, port } = await callerServer();
    const theirs: string[] = [];
    server.on('upgrade', (request, socket: Duplex) => {
      if ((request.url ?? '').split('?')[0] !== '/mine') return;
      theirs.push(request.url ?? '');
      socket.on('error', () => undefined);
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n');
    });

    const handle = await nodeHost({ server }).serveConversations(echo);
    open.push(handle);

    // Ours answers as a conversation…
    const client = connectConversation(port);
    expect((await client.opened).status).toBe(101);
    client.send('beside');
    expect(await client.waitForFrames(1)).toEqual(['echo:beside']);
    client.destroy();

    // …and theirs is untouched on the same socket.
    const mine = connectConversation(port, { path: '/mine' });
    expect((await mine.opened).status).toBe(101);
    expect(theirs).toEqual(['/mine']);
    mine.destroy();
  });

  it('LAW: an upgrade on a path this door does not own is left for the caller', async () => {
    const { server, port } = await callerServer();
    const handle = await nodeHost({ server }).serveConversations(echo);
    open.push(handle);

    // Nobody routed it, so nobody answers it — the upgrade twin of the 404 law,
    // and the same documented cost: unanswered, not refused.
    const stray = connectConversation(port, { path: '/nobody' });
    const outcome = await Promise.race([
      stray.opened.then(() => 'answered'),
      new Promise((resolve) => setTimeout(() => resolve('left alone'), 250)),
    ]);
    expect(outcome).toBe('left alone');
    stray.destroy();
  });

  it('LAW: close() detaches and leaves the caller’s socket listening', async () => {
    const { server, port, url } = await callerServer();
    server.on('request', (request, response) => {
      if ((request.url ?? '') === '/theirs') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ from: 'caller' }));
      }
    });
    const handle = await nodeHost({ server }).serveConversations(echo);
    await handle.close();

    expect(await isListening(port)).toBe(true);
    expect(await (await fetch(`${url}/theirs`)).json()).toEqual({ from: 'caller' });
  });

  it('LAW: on OUR socket an unclaimed upgrade is answered, because nobody else can', async () => {
    const host = nodeHost({ port: 0, hostname: '127.0.0.1' });
    const handle = (await host.serveConversations(echo)) as HttpHostHandle;
    open.push(handle);

    const stray = connectConversation(handle.port, { path: '/nobody' });
    const { status } = await stray.opened;
    expect(status).toBe(400);
    stray.destroy();
  });
});

// ── the deeper law, on the other door ───────────────────────────────
//
// `node:http` calls an `'upgrade'` listener from its own stack, and an upgraded
// socket's `'data'` listener the same way. A throw inside either is UNCAUGHT —
// so one bad handshake, or one co-listener's setting, would end every other
// conversation on this door and every request beside them. Both are contained
// here, and both cost exactly one conversation.

describe('a conversation is never the PROCESS’s failure', () => {
  it('LAW: a handshake dialect that throws refuses THAT upgrade and keeps the door open', async () => {
    let firstOnly = true;
    const handle = (await httpHost({
      name: 'brittleHost',
      wire: {
        ...jsonWire,
        readConversation: () => {
          // Throws for the first handshake only, so the same door can be shown
          // still working immediately afterwards.
          if (firstOnly) {
            firstOnly = false;
            throw new Error('the handshake dialect threw');
          }
          return {};
        },
      },
      invokePath: '/invoke',
      healthPath: '/health',
      conversationPath: '/conversation',
      port: 0,
      hostname: '127.0.0.1',
    }).serveConversations(echo)) as HttpHostHandle;
    open.push(handle);

    const refused = connectConversation(handle.port);
    expect((await refused.opened).status).toBe(500);
    refused.destroy();

    // The door is still a door: the next conversation is carried normally.
    const after = connectConversation(handle.port);
    expect((await after.opened).status).toBe(101);
    after.send('after');
    expect(await after.waitForFrames(1)).toEqual(['echo:after']);
    after.destroy();
  });

  it('WHY THE FRAME READER IS SAFE: node refuses an encoding on an upgraded socket', async () => {
    // The request door's field defect asked the same question of this one: a
    // co-listener shares the upgraded socket, and one that called
    // `setEncoding` would turn every frame into text with its mask key decoded
    // away. It cannot. Node replaces `setEncoding` on a socket it has handed to
    // `'upgrade'` with a refusal — ERR_HTTP_SOCKET_ENCODING, "not allowed per
    // RFC7230 Section 3" — so the chunks this door reads are bytes by the
    // transport's own rule and not by this door's hope.
    //
    // Pinned rather than asserted in prose, because the reason lives in NODE
    // and could change there; if it ever does, this test says so first.
    const server = createServer();
    servers.push(server);
    server.on('connection', (socket: Socket) => sockets.push(socket));
    const refusals: string[] = [];
    server.on('upgrade', (request, socket: Duplex) => {
      if ((request.url ?? '').split('?')[0] !== '/conversation') return;
      try {
        socket.setEncoding('utf8');
        refusals.push('ALLOWED');
      } catch (err) {
        refusals.push((err as { code?: string }).code ?? String(err));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const handle = await nodeHost({ server }).serveConversations(echo);
    open.push(handle);

    const client = connectConversation(port);
    expect((await client.opened).status).toBe(101);
    client.send('hello');
    expect(await client.waitForFrames(1)).toEqual(['echo:hello']);
    client.destroy();

    expect(refusals).toEqual(['ERR_HTTP_SOCKET_ENCODING']);
  });
});

describe('the declared ceilings, enforced where they were declared', () => {
  async function serving(
    limits?: { maxFrameBytes?: number; maxPendingBytes?: number },
    handler: ConversationHandler = echo,
  ): Promise<HttpHostHandle> {
    const handle = (await nodeHost({
      port: 0,
      hostname: '127.0.0.1',
      ...(limits && { conversationLimits: limits }),
    }).serveConversations(handler)) as HttpHostHandle;
    open.push(handle);
    return handle;
  }

  it('declares what it enforces, defaults included', () => {
    expect(nodeHost().conversationLimits).toEqual({
      maxFrameBytes: 1_048_576,
      maxPendingBytes: 1_048_576,
    });
    // A deployment's own numbers are declared as given, topped up with the
    // defaults for whatever it did not name — so the declaration is always
    // what is really enforced.
    expect(nodeHost({ conversationLimits: { maxFrameBytes: 64 } }).conversationLimits).toEqual({
      maxFrameBytes: 64,
      maxPendingBytes: 1_048_576,
    });
  });

  it('SECURITY: an inbound frame past maxFrameBytes ends the conversation, saying so', async () => {
    const handle = await serving({ maxFrameBytes: 64 });
    const client = connectConversation(handle.port);
    await client.opened;
    client.send('x'.repeat(65));

    const closed = await client.closed;
    expect(closed.code).toBe(1009);
    expect(closed.reason).toContain('past the declared maxFrameBytes of 64');
  });

  it('SECURITY: an ANNOUNCED oversized frame is refused before its payload is buffered', async () => {
    const handle = await serving({ maxFrameBytes: 64 });
    const client = connectConversation(handle.port);
    await client.opened;
    // A header claiming 500 MB, with not one byte of it sent.
    client.sendRaw(oversizedHeader(500_000_000));

    const closed = await client.closed;
    expect(closed.code).toBe(1009);
    expect(closed.reason).toContain('500000000');
  });

  it('SECURITY: fragmentation cannot walk past the ceiling — the port’s frame is the MESSAGE', async () => {
    const handle = await serving({ maxFrameBytes: 64 });
    const client = connectConversation(handle.port);
    await client.opened;
    // Four 20-byte pieces: every piece is under the ceiling and the message is not.
    client.sendFragmented(['a'.repeat(20), 'b'.repeat(20), 'c'.repeat(20), 'd'.repeat(20)]);

    const closed = await client.closed;
    expect(closed.code).toBe(1009);
    expect(closed.reason).toContain('fragmented message');
  });

  it('SECURITY: a flood before onFrame(...) ends the conversation by the rule, never by OOM', async () => {
    const seen: HostConversation[] = [];
    const handle = await serving({ maxPendingBytes: 1_024 }, neverSubscribes(seen));
    const client = connectConversation(handle.port);
    await client.opened;
    // Nothing is subscribed and nothing ever will be. Without a bound this is
    // an unbounded queue somebody else fills and this process pays for.
    for (let i = 0; i < 50; i++) client.send('x'.repeat(100));

    const closed = await client.closed;
    expect(closed.code).toBe(1009);
    expect(closed.reason).toContain('before onFrame(...) was subscribed');
    expect(closed.reason).toContain('maxPendingBytes of 1024');
    expect(seen).toHaveLength(1);
  });

  it('holds what fits, and hands it to the first subscriber in order', async () => {
    const delivered: string[] = [];
    const handle = await serving(undefined, async (conversation) => {
      // Two awaits before subscribing: a handler that looks something up first
      // is the ordinary shape, not the exotic one.
      await new Promise((resolve) => setTimeout(resolve, 40));
      conversation.onFrame((frame) => delivered.push(frame));
    });
    const client = connectConversation(handle.port);
    await client.opened;
    client.send('one');
    client.send('two');
    client.send('three');

    const deadline = Date.now() + 2000;
    while (delivered.length < 3 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(delivered).toEqual(['one', 'two', 'three']);
    client.destroy();
  });
});

describe('the protocol itself, over a real socket', () => {
  async function serving(handler: ConversationHandler = echo): Promise<HttpHostHandle> {
    const handle = (await nodeHost({ port: 0, hostname: '127.0.0.1' }).serveConversations(
      handler,
    )) as HttpHostHandle;
    open.push(handle);
    return handle;
  }

  it('a fragmented message is delivered as ONE frame at the port', async () => {
    const handle = await serving();
    const client = connectConversation(handle.port);
    await client.opened;
    client.sendFragmented(['Hel', 'lo ', 'world']);
    expect(await client.waitForFrames(1)).toEqual(['echo:Hello world']);
    client.destroy();
  });

  it('answers a ping with a pong carrying the same payload', async () => {
    const handle = await serving();
    const client = connectConversation(handle.port);
    await client.opened;
    expect(await client.ping('are you there')).toBe('are you there');
    // …and the channel still works afterwards.
    client.send('yes');
    expect(await client.waitForFrames(1)).toEqual(['echo:yes']);
    client.destroy();
  });

  it('REFUSAL: a binary frame ends the conversation by name — this port carries text', async () => {
    const handle = await serving();
    const client = connectConversation(handle.port);
    await client.opened;
    client.sendBinary(Buffer.from([0x00, 0x01, 0x02]));

    const closed = await client.closed;
    expect(closed.code).toBe(1003);
    expect(closed.reason).toContain('text frames only');
  });

  it('REFUSAL: a request that is not a version-13 upgrade gets a 400 naming the door', async () => {
    const handle = await serving();
    const socket = connect(handle.port, '127.0.0.1');
    sockets.push(socket);
    let transcript = '';
    socket.on('data', (chunk: Buffer) => {
      transcript += chunk.toString('utf8');
    });
    socket.write(
      `GET /conversation HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
    );
    const deadline = Date.now() + 2000;
    while (!transcript.includes('\r\n\r\n') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(transcript).toContain('400 Bad Request');
    expect(transcript).toContain('nodeHost');
  });

  it('a dropped socket is reported as the transport ending it, not as either side closing', async () => {
    const closes: { by: string; reason?: string }[] = [];
    const handle = await serving((conversation) => {
      conversation.onClose((reason) => closes.push(reason));
      conversation.onFrame(() => undefined);
    });
    const client = connectConversation(handle.port);
    await client.opened;
    client.send('then vanish');
    await new Promise((resolve) => setTimeout(resolve, 30));
    client.destroy();

    const deadline = Date.now() + 2000;
    while (closes.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(closes).toHaveLength(1);
    expect(closes[0].by).toBe('transport');
  });

  // The platform's own WebSocket client where the runtime has one: an
  // implementation nobody in this repository wrote, exercising the same door.
  // Skipped rather than faked on runtimes without it — this package supports
  // Node 20, where the global does not exist.
  it.skipIf(typeof WebSocket === 'undefined')(
    'speaks to the platform’s own WebSocket client, which nothing here authored',
    async () => {
      const handle = await serving();
      const client = new WebSocket(`ws://127.0.0.1:${handle.port}/conversation?sessionId=c-9`);
      const frames: string[] = [];
      client.addEventListener('message', (event) => frames.push(String(event.data)));
      await new Promise((resolve) => client.addEventListener('open', resolve, { once: true }));

      client.send('hello from the platform');
      const deadline = Date.now() + 3000;
      while (frames.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(frames).toEqual(['echo:hello from the platform']);
      client.close();
    },
  );
});

describe('session affinity across the two doors', () => {
  it('the same sessionId reaches a request and a conversation as the same string', async () => {
    const port = await freePort();
    const host = nodeHost({ port, hostname: '127.0.0.1' });
    const fromRequests: (string | undefined)[] = [];
    const fromConversations: (string | undefined)[] = [];

    const requests = (await host.serve((request, reply) => {
      fromRequests.push(request.sessionId);
      reply.complete('ok');
    })) as HttpHostHandle;
    open.push(requests);
    const conversations = await host.serveConversations((conversation) => {
      fromConversations.push(conversation.sessionId);
      conversation.onFrame(() => conversation.send('ok'));
    });
    open.push(conversations);

    await invoke(requests.url, { input: 'hi', sessionId: 'shared-42' });
    // A browser cannot set a header on a WebSocket, so this dialect reads the
    // query too — and the header still wins when both arrive.
    const viaQuery = connectConversation(port, { path: '/conversation?sessionId=shared-42' });
    await viaQuery.opened;
    viaQuery.send('hi');
    await viaQuery.waitForFrames(1);
    viaQuery.destroy();

    const viaHeader = connectConversation(port, {
      path: '/conversation?sessionId=ignored',
      headers: { 'x-session-id': 'shared-42' },
    });
    await viaHeader.opened;
    viaHeader.send('hi');
    await viaHeader.waitForFrames(1);
    viaHeader.destroy();

    expect(fromRequests).toEqual(['shared-42']);
    expect(fromConversations).toEqual(['shared-42', 'shared-42']);
  });
});

describe('refusals a caller can act on', () => {
  it('a host built without a conversationPath refuses by name and declares nothing', async () => {
    const host = httpHost({
      name: 'requestsOnly',
      wire: jsonWire,
      invokePath: '/invoke',
      healthPath: '/health',
      port: 0,
      hostname: '127.0.0.1',
    });
    expect(host.capabilities).toEqual(['streaming']);
    await expect(host.serveConversations(echo)).rejects.toThrow(
      /built without a 'conversationPath'/,
    );
    await expect(host.serveConversations(echo)).rejects.toThrow('requestsOnly');
  });

  it('serving conversations twice on one host refuses rather than picking a winner', async () => {
    const host = nodeHost({ port: 0, hostname: '127.0.0.1' });
    const handle = await host.serveConversations(echo);
    open.push(handle);
    await expect(host.serveConversations(echo)).rejects.toThrow(/already serving conversations/);

    // …and the refusal is not permanent: close the first, serve again.
    await handle.close();
    open.pop();
    const again = await host.serveConversations(echo);
    open.push(again);
    expect(again.port).toBeGreaterThan(0);
  });
});

describe('D4: standingAgent is NOT conversation-aware, and that is deliberate', () => {
  it('the composer never opens a conversation door, even on a host that has one', async () => {
    // Three consumers push different things down a channel — tool calls out,
    // UI events in, task updates both ways — so baking one loop into the
    // composer would be consumer bias. The absence is pinned rather than
    // assumed: a host whose conversation door EXPLODES if touched serves a
    // standing agent perfectly well.
    let touched = false;
    const inner = nodeHost({ port: 0, hostname: '127.0.0.1' });
    const guarded: AgentHost & { serveConversations: () => Promise<HostHandle> } = {
      name: inner.name,
      capabilities: inner.capabilities,
      serve: (handler) => inner.serve(handler),
      serveConversations: () => {
        touched = true;
        throw new Error('standingAgent must not open a conversation door');
      },
    };

    const handle = (await standingAgent({
      agent: Agent.create({ provider: mock({ reply: 'hello back' }), model: 'mock' })
        .system('brief')
        .build(),
      sessions: memorySessions(),
      host: guarded,
    })) as HttpHostHandle;
    open.push(handle);

    expect(await invoke(handle.url, { input: 'hi', sessionId: 'c-1' })).toEqual({
      output: 'hello back',
    });
    expect(touched).toBe(false);
  });
});
