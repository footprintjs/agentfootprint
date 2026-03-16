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
    const tools = provider.resolve(baseCtx);
    expect(tools).toHaveLength(2);
    expect((tools as any)[0].name).toBe('search');
    expect((tools as any)[1].name).toBe('calc');
  });

  it('formats tool descriptions for LLM', () => {
    const provider = staticTools([searchTool]);
    const tools = provider.resolve(baseCtx) as any[];
    expect(tools[0]).toEqual({
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
    expect(provider.resolve(baseCtx)).toEqual([]);
  });

  it('returns same tools regardless of context', () => {
    const provider = staticTools([searchTool]);
    const ctx1: ToolContext = { message: 'code', turnNumber: 0, loopIteration: 0, messages: [] };
    const ctx2: ToolContext = { message: 'search', turnNumber: 5, loopIteration: 3, messages: [] };
    const tools1 = provider.resolve(ctx1) as any[];
    const tools2 = provider.resolve(ctx2) as any[];
    expect(tools1).toEqual(tools2);
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

    const codeTools = await provider.resolve(codeCtx);
    expect(codeTools).toHaveLength(1);
    expect(codeTools[0].name).toBe('calc');

    const searchTools = await provider.resolve(searchCtx);
    expect(searchTools).toHaveLength(1);
    expect(searchTools[0].name).toBe('search');
  });

  it('is resolver-only — no execute method', () => {
    const provider = dynamicTools(() => [searchTool]);
    expect(provider.execute).toBeUndefined();
  });

  it('supports async resolver', async () => {
    const provider = dynamicTools(async () => {
      return [searchTool, calcTool];
    });
    const tools = await provider.resolve(baseCtx);
    expect(tools).toHaveLength(2);
  });

  it('can return different tools on different turns', async () => {
    const provider = dynamicTools((ctx) => {
      if (ctx.loopIteration > 0) return []; // no tools on retries
      return [searchTool];
    });

    const first = await provider.resolve({ ...baseCtx, loopIteration: 0 });
    expect(first).toHaveLength(1);

    const retry = await provider.resolve({ ...baseCtx, loopIteration: 1 });
    expect(retry).toHaveLength(0);
  });

  it('formats LLMToolDescription correctly', async () => {
    const provider = dynamicTools(() => [searchTool]);
    const tools = await provider.resolve(baseCtx);
    expect(tools[0]).toEqual({
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
    expect(provider.resolve(baseCtx)).toEqual([]);
  });

  it('has no execute method', () => {
    const provider = noTools();
    expect(provider.execute).toBeUndefined();
  });

  it('returns empty on every context', () => {
    const provider = noTools();
    const ctx1: ToolContext = {
      message: 'anything',
      turnNumber: 99,
      loopIteration: 5,
      messages: [],
    };
    expect(provider.resolve(ctx1)).toEqual([]);
  });
});
