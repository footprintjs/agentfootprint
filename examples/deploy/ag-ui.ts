/**
 * deploy/ag-ui — any AG-UI frontend runs an agentfootprint agent, no glue code.
 *
 * AG-UI is the open protocol AG-UI frontends (`@ag-ui/client`, CopilotKit, the
 * AG-UI Dojo) use to drive an agent: they POST one `RunAgentInput` and read a
 * stream of typed events — text as it streams, tool calls with their arguments
 * and results, steps, sub-agents, and a terminal event. Two pieces serve it:
 *
 *   streamHandler (agentfootprint/hosting) — a Fetch-API handler,
 *                  `(request) => Promise<Response>`, that mounts in Next.js,
 *                  Hono, Bun, Deno or Workers. It builds a FRESH agent for every
 *                  request, binds the conversation the request names to the
 *                  caller YOUR code authenticates (`threads`), and keeps the
 *                  conversation on the server (`sessions`);
 *   agUi()        (agentfootprint/ag-ui)   — the protocol adapter it takes: an
 *                  untrusted request → the turn, the run's served events →
 *                  AG-UI events, framed by the official `@ag-ui/encoder` (an
 *                  optional peer: `npm install @ag-ui/core @ag-ui/encoder`).
 *
 * This file posts two turns to the handler exactly as a frontend would and
 * prints what the frontend reads — against the mock provider. No key, no
 * network, no server socket.
 *
 * Run:  npm run example -- examples/deploy/ag-ui.ts
 */

import { Agent, defineTool, isPaused, type LLMProvider, type Tool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { memorySessions, streamHandler, type ThreadBinder } from '../../src/doors/hosting.js';
import { agUi, agUiSerializer, agUiSse, type AgUiEvent } from '../../src/doors/ag-ui.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'deploy/ag-ui',
  title: 'AG-UI — any AG-UI frontend runs the agent, no glue code',
  group: 'deploy',
  description:
    'Serve an agent to AG-UI frontends with streamHandler + agUi(): POST a RunAgentInput, read AG-UI events (text, a tool call and its result, steps) as Server-Sent Events. A fresh agent per request; the thread bound to the signed-in caller; the conversation kept on the server across two turns.',
  defaultInput: 'What is the weather in Paris?',
  providerSlots: ['default'],
  tags: ['deploy', 'ag-ui', 'streaming', 'sse', 'protocol', 'hosting'],
};

const weather = defineTool({
  name: 'weather',
  description: 'Current weather for a city.',
  inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  execute: async ({ city }: { city: string }) => `${city}: 21°C, sunny`,
});

/** Your agent — built anew for every request. `tools` are the page's allow-listed frontend tools. */
function buildAgent(provider: LLMProvider, tools: readonly Tool[] = []): Agent {
  return Agent.create({ provider, model: 'mock' })
    .system('Answer weather questions with the weather tool.')
    .tools([weather, ...tools])
    .build();
}

// #region serve
/**
 * YOUR authentication: who is calling. A real app verifies a session cookie or a
 * bearer token here (`verifyRequestIdentity`); this one trusts a demo header.
 */
const threads: ThreadBinder = {
  bind: ({ conversation, headers }) => {
    const user = headers['x-demo-user'] ?? 'guest';
    // The key is the caller's own: the same thread id from someone else is another conversation.
    return {
      sessionId: `${user}:${conversation}`,
      identity: { principal: user, conversationId: conversation },
    };
  },
};

/** The whole server side: one handler, mounted at any route of any framework. */
function serve(provider: LLMProvider) {
  return streamHandler({
    agent: ({ tools }) => buildAgent(provider, tools), // fresh per request
    adapter: agUi(),
    threads,
    sessions: memorySessions(), // sqliteSessions({ file }) to survive a restart
  });
  // Next.js:  export const POST = serve(provider);
  // Hono:     app.post('/agent', (c) => handler(c.req.raw));
  // Bun/Deno: Bun.serve({ fetch: handler }) · Deno.serve(handler)
}
// #endregion serve

