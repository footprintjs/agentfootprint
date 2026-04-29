/**
 * mockMcpClient — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * In-memory MCP client for $0 development. Same `McpClient` shape as
 * `mcpClient(opts)`; drop-in for code that consumes one.
 */

import { describe, expect, it } from 'vitest';

import { Agent, mock, mockMcpClient, type MockMcpTool } from '../../../src/index.js';

// ─── Unit — factory + lifecycle ──────────────────────────────────────

describe('mockMcpClient — unit', () => {
  it('returns an McpClient with name + lifecycle methods', async () => {
    const client = mockMcpClient({
      name: 'test-mock-mcp',
      tools: [{ name: 'echo', inputSchema: { type: 'object' } }],
    });
    expect(client.name).toBe('test-mock-mcp');
    expect(typeof client.tools).toBe('function');
    expect(typeof client.refresh).toBe('function');
    expect(typeof client.close).toBe('function');
  });

  it('default name is "mock-mcp"', async () => {
    const client = mockMcpClient({ tools: [{ name: 't', inputSchema: {} }] });
    expect(client.name).toBe('mock-mcp');
  });

  it('.tools() returns Tool[] with schema preserved verbatim', async () => {
    const inputSchema = {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    };
    const client = mockMcpClient({
      tools: [{ name: 'search', description: 'Search the web', inputSchema }],
    });
    const tools = await client.tools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.schema.name).toBe('search');
    expect(tools[0]!.schema.description).toBe('Search the web');
    expect(tools[0]!.schema.inputSchema).toEqual(inputSchema);
  });

  it('.tools() caches between calls; .refresh() re-builds', async () => {
    const client = mockMcpClient({
      tools: [{ name: 't1', inputSchema: {} }],
    });
    const first = await client.tools();
    const second = await client.tools();
    expect(second).toBe(first); // identity (cached)
    const refreshed = await client.refresh();
    expect(refreshed).not.toBe(first); // new identity
    expect(refreshed[0]!.schema.name).toBe('t1');
  });

  it('.tools() / .refresh() after .close() throws', async () => {
    const client = mockMcpClient({
      name: 'test',
      tools: [{ name: 't', inputSchema: {} }],
    });
    await client.close();
    await expect(client.tools()).rejects.toThrow(
      /mockMcpClient\[test\]\.tools\(\) called after close/,
    );
    await expect(client.refresh()).rejects.toThrow(
      /mockMcpClient\[test\]\.refresh\(\) called after close/,
    );
  });

  it('.close() is idempotent', async () => {
    const client = mockMcpClient({ tools: [{ name: 't', inputSchema: {} }] });
    await client.close();
    await client.close(); // must not throw
  });
});

// ─── Unit — handler dispatch + arg coercion ──────────────────────────

describe('mockMcpClient — handler dispatch', () => {
  it('execute() invokes the supplied handler with the LLM args', async () => {
    let received: Record<string, unknown> | null = null;
    const tool: MockMcpTool = {
      name: 'echo',
      inputSchema: {},
      handler: async (args) => {
        received = args;
        return `echoed: ${args.text}`;
      },
    };
    const client = mockMcpClient({ tools: [tool] });
    const tools = await client.tools();
    const result = await tools[0]!.execute({ text: 'hi' });
    expect(result).toBe('echoed: hi');
    expect(received).toEqual({ text: 'hi' });
  });

  it('returns "[mock result]" when no handler is supplied (wiring-only mode)', async () => {
    const client = mockMcpClient({
      tools: [{ name: 'wired-not-impl', inputSchema: {} }],
    });
    const tools = await client.tools();
    expect(await tools[0]!.execute({})).toBe('[mock result]');
  });

  it('non-object args (LLM hallucination) coerce to {} defensively', async () => {
    let received: Record<string, unknown> | null = null;
    const client = mockMcpClient({
      tools: [
        {
          name: 't',
          inputSchema: {},
          handler: async (args) => {
            received = args;
            return 'ok';
          },
        },
      ],
    });
    const tools = await client.tools();
    await tools[0]!.execute(null);
    expect(received).toEqual({});
    await tools[0]!.execute('oops' as unknown as Record<string, unknown>);
    expect(received).toEqual({});
    await tools[0]!.execute(['oops'] as unknown as Record<string, unknown>);
    expect(received).toEqual({});
  });

  it('handler thrown errors surface with server + tool context', async () => {
    const client = mockMcpClient({
      name: 'auth-server',
      tools: [
        {
          name: 'broken',
          inputSchema: {},
          handler: async () => {
            throw new Error('permission denied');
          },
        },
      ],
    });
    const tools = await client.tools();
    await expect(tools[0]!.execute({})).rejects.toThrow(
      /Mock MCP tool 'broken'.*server 'auth-server'.*permission denied/,
    );
  });
});

