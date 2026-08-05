/**
 * deploy/own-routes — your routes on the HOST's socket, with `onUnhandled`.
 *
 * `{ server }` (see one-port.ts) solves the single-port container by giving the
 * agent a socket YOU bound. That is the right answer when you have your own
 * protocol to serve. It is a lot of ceremony when all you wanted was one
 * diagnostic route beside the agent.
 *
 *   nodeHost({ port: 8080, onUnhandled: (req, res) => { … } })
 *
 * Same one port, opposite direction: the host binds the socket as it always
 * did, and every path it does NOT own is handed to your code instead of
 * collecting its 404. The host still never answers for your application — with
 * this hook it no longer has to 404 for it either.
 *
 * Four things this file demonstrates, and each is a law with a test behind it:
 *
 *   1. **Your route answers on the agent's port.** `/debug/trace` is served by
 *      the code below, on the same socket as `/invoke`.
 *   2. **The host's own paths NEVER reach your hook** — `/invoke`, `/health`
 *      and `/conversation`, including a wrong method on one of them. A hook
 *      that could claim `POST /invoke` would be a second door wearing the
 *      first one's name.
 *   3. **The 404 is yours now.** Unmatched paths are yours to answer or to
 *      refuse; nothing is written on them unless you write it. (A hook that
 *      answers nothing leaves the request hanging until it times out — the
 *      same price, for the same reason, as the missing 404 on a caller-owned
 *      server.)
 *   4. **A throw in your route is THAT request's 500, never the process's
 *      failure.** Nothing in a request's lifecycle may ever end the container.
 *
 * This file is its own integration test: it binds an ephemeral port, calls the
 * agent, calls its own route, opens the conversation door, breaks a route on
 * purpose, and reports what each one answered. Set `SERVE=1` to keep it
 * listening on :8080.
 *
 * Run:  npm run example examples/deploy/own-routes.ts
 */

import { connect } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { Agent, type LLMProvider } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { memorySessions, nodeHost, standingAgent } from '../../src/hosting/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'deploy/own-routes',
  title: 'Your own routes on the agent’s port — onUnhandled',
  group: 'deploy',
  description:
    'Serve a diagnostic route beside the agent on ONE port without binding the socket yourself: nodeHost({ onUnhandled }) hands every path the host does not own to your code instead of answering 404 for your application. /invoke, /health and /conversation never reach it, and a route that throws costs that request a 500 and nothing else.',
  defaultInput: 'What did the last run decide?',
  providerSlots: ['default'],
  tags: ['deploy', 'hosting', 'http', 'ports-and-adapters', 'observability'],
};

function buildAgent(provider?: LLMProvider): Agent {
  return Agent.create({
    provider: provider ?? mock({ reply: 'It decided to answer briefly.' }),
    model: 'mock',
    maxIterations: 2,
  })
    .system('You are a brief assistant.')
    .build();
}

// #region own-routes
/** What the diagnostic route reports. Ordinary application state, kept by you. */
interface Desk {
  turns: number;
  lastAnswer: string;
}

/**
 * Your routes, on the host's socket.
 *
 * Everything the host does not own arrives here exactly as it came off the
 * wire — a `node:http` request and response, nothing wrapped, nothing decided.
 * The 404 is yours to write, and so is the decision not to.
 */
function ownRoutes(desk: Desk) {
  return (request: IncomingMessage, response: ServerResponse): void => {
    const path = (request.url ?? '').split('?')[0];

    if (path === '/debug/trace') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ turns: desk.turns, lastAnswer: desk.lastAnswer }));
      return;
    }
    if (path === '/debug/boom') {
      // On purpose: a route that throws is THIS request's 500. The agent door
      // beside it does not notice, and neither does the process.
      throw new Error('this route is broken on purpose');
    }
    // Nothing here is written for you. This 404 is a choice, and skipping it
    // would leave the request hanging rather than refused.
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: `no route for ${request.method} ${path}` }));
  };
}

