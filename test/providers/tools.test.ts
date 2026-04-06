import { describe, it, expect, vi } from 'vitest';
import { agentAsTool, compositeTools, defineTool } from '../../src/test-barrel';
import type { ToolContext, RunnerLike } from '../../src/test-barrel';
import { staticTools, dynamicTools } from '../../src/providers';

// ── Helpers ─────────────────────────────────────────────────

function toolCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    message: 'hello',
    turnNumber: 0,
    loopIteration: 0,
    messages: [],
    ...overrides,
  };
}

const searchTool = defineTool({
  id: 'search',
  description: 'Search the web',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  handler: async (input) => ({ content: `Found: ${input.q}` }),
});

const calcTool = defineTool({
  id: 'calc',
  description: 'Calculate math',
  inputSchema: { type: 'object', properties: { expr: { type: 'string' } } },
  handler: async (input) => ({ content: `Result: ${input.expr}` }),
});

// ── agentAsTool ─────────────────────────────────────────────

describe('agentAsTool', () => {
  it('wraps a runner as a tool definition', () => {
    const runner: RunnerLike = {
      run: async () => ({ content: 'done' }),
    };

    const tool = agentAsTool({
      id: 'researcher',
      description: 'Research a topic.',
      runner,
    });

    expect(tool.id).toBe('researcher');
    expect(tool.description).toBe('Research a topic.');
    expect(tool.inputSchema).toEqual({
      type: 'object',
      properties: { message: { type: 'string', description: 'The message to send to the agent.' } },
      required: ['message'],
    });
  });

  it('invokes runner.run when handler is called', async () => {
    const runner: RunnerLike = {
      run: vi.fn(async (msg: string) => ({ content: `Researched: ${msg}` })),
    };

    const tool = agentAsTool({ id: 'r', description: 'd', runner });
    const result = await tool.handler({ message: 'AI trends' });

    expect(runner.run).toHaveBeenCalledWith('AI trends', {
      signal: undefined,
      timeoutMs: undefined,
    });
    expect(result.content).toBe('Researched: AI trends');
    expect(result.error).toBeUndefined();
  });

  it('returns error result when runner throws', async () => {
    const runner: RunnerLike = {
      run: async () => {
        throw new Error('timeout');
      },
    };

    const tool = agentAsTool({ id: 'r', description: 'd', runner });
    const result = await tool.handler({ message: 'test' });

    expect(result.error).toBe(true);
    expect(result.content).toContain('timeout');
  });

  it('uses custom inputMapper', async () => {
    const runner: RunnerLike = {
      run: vi.fn(async (msg: string) => ({ content: msg })),
    };

    const tool = agentAsTool({
      id: 'r',
      description: 'd',
      runner,
      inputMapper: (input) => `Query: ${input.q}`,
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    });

    await tool.handler({ q: 'test' });
    expect(runner.run).toHaveBeenCalledWith('Query: test', expect.any(Object));
  });

  it('propagates signal and timeoutMs', async () => {
    const controller = new AbortController();
    const runner: RunnerLike = {
      run: vi.fn(async () => ({ content: 'ok' })),
    };

    const tool = agentAsTool({
      id: 'r',
      description: 'd',
      runner,
      signal: controller.signal,
      timeoutMs: 5000,
    });

    await tool.handler({ message: 'test' });
    expect(runner.run).toHaveBeenCalledWith('test', {
      signal: controller.signal,
      timeoutMs: 5000,
    });
  });

  it('works with Agent runner (integration)', async () => {
    // Simulate an agent-like runner
    const agentRunner: RunnerLike = {
      run: async (msg: string) => ({ content: `Agent processed: ${msg}` }),
      getNarrative: () => ['Started', 'Finished'],
    };

    const tool = agentAsTool({
      id: 'agent',
      description: 'A smart agent.',
      runner: agentRunner,
    });

    const result = await tool.handler({ message: 'analyze this' });
    expect(result.content).toBe('Agent processed: analyze this');
  });
});

// ── compositeTools ──────────────────────────────────────────

describe('compositeTools', () => {
  it('merges tools from multiple providers', async () => {
    const provider = compositeTools([staticTools([searchTool]), staticTools([calcTool])]);

    const decision = await provider.resolve(toolCtx());
    const names = decision.value.map((t) => t.name);
    expect(names).toContain('search');
    expect(names).toContain('calc');
  });

  it('last-write-wins for duplicate tool names', async () => {
    const searchV1 = defineTool({
      id: 'search',
      description: 'Search v1',
      inputSchema: {},
      handler: async () => ({ content: 'v1' }),
    });
    const searchV2 = defineTool({
      id: 'search',
      description: 'Search v2',
      inputSchema: {},
      handler: async () => ({ content: 'v2' }),
    });

    const provider = compositeTools([staticTools([searchV1]), staticTools([searchV2])]);

    const decision = await provider.resolve(toolCtx());
    expect(decision.value.length).toBe(1);
    expect(decision.value[0].description).toBe('Search v2');
  });

  it('delegates execute to provider with execute method', async () => {
    const provider = compositeTools([staticTools([searchTool])]);

    const result = await provider.execute!({
      id: 'tc1',
      name: 'search',
      arguments: { q: 'hello' },
    });
    expect(result.content).toBe('Found: hello');
  });

  it('returns error when no executor found', async () => {
    // dynamicTools has no execute method
    const provider = compositeTools([dynamicTools(() => [searchTool])]);

    const result = await provider.execute!({
      id: 'tc1',
      name: 'search',
      arguments: { q: 'hello' },
    });
    expect(result.error).toBe(true);
    expect(result.content).toContain('No executor found');
  });

  it('composes with dynamic context-based filtering', async () => {
    const provider = compositeTools([
      staticTools([searchTool]),
      dynamicTools((ctx) => (ctx.turnNumber > 2 ? [calcTool] : [])),
    ]);

    const earlyDecision = await provider.resolve(toolCtx({ turnNumber: 1 }));
    expect(earlyDecision.value.map((t) => t.name)).toEqual(['search']);

    const lateDecision = await provider.resolve(toolCtx({ turnNumber: 3 }));
    expect(lateDecision.value.map((t) => t.name)).toContain('search');
    expect(lateDecision.value.map((t) => t.name)).toContain('calc');
  });

  it('composes with agentAsTool', async () => {
    const runner: RunnerLike = {
      run: async (msg: string) => ({ content: `Delegated: ${msg}` }),
    };

    const delegateTool = agentAsTool({
      id: 'delegate',
      description: 'Delegate to another agent.',
      runner,
    });

    const provider = compositeTools([staticTools([searchTool, delegateTool])]);

    const decision = await provider.resolve(toolCtx());
    expect(decision.value.map((t) => t.name)).toContain('delegate');

    const result = await provider.execute!({
      id: 'tc1',
      name: 'delegate',
      arguments: { message: 'help' },
    });
    expect(result.content).toBe('Delegated: help');
  });

  it('empty composite returns no tools', async () => {
    const provider = compositeTools([]);
    const decision = await provider.resolve(toolCtx());
    expect(decision.value).toEqual([]);
  });
});
