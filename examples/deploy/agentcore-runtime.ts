/**
 * deploy/agentcore-runtime — run an agentfootprint agent inside AWS Bedrock
 * AgentCore Runtime.
 *
 * AgentCore Runtime is a CONTAINER contract: your agent must be an ARM64
 * container serving the runtime's HTTP protocol on `0.0.0.0:8080` —
 *
 *   POST /invocations   JSON `{ "prompt": "..." }`  →  JSON `{ "response", "status" }`
 *   GET  /ping          →  `{ "status": "Healthy", "time_of_last_update": <unix> }`
 *
 * and the caller's conversation arrives in the
 * `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` header.
 *
 * Since 7.15.0 you do not write that yourself. `agentCoreRuntimeHost()` IS that
 * contract, as an adapter on the `AgentHost` port; `agentCoreSessions()` is
 * where the conversation lives between requests; `standingAgent()` is the same
 * composer you would use anywhere else. The container's whole entry point is
 * the `serve()` function below, and not one line of it is HTTP.
 *
 * This file is BOTH the reference entry point AND its own integration test:
 *   • `AGENTCORE_SERVE=1`  → listen forever on :8080 (what the container runs)
 *   • otherwise            → bind an ephemeral port, drive the real contract
 *                            (/ping, /invocations, the session header, and a
 *                            second turn that remembers the first), then exit
 *
 * Deploy: see ./Dockerfile + ./README.md. Swap `buildAgent()`'s `mock()` for
 * `providerFromEnv()` (Bedrock/Anthropic/Azure) — nothing else changes.
 *
 * Run:  npx tsx examples/deploy/agentcore-runtime.ts
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

import { Agent, type LLMProvider } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { standingAgent } from '../../src/doors/hosting.js';
import { agentCoreRuntimeHost, agentCoreSessions } from '../../src/doors/hosting.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'deploy/agentcore-runtime',
  title: 'Deploy on AWS Bedrock AgentCore Runtime (/invocations + /ping)',
  group: 'deploy',
  description:
    'Run an agentfootprint agent inside AgentCore Runtime with agentCoreRuntimeHost + agentCoreSessions: the container HTTP contract (POST /invocations, GET /ping on :8080) and the session header, as adapters on the hosting ports. Self-tests the contract, then exits; AGENTCORE_SERVE=1 listens forever.',
  defaultInput: "what's the status of fc1/3?",
  providerSlots: ['default'],
  tags: ['deploy', 'agentcore', 'aws', 'runtime', 'bedrock', 'hosting', 'sessions'],
};

/** The header AgentCore Runtime puts the caller's conversation in. */
const SESSION_HEADER = 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id';

/** A consumer swaps `mock()` for `providerFromEnv()` (Bedrock/Anthropic/Azure). */
function buildAgent(provider?: LLMProvider): Agent {
  return Agent.create({
    provider:
      provider ??
      mock({
        replies: [
          'fc1/3 is down — degraded SFP suspected.',
          'You asked about fc1/3, which is down with a suspected degraded SFP.',
        ],
      }),
    model: 'mock',
    maxIterations: 2,
  })
    .system('You are a terse, read-only SAN triage assistant.')
    .build();
}

// #region entrypoint
/**
 * The container's entry point. `agentCoreRuntimeHost()` already knows the two
 * paths, the port, the session header and the body shapes, so nothing here is
 * HTTP.
 *
 * `{ store: 'session-storage' }` keeps each conversation in a JSON file in the
 * runtime's own session storage, which survives a stop/resume of the container.
 * Swap it for `{ store: 'memory', memoryId }` to outlive the session entirely —
 * the agent above does not change either way.
 */
async function serve(agent: Agent, port: number, sessionPath?: string) {
  return standingAgent({
    agent,
    host: agentCoreRuntimeHost({ port, hostname: '127.0.0.1' }),
    sessions: agentCoreSessions({
      store: 'session-storage',
      ...(sessionPath !== undefined && { path: sessionPath }),
    }),
  });
}
// #endregion entrypoint

// #region invoke
/** One call, exactly as the runtime makes it: prompt in the body, conversation in a header. */
async function invoke(base: string, prompt: string, sessionId?: string): Promise<AgentCoreReply> {
  const response = await fetch(`${base}/invocations`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(sessionId !== undefined && { [SESSION_HEADER]: sessionId }),
    },
    body: JSON.stringify({ prompt }),
  });
  return (await response.json()) as AgentCoreReply;
}

/** `{ response, status: 'success' }` on the way out, `{ error, status: 'error' }` when it fails. */
interface AgentCoreReply {
  readonly response?: string;
  readonly status?: string;
  readonly error?: string;
}
// #endregion invoke

/** Production entry: listen forever on the contract's own port (the container's job). */
async function listenForever(): Promise<void> {
  const handle = await standingAgent({
    agent: buildAgent(),
    host: agentCoreRuntimeHost(), // 0.0.0.0:8080, POST /invocations, GET /ping
    sessions: agentCoreSessions({ store: 'session-storage' }),
  });
  // eslint-disable-next-line no-console
  console.log('[agentcore-runtime] listening on http://0.0.0.0:8080 (/invocations, /ping)');
  process.on('SIGTERM', () => void handle.close());
}

/** Example/gate entry: bind an ephemeral port, drive the real contract, exit. */
export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  // A per-run file, so the example never touches a real deployment's storage.
  const sessionPath = join(tmpdir(), `agentcore-session-example-${process.pid}`);
  const handle = await serve(buildAgent(provider), 0, sessionPath);
  const base = handle.url;

  try {
    const ping = await (await fetch(`${base}/ping`)).json();

    // One conversation, two turns. The session id rides in the header and never
    // in the body, and turn 2 was never told the answer a second time.
    const turn1 = await invoke(base, input, 'san-triage-1');
    const turn2 = await invoke(base, 'what did I just ask about?', 'san-triage-1');

    const notFound = (await fetch(`${base}/nope`)).status;

    return {
      ping,
      turn1,
      turn2,
      rememberedAcrossRequests: (turn2.response ?? '').includes('fc1/3'),
      notFoundStatus: notFound,
    };
  } finally {
    await handle.close();
    await rm(sessionPath, { force: true });
  }
}

if (isCliEntry(import.meta.url)) {
  if (process.env.AGENTCORE_SERVE === '1') {
    void listenForever();
  } else {
    void run(meta.defaultInput!).then(printResult);
  }
}
