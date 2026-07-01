/**
 * deploy/agentcore-runtime — run an agentfootprint agent inside AWS Bedrock
 * AgentCore Runtime.
 *
 * AgentCore Runtime is a CONTAINER contract, not an adapter: your agent must be
 * an ARM64 container that serves the runtime's HTTP protocol on `0.0.0.0:8080`:
 *
 *   POST /invocations   JSON `{ "prompt": "..." }`  →  JSON `{ "response", "status" }`
 *   GET  /ping          →  `{ "status": "Healthy", "time_of_last_update": <unix> }`
 *
 * This file is BOTH the reference handler AND its own integration test:
 *   • `AGENTCORE_SERVE=1`  → listen forever on :8080 (what the container runs)
 *   • otherwise            → bind an ephemeral port, self-test /ping + /invocations,
 *                            print the result, exit (what the example gate runs)
 *
 * Deploy: see ./Dockerfile + ./README.md. Swap `buildAgent()`'s `mock()` for
 * `providerFromEnv()` (Bedrock/Anthropic/Azure) — nothing else changes.
 *
 * Run:  npx tsx examples/deploy/agentcore-runtime.ts
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { Agent, type LLMProvider } from '../../src/index.js'
import { mock } from '../../src/llm-providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'deploy/agentcore-runtime',
  title: 'Deploy on AWS Bedrock AgentCore Runtime (/invocations + /ping)',
  group: 'deploy',
  description:
    'Run an agentfootprint agent inside AgentCore Runtime: the ARM64 container HTTP contract (POST /invocations, GET /ping on :8080). Self-tests the handler, then exits; set AGENTCORE_SERVE=1 to listen forever.',
  defaultInput: "what's the status of fc1/3?",
  providerSlots: ['default'],
  tags: ['deploy', 'agentcore', 'aws', 'runtime', 'bedrock'],
};

const HOST = '0.0.0.0';
const PORT = 8080;

/** A consumer swaps `mock()` for `providerFromEnv()` (Bedrock/Anthropic/Azure). */
function buildAgent(provider?: LLMProvider) {
  return Agent.create({
    provider: provider ?? mock({ reply: 'fc1/3 is down — degraded SFP suspected.' }),
    model: 'mock',
    maxIterations: 2,
  })
    .system('You are a terse, read-only SAN triage assistant.')
    .build();
}

/** Read + JSON-parse a request body (AgentCore caps payloads at 100 MB). */
function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

/**
 * The AgentCore Runtime HTTP handler. Pure w.r.t. transport — pass any built
 * agent; returns a `node:http` request listener. Exported so it's unit-testable
 * without binding a socket.
 */
export function agentCoreHandler(agent: ReturnType<typeof buildAgent>) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    void (async () => {
      try {
        if (req.method === 'GET' && req.url === '/ping') {
          // HealthyBusy is the signal for "processing async work"; this sample is sync.
          return sendJson(res, 200, {
            status: 'Healthy',
            time_of_last_update: Math.floor(Date.now() / 1000),
          });
        }
        if (req.method === 'POST' && req.url === '/invocations') {
          const body = (await readJson(req)) as { prompt?: unknown };
          const message = typeof body.prompt === 'string' ? body.prompt : '';
          const answer = await agent.run({ message });
          // answer is the agent's final text (AgentOutput = string). A pausing
          // agent would return a RunnerPauseOutcome — handle that if you use pause/resume.
          return sendJson(res, 200, { response: answer, status: 'success' });
        }
        return sendJson(res, 404, { error: `no route for ${req.method} ${req.url}` });
      } catch (err) {
        // Never leak a stack trace to the caller; AgentCore surfaces the status code.
        return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    })();
  };
}

/** Production entry: listen forever (the container's job). */
function serve(port = PORT): Server {
  const server = createServer(agentCoreHandler(buildAgent()));
  server.listen(port, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`[agentcore-runtime] listening on http://${HOST}:${port} (/invocations, /ping)`);
  });
  return server;
}

/** Example/gate entry: bind an ephemeral port, self-test the contract, exit. */
export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const server = createServer(agentCoreHandler(buildAgent(provider)));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : PORT;
  const base = `http://127.0.0.1:${port}`;
  try {
    const ping = await (await fetch(`${base}/ping`)).json();
    const invoke = await (
      await fetch(`${base}/invocations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: input }),
      })
    ).json();
    const notFound = (await fetch(`${base}/nope`)).status;
    return { ping, invoke, notFoundStatus: notFound };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

if (isCliEntry(import.meta.url)) {
  if (process.env.AGENTCORE_SERVE === '1') {
    serve();
  } else {
    void run(meta.defaultInput!).then(printResult);
  }
}
