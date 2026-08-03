/**
 * deploy/standing-agent — an agent that stays up and remembers.
 *
 * A script-shaped agent answers once and forgets. A deployed one has to do two
 * more things: be reachable, and continue a conversation it started before the
 * last restart. Those are the two ports in `agentfootprint/hosting`:
 *
 *   AgentHost         — something can call me.       (`nodeHost` here)
 *   SessionLifecycle  — the conversation outlives it. (`memorySessions` here)
 *   standingAgent     — hydrate → resume-or-fresh → persist → reply.
 *
 * Neither port mentions any cloud, and that is the point: swap `nodeHost` for
 * an adapter that speaks somebody's container contract, swap `memorySessions`
 * for Redis, and the agent above them does not change.
 *
 * This file is its own integration test: it binds an ephemeral port, has a
 * two-turn conversation over HTTP, proves the second turn remembered the first,
 * then shuts down. Set `SERVE=1` to keep it listening on :8080 instead.
 *
 * Run:  npm run example examples/deploy/standing-agent.ts
 */

import { Agent, type LLMProvider } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { memorySessions, nodeHost, standingAgent } from '../../src/hosting/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'deploy/standing-agent',
  title: 'A standing agent — hosted, and remembering between requests',
  group: 'deploy',
  description:
    'Serve one agent over HTTP with per-session conversation memory: standingAgent + nodeHost + memorySessions. Has a two-turn conversation against itself, proves turn 2 remembered turn 1, then exits. SERVE=1 listens forever.',
  defaultInput: 'My name is Ada.',
  providerSlots: ['default'],
  tags: ['deploy', 'hosting', 'sessions', 'ports-and-adapters', 'http'],
};

/** A consumer swaps `mock()` for a real provider — nothing else changes. */
function buildAgent(provider?: LLMProvider): Agent {
  return Agent.create({
    provider:
      provider ??
      mock({
        replies: [
          'Nice to meet you, Ada.',
          'You said your name is Ada.',
          "I don't think you've told me your name.",
        ],
      }),
    model: 'mock',
    maxIterations: 2,
  })
    .system('You are a warm, very brief assistant. Remember what the user tells you.')
    .build();
}

// #region standing
/** Serve one agent, with per-session memory, on plain HTTP. */
async function serve(agent: Agent, port: number) {
  return standingAgent({
    agent,
    sessions: memorySessions(), // swap for Redis; nothing else changes
    host: nodeHost({ port, hostname: '127.0.0.1' }),
    // 'reject' (the default) refuses a SECOND turn of the SAME conversation
    // while the first is still running. A different session is never refused —
    // it waits its turn.
    onConcurrentInvoke: 'reject',
  });
}
// #endregion standing

// #region turn
/** One turn of a conversation. `sessionId` is what makes it a conversation. */
async function say(base: string, sessionId: string, input: string): Promise<string> {
  const response = await fetch(`${base}/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input, sessionId }),
  });
  const body = (await response.json()) as { output?: string; error?: string };
  if (body.error) throw new Error(body.error);
  return body.output ?? '';
}
// #endregion turn

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  // Port 0 = "pick one for me", and the handle says which — composing through
  // standingAgent keeps what the adapter told you.
  const handle = await serve(buildAgent(provider), 0);
  const base = handle.url;

  try {
    const health = await (await fetch(`${base}/health`)).json();

    // Two turns, one session id. The second one is the whole demonstration:
    // the agent was never told the name twice.
    const first = await say(base, 'ada-1', input);
    const second = await say(base, 'ada-1', 'What is my name?');

    // A different session id is a different conversation — no bleed.
    const stranger = await say(base, 'someone-else', 'What is my name?');

    return {
      health,
      turn1: first,
      turn2: second,
      rememberedAcrossRequests: second.includes('Ada'),
      strangerSawNothing: !stranger.includes('Ada'),
      stranger,
    };
  } finally {
    await handle.close();
  }
}

if (isCliEntry(import.meta.url)) {
  if (process.env.SERVE === '1') {
    void serve(buildAgent(), 8080);
  } else {
    void run(meta.defaultInput!).then(printResult);
  }
}
