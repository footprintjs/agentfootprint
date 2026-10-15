/**
 * deploy/ag-ui — an agentfootprint run, spoken in the AG-UI protocol.
 *
 * AG-UI is the open protocol AG-UI frontends (`@ag-ui/client`, CopilotKit, the
 * AG-UI Dojo) use to drive an agent: one request in, a stream of typed events
 * out — text as it streams, tool calls with their arguments and results, steps,
 * sub-agents, and a terminal event. `agentfootprint/ag-ui` is the adapter over
 * the run's own event stream:
 *
 *   agUiSerializer — one run's events → AG-UI 1.0 events (pure, per run)
 *   agUiSse        — those events → Server-Sent Events frames, written by the
 *                    official `@ag-ui/encoder` (an optional peer: install
 *                    `@ag-ui/core @ag-ui/encoder` to use it)
 *
 * This file runs one agent turn with a tool call against the mock provider and
 * prints the frames an AG-UI frontend would read, then the conversation they
 * add up to. No key, no network.
 *
 * Run:  npm run example -- examples/deploy/ag-ui.ts
 */

import { Agent, defineTool, isPaused, type LLMProvider } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { agUiSerializer, agUiSse, type AgUiEvent } from '../../src/doors/ag-ui.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'deploy/ag-ui',
  title: 'AG-UI — a run as the AG-UI protocol’s events',
  group: 'deploy',
  description:
    'Translate one agent run (a tool call, then an answer) into AG-UI 1.0 events with agUiSerializer and frame them as Server-Sent Events with agUiSse — what an AG-UI frontend reads.',
  defaultInput: 'What is the weather in Paris?',
  providerSlots: ['default'],
  tags: ['deploy', 'ag-ui', 'streaming', 'sse', 'protocol'],
};

const weather = defineTool({
  name: 'weather',
  description: 'Current weather for a city.',
  inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  execute: async ({ city }: { city: string }) => `${city}: 21°C, sunny`,
});

function buildAgent(provider?: LLMProvider): Agent {
  return Agent.create({
    provider:
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
    model: 'mock',
  })
    .system('Answer weather questions with the weather tool.')
    .tool(weather)
    .build();
}

// #region frames
/** One run of `agent` → the AG-UI frames a frontend reads, in order. */
async function agUiFrames(agent: Agent, message: string): Promise<string[]> {
  // The AG-UI request's own ids — a frontend sends them in its RunAgentInput.
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
  } catch (error) {
    write(serializer.settle({ kind: 'failed', error }));
  } finally {
    off();
  }
  return frames;
}
// #endregion frames

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  const frames = await agUiFrames(buildAgent(provider), input);
  const events = frames.map((frame) => JSON.parse(frame.slice('data: '.length)) as AgUiEvent);
  const said = (type: AgUiEvent['type']) => events.filter((e) => e.type === type);
  // What the conversation adds up to, the way a frontend's reducer reads it:
  // each assistant message is its deltas, joined.
  const messages = new Map<string, string>();
  for (const e of said('TEXT_MESSAGE_CONTENT') as { messageId: string; delta: string }[])
    messages.set(e.messageId, (messages.get(e.messageId) ?? '') + e.delta);
  return {
    frames: frames.length,
    firstFrame: frames[0],
    assistantMessages: [...messages.values()],
    toolCalls: said('TOOL_CALL_START').map((e) => (e as { toolCallName: string }).toolCallName),
    toolResults: said('TOOL_CALL_RESULT').map((e) => (e as { content: string }).content),
    lastEvent: events.at(-1)?.type,
  };
}

if (isCliEntry(import.meta.url)) {
  void run(meta.defaultInput!).then(printResult);
}