/** One port: the agent, the conversation door, and your routes. */
async function serveEverything(provider: LLMProvider | undefined, port: number, desk: Desk) {
  const host = nodeHost({
    port,
    hostname: '127.0.0.1',
    // The whole feature. No server to create, no listen() to call, no
    // registration order to reason about.
    onUnhandled: ownRoutes(desk),
  });

  const agent = buildAgent(provider);
  const requests = await standingAgent({ agent, sessions: memorySessions(), host });
  // The third door, on the same socket as always — the hook changes nothing
  // about it, because an upgrade is a protocol handover and not a route.
  const conversations = await host.serveConversations((conversation) => {
    conversation.onFrame((frame) => conversation.send(`echo:${frame}`));
  });
  return { host, agent, requests, conversations };
}
// #endregion own-routes

async function invoke(base: string, input: string): Promise<string> {
  const response = await fetch(`${base}/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input, sessionId: 'own-routes' }),
  });
  const body = (await response.json()) as { output?: string; error?: string };
  if (body.error) throw new Error(body.error);
  return body.output ?? '';
}

/** Open the conversation door far enough to prove it still owns its path. */
async function upgrades(port: number, path: string): Promise<number> {
  const socket = connect(port, '127.0.0.1');
  socket.on('error', () => undefined);
  let transcript = '';
  socket.on('data', (chunk: Buffer) => {
    transcript += chunk.toString('utf8');
  });
  await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
  socket.write(
    `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\n` +
      `Upgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
      `Sec-WebSocket-Version: 13\r\n\r\n`,
  );
  for (let waited = 0; waited < 2000 && !transcript.includes('\r\n'); waited += 10) {
    await new Promise((r) => setTimeout(r, 10));
  }
  socket.destroy();
  return Number(transcript.split(' ')[1] ?? 0);
}

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const desk: Desk = { turns: 0, lastAnswer: '' };
  const { requests, conversations } = await serveEverything(provider, 0, desk);
  const base = requests.url;
  try {
    // 1. the agent, on its own port.
    const answer = await invoke(base, input);
    desk.turns += 1;
    desk.lastAnswer = answer;

    // 2. YOUR route, on the same port, with no server of your own.
    const trace = await (await fetch(`${base}/debug/trace`)).json();

    // 3. the host's paths are still the host's — including a wrong method on
    //    one of them, which never reaches your hook.
    const health = (await (await fetch(`${base}/health`)).json()) as { status: string };
    const wrongMethod = await fetch(`${base}/invoke`);
    const conversationDoor = await upgrades(requests.port, '/conversation');

    // 4. the 404 is yours, and so is a route that breaks.
    const yourRefusal = await fetch(`${base}/nothing-here`);
    const broken = await fetch(`${base}/debug/boom`);

    // …and the agent is still answering after a route of yours threw.
    const afterTheThrow = await invoke(base, 'still there?');

    return {
      agentAnswered: answer,
      yourRouteOnTheAgentsPort: trace,
      health: health.status,
      hostKeepsItsOwnPaths: {
        wrongMethodOnInvoke: wrongMethod.status, // 404 from the HOST, not from you
        conversationDoorStatus: conversationDoor, // 101: still a door
      },
      the404IsYours: {
        status: yourRefusal.status,
        body: await yourRefusal.json(),
      },
      aBrokenRouteCostsOneRequest: {
        status: broken.status, // 500
        agentStillAnswers: afterTheThrow,
      },
    };
  } finally {
    await conversations.close();
    await requests.close();
  }
}

if (isCliEntry(import.meta.url)) {
  if (process.env.SERVE === '1') {
    const desk: Desk = { turns: 0, lastAnswer: 'nothing yet' };
    void serveEverything(undefined, 8080, desk);
  } else {
    void run(meta.defaultInput!).then(printResult);
  }
}
