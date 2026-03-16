import { describe, it, expect } from 'vitest';
import { Agent, mock, defineTool } from '../../src';

const searchTool = defineTool({
  id: 'search',
  description: 'Search the web',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  handler: async ({ query }) => ({ content: `Results for: ${query}` }),
});

const calcTool = defineTool({
  id: 'calculator',
  description: 'Calculate math',
  inputSchema: { type: 'object', properties: { expr: { type: 'string' } }, required: ['expr'] },
  handler: ({ expr }) => ({ content: `Result: ${String(expr)}` }),
});

describe('Scenario: Agent with Tool Loop (ReAct)', () => {
  it('calls a tool and returns final answer', async () => {
    const agent = Agent.create({
      provider: mock([
        // Call 1: LLM requests search tool
        {
          content: 'Let me search.',
          toolCalls: [{ id: 'tc-1', name: 'search', arguments: { query: 'weather' } }],
        },
        // Call 2: LLM returns final answer
        { content: 'The weather is sunny.' },
      ]),
    })
      .system('You are a helpful assistant.')
      .tool(searchTool)
      .build();

    const result = await agent.run('What is the weather?');

    expect(result.content).toBe('The weather is sunny.');
    expect(result.iterations).toBe(1); // one tool loop
  });

  it('handles multiple tool calls in sequence', async () => {
    const agent = Agent.create({
      provider: mock([
        // Call 1: two tool calls
        {
          content: 'Searching and calculating.',
          toolCalls: [
            { id: 'tc-1', name: 'search', arguments: { query: 'data' } },
            { id: 'tc-2', name: 'calculator', arguments: { expr: '2+2' } },
          ],
        },
        // Call 2: final answer
        { content: 'Found data, 2+2=4.' },
      ]),
    })
      .tool(searchTool)
      .tool(calcTool)
      .build();

    const result = await agent.run('Find data and calculate.');
    expect(result.content).toBe('Found data, 2+2=4.');
  });

  it('respects maxIterations to prevent infinite loops', async () => {
    // LLM keeps requesting tools forever
    const responses = Array.from({ length: 20 }, () => ({
      content: 'Still working...',
      toolCalls: [{ id: 'tc', name: 'search', arguments: { query: 'loop' } }],
    }));
    // Add a final response that won't be reached if maxIterations works
    responses.push({ content: 'Done', toolCalls: undefined as any });

    const agent = Agent.create({ provider: mock(responses) })
      .tool(searchTool)
      .maxIterations(3)
      .build();

    const result = await agent.run('Loop test');
    // Should stop after 3 iterations, finalize with whatever is available
    expect(result.iterations).toBeLessThanOrEqual(3);
  });

  it('generates narrative with tool execution details', async () => {
    const agent = Agent.create({
      provider: mock([
        {
          content: 'Searching.',
          toolCalls: [{ id: 'tc-1', name: 'search', arguments: { query: 'test' } }],
        },
        { content: 'Found it.' },
      ]),
    })
      .tool(searchTool)
      .build();

    await agent.run('Search for test');

    const narrative = agent.getNarrative();
    expect(narrative.length).toBeGreaterThan(0);
  });

  it('handles unknown tool gracefully', async () => {
    const agent = Agent.create({
      provider: mock([
        {
          content: 'Calling unknown tool.',
          toolCalls: [{ id: 'tc-1', name: 'nonexistent', arguments: {} }],
        },
        { content: 'Tool not found, sorry.' },
      ]),
    })
      .tool(searchTool)
      .build();

    const result = await agent.run('Try unknown tool');
    expect(result.content).toBe('Tool not found, sorry.');
  });

  it('handles tool handler errors gracefully', async () => {
    const brokenTool = defineTool({
      id: 'broken',
      description: 'Always fails',
      inputSchema: {},
      handler: () => {
        throw new Error('Tool exploded');
      },
    });

    const agent = Agent.create({
      provider: mock([
        {
          content: 'Calling broken tool.',
          toolCalls: [{ id: 'tc-1', name: 'broken', arguments: {} }],
        },
        { content: 'Tool failed, moving on.' },
      ]),
    })
      .tool(brokenTool)
      .build();

    const result = await agent.run('Try broken tool');
    expect(result.content).toBe('Tool failed, moving on.');
  });
});

describe('Scenario: Multi-turn conversation', () => {
  it('preserves conversation history across runs', async () => {
    const agent = Agent.create({
      provider: mock([{ content: 'Hi Alice!' }, { content: 'Your name is Alice.' }]),
    })
      .system('Remember names.')
      .build();

    await agent.run('My name is Alice.');
    const result = await agent.run('What is my name?');

    expect(result.content).toBe('Your name is Alice.');
    // Should have full history: system + user1 + asst1 + user2 + asst2
    expect(result.messages.length).toBeGreaterThanOrEqual(4);
  });

  it('resetConversation clears history', async () => {
    const agent = Agent.create({
      provider: mock([{ content: 'First response.' }, { content: 'Fresh start.' }]),
    }).build();

    await agent.run('First message');
    agent.resetConversation();

    const result = await agent.run('New conversation');
    // Should only have user + assistant (no history from first run)
    expect(result.messages).toHaveLength(2);
  });
});
