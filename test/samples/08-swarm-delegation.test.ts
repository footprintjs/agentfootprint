/**
 * Sample 08: Swarm — LLM-Driven Delegation
 *
 * An orchestrator agent that delegates to specialists as tools.
 * Unlike FlowChart (fixed sequence), Swarm lets the LLM decide
 * which specialist to call and when.
 *
 * Pattern: Orchestrator → LLM decides → specialist agent (as tool) → LLM → response
 */
import { describe, it, expect } from 'vitest';
import { Swarm, mock, defineTool } from '../../src/test-barrel';
import type { RunnerLike } from '../../src/test-barrel';

describe('Sample 08: Swarm Delegation', () => {
  it('orchestrator delegates to the right specialist', async () => {
    // Specialist agents
    const researcher: RunnerLike = {
      run: async (msg) => ({ content: `Research findings: ${msg}` }),
    };

    const coder: RunnerLike = {
      run: async (msg) => ({ content: `Code: function solve() { /* ${msg} */ }` }),
    };

    // Orchestrator decides which specialist to use
    const swarm = Swarm.create({
      provider: mock([
        {
          content: 'This needs research.',
          toolCalls: [
            { id: 'tc1', name: 'research', arguments: { message: 'quantum computing basics' } },
          ],
        },
        { content: 'Here are the research findings on quantum computing.' },
      ]),
    })
      .system('You are a project manager. Delegate tasks to specialists.')
      .specialist('research', 'Deep research on any topic.', researcher)
      .specialist('code', 'Write code to solve problems.', coder)
      .build();

    const result = await swarm.run('I need to understand quantum computing');
    expect(result.content).toContain('research findings');
  });

  it('orchestrator can call multiple specialists in sequence', async () => {
    const researcher: RunnerLike = {
      run: async () => ({ content: 'Research: AI facts' }),
    };
    const writer: RunnerLike = {
      run: async () => ({ content: 'Article: AI Overview' }),
    };

    const swarm = Swarm.create({
      provider: mock([
        {
          content: 'First, research.',
          toolCalls: [{ id: 'tc1', name: 'research', arguments: { message: 'AI' } }],
        },
        {
          content: 'Now write.',
          toolCalls: [{ id: 'tc2', name: 'write', arguments: { message: 'write about AI' } }],
        },
        { content: 'Done! Article is ready.' },
      ]),
    })
      .specialist('research', 'Research topics.', researcher)
      .specialist('write', 'Write articles.', writer)
      .build();

    const result = await swarm.run('Write an article about AI');
    expect(result.content).toBe('Done! Article is ready.');
  });

  it('orchestrator responds directly when no delegation needed', async () => {
    const helper: RunnerLike = {
      run: async () => ({ content: 'helped' }),
    };

    const swarm = Swarm.create({
      provider: mock([{ content: '2 + 2 = 4' }]),
    })
      .specialist('helper', 'Help with things.', helper)
      .build();

    const result = await swarm.run('What is 2+2?');
    expect(result.content).toBe('2 + 2 = 4');
  });

  it('swarm can include non-agent tools', async () => {
    const helper: RunnerLike = {
      run: async () => ({ content: 'ok' }),
    };

    const calcTool = defineTool({
      id: 'calc',
      description: 'Calculate math.',
      inputSchema: { type: 'object', properties: { expr: { type: 'string' } } },
      handler: async () => ({ content: '42' }),
    });

    const swarm = Swarm.create({
      provider: mock([
        {
          content: 'Let me calculate.',
          toolCalls: [{ id: 'tc1', name: 'calc', arguments: { expr: '6*7' } }],
        },
        { content: 'The answer is 42.' },
      ]),
    })
      .specialist('helper', 'General help.', helper)
      .tool(calcTool) // Extra non-agent tool
      .build();

    const result = await swarm.run('What is 6 times 7?');
    expect(result.content).toBe('The answer is 42.');
  });
});