// ─── Integration — with Agent.tools(arr) ─────────────────────────────

describe('mockMcpClient — Agent integration', () => {
  it('drop-in compatible with mcpClient — agent.tools(await client.tools())', async () => {
    const client = mockMcpClient({
      tools: [
        { name: 'lookup', inputSchema: { type: 'object' } },
        { name: 'compute', inputSchema: { type: 'object' } },
      ],
    });
    const agent = Agent.create({
      provider: mock({ reply: 'no tools needed' }),
      model: 'mock',
      maxIterations: 1,
    })
      .tools(await client.tools())
      .build();
    const result = await agent.run({ message: 'hello' });
    expect(typeof result).toBe('string');
    await client.close();
  });

  it('end-to-end: agent calls mock MCP tool via scripted replies', async () => {
    let handlerArgs: Record<string, unknown> | null = null;
    const client = mockMcpClient({
      tools: [
        {
          name: 'lookup',
          inputSchema: { type: 'object' },
          handler: async (args) => {
            handlerArgs = args;
            return 'refunds take 3 business days';
          },
        },
      ],
    });
    const provider = mock({
      replies: [
        // Iteration 1: LLM decides to call the tool
        {
          toolCalls: [
            { id: 'c1', name: 'lookup', args: { topic: 'refunds' } as Record<string, unknown> },
          ],
        },
        // Iteration 2: LLM produces final answer using the tool result
        { content: 'Refunds take 3 business days.' },
      ],
    });
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 5 })
      .tools(await client.tools())
      .build();
    const result = await agent.run({ message: 'How long do refunds take?' });
    expect(result).toContain('Refunds take 3 business days');
    expect(handlerArgs).toEqual({ topic: 'refunds' });
    await client.close();
  });
});

// ─── Property — schema fidelity ──────────────────────────────────────

describe('mockMcpClient — properties', () => {
  it('inputSchema round-trips unchanged through wrapping', async () => {
    const original = [
      { name: 'a', inputSchema: { x: 1, y: [2, 3], z: { nested: true } } },
      { name: 'b', description: 'with desc', inputSchema: { type: 'object' } },
    ];
    const client = mockMcpClient({ tools: original });
    const tools = await client.tools();
    for (let i = 0; i < tools.length; i++) {
      expect(tools[i]!.schema.inputSchema).toEqual(original[i]!.inputSchema);
    }
  });

  it('tool count from .tools() equals tools[].length', async () => {
    const tools = Array.from({ length: 50 }, (_, i) => ({
      name: `t${i}`,
      inputSchema: {} as Record<string, unknown>,
    }));
    const client = mockMcpClient({ tools });
    expect((await client.tools()).length).toBe(50);
  });
});

// ─── ROI — what mockMcpClient unlocks ───────────────────────────────

describe('mockMcpClient — ROI', () => {
  it('zero-dependency MCP development — no @modelcontextprotocol/sdk install', async () => {
    // The pitch: build the entire MCP integration with no subprocess,
    // no network, no SDK install. Then `mcpClient` is one line away.
    const client = mockMcpClient({
      name: 'imaginary-server',
      tools: [
        {
          name: 'fetch_data',
          description: 'Get data from the imaginary server',
          inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
          handler: async ({ id }) => `data for ${id}`,
        },
      ],
    });
    const tools = await client.tools();
    expect(tools[0]!.schema.name).toBe('fetch_data');
    expect(await tools[0]!.execute({ id: '42' })).toBe('data for 42');
    await client.close();
  });
});
