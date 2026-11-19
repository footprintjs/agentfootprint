import { expect, it } from 'vitest';
import { Agent, defineTool, isPaused, pauseHere } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import type { LLMMessage, LLMRequest } from '../../../src/provider-contract/types.js';
import { readCallOccurrenceKey } from '../../../src/lib/callOccurrence.js';

it('carries a paused call address through a JSON checkpoint and keeps it off the provider wire', async () => {
  const requests: LLMRequest[] = [];
  const fixture = mock({
    replies: [
      {
        toolCalls: [
          { id: 'read-1', name: 'read_label', args: {} },
          { id: 'read-2', name: 'ask_label', args: {} },
        ],
      },
      { content: 'The labels were recorded.' },
    ],
  });
  const agent = Agent.create({
    provider: {
      name: fixture.name,
      complete(request) {
        requests.push(request);
        return fixture.complete(request);
      },
    },
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'read_label',
        description: 'Read a fixture label.',
        inputSchema: { type: 'object' },
        execute: () => 'blue',
      }),
    )
    .tool(
      defineTool({
        name: 'ask_label',
        description: 'Ask for a fixture label.',
        inputSchema: { type: 'object' },
        execute: () => pauseHere({ question: 'What is the label?' }),
      }),
    )
    .build();

  const started: string[] = [];
  const ended: string[] = [];
  let history: readonly LLMMessage[] = [];
  agent.on('agentfootprint.stream.tool_start', (event) => {
    started.push(readCallOccurrenceKey(event.payload) ?? '');
  });
  agent.on('agentfootprint.stream.tool_end', (event) => {
    ended.push(readCallOccurrenceKey(event.payload) ?? '');
  });
  agent.on('agentfootprint.agent.iteration_end', (event) => {
    if (event.payload.history !== undefined) history = event.payload.history;
  });

  const pause = await agent.run('Read the colors.');
  if (!isPaused(pause)) throw new Error('Expected a pause');
  await agent.resume(JSON.parse(JSON.stringify(pause.checkpoint)), 'green');

  expect(started).toHaveLength(2);
  expect(started.every((key) => key.length > 0)).toBe(true);
  expect(started[0]).not.toEqual(started[1]);
  expect(ended).toEqual(started);
  expect(history.filter((message) => message.role === 'tool').map(readCallOccurrenceKey)).toEqual(
    started,
  );
  expect(requests).toHaveLength(2);
  expect(JSON.stringify(requests[1]?.messages)).not.toContain('callOccurrenceKey');
});