// #region turn
/** One turn, posted the way an AG-UI frontend posts it; the events it reads back. */
async function turn(
  handler: (request: Request) => Promise<Response>,
  runId: string,
  messages: readonly Record<string, unknown>[],
): Promise<AgUiEvent[]> {
  const response = await handler(
    new Request('http://localhost/agent', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        'x-demo-user': 'ada',
      },
      body: JSON.stringify({ threadId: 'thread-1', runId, messages, tools: [], context: [] }),
    }),
  );
  const text = await response.text();
  return text
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice('data: '.length)) as AgUiEvent);
}
// #endregion turn

// #region frames
/** Without the handler: one run of `agent` → the AG-UI frames, for a transport of your own. */
async function agUiFrames(agent: Agent, message: string): Promise<string[]> {
  const serializer = agUiSerializer({ threadId: 'thread-1', runId: 'run-1' });
  const framing = agUiSse(); // the official @ag-ui/encoder writes every frame
  const frames: string[] = [];
  const write = (events: readonly AgUiEvent[]) => {
    for (const event of events) frames.push(framing.frame(event));
  };
  // Subscribe BEFORE the run: every event the run serves, translated as it lands.
  const off = agent.on('*', (event) => write(serializer.event(event)));
  try {
    const out = await agent.run({ message });
    write(serializer.settle({ kind: isPaused(out) ? 'paused' : 'finished' }));
  } catch {
    // Said in fixed words — never by the thrown value.
    write(serializer.settle({ kind: 'failed' }));
  } finally {
    off();
  }
  return frames;
}
// #endregion frames

/** What a frontend's reducer reads out of a stream: each assistant message, joined. */
function said(events: readonly AgUiEvent[]): string[] {
  const messages = new Map<string, string>();
  for (const e of events)
    if (e.type === 'TEXT_MESSAGE_CONTENT')
      messages.set(e.messageId, (messages.get(e.messageId) ?? '') + e.delta);
  return [...messages.values()];
}

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const llm =
    provider ??
    mock({
      chunkDelayMs: 0,
      replies: [
        {
          content: 'Let me check.',
          toolCalls: [{ id: 'call_1', name: 'weather', args: { city: 'Paris' } }],
        },
        'It is 21°C and sunny in Paris.',
        'You asked about Paris — 21°C and sunny.',
      ],
    });
  const handler = serve(llm);

  const first = await turn(handler, 'run-1', [{ id: 'u1', role: 'user', content: input }]);
  const call = first.find((e) => e.type === 'TOOL_CALL_START');
  const result = first.find((e) => e.type === 'TOOL_CALL_RESULT');

  // The frontend sends its copy of the thread back; only the newest message is
  // read — the server continues ITS copy of the conversation.
  const second = await turn(handler, 'run-2', [
    { id: 'u1', role: 'user', content: input },
    { id: 'a2', role: 'assistant', content: said(first).at(-1) ?? '' },
    { id: 'u2', role: 'user', content: 'Which city did I ask about?' },
  ]);

  // The same run without the handler: frames for a transport of your own.
  const frames = await agUiFrames(
    buildAgent(
      provider ??
        mock({
          chunkDelayMs: 0,
          replies: [
            {
              content: 'Let me check.',
              toolCalls: [{ id: 'call_1', name: 'weather', args: { city: 'Paris' } }],
            },
            'It is 21°C and sunny in Paris.',
          ],
        }),
    ),
    input,
  );

  return {
    turn1: {
      events: first.length,
      types: [...new Set(first.map((e) => e.type))],
      assistantMessages: said(first),
      toolCall: call?.type === 'TOOL_CALL_START' ? call.toolCallName : undefined,
      toolResult: result?.type === 'TOOL_CALL_RESULT' ? result.content : undefined,
    },
    turn2: { assistantMessages: said(second), last: second.at(-1)?.type },
    serializerOnly: { frames: frames.length, firstFrame: frames[0] },
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
