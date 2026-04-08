/**
 * ExplainRecorder — per-iteration evaluation units.
 *
 * Tests the connected data shape: each iteration has its own context,
 * decisions, sources, and claim. Evaluators walk iterations to assess
 * faithfulness, relevance, and hallucination.
 */
import { describe, it, expect } from 'vitest';
import { Agent, mock, defineTool } from '../../src/test-barrel';
import { ExplainRecorder } from '../../src/recorders/ExplainRecorder';

const searchTool = defineTool({
  id: 'search',
  description: 'Search the web',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  handler: async ({ query }: { query: string }) => ({
    content: `Results for "${query}": found data`,
  }),
});

describe('ExplainRecorder — per-iteration evaluation', () => {
  it('tool-calling agent produces 2 iterations with correct structure', async () => {
    const explain = new ExplainRecorder();

    const agent = Agent.create({
      provider: mock([
        {
          content: 'Let me search.',
          toolCalls: [{ id: 'tc1', name: 'search', arguments: { query: 'AI safety' } }],
        },
        { content: 'AI safety is important.' },
      ]),
    })
      .system('You are a research assistant.')
      .tool(searchTool)
      .recorder(explain)
      .build();

    await agent.run('Tell me about AI safety');

    const report = explain.explain();
    expect(report.iterations).toHaveLength(2);

    // Iteration 0: tool-calling response (no claim)
    const iter0 = report.iterations[0];
    expect(iter0.iteration).toBe(0);
    expect(iter0.decisions).toHaveLength(1);
    expect(iter0.decisions[0].toolName).toBe('search');
    expect(iter0.sources).toHaveLength(1);
    expect(iter0.sources[0].result).toContain('found data');
    expect(iter0.claim).toBeNull();

    // Iteration 1: final answer (has claim, no decisions)
    const iter1 = report.iterations[1];
    expect(iter1.iteration).toBe(1);
    expect(iter1.decisions).toHaveLength(0);
    expect(iter1.sources).toHaveLength(0);
    expect(iter1.claim).not.toBeNull();
    expect(iter1.claim!.content).toBe('AI safety is important.');
  });

  it('per-iteration context captures systemPrompt and availableTools', async () => {
    const explain = new ExplainRecorder();

    const agent = Agent.create({
      provider: mock([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'search', arguments: { query: 'test' } }],
        },
        { content: 'Done.' },
      ]),
    })
      .system('You are helpful.')
      .tool(searchTool)
      .recorder(explain)
      .build();

    await agent.run('Search for test');

    const report = explain.explain();

    // Context should have input, systemPrompt, and available tools
    expect(report.context.input).toBe('Search for test');
    expect(report.context.systemPrompt).toBe('You are helpful.');
    expect(report.context.availableTools).toBeDefined();
    expect(report.context.availableTools!.some((t) => t.name === 'search')).toBe(true);

    // Per-iteration context should also have it
    const iter0 = report.iterations[0];
    expect(iter0.context.systemPrompt).toBe('You are helpful.');
    expect(iter0.context.input).toBe('Search for test');
  });

  it('no-tools agent produces 1 iteration with claim', async () => {
    const explain = new ExplainRecorder();

    const agent = Agent.create({
      provider: mock([{ content: 'Hello world!' }]),
    })
      .recorder(explain)
      .build();

    await agent.run('Hi');

    const report = explain.explain();
    expect(report.iterations).toHaveLength(1);

    const iter = report.iterations[0];
    expect(iter.iteration).toBe(0);
    expect(iter.decisions).toHaveLength(0);
    expect(iter.sources).toHaveLength(0);
    expect(iter.claim).not.toBeNull();
    expect(iter.claim!.content).toBe('Hello world!');
  });

  it('flat accessors match iteration data', async () => {
    const explain = new ExplainRecorder();

    const agent = Agent.create({
      provider: mock([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'search', arguments: { query: 'q1' } }],
        },
        { content: 'Answer.' },
      ]),
    })
      .tool(searchTool)
      .recorder(explain)
      .build();

    await agent.run('Question');

    const report = explain.explain();

    // Flat sources = all iterations' sources combined
    const flatSources = report.iterations.flatMap((it) => it.sources);
    expect(report.sources).toHaveLength(flatSources.length);
    expect(report.sources[0].toolName).toBe(flatSources[0].toolName);

    // Flat claims = non-null claims from iterations
    const flatClaims = report.iterations.filter((it) => it.claim).map((it) => it.claim!);
    expect(report.claims).toHaveLength(flatClaims.length);

    // Flat decisions = all iterations' decisions combined
    const flatDecisions = report.iterations.flatMap((it) => it.decisions);
    expect(report.decisions).toHaveLength(flatDecisions.length);
  });

  it('clear() resets iterations', async () => {
    const explain = new ExplainRecorder();

    const agent = Agent.create({
      provider: mock([
        {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'search', arguments: { query: 'q' } }],
        },
        { content: 'Done.' },
      ]),
    })
      .tool(searchTool)
      .recorder(explain)
      .build();

    await agent.run('Go');
    expect(explain.explain().iterations).toHaveLength(2);

    explain.clear();
    expect(explain.explain().iterations).toHaveLength(0);
    expect(explain.explain().sources).toHaveLength(0);
    expect(explain.explain().claims).toHaveLength(0);
    expect(explain.explain().context).toEqual({});
  });
});
