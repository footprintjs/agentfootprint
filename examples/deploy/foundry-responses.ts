/**
 * deploy/foundry-responses — put an agentfootprint agent behind Microsoft
 * Foundry Toolkit's Agent Inspector.
 *
 * The Toolkit talks to a local hosted agent over the **Responses** protocol —
 *
 *   HEAD /responses     capability probe                     →  204
 *   GET  /readiness     →  `{ "status": "healthy" }`
 *   POST /responses     `input` as text or user-message items; `stream: true`
 *                       in the BODY selects a nine-event SSE lifecycle from
 *                       `response.created` through `response.completed`
 *
 * on port 8088, with the conversation named by `conversation` /
 * `agent_session_id` / `session_id` (first present wins).
 *
 * Since 9.65.0 you do not write that yourself. `foundryResponsesHost()` IS
 * that contract, as an adapter on the `AgentHost` port — an **inbound hosting
 * adapter**, not a model provider. Which model the agent calls is a separate
 * decision; for a Foundry Local model it is `openai({ baseURL })` pointed at
 * the local endpoint, and nothing in this file changes.
 *
 * What it deliberately does NOT do: carry tool calls, image/file input,
 * function-call output or background responses (each is refused by name, never
 * dropped), and it does not feed the Toolkit's Workflow Visualizer — the
 * Inspector renders the conversation, not the agent's internal topology. An
 * agent's internal structure is readable from agentfootprint's own recorders.
 *
 * This file is BOTH the reference entry point AND its own integration test:
 *   • `FOUNDRY_SERVE=1`  → listen forever on :8088 (what the Inspector expects)
 *   • otherwise          → bind an ephemeral port, drive the real contract
 *                          (both probes, a non-streaming turn, a streamed turn
 *                          in the same conversation), then exit
 *
 * Run:  npx tsx examples/deploy/foundry-responses.ts
 */

import { Agent, type LLMProvider } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { foundryResponsesHost, memorySessions, standingAgent } from '../../src/doors/hosting.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'deploy/foundry-responses',
  title: 'Serve the Foundry Agent Inspector (/responses + /readiness)',
  group: 'deploy',
  description:
    'Put an agent behind Microsoft Foundry Toolkit with foundryResponsesHost + memorySessions: the hosted-agent contract (HEAD/POST /responses, GET /readiness on :8088) and the Responses SSE lifecycle, as an adapter on the hosting ports. Self-tests the contract, then exits; FOUNDRY_SERVE=1 listens forever.',
  defaultInput: 'Summarize my resume fit for a cloud engineering role.',
  providerSlots: ['default'],
  tags: ['deploy', 'foundry', 'microsoft', 'inspector', 'responses', 'hosting', 'sessions'],
};

/** A consumer swaps `mock()` for a real provider — e.g. `openai({ baseURL })`
 *  at a Foundry Local endpoint. The host does not change. */
function buildAgent(provider?: LLMProvider): Agent {
  return Agent.create({
    provider:
      provider ??
      mock({
        replies: [
          'Strong fit: cloud fundamentals present; certification gap in AZ-104.',
          'You asked about your resume fit, which I scored as strong with one certification gap.',
        ],
      }),
    model: 'mock',
    maxIterations: 2,
  })
    .system('You are a terse career-fit assistant.')
    .build();
}

// #region entrypoint
/**
 * The whole entry point. `foundryResponsesHost()` already knows the paths, the
 * port, the probe bodies, the session aliases and the SSE lifecycle, so
 * nothing here is HTTP.
 */
async function serve(agent: Agent, port: number) {
  return standingAgent({
    agent,
    sessions: memorySessions(),
    host: foundryResponsesHost({ port, hostname: '127.0.0.1' }),
  });
}
// #endregion entrypoint

// #region invoke
/** One turn, exactly as the Inspector sends it: message items in, `response` object out. */
async function invoke(base: string, text: string, conversation: string): Promise<ResponsesReply> {
  const response = await fetch(`${base}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text }] }],
      conversation,
    }),
  });
  return (await response.json()) as ResponsesReply;
}

/** The slice of a `response` object this example reads. */
interface ResponsesReply {
  readonly status?: string;
  readonly conversation?: { readonly id?: string } | null;
  readonly output?: readonly { readonly content?: readonly { readonly text?: string }[] }[];
}
// #endregion invoke

/** Production entry: listen forever on the contract's own port (the Inspector's expectation). */
async function listenForever(): Promise<void> {
  const handle = await serve(buildAgent(), 8088);
  // eslint-disable-next-line no-console
  console.log('[foundry-responses] listening on :8088 (/responses, /readiness)');
  process.on('SIGTERM', () => void handle.close());
}

/** Example/gate entry: bind an ephemeral port, drive the real contract, exit. */
export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const handle = await serve(buildAgent(provider), 0);
  const base = handle.url;

  try {
    const probe = (await fetch(`${base}/responses`, { method: 'HEAD' })).status;
    const readiness = await (await fetch(`${base}/readiness`)).json();

    // One conversation, two turns — the second streamed, and never told the
    // first answer a second time.
    const turn1 = await invoke(base, input, 'career-fit-1');
    const streamed = await fetch(`${base}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input: 'what did I just ask about?',
        stream: true,
        conversation: 'career-fit-1',
      }),
    });
    const sse = await streamed.text();
    const events = [...sse.matchAll(/^event: (.+)$/gm)].map((m) => m[1]);
    // The completed event carries the whole response object; the answer's text
    // is read from it, not assumed.
    const completedData = [...sse.matchAll(/^data: (.+)$/gm)].map((m) => m[1]).at(-1);
    const completed = completedData === undefined ? undefined : (JSON.parse(completedData) as {
      response?: ResponsesReply;
    });
    const turn2Text = completed?.response?.output?.[0]?.content?.[0]?.text ?? '';

    return {
      headProbeStatus: probe,
      readiness,
      turn1Status: turn1.status,
      turn1Text: turn1.output?.[0]?.content?.[0]?.text,
      streamOpensWith: events[0],
      streamEndsWith: events.at(-1),
      turn2Text,
      // Turn 2 was never told the topic — only the conversation id connects it.
      rememberedAcrossRequests: turn2Text.includes('resume fit'),
      streamedEventCount: events.length,
    };
  } finally {
    await handle.close();
  }
}

if (isCliEntry(import.meta.url)) {
  if (process.env.FOUNDRY_SERVE === '1') {
    void listenForever();
  } else {
    void run(meta.defaultInput!).then(printResult);
  }
}
