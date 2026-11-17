import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineTool, type Tool, type ToolResultRowset } from '../../src/index.js';
import { mcpClient, mockMcpClient } from '../../src/tool-providers/index.js';
import {
  MCP_TOOL_EXTRAS_KEY,
  readToolExtras,
  toolExtrasOf,
  _resetToolExtrasWarnings,
} from '../../src/mcp/toolExtras.js';

const rowset = (): ToolResultRowset => ({
  key: 'disks',
  columns: { capacity_gb: 'number' },
  source: { kind: 'inline', path: ['result', 'disks'] },
});
const origin = { server: 'synthetic-rowset-server', tool: 'read_disks' };
const meta = (value: unknown) => ({ [MCP_TOOL_EXTRAS_KEY]: { resultRowsets: value } });
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  _resetToolExtrasWarnings();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe('inert rowset declarations over MCP', () => {
  it('normalizes manually authored tools at export without relying on defineTool', () => {
    const declaration = rowset();
    const raw: Tool = {
      schema: { name: origin.tool, description: 'Synthetic.', inputSchema: { type: 'object' } },
      resultRowsets: [declaration],
      execute: () => [],
    };
    const served = toolExtrasOf(raw)!.resultRowsets!;
    expect(served).toEqual([declaration]);
    expect(served).not.toBe(raw.resultRowsets);
    expect(Object.isFrozen(served[0]!.source)).toBe(true);
    (declaration as { key: string }).key = 'changed';
    expect(served[0]!.key).toBe('disks');
    let reads = 0;
    Object.defineProperty(raw, 'resultRowsets', {
      enumerable: true,
      get() {
        reads++;
        return [];
      },
    });
    expect(() => toolExtrasOf(raw)).toThrow(/resultRowsets/);
    expect(reads).toBe(0);
  });

  it('serves and ingests the same explicit declaration as a detached frozen value', () => {
    const tool = defineTool({
      name: origin.tool,
      description: 'Synthetic.',
      resultRowsets: [rowset()],
      execute: () => [],
    });
    const bag = toolExtrasOf(tool);
    expect(bag).toEqual({ resultRowsets: [rowset()] });
    const ingested = readToolExtras({ [MCP_TOOL_EXTRAS_KEY]: bag }, origin);
    expect(ingested.resultRowsets).toEqual(tool.resultRowsets);
    expect(ingested.resultRowsets).not.toBe(tool.resultRowsets);
    expect(Object.isFrozen(ingested.resultRowsets)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('rejects only a malformed or conflicting new field, retaining valid legacy metadata', () => {
    const resultColumns = { capacity_gb: 'number' as const };
    const declared = { resultColumns, resultRowsets: [rowset()], resultKind: 'dataset/rows' };
    expect(readToolExtras({ [MCP_TOOL_EXTRAS_KEY]: declared }, origin)).toEqual({
      resultColumns,
      resultKind: 'dataset/rows',
    });
    readToolExtras({ [MCP_TOOL_EXTRAS_KEY]: declared }, origin);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('resultRowsets');
    expect(readToolExtras(meta([{ ...rowset(), extra: true }]), origin)).toEqual({});
  });

  it('does not invoke a property or nested declaration getter', () => {
    let reads = 0;
    const bag = {};
    Object.defineProperty(bag, 'resultRowsets', {
      enumerable: true,
      get() {
        reads++;
        return [rowset()];
      },
    });
    expect(readToolExtras({ [MCP_TOOL_EXTRAS_KEY]: bag }, origin)).toEqual({});
    const row = rowset();
    Object.defineProperty(row, 'source', {
      enumerable: true,
      get() {
        reads++;
        return { kind: 'inline', path: [] };
      },
    });
    expect(readToolExtras(meta([row]), { ...origin, tool: 'second_disks' })).toEqual({});
    expect(reads).toBe(0);
  });

  it('keeps absent metadata and older legacy bags byte-equivalent', () => {
    const tool = defineTool({ name: origin.tool, description: 'Synthetic.', execute: () => [] });
    expect(toolExtrasOf(tool)).toBeUndefined();
    expect(readToolExtras(undefined, origin)).toEqual({});
    const resultColumns = { capacity_gb: 'number' as const };
    expect(readToolExtras({ [MCP_TOOL_EXTRAS_KEY]: { resultColumns } }, origin)).toEqual({
      resultColumns,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('both actual native client registration doors retain the declaration without calling the tool', async () => {
    const listed = {
      name: origin.tool,
      description: 'Synthetic.',
      inputSchema: { type: 'object' },
      _meta: meta([rowset()]),
    };
    let calls = 0;
    const native = await mcpClient({
      name: origin.server,
      connection: {
        listTools: async () => ({ tools: [listed] }),
        callTool: async () => {
          calls++;
          return { content: [] };
        },
        close: async () => {},
      },
    });
    try {
      expect((await native.tools())[0]!.resultRowsets).toEqual([rowset()]);
      expect(calls).toBe(0);
    } finally {
      await native.close();
    }
    const mocked = mockMcpClient({ name: origin.server, tools: [listed] });
    expect((await mocked.tools())[0]!.resultRowsets).toEqual([rowset()]);
    await mocked.close();
  });
});
