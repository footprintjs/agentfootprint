/**
 * Sample 02: Agent with Tools (ReAct Loop)
 *
 * An agent that can use tools. The LLM decides when to call tools
 * and when to respond. This is the ReAct (Reasoning + Acting) pattern.
 *
 * Flow: User → LLM → (tool call → tool result → LLM)* → final response
 */
import { describe, it, expect } from 'vitest';
import { Agent, mock, defineTool } from '../../src';

describe('Sample 02: Agent with Tools', () => {
  // Define tools with id, description, schema, and handler
  const searchTool = defineTool({
    id: 'web_search',
    description: 'Search the web for information.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    handler: async (input) => ({
      content: `Results for "${input.query}": AI is transforming healthcare, finance, and education.`,
    }),
  });

  const calcTool = defineTool({
    id: 'calculator',
    description: 'Perform mathematical calculations.',
    inputSchema: {
      type: 'object',
      properties: { expression: { type: 'string' } },
    },
    handler: async (input) => ({
      content: `${input.expression} = 42`,
    }),
  });

  it('agent calls a tool and uses the result', async () => {
    // Mock LLM: first response calls the tool, second gives final answer
    const llm = mock([
      {
        content: 'Let me search for that.',
        toolCalls: [{ id: 'tc1', name: 'web_search', arguments: { query: 'AI trends 2025' } }],
      },
      { content: 'Based on my research, AI is transforming multiple industries.' },
    ]);

    const agent = Agent.create({ provider: llm })
      .system('You are a research assistant.')
      .tool(searchTool)
      .build();

    const result = await agent.run('What are the AI trends?');

    expect(result.content).toBe('Based on my research, AI is transforming multiple industries.');
  });

  it('agent can use multiple tools', async () => {
    const llm = mock([
      {
        content: 'Searching and calculating.',
        toolCalls: [
          { id: 'tc1', name: 'web_search', arguments: { query: 'data' } },
          { id: 'tc2', name: 'calculator', arguments: { expression: '6 * 7' } },
        ],
      },
      { content: 'Search returned data, and 6*7 = 42.' },
    ]);

    const agent = Agent.create({ provider: llm }).tools([searchTool, calcTool]).build();

    const result = await agent.run('Search and calculate');
    expect(result.content).toContain('42');
  });

  it('agent responds directly when no tools needed', async () => {
    const agent = Agent.create({
      provider: mock([{ content: 'Hello! How can I help?' }]),
    })
      .tool(searchTool)
      .build();

    const result = await agent.run('Hi there');
    expect(result.content).toBe('Hello! How can I help?');
  });

  it('agent maintains conversation history across turns', async () => {
    const agent = Agent.create({
      provider: mock([
        { content: 'Hi! I can help with research.' },
        { content: 'You asked me about help.' },
      ]),
    })
      .system('You are helpful.')
      .build();

    await agent.run('Hello');
    const result = await agent.run('What did I just ask?');
    expect(result.content).toBe('You asked me about help.');
  });
});
