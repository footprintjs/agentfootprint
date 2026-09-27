/**
 * The inputs layer's declarations over MCP — `askOrAssume` and `period` in
 * `_meta.agentfootprint` (honesty layer 2).
 *
 * The host's production tools arrive over MCP, so a layer that left MCP tools
 * free would do nothing where it matters. Both declarations travel verbatim on
 * the way out (`toolExtrasOf`) and are judged on the way in by the SAME assert
 * `defineTool` runs (`readToolExtras`) — the first extras judged against the
 * listed tool's own `inputSchema`, which the origin now carries.
 *
 * Test types (Convention 3): unit (the composer carries both, absent means
 * absent) · functional (mcpServe → mcpClient: the rules come back byte-equal
 * and the served schema keeps the author's `required`) · integration (a
 * Python-shaped bag on a mock MCP server arms the layer: the library fills the
 * default) · edge (a malformed or not-yet-applied rule is warned once and
 * dropped; the tool still registers and its argument runs free).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Agent, defineTool, type Tool } from '../../../src/index.js';
import { mcpClient, mcpServe, mockMcpClient } from '../../../src/tool-providers/index.js';
import { mock } from '../../../src/llm-providers.js';
import {
  MCP_TOOL_EXTRAS_KEY,
  readToolExtras,
  toolExtrasOf,
  _resetToolExtrasWarnings,
} from '../../../src/lib/mcp/toolExtras.js';
import type {
  McpCallToolRequest,
  McpListedTool,
  McpSdkServer,
} from '../../../src/lib/mcp/types.js';

type Handler = (req: McpCallToolRequest, extra: { signal?: AbortSignal }) => unknown;

function listingServer(): McpSdkServer & { list(): Promise<{ tools: McpListedTool[] }> } {
  const handlers = new Map<string, Handler>();
  return {
    setRequestHandler(schema: unknown, handler: Handler) {
      handlers.set((schema as { method: string }).method, handler);
    },
    connect: async () => {},
    close: async () => {},
    async list() {
      return (await handlers.get('tools/list')?.({}, {})) as never;
    },
  };
}

const listingClient = (tools: readonly McpListedTool[]) => ({
  connect: async () => {},
  listTools: async () => ({ tools }),
  callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
  close: async () => {},
});

async function ingest(tools: readonly McpListedTool[]): Promise<Tool[]> {
  const client = await mcpClient({
    name: 'fleet-mcp',
    transport: { transport: 'stdio', command: 'echo' },
    _client: listingClient(tools),
  });
  return [...(await client.tools())];
}

const SCHEMA = {
  type: 'object',
  required: ['host', 'time_range'],
  properties: {
    host: { type: 'string' },
    time_range: { type: 'string', enum: ['1h', '24h', '7d'] },
  },
};

const ioProfile = () =>
  defineTool({
    name: 'io_profile',
    description: 'Disk I/O profile of one host over a look-back period.',
    inputSchema: SCHEMA,
    askOrAssume: { time_range: { assume: '24h' } },
    period: { argument: 'time_range', spelling: 'lookback' },
    execute: () => 'ok',
  });

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  _resetToolExtrasWarnings();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

describe('unit — toolExtrasOf carries both declarations, verbatim', () => {
  it('askOrAssume and period ride the bag under their own camelCase keys', () => {
    expect(toolExtrasOf(ioProfile())).toEqual({
      askOrAssume: { time_range: { assume: '24h' } },
      period: { argument: 'time_range', spelling: 'lookback' },
    });
  });

  it('a tool that rules nothing adds neither key', () => {
    expect(toolExtrasOf(defineTool({ name: 'p', description: 'p', execute: () => 1 }))).toBe(
      undefined,
    );
  });
});

describe('functional — mcpServe → mcpClient: the rules come back, the schema stays the author’s', () => {
  it('the registered Tool carries the rules byte-equal; the served schema keeps `required`', async () => {
    const server = listingServer();
    await mcpServe([ioProfile()], { name: 'fleet-desk', _server: server });
    const listed = await server.list();
    // The author's schema, `required` intact — the served decoration is the
    // CLIENT's, per request, never the server's.
    expect(listed.tools[0]!.inputSchema.required).toEqual(['host', 'time_range']);
    const [registered] = await ingest(listed.tools);
    expect(registered!.askOrAssume).toEqual({ time_range: { assume: '24h' } });
    expect(registered!.period).toEqual({ argument: 'time_range', spelling: 'lookback' });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('integration — a Python-shaped bag on an MCP server arms the layer', () => {
  it('the library fills the default for the remote tool, and files it', async () => {
    const received: unknown[] = [];
    const client = mockMcpClient({
      name: 'fleet-mcp',
      tools: [
        {
          name: 'io_profile',
          description: 'Disk I/O profile of one host.',
          inputSchema: SCHEMA,
          // The shape the host's `TOOL_EXTRAS` serves: two keys per tool.
          _meta: {
            [MCP_TOOL_EXTRAS_KEY]: {
              resultKind: 'rows',
              askOrAssume: { time_range: { assume: '24h' } },
              period: { argument: 'time_range', spelling: 'lookback' },
            },
          },
          handler: async (args: unknown) => {
            received.push(args);
            return { content: [{ type: 'text', text: '{"p95_read_ms":4}' }] };
          },
        },
      ],
    });
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'call-1', name: 'io_profile', args: { host: 'db-1' } }] },
          { content: 'p95 read latency is 4 ms.' },
        ],
      }),
      model: 'm',
    })
      .tools(await client.tools())
      .build();
    await agent.run({ message: 'how is db-1 doing?' });
    expect(received).toEqual([{ host: 'db-1', time_range: '24h' }]);
    expect((agent.findings() ?? []).filter((r) => r.kind === 'argument')).toMatchObject([
      { toolName: 'io_profile', argument: 'time_range', source: 'default', period: true },
    ]);
  });
});

describe('edge — a rule this library cannot apply is warned once and DROPPED', () => {
  const origin = { server: 'fleet-mcp', tool: 'io_profile', inputSchema: SCHEMA };
  const bag = (extras: Record<string, unknown>) => ({ [MCP_TOOL_EXTRAS_KEY]: extras });

  it('an assume value outside the LISTED schema’s enum — judged against the tool’s own schema', () => {
    const read = readToolExtras(bag({ askOrAssume: { time_range: { assume: '2h' } } }), origin);
    expect(read).toEqual({});
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]![0]);
    expect(message).toContain("MCP server 'fleet-mcp'");
    expect(message).toContain('`askOrAssume`');
    expect(message).toContain("'io_profile'");
  });

  it('an `ask` rule the schema accepts is carried (step 4 applies it: the batch ask)', () => {
    const askOrAssume = { time_range: { ask: 'Which period?', choices: ['1h', '24h'] } };
    const read = readToolExtras(bag({ askOrAssume }), origin);
    expect(read).toEqual({ askOrAssume });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('an `ask` rule whose choice the schema rejects is warned once and DROPPED', () => {
    const read = readToolExtras(
      bag({ askOrAssume: { time_range: { ask: 'Which period?', choices: ['1h', '9h'] } } }),
      origin,
    );
    expect(read).toEqual({});
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]![0])).toContain('askOrAssume.time_range.choices[1]');
  });

  it('a period whose rule was dropped is dropped too — a period never arms anything alone', () => {
    const read = readToolExtras(
      bag({
        askOrAssume: { time_range: { assume: '2h' } },
        period: { argument: 'time_range', spelling: 'lookback' },
      }),
      origin,
    );
    expect(read).toEqual({});
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('with no schema on the origin, every rule is dropped rather than trusted unjudged', () => {
    const read = readToolExtras(bag({ askOrAssume: { time_range: { assume: '24h' } } }), {
      server: 'fleet-mcp',
      tool: 'io_profile',
    });
    expect(read).toEqual({});
  });

  it('the tool still registers without the dropped rule — and its argument runs free', async () => {
    const [registered] = await ingest([
      {
        name: 'io_profile',
        inputSchema: SCHEMA,
        _meta: bag({ askOrAssume: { time_range: { assume: '2h' } }, resultKind: 'rows' }),
      },
    ]);
    expect(registered!.askOrAssume).toBeUndefined();
    expect(registered!.resultKind).toBe('rows');
  });
});
