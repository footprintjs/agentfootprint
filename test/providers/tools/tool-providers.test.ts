import { describe, it, expect } from 'vitest';
import { staticTools, dynamicTools, noTools } from '../../../src/providers/tools';
import type { ToolContext } from '../../../src/core';
import type { ToolDefinition } from '../../../src/types';

const baseCtx: ToolContext = { message: 'test', turnNumber: 0, loopIteration: 0, messages: [] };

const searchTool: ToolDefinition = {
  id: 'search',
  description: 'Search the web',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  handler: async (input) => ({ content: `Results for: ${input.query}` }),
};

const calcTool: ToolDefinition = {
  id: 'calc',
  description: 'Calculate expression',
  inputSchema: { type: 'object', properties: { expr: { type: 'string' } } },
  handler: (input) => ({ content: `= ${String(input.expr)}` }),
};

// ── staticTools ─────────────────────────────────────────────

describe('staticTools', () => {
  it('resolves all registered tools', () => {
    const provider = staticTools([searchTool, calcTool]);
    const decision = provider.resolve(baseCtx);
    expect(decision.value).toHaveLength(2);
    expect(decision.value[0].name).toBe('search');
    expect(decision.value[1].name).toBe('calc');
    expect(decision.chosen).toBe('static');
  });

  it('formats tool descriptions for LLM', () => {
    const provider = staticTools([searchTool]);
    const decision = provider.resolve(baseCtx);
    expect(decision.value[0]).toEqual({
      name: 'search',
      description: 'Search the web',
      inputSchema: searchTool.inputSchema,
    });
  });

  it('executes tool by name', async () => {
    const provider = staticTools([searchTool]);
    const result = await provider.execute!({
      id: '1',
      name: 'search',
      arguments: { query: 'cats' },
    });
    expect(result.content).toBe('Results for: cats');
    expect(result.error).toBeUndefined();
  });

  it('returns error for unknown tool', async () => {
    const provider = staticTools([searchTool]);
    const result = await provider.execute!({ id: '1', name: 'nonexistent', arguments: {} });
    expect(result.error).toBe(true);
    expect(result.content).toContain('Unknown tool');
  });

  it('handles empty tool list', () => {
    const provider = staticTools([]);
    const decision = provider.resolve(baseCtx);
    expect(decision.value).toEqual([]);
    expect(decision.chosen).toBe('static');
  });

  it('returns same tools regardless of context', () => {
    const provider = staticTools([searchTool]);
    const ctx1: ToolContext = { message: 'code', turnNumber: 0, loopIteration: 0, messages: [] };
    const ctx2: ToolContext = { message: 'search', turnNumber: 5, loopIteration: 3, messages: [] };
    const d1 = provider.resolve(ctx1);
    const d2 = provider.resolve(ctx2);
    expect(d1.value).toEqual(d2.value);
  });

  it('provides execute method (self-contained)', () => {
    const provider = staticTools([searchTool]);
    expect(provider.execute).toBeDefined();
  });
});

// ── dynamicTools ────────────────────────────────────────────

describe('dynamicTools', () => {
  it('resolves tools based on context', async () => {
    const provider = dynamicTools((ctx) => {
      if (ctx.message.includes('code')) return [calcTool];
      return [searchTool];
    });

    const codeCtx: ToolContext = {
      message: 'write code',
      turnNumber: 0,
      loopIteration: 0,
      messages: [],
    };
    const searchCtx: ToolContext = {
      message: 'find info',
      turnNumber: 0,
      loopIteration: 0,
      messages: [],
    };

    const codeDecision = await provider.resolve(codeCtx);
    expect(codeDecision.value).toHaveLength(1);
    expect(codeDecision.value[0].name).toBe('calc');

    const searchDecision = await provider.resolve(searchCtx);
    expect(searchDecision.value).toHaveLength(1);
    expect(searchDecision.value[0].name).toBe('search');
  });

  it('is resolver-only — no execute method', () => {
    const provider = dynamicTools(() => [searchTool]);
    expect(provider.execute).toBeUndefined();
  });

  it('supports async resolver', async () => {
    const provider = dynamicTools(async () => {
      return [searchTool, calcTool];
    });
    const decision = await provider.resolve(baseCtx);
    expect(decision.value).toHaveLength(2);
    expect(decision.chosen).toBe('dynamic');
  });

  it('can return different tools on different turns', async () => {
    const provider = dynamicTools((ctx) => {
      return ctx.turnNumber > 3 ? [searchTool, calcTool] : [searchTool];
    });

    const turn0 = await provider.resolve({ ...baseCtx, turnNumber: 0 });
    const turn5 = await provider.resolve({ ...baseCtx, turnNumber: 5 });
    expect(turn0.value).toHaveLength(1);
    expect(turn5.value).toHaveLength(2);
  });

  it('formats LLMToolDescription correctly', async () => {
    const provider = dynamicTools(() => [searchTool]);
    const decision = await provider.resolve(baseCtx);
    expect(decision.value[0]).toEqual({
      name: 'search',
      description: 'Search the web',
      inputSchema: searchTool.inputSchema,
    });
  });
});

// ── noTools ─────────────────────────────────────────────────

describe('noTools', () => {
  it('resolves empty tool list', () => {
    const provider = noTools();
    const decision = provider.resolve(baseCtx);
    expect(decision.value).toEqual([]);
    expect(decision.chosen).toBe('none');
  });

  it('returns empty on every context', () => {
    const provider = noTools();
    const d1 = provider.resolve({ ...baseCtx, turnNumber: 0 });
    const d2 = provider.resolve({ ...baseCtx, turnNumber: 10 });
    expect(d1.value).toEqual([]);
    expect(d2.value).toEqual([]);
  });

  it('has no execute method', () => {
    const provider = noTools();
    expect(provider.execute).toBeUndefined();
  });
});
