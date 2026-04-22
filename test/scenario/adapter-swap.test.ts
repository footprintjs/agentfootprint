import { describe, it, expect } from 'vitest';
import { Agent, mock, defineTool } from '../../src/test-barrel';

/**
 * Scenario: Adapter Swap — same flowchart, different adapters, identical behavior.
 *
 * This is the $0 testing story: mock adapter in tests, real adapter in prod,
 * same control flow, same narrative trace structure.
 */

const weatherTool = defineTool({
  id: 'get-weather',
  description: 'Get current weather',
  inputSchema: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
  },
  handler: async ({ city }) => ({ content: `Sunny in ${city}` }),
});

function buildAgent(provider: import('../../src').LLMProvider) {
  return Agent.create({ provider })
    .system('You are a weather assistant.')
    .tool(weatherTool)
    .maxIterations(5)
    .build();
}

describe('Scenario: Adapter Swap ($0 testing)', () => {
  it('mock adapter produces same narrative structure as would a real adapter', async () => {
    const mockProvider = mock([
      {
        content: 'Checking weather.',
        toolCalls: [{ id: 'tc-1', name: 'get-weather', arguments: { city: 'Seattle' } }],
      },
      { content: 'It is sunny in Seattle.' },
    ]);

    const agent = buildAgent(mockProvider);
    const result = await agent.run('Weather in Seattle?');

    expect(result.content).toBe('It is sunny in Seattle.');

    const narrative = agent.getNarrativeEntries().map((e) => e.text);
    // Verify the narrative has the expected structure
    expect(narrative.some((s) => s.includes('[Seed]'))).toBe(true);
    expect(narrative.some((s) => s.includes('Preparing system prompt'))).toBe(true);
  });

  it('two mock adapters with same responses produce identical results', async () => {
    const responses = [
      {
        content: 'Let me check.',
        toolCalls: [{ id: 'tc-1', name: 'get-weather', arguments: { city: 'NYC' } }],
      },
      { content: 'Rainy in NYC.' },
    ];

    const agent1 = buildAgent(mock([...responses]));
    const agent2 = buildAgent(mock([...responses]));

    const result1 = await agent1.run('Weather in NYC?');
    const result2 = await agent2.run('Weather in NYC?');

    expect(result1.content).toBe(result2.content);
    expect(result1.iterations).toBe(result2.iterations);
  });

  it('agent function is reusable — buildAgent is a factory', async () => {
    // Same buildAgent function, different mock data — proves the flowchart
    // shape is independent of the adapter
    const sunnyAgent = buildAgent(mock([{ content: 'Sunny!' }]));
    const rainyAgent = buildAgent(mock([{ content: 'Rainy!' }]));

    expect((await sunnyAgent.run('Weather?')).content).toBe('Sunny!');
    expect((await rainyAgent.run('Weather?')).content).toBe('Rainy!');
  });
});
