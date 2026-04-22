import { describe, it, expect } from 'vitest';
import { Swarm, mock, defineTool } from '../../src/test-barrel';
import type { RunnerLike } from '../../src/test-barrel';

// ── Helpers ─────────────────────────────────────────────────

const simpleRunner = (response: string): RunnerLike => ({
  run: async () => ({ content: response }),
});

// ── Swarm Builder ───────────────────────────────────────────

describe('Swarm', () => {
  it('requires at least one specialist', () => {
    expect(() => Swarm.create({ provider: mock([]) }).build()).toThrow('at least one specialist');
  });

  it('delegates to a specialist via tool call', async () => {
    const researcher = simpleRunner('Research result: AI is growing.');

    const swarm = Swarm.create({
      provider: mock([
        {
          content: 'Let me research that.',
          toolCalls: [{ id: 'tc1', name: 'research', arguments: { message: 'AI trends' } }],
        },
        { content: 'Based on research: AI is growing fast.' },
      ]),
    })
      .system('You are a router. Use specialists.')
      .specialist('research', 'Research a topic.', researcher)
      .build();

    const result = await swarm.run('Tell me about AI');
    expect(result.content).toBe('Based on research: AI is growing fast.');
  });

  it('orchestrator can call multiple specialists', async () => {
    const researcher = simpleRunner('Facts about AI.');
    const writer = simpleRunner('Article about AI.');

    const swarm = Swarm.create({
      provider: mock([
        {
          content: 'Research first.',
          toolCalls: [{ id: 'tc1', name: 'research', arguments: { message: 'AI' } }],
        },
        {
          content: 'Now write.',
          toolCalls: [{ id: 'tc2', name: 'write', arguments: { message: 'Write about AI' } }],
        },
        { content: 'Done! Here is the article.' },
      ]),
    })
      .specialist('research', 'Research a topic.', researcher)
      .specialist('write', 'Write content.', writer)
      .build();

    const result = await swarm.run('Write about AI');
    expect(result.content).toBe('Done! Here is the article.');
  });

  it('works without tool calls (direct response)', async () => {
    const swarm = Swarm.create({
      provider: mock([{ content: 'I can answer directly.' }]),
    })
      .specialist('helper', 'Help with things.', simpleRunner('helped'))
      .build();

    const result = await swarm.run('What is 2+2?');
    expect(result.content).toBe('I can answer directly.');
  });

  it('can have extra non-agent tools', async () => {
    const calcTool = defineTool({
      id: 'calc',
      description: 'Calculate',
      inputSchema: { type: 'object', properties: { expr: { type: 'string' } } },
      handler: async () => ({ content: '42' }),
    });

    const swarm = Swarm.create({
      provider: mock([
        {
          content: 'Calculating.',
          toolCalls: [{ id: 'tc1', name: 'calc', arguments: { expr: '6*7' } }],
        },
        { content: 'The answer is 42.' },
      ]),
    })
      .specialist('helper', 'Help.', simpleRunner('ok'))
      .tool(calcTool)
      .build();

    const result = await swarm.run('What is 6*7?');
    expect(result.content).toBe('The answer is 42.');
  });

  it('returns TraversalResult with totalLatencyMs', async () => {
    const swarm = Swarm.create({
      provider: mock([{ content: 'Done.' }]),
    })
      .specialist('helper', 'Help.', simpleRunner('ok'))
      .build();

    const result = await swarm.run('test');
    expect(result.totalLatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.agents).toBeInstanceOf(Array);
  });

  it('produces narrative from execution', async () => {
    const swarm = Swarm.create({
      provider: mock([{ content: 'Done.' }]),
    })
      .specialist('helper', 'Help.', simpleRunner('ok'))
      .build();

    await swarm.run('test');
    const narrative = swarm.getNarrativeEntries().map((e) => e.text);
    expect(narrative.length).toBeGreaterThan(0);
  });
});
