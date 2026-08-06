/**
 * deploy/one-port — an agent and a WebSocket upgrade on the SAME port.
 *
 * Some runtimes hand a container exactly one port. If the host owns the socket
 * privately, that is the end of the conversation: you can serve the agent or
 * you can serve your upgrade, not both. So a host can now attach to a
 * `node:http` server YOU own:
 *
 *   const server = createServer();          // yours
 *   server.on('upgrade', …);                // yours
 *   await listen(server, port);             // yours
 *   nodeHost({ server })                    // ← attaches, binds nothing
 *
 * Three laws come with it, and this file demonstrates all three:
 *
 *   1. The host answers ITS two paths on your socket, and writes nothing on
 *      anyone else's — a path it does not own is yours, and it will never
 *      answer 404 for your application. (The flip side, stated once so it is
 *      never a surprise: a path NOBODY routes is not a 404, it hangs. Give
 *      your server a fallback route if you want one.)
 *   2. An `'upgrade'` listener you added keeps working beside it — the case
 *      this exists for.
 *   3. `handle.close()` detaches the host and drains what it was serving. Your
 *      server stays up, your upgrade stays connected, your routes still answer.
 *
 * This file is its own integration test: it binds an ephemeral port, talks to
 * the agent, upgrades a raw socket beside it, closes the agent host, and proves
 * the socket outlived it. Set `SERVE=1` to keep it listening on :8080.
 *
 * Run:  npm run example examples/deploy/one-port.ts
 */

import { createServer, type Server } from 'node:http';
import { connect } from 'node:net';
import type { Duplex } from 'node:stream';

import { Agent, type LLMProvider } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { memorySessions, nodeHost, standingAgent } from '../../src/doors/hosting.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'deploy/one-port',
  title: 'One port, two protocols — the agent attached to a server you own',
  group: 'deploy',
  description:
    'Serve the agent AND a WebSocket upgrade on a single port: create the node:http server yourself, add your upgrade listener, and hand it to nodeHost({ server }). The host attaches its two routes, never 404s your paths, and close() detaches without closing your socket.',
  defaultInput: 'Hello from the shared port.',
  providerSlots: ['default'],
  tags: ['deploy', 'hosting', 'websocket', 'ports-and-adapters', 'http'],
};

function buildAgent(provider?: LLMProvider): Agent {
  return Agent.create({
    provider: provider ?? mock({ reply: 'Heard you on the shared port.' }),
    model: 'mock',
    maxIterations: 2,
  })
    .system('You are a brief assistant.')
    .build();
}

// #region shared-server
/** The container's own server: an upgrade, a route of your own, one port. */
function buildServer(): { server: Server; upgraded: Set<Duplex> } {
  const server = createServer();
  // An upgraded socket is yours to end, and `server.close()` will WAIT for it:
  // it never ends one for you, and it does not finish while one is still open
  // (`closeIdleConnections()` does not count it as idle either). So a graceful
  // shutdown has to destroy your upgraded sockets itself — measured behaviour,
  // and the reason the teardown below keeps this set.
  const upgraded = new Set<Duplex>();

  // Your protocol, on your port. A real deployment hands this to `ws`; the
  // handshake is written out here so the example has no extra dependency.
  server.on('upgrade', (_request, socket) => {
    upgraded.add(socket);
    socket.on('close', () => upgraded.delete(socket));
    socket.on('error', () => undefined);
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n',
    );
    socket.on('data', (chunk: Buffer) => socket.write(chunk)); // echo
  });

  // Your routes. The host never answers for these — including the 404 for
  // anything neither of you claims, which is why this fallback exists.
  server.on('request', (request, response) => {
    if (response.headersSent) return; // the agent host already answered
    const path = (request.url ?? '').split('?')[0];
    if (path === '/metrics') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ up: true }));
    }
  });

  return { server, upgraded };
}

/** Attach the agent to a server that is already listening. */
async function attachAgent(agent: Agent, server: Server) {
  return standingAgent({
    agent,
    sessions: memorySessions(),
    // No port, no hostname: this host binds nothing. Passing one anyway is
    // refused by name rather than quietly ignored.
    host: nodeHost({ server }),
  });
}
// #endregion shared-server

const listen = (server: Server, port: number): Promise<void> =>
  new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve()));

/** A raw upgrade handshake + echo, so "the WebSocket still works" is a fact, not a claim. */
async function upgradeEcho(port: number, message: string): Promise<{ upgraded: boolean }> {
  const socket = connect(port, '127.0.0.1');
  let transcript = '';
  socket.on('error', () => undefined);
  socket.on('data', (chunk: Buffer) => {
    transcript += chunk.toString('utf8');
  });
  const waitFor = async (needle: string): Promise<boolean> => {
    for (let waited = 0; waited < 2000; waited += 10) {
      if (transcript.includes(needle)) return true;
      await new Promise((r) => setTimeout(r, 10));
    }
    return false;
  };

  await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
  socket.write(
    `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n` +
      `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
  const upgraded = await waitFor('101 Switching Protocols');
  socket.write(message);
  const echoed = await waitFor(message);
  socket.destroy();
  return { upgraded: upgraded && echoed };
}

async function say(base: string, input: string): Promise<string> {
  const response = await fetch(`${base}/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input, sessionId: 'one-port' }),
  });
  const body = (await response.json()) as { output?: string; error?: string };
  if (body.error) throw new Error(body.error);
  return body.output ?? '';
}

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const { server, upgraded } = buildServer();
  await listen(server, 0);
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const handle = await attachAgent(buildAgent(provider), server);
  try {
    // 1. the agent, on your socket — and the handle reports YOUR address.
    const answer = await say(base, input);
    const health = (await (await fetch(`${base}/health`)).json()) as { status: string };

    // 2. your own route, untouched, on the same port.
    const metrics = await (await fetch(`${base}/metrics`)).json();

    // 3. your upgrade, beside the agent.
    const socketBefore = await upgradeEcho(port, 'ping-1');

    // …and the host leaving does not take the socket with it.
    await handle.close();
    const socketAfter = await upgradeEcho(port, 'ping-2');
    const metricsAfter = await (await fetch(`${base}/metrics`)).json();

    return {
      handleReportsYourAddress: handle.url === base,
      agentAnswered: answer,
      health: health.status,
      yourRouteStillYours: metrics,
      webSocketBesideTheAgent: socketBefore.upgraded,
      afterClose: {
        serverStillListening: server.listening,
        webSocketStillWorks: socketAfter.upgraded,
        yourRouteStillAnswers: metricsAfter,
      },
    };
  } finally {
    await handle.close();
    await new Promise<void>((resolve) => {
      for (const socket of upgraded) socket.destroy(); // yours to end, see above
      server.closeAllConnections();
      server.close(() => resolve());
    });
  }
}

if (isCliEntry(import.meta.url)) {
  if (process.env.SERVE === '1') {
    const { server } = buildServer();
    void listen(server, 8080).then(() => attachAgent(buildAgent(), server));
  } else {
    void run(meta.defaultInput!).then(printResult);
  }
}
