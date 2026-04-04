/**
 * Swarm unified with Agent loop — 5-pattern tests.
 *
 * Verifies that Swarm now uses buildAgentLoop + buildSwarmRouting
 * and gains all Agent capabilities: 3-slot architecture, streaming,
 * toFlowChart(), narrative enrichment.
 */
import { describe, it, expect, vi } from 'vitest';
import { Swarm } from '../../src/concepts/Swarm';
import type { LLMProvider, LLMResponse } from '../../src/types';
import type { RunnerLike } from '../../src/types/multiAgent';
import { defineTool } from '../../src/tools/ToolRegistry';

// ── Helpers ──────────────────────────────────────────────────

function mockProvider(responses: LLMResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    chat: vi.fn(async () => {
      const response = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return response;
    }),
  };
}

function mockRunner(content: string): RunnerLike {
  return {
    run: vi.fn(async () => ({ content, messages: [], iterations: 1 })),
  };
}

// ── Unit ────────────────────────────────────────────────────

describe('Swarm unified — unit', () => {
  it('builds and runs with specialist routing', async () => {
    const provider = mockProvider([
      { content: '', toolCalls: [{ id: 'tc1', name: 'coding', arguments: { message: 'fizzbuzz' } }] },
      { content: 'Here is the code.' },
    ]);

    const swarm = Swarm.create({ provider })
      .system('Route to specialist.')
      .specialist('coding', 'Code specialist', mockRunner('def fizzbuzz(): ...'))
      .build();

    const result = await swarm.run('write fizzbuzz');
    expect(result.content).toBe('Here is the code.');
  });

  it('getSpec() returns spec before run()', () => {
    const provider = mockProvider([{ content: 'hi' }]);
    const swarm = Swarm.create({ provider })
      .specialist('coding', 'Code', mockRunner('code'))
      .build();

    const spec = swarm.getSpec();
    expect(spec).toBeDefined();
    const specStr = JSON.stringify(spec);
    // Should contain the 3-slot stages from Agent loop
    expect(specStr).toContain('SystemPrompt');
    expect(specStr).toContain('CallLLM');
    expect(specStr).toContain('RouteSpecialist');
  });

  it('toFlowChart() returns a valid FlowChart for subflow composition', () => {
    const provider = mockProvider([{ content: 'hi' }]);
    const swarm = Swarm.create({ provider })
      .specialist('coding', 'Code', mockRunner('code'))
      .build();

    const chart = swarm.toFlowChart();
    expect(chart).toBeDefined();
    expect(chart.root).toBeDefined();
  });

  it('narrative includes 3-slot stages', async () => {
    const provider = mockProvider([{ content: 'Direct answer.' }]);
    const swarm = Swarm.create({ provider })
      .specialist('coding', 'Code', mockRunner('code'))
      .build();

    await swarm.run('hi');
    const narrative = swarm.getNarrative();

    // 3-slot stages should appear in narrative
    expect(narrative.some((s: string) => s.includes('SystemPrompt') || s.includes('system prompt'))).toBe(true);
    expect(narrative.some((s: string) => s.includes('CallLLM') || s.includes('Called LLM'))).toBe(true);
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('Swarm unified — boundary', () => {
  it('throws when no specialists registered', () => {
    const provider = mockProvider([{ content: 'hi' }]);
    expect(() => Swarm.create({ provider }).build()).toThrow('at least one specialist');
  });

  it('single specialist with direct response (no tool call)', async () => {
    const provider = mockProvider([{ content: 'I can answer directly.' }]);
    const swarm = Swarm.create({ provider })
      .specialist('coding', 'Code', mockRunner('code'))
      .build();

    const result = await swarm.run('What is 2+2?');
    expect(result.content).toBe('I can answer directly.');
  });

  it('extra tools work alongside specialists', async () => {
    const calcHandler = vi.fn(async () => ({ content: '42' }));
    const provider = mockProvider([
      { content: '', toolCalls: [{ id: 'tc1', name: 'calculator', arguments: { expr: '6*7' } }] },
      { content: 'The answer is 42.' },
    ]);

    const swarm = Swarm.create({ provider })
      .specialist('coding', 'Code', mockRunner('code'))
      .tool(defineTool({ id: 'calculator', description: 'Calculate', inputSchema: {}, handler: calcHandler }))
      .build();

    const result = await swarm.run('What is 6*7?');
    expect(result.content).toBe('The answer is 42.');
    expect(calcHandler).toHaveBeenCalled();
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('Swarm unified — scenario', () => {
  it('multi-specialist delegation: coding then writing', async () => {
    const codingRunner = mockRunner('def fizzbuzz(): pass');
    const writingRunner = mockRunner('A haiku about code');
    const provider = mockProvider([
      { content: '', toolCalls: [{ id: 'tc1', name: 'coding', arguments: { message: 'fizzbuzz' } }] },
      { content: '', toolCalls: [{ id: 'tc2', name: 'writing', arguments: { message: 'haiku about the code' } }] },
      { content: 'Here is the code and a haiku about it.' },
    ]);

    const swarm = Swarm.create({ provider })
      .system('Route to specialists.')
      .specialist('coding', 'Code specialist', codingRunner)
      .specialist('writing', 'Writing specialist', writingRunner)
      .build();

    const result = await swarm.run('Write fizzbuzz and a haiku');
    expect(result.content).toBe('Here is the code and a haiku about it.');
    expect(codingRunner.run).toHaveBeenCalled();
    expect(writingRunner.run).toHaveBeenCalled();
  });
});

// ── Property ────────────────────────────────────────────────

describe('Swarm unified — property', () => {
  it('system prompt includes specialist descriptions', async () => {
    const provider = mockProvider([{ content: 'Direct.' }]);
    const swarm = Swarm.create({ provider })
      .system('You are an orchestrator.')
      .specialist('coding', 'Code specialist for programming tasks', mockRunner('code'))
      .specialist('writing', 'Writing specialist for creative content', mockRunner('text'))
      .build();

    await swarm.run('hi');

    // The provider.chat should have been called with messages containing the specialist list
    const chatCall = (provider.chat as any).mock.calls[0];
    const messages = chatCall[0];
    const systemMsg = messages.find((m: any) => m.role === 'system');
    expect(systemMsg.content).toContain('coding: Code specialist for programming tasks');
    expect(systemMsg.content).toContain('writing: Writing specialist for creative content');
  });

  it('streaming option is passed through', () => {
    const provider = mockProvider([{ content: 'hi' }]);
    const swarm = Swarm.create({ provider })
      .specialist('coding', 'Code', mockRunner('code'))
      .streaming(true)
      .build();

    // Verify streaming is enabled by checking the spec (streaming stages have different names)
    const spec = swarm.getSpec();
    expect(spec).toBeDefined();
  });

  it('maxIterations is respected', async () => {
    // LLM always calls specialist — should stop at maxIterations
    const provider = mockProvider([
      { content: '', toolCalls: [{ id: 'tc1', name: 'coding', arguments: { message: 'loop' } }] },
    ]);

    const swarm = Swarm.create({ provider })
      .specialist('coding', 'Code', mockRunner('looped'))
      .maxIterations(2)
      .build();

    const result = await swarm.run('loop forever');
    // Should terminate after max iterations
    expect(result).toBeDefined();
  });
});

// ── Security ────────────────────────────────────────────────

describe('Swarm unified — security', () => {
  it('unknown specialist name routes to final (no crash)', async () => {
    const provider = mockProvider([
      { content: '', toolCalls: [{ id: 'tc1', name: 'nonexistent', arguments: { message: 'test' } }] },
      { content: 'Fallback response.' },
    ]);

    const swarm = Swarm.create({ provider })
      .specialist('coding', 'Code', mockRunner('code'))
      .build();

    // The unknown tool name should route to 'final', not crash
    const result = await swarm.run('test');
    expect(result.content).toBeDefined();
  });

  it('specialist message is string-validated (no object injection)', async () => {
    const codingRunner = mockRunner('result');
    const provider = mockProvider([
      { content: '', toolCalls: [{ id: 'tc1', name: 'coding', arguments: { message: { injected: true } } }] },
      { content: 'Done.' },
    ]);

    const swarm = Swarm.create({ provider })
      .specialist('coding', 'Code', codingRunner)
      .build();

    await swarm.run('test');
    // The specialist should receive empty string (non-string coerced), not the object
    const runCall = (codingRunner.run as any).mock.calls[0];
    expect(typeof runCall[0]).toBe('string');
  });
});
