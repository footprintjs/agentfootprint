import { expect, it } from 'vitest';
import { Agent, defineTool, isPaused, pauseHere } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import type { LLMMessage, LLMRequest } from '../../../src/provider-contract/types.js';
import { readCallOccurrenceKey } from '../../../src/lib/callOccurrence.js';

it.each([
  ['different IDs', ['read-1', 'read-2', 'read-3']],
  ['the same ID', ['read-1', 'read-1', 'read-1']],
] as const)(
  'resumes the middle call with %s and keeps its address off the wire',
  async (_, ids) => {
    const entered: string[] = [];
    const requests: LLMRequest[] = [];
    const fixture = mock({
      replies: [
        {
          toolCalls: ['blue', 'ask', 'red'].map((label, slot) => ({
            id: ids[slot]!,
            name: 'read_label',
            args: { label },
          })),
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
          inputSchema: { type: 'object', properties: { label: { type: 'string' } } },
          execute: ({ label }) => {
            entered.push(label as string);
            return label === 'ask' ? pauseHere({ question: 'What is the label?' }) : label;
          },
        }),
      )
      .findings()
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

    expect(entered).toEqual(['blue', 'ask']);
    expect(started.map((key) => key.split('.').at(-1))).toEqual(['0', '1', '2']);
    expect(new Set(started).size).toBe(3);
    expect(ended).toEqual(started);
    const results = history.filter((message) => message.role === 'tool');
    expect(results.map(readCallOccurrenceKey)).toEqual(started);
    expect(results.slice(0, 2).map((message) => message.content)).toEqual(['blue', 'green']);
    expect(results[2]?.notDispatched?.pausedCall).toEqual({
      toolName: 'read_label',
      toolCallId: ids[1],
    });
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]?.messages)).not.toContain('callOccurrenceKey');
  },
);
