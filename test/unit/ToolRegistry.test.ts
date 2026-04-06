import { describe, it, expect } from 'vitest';
import { ToolRegistry, defineTool } from '../../src/test-barrel';

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
  handler: ({ expr }) => ({ content: `${eval(String(expr))}` }),
});

describe('ToolRegistry', () => {
  it('registers and retrieves a tool', () => {
    const registry = new ToolRegistry();
    registry.register(searchTool);
    expect(registry.get('search')).toBe(searchTool);
    expect(registry.has('search')).toBe(true);
  });

  it('throws on duplicate registration', () => {
    const registry = new ToolRegistry();
    registry.register(searchTool);
    expect(() => registry.register(searchTool)).toThrow('already registered');
  });

  it('returns undefined for unknown tool', () => {
    const registry = new ToolRegistry();
    expect(registry.get('unknown')).toBeUndefined();
    expect(registry.has('unknown')).toBe(false);
  });

  it('lists all tool IDs', () => {
    const registry = new ToolRegistry();
    registry.register(searchTool);
    registry.register(calcTool);
    expect(registry.ids()).toEqual(['search', 'calculator']);
  });

  it('returns all tools', () => {
    const registry = new ToolRegistry();
    registry.register(searchTool);
    registry.register(calcTool);
    expect(registry.all()).toHaveLength(2);
  });

  it('tracks size', () => {
    const registry = new ToolRegistry();
    expect(registry.size).toBe(0);
    registry.register(searchTool);
    expect(registry.size).toBe(1);
  });

  it('formats tools for LLM', () => {
    const registry = new ToolRegistry();
    registry.register(searchTool);

    const formatted = registry.formatForLLM();
    expect(formatted).toEqual([
      {
        name: 'search',
        description: 'Search the web',
        inputSchema: searchTool.inputSchema,
      },
    ]);
  });

  it('formats subset of tools by ID', () => {
    const registry = new ToolRegistry();
    registry.register(searchTool);
    registry.register(calcTool);

    const formatted = registry.formatForLLM(['calculator']);
    expect(formatted).toHaveLength(1);
    expect(formatted[0].name).toBe('calculator');
  });

  it('throws when formatting unknown tool ID', () => {
    const registry = new ToolRegistry();
    expect(() => registry.formatForLLM(['nope'])).toThrow('not found');
  });

  it('supports fluent registration', () => {
    const registry = new ToolRegistry();
    const result = registry.register(searchTool);
    expect(result).toBe(registry);
  });
});

describe('defineTool', () => {
  it('returns the tool definition as-is', () => {
    const tool = defineTool({
      id: 'test',
      description: 'Test tool',
      inputSchema: {},
      handler: async () => ({ content: 'ok' }),
    });
    expect(tool.id).toBe('test');
  });
});
