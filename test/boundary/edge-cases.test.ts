import { describe, it, expect } from 'vitest';
import {
  Agent,
  LLMCall,
  mock,
  defineTool,
  ToolRegistry,
  slidingWindow,
  userMessage,
} from '../../src';
import type { Message } from '../../src';

describe('Boundary: Empty inputs', () => {
  it('Agent handles empty message', async () => {
    const agent = Agent.create({ provider: mock([{ content: 'Ok.' }]) }).build();
    const result = await agent.run('');
    expect(result.content).toBe('Ok.');
  });

  it('LLMCall handles empty message', async () => {
    const caller = LLMCall.create({ provider: mock([{ content: 'Ok.' }]) }).build();
    const result = await caller.run('');
    expect(result.content).toBe('Ok.');
  });

  it('ToolRegistry with zero tools formats to empty array', () => {
    const registry = new ToolRegistry();
    expect(registry.formatForLLM()).toEqual([]);
  });

  it('slidingWindow with empty messages', () => {
    expect(slidingWindow([], 5)).toEqual([]);
  });
});

describe('Boundary: Large inputs', () => {
  it('handles message with 10K characters', async () => {
    const longMsg = 'x'.repeat(10_000);
    const caller = LLMCall.create({ provider: mock([{ content: 'Received.' }]) }).build();
    const result = await caller.run(longMsg);
    expect(result.content).toBe('Received.');
  });

  it('handles 100 tool registrations', () => {
    const registry = new ToolRegistry();
    for (let i = 0; i < 100; i++) {
      registry.register(
        defineTool({
          id: `tool-${i}`,
          description: `Tool ${i}`,
          inputSchema: {},
          handler: async () => ({ content: 'ok' }),
        }),
      );
    }
    expect(registry.size).toBe(100);
    expect(registry.formatForLLM()).toHaveLength(100);
  });

  it('slidingWindow with 1000 messages keeps only window', () => {
    const msgs: Message[] = Array.from({ length: 1000 }, (_, i) => userMessage(`msg-${i}`));
    const result = slidingWindow(msgs, 5);
    expect(result).toHaveLength(5);
    expect(result[4].content).toBe('msg-999');
  });
});

describe('Boundary: maxIterations edge values', () => {
  it('maxIterations=0 means no tool execution', async () => {
    const agent = Agent.create({
      provider: mock([
        {
          content: 'Want to search.',
          toolCalls: [{ id: 'tc', name: 'search', arguments: {} }],
        },
        { content: 'Gave up.' },
      ]),
    })
      .tool(
        defineTool({
          id: 'search',
          description: 'Search',
          inputSchema: {},
          handler: async () => ({ content: 'found' }),
        }),
      )
      .maxIterations(0)
      .build();

    // With maxIterations=0, should go straight to finalize
    const result = await agent.run('Search something');
    expect(result.iterations).toBe(0);
  });

  it('maxIterations=1 allows exactly one tool loop', async () => {
    const agent = Agent.create({
      provider: mock([
        {
          content: 'Searching.',
          toolCalls: [{ id: 'tc', name: 'search', arguments: {} }],
        },
        // After 1 iteration, even if tools requested, should finalize
        {
          content: 'More tools.',
          toolCalls: [{ id: 'tc2', name: 'search', arguments: {} }],
        },
        { content: 'Done.' },
      ]),
    })
      .tool(
        defineTool({
          id: 'search',
          description: 'Search',
          inputSchema: {},
          handler: async () => ({ content: 'found' }),
        }),
      )
      .maxIterations(1)
      .build();

    const result = await agent.run('Search');
    expect(result.iterations).toBeLessThanOrEqual(1);
  });
});
