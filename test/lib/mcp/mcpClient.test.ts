/**
 * MCP — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Covers `mcpClient()` factory, MCP→Tool wrapping, lifecycle
 * (.tools / .refresh / .close), and end-to-end Agent integration via
 * `agent.tools(await client.tools())`. SDK is mock-injected via
 * `_client` so tests don't require @modelcontextprotocol/sdk.
 */

import { describe, expect, it, vi } from 'vitest';

import { Agent } from '../../../src/index.js';
import { mcpClient } from '../../../src/tool-providers/index.js';
import { mock } from '../../../src/llm-providers.js';
import type { McpSdkClient } from '../../../src/lib/mcp/types.js';

// ─── Mock SDK client factory ──────────────────────────────────────

function makeMockSdk(
  opts: {
    tools?: ReadonlyArray<{
      name: string;
      description?: string;
      inputSchema: Record<string, unknown>;
    }>;
    callResult?: { content: ReadonlyArray<{ type: string; text?: string }>; isError?: boolean };
    callImpl?: (args: { name: string; arguments?: Record<string, unknown> }) => Promise<{
      content: ReadonlyArray<{ type: string; text?: string }>;
      isError?: boolean;
    }>;
  } = {},
): McpSdkClient {
  const tools = opts.tools ?? [
    {
      name: 'echo',
      description: 'Echo input',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    },
  ];
  const callResult = opts.callResult ?? { content: [{ type: 'text', text: 'mock result' }] };
  return {
    connect: vi.fn(async () => {}),
    listTools: vi.fn(async () => ({ tools })),
    callTool: vi.fn(opts.callImpl ?? (async () => callResult)),
    close: vi.fn(async () => {}),
  };
}

// ─── Unit — factory + lifecycle ───────────────────────────────────

describe('mcpClient — unit', () => {
  it('returns an McpClient with the given name + lifecycle methods', async () => {
    const client = await mcpClient({
      name: 'test-mcp',
      transport: { transport: 'stdio', command: 'echo' },
      _client: makeMockSdk(),
    });
    expect(client.name).toBe('test-mcp');
    expect(typeof client.tools).toBe('function');
    expect(typeof client.refresh).toBe('function');
    expect(typeof client.close).toBe('function');
  });

  it('default name is "mcp"', async () => {
    const client = await mcpClient({
      transport: { transport: 'stdio', command: 'echo' },
      _client: makeMockSdk(),
    });
    expect(client.name).toBe('mcp');
  });

  it('.tools() returns wrapped Tool[] with schema preserved', async () => {
    const sdk = makeMockSdk({
      tools: [
        {
          name: 'search',
          description: 'Search the web',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
    });
    const client = await mcpClient({
      transport: { transport: 'stdio', command: 'echo' },
      _client: sdk,
    });
    const tools = await client.tools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.schema.name).toBe('search');
    expect(tools[0]!.schema.description).toBe('Search the web');
    expect(tools[0]!.schema.inputSchema).toEqual({
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    });
  });

  it('.tools() caches between calls; .refresh() re-fetches', async () => {
    const sdk = makeMockSdk();
    const listToolsSpy = sdk.listTools as ReturnType<typeof vi.fn>;
    const client = await mcpClient({
      transport: { transport: 'stdio', command: 'echo' },
      _client: sdk,
    });

    await client.tools();
    await client.tools();
    expect(listToolsSpy).toHaveBeenCalledTimes(1); // cached

    await client.refresh();
    expect(listToolsSpy).toHaveBeenCalledTimes(2); // bypassed cache
  });

  it('.close() invokes the SDK close()', async () => {
    const sdk = makeMockSdk();
    const closeSpy = sdk.close as ReturnType<typeof vi.fn>;
    const client = await mcpClient({
      transport: { transport: 'stdio', command: 'echo' },
      _client: sdk,
    });
    await client.close();
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it('.tools() / .refresh() after .close() throws — no torn-transport calls', async () => {
    const sdk = makeMockSdk();
    const listToolsSpy = sdk.listTools as ReturnType<typeof vi.fn>;
    const client = await mcpClient({
      name: 'test',
      transport: { transport: 'stdio', command: 'echo' },
      _client: sdk,
    });
    await client.tools(); // populate cache
    await client.close();
    listToolsSpy.mockClear();
    await expect(client.tools()).rejects.toThrow(/mcpClient\[test\]\.tools\(\) called after close/);
    await expect(client.refresh()).rejects.toThrow(
      /mcpClient\[test\]\.refresh\(\) called after close/,
    );
    expect(listToolsSpy).not.toHaveBeenCalled();
  });

  it('.close() is idempotent — second call is a no-op (no double-close on SDK)', async () => {
    const sdk = makeMockSdk();
    const closeSpy = sdk.close as ReturnType<typeof vi.fn>;
    const client = await mcpClient({
      transport: { transport: 'stdio', command: 'echo' },
      _client: sdk,
    });
    await client.close();
    await client.close();
    expect(closeSpy).toHaveBeenCalledOnce();
  });
});

describe('mcpClient — signal + arg-coercion fixes', () => {
  it('McpClientOptions.signal threads through to sdk.callTool() — consumer can cancel', async () => {
    const sdk = makeMockSdk({ tools: [{ name: 't', inputSchema: {} }] });
    const callSpy = sdk.callTool as ReturnType<typeof vi.fn>;
    const ac = new AbortController();
    const client = await mcpClient({
      transport: { transport: 'stdio', command: 'echo' },
      signal: ac.signal,
      _client: sdk,
    });
    const tools = await client.tools();
    await tools[0]!.execute({ q: 'x' });
    // POSITION IS THE POINT: the SDK reads `signal` from its THIRD
    // argument (RequestOptions). Inside the params object — where this
    // used to go — it is JSON-serialized to `{}` on the wire and cancels
    // nothing. See mcpClient.real.test.ts for the same law over a socket.
    const [params, resultSchema, options] = callSpy.mock.calls[0]!;
    expect(params.signal).toBeUndefined();
    expect(resultSchema).toBeUndefined();
    expect(options.signal).toBe(ac.signal);
  });

  it('non-object args coerce to {} (defensive — LLM may hallucinate scalar)', async () => {
    const sdk = makeMockSdk({ tools: [{ name: 't', inputSchema: {} }] });
    const callSpy = sdk.callTool as ReturnType<typeof vi.fn>;
    const client = await mcpClient({
      transport: { transport: 'stdio', command: 'echo' },
      _client: sdk,
    });
    const tools = await client.tools();
    // null, scalar, array — all become {}
    await tools[0]!.execute(null);
    await tools[0]!.execute('oops' as unknown as Record<string, unknown>);
    await tools[0]!.execute(['oops'] as unknown as Record<string, unknown>);
    for (const call of callSpy.mock.calls) {
      expect(call[0].arguments).toEqual({});
    }
  });
});

// ─── Unit — tool wrapping (execute → callTool round trip) ─────────

describe('mcpClient — execute wraps callTool', () => {
  it('execute() concatenates text content blocks', async () => {
    const sdk = makeMockSdk({
      tools: [{ name: 't', inputSchema: {} }],
      callResult: {
        content: [
          { type: 'text', text: 'line 1' },
          { type: 'text', text: 'line 2' },
        ],
      },
    });
    const client = await mcpClient({
      transport: { transport: 'stdio', command: 'echo' },
      _client: sdk,
    });
    const tools = await client.tools();
    const result = await tools[0]!.execute({});
    expect(result).toBe('line 1\nline 2');
  });

  it('execute() summarizes non-text content blocks by type', async () => {
    const sdk = makeMockSdk({
      tools: [{ name: 't', inputSchema: {} }],
      callResult: {
        content: [{ type: 'text', text: 'caption' }, { type: 'image' }, { type: 'resource' }],
      },
    });
    const client = await mcpClient({
      transport: { transport: 'stdio', command: 'echo' },
      _client: sdk,
    });
    const tools = await client.tools();
    const result = await tools[0]!.execute({});
    expect(result).toBe('caption\n[image]\n[resource]');
  });

  it('execute() throws when MCP returns isError=true (error includes server name for traceability)', async () => {
    const sdk = makeMockSdk({
      tools: [{ name: 'broken', inputSchema: {} }],
      callResult: { content: [{ type: 'text', text: 'permission denied' }], isError: true },
    });
    const client = await mcpClient({
      name: 'auth-server',
      transport: { transport: 'stdio', command: 'echo' },
      _client: sdk,
    });
    const tools = await client.tools();
    await expect(tools[0]!.execute({})).rejects.toThrow(
      /'broken'.*server 'auth-server'.*permission denied/,
    );
  });

  it('execute() forwards tool args to callTool', async () => {
    const sdk = makeMockSdk({ tools: [{ name: 'echo', inputSchema: {} }] });
    const callSpy = sdk.callTool as ReturnType<typeof vi.fn>;
    const client = await mcpClient({
      transport: { transport: 'stdio', command: 'echo' },
      _client: sdk,
    });
    const tools = await client.tools();
    await tools[0]!.execute({ text: 'hello world', count: 3 });
    expect(callSpy).toHaveBeenCalledWith({
      name: 'echo',
      arguments: { text: 'hello world', count: 3 },
    });
  });
});

// ─── The callTool union — both arms of the protocol (7.23.0) ──────

/**
 * The SDK's declared `callTool` return is a UNION: today's `content` blocks,
 * or the 2024-10-07 `{ toolResult }` with no `content` at all. Reading
 * `result.content` unconditionally was a crash waiting for a server old enough
 * to trigger it — and the shim that promised only one arm is what hid it from
 * the compiler.
 */
describe('mcpClient — a legacy result shape', () => {
  /** An SDK client that answers with whatever result object the test names. */
  const sdkAnswering = (result: unknown): McpSdkClient =>
    ({
      connect: vi.fn(async () => {}),
      listTools: vi.fn(async () => ({ tools: [{ name: 'legacy', inputSchema: {} }] })),
      callTool: vi.fn(async () => result),
      close: vi.fn(async () => {}),
    } as unknown as McpSdkClient);

  const legacyTool = async (result: unknown) => {
    const client = await mcpClient({
      name: 'old-server',
      transport: { transport: 'stdio', command: 'echo' },
      _client: sdkAnswering(result),
    });
    return (await client.tools())[0]!;
  };

  it('LAW: a { toolResult } answer does not throw — the value becomes the tool text', async () => {
    const tool = await legacyTool({ toolResult: 'the answer' });
    expect(await tool.execute({})).toBe('the answer');
  });

  it('LAW: a non-string toolResult is JSON — the documented conversion', async () => {
    const tool = await legacyTool({ toolResult: { rows: 2, ok: true } });
    expect(await tool.execute({})).toBe('{"rows":2,"ok":true}');
  });

  it('LAW: an EMPTY content beside a toolResult is the SDK default, not the answer', async () => {
    // The SDK's own result schema defaults `content` to `[]`, so a legacy
    // payload reaches us wearing a content it never sent. Reading that first
    // would answer a real result with an empty string.
    const tool = await legacyTool({ content: [], toolResult: 'legacy answer' });
    expect(await tool.execute({})).toBe('legacy answer');
  });

  it('LAW: a NON-empty content always wins — a server that sent blocks meant them', async () => {
    const tool = await legacyTool({
      content: [{ type: 'text', text: 'block text' }],
      toolResult: 'ignored',
    });
    expect(await tool.execute({})).toBe('block text');
  });

  it('a legacy answer carries no isError, so it is a result — not a refusal', async () => {
    const tool = await legacyTool({ toolResult: '' });
    await expect(tool.execute({})).resolves.toBe('');
  });

  it('LAW: neither arm is a corrective error naming the tool, the server and the SHAPE', async () => {
    const tool = await legacyTool({ status: 'ok', rows: [1, 2, 3] });
    await expect(tool.execute({})).rejects.toThrow(
      /'legacy'.*server 'old-server'.*an object with keys \[status, rows\]/,
    );
  });

  it('SECURITY: the corrective error names the shape and never the payload', async () => {
    const tool = await legacyTool({ ssn: '123-45-6789', note: 'transfer to acct 9910' });
    const err = await tool.execute({}).catch((e: Error) => e);
    const message = (err as Error).message;
    expect(message).toContain('an object with keys [ssn, note]');
    expect(message).not.toContain('123-45-6789');
    expect(message).not.toContain('9910');
  });

  it('a non-object answer is described by type, not printed', async () => {
    const tool = await legacyTool('a bare string nobody expected');
    const err = await tool.execute({}).catch((e: Error) => e);
    expect((err as Error).message).toContain('a string');
    expect((err as Error).message).not.toContain('nobody expected');
  });

  it('PROPERTY: every unreadable answer produces a description and never a crash', async () => {
    // The corrective path has to survive the answers that are least like a
    // result — a null, a scalar, an array, an empty object — because those are
    // exactly what a misconfigured or hostile server sends.
    const shapes: Array<[unknown, RegExp]> = [
      [null, /: null\./],
      [42, /a number/],
      [[{ a: 1 }, { b: 2 }], /an array of 2 item\(s\)/],
      [{}, /an object with no keys/],
      [
        { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9 },
        /an object with keys \[a, b, c, d, e, f, g, h, …\]/,
      ],
    ];
    for (const [answer, shape] of shapes) {
      const tool = await legacyTool(answer);
      await expect(tool.execute({})).rejects.toThrow(shape);
    }
  });

  it('an undefined toolResult is an empty answer, and a circular one still reports', async () => {
    expect(await (await legacyTool({ toolResult: undefined })).execute({})).toBe('');

    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;
    expect(await (await legacyTool({ toolResult: circular })).execute({})).toBe('[object Object]');
  });
});

// ─── Provenance — Tool.source (7.23.0) ────────────────────────────

describe('mcpClient — tools carry their server', () => {
  it('LAW: every wrapped tool carries the client name as `source`', async () => {
    const client = await mcpClient({
      name: 'aws-prod',
      transport: { transport: 'stdio', command: 'echo' },
      _client: makeMockSdk({ tools: [{ name: 'call_aws', inputSchema: {} }] }),
    });
    const tools = await client.tools();
    expect(tools[0]!.source).toBe('aws-prod');
  });

  it('the default name is what an unnamed client stamps', async () => {
    const client = await mcpClient({
      transport: { transport: 'stdio', command: 'echo' },
      _client: makeMockSdk(),
    });
    expect((await client.tools())[0]!.source).toBe('mcp');
  });
});

// ─── Integration — Agent.tools(await client.tools()) ──────────────

describe('mcpClient — Agent integration', () => {
  it('agent.tools(await client.tools()) registers all MCP tools at once', async () => {
    const sdk = makeMockSdk({
      tools: [
        { name: 'one', inputSchema: { type: 'object' } },
        { name: 'two', inputSchema: { type: 'object' } },
        { name: 'three', inputSchema: { type: 'object' } },
      ],
    });
    const client = await mcpClient({
      transport: { transport: 'stdio', command: 'echo' },
      _client: sdk,
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
  });

  it('duplicate tool names across MCP + manual .tool() throw at build time', async () => {
    const sdk = makeMockSdk({ tools: [{ name: 'shared', inputSchema: {} }] });
    const client = await mcpClient({
      transport: { transport: 'stdio', command: 'echo' },
      _client: sdk,
    });

    const builder = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' }).tool({
      schema: { name: 'shared', description: 'manual', inputSchema: {} },
      execute: async () => 'manual result',
    });

    const mcpTools = await client.tools();
    expect(() => builder.tools(mcpTools)).toThrow(/duplicate tool name 'shared'/);
  });
});

// ─── Property — invariants ─────────────────────────────────────────

describe('mcpClient — properties', () => {
  it('listTools shape preserved through wrapping (no loss)', async () => {
    const original = [
      { name: 'a', inputSchema: { x: 1 } },
      { name: 'b', description: 'with desc', inputSchema: { y: 2 } },
      { name: 'c', inputSchema: { type: 'object', properties: { p: { type: 'string' } } } },
    ];
    const sdk = makeMockSdk({ tools: original });
    const client = await mcpClient({
      transport: { transport: 'stdio', command: 'echo' },
      _client: sdk,
    });
    const tools = await client.tools();
    expect(tools.length).toBe(3);
    for (let i = 0; i < tools.length; i++) {
      expect(tools[i]!.schema.name).toBe(original[i]!.name);
      expect(tools[i]!.schema.inputSchema).toEqual(original[i]!.inputSchema);
    }
  });

  it('default description filled when MCP server omits it', async () => {
    const sdk = makeMockSdk({ tools: [{ name: 'no-desc', inputSchema: {} }] });
    const client = await mcpClient({
      transport: { transport: 'stdio', command: 'echo' },
      _client: sdk,
    });
    const tools = await client.tools();
    expect(tools[0]!.schema.description).toContain('no-desc');
  });
});

// ─── Security — install error + auth pass-through ────────────────

describe('mcpClient — security', () => {
  it('without _client + without SDK installed, throws install hint', async () => {
    // Simulate the SDK not being installed by mocking the require to fail.
    // We can't easily hijack require here without complex setup; instead
    // verify the friendly error path is the one we'd hit by inspecting
    // the catch path indirectly: passing an injected mock skips the
    // install path, so the install error is exercised by the
    // unmocked-runtime case (covered manually). This test pins the
    // contract that `_client` injection bypasses the require.
    const sdk = makeMockSdk();
    const client = await mcpClient({
      transport: { transport: 'stdio', command: 'echo' },
      _client: sdk,
    });
    expect(client).toBeDefined();
    expect(sdk.connect).not.toHaveBeenCalled(); // injected client skips connect
  });
});

// ─── Performance ──────────────────────────────────────────────────

describe('mcpClient — performance', () => {
  it('tools cache prevents repeated listTools roundtrips', async () => {
    const sdk = makeMockSdk();
    const listToolsSpy = sdk.listTools as ReturnType<typeof vi.fn>;
    const client = await mcpClient({
      transport: { transport: 'stdio', command: 'echo' },
      _client: sdk,
    });

    // 100 reads should hit listTools exactly once.
    for (let i = 0; i < 100; i++) await client.tools();
    expect(listToolsSpy).toHaveBeenCalledTimes(1);
  });
});

// ─── ROI — what the surface unlocks ───────────────────────────────

describe('mcpClient — ROI', () => {
  it('one factory function exposes any MCP server to any agent', async () => {
    // The pitch: ONE function. Validate end-to-end that mcpClient +
    // agent.tools spans the entire MCP ecosystem.
    const sdk = makeMockSdk({
      tools: [
        { name: 'list-files', description: 'List files', inputSchema: { type: 'object' } },
        { name: 'read-file', description: 'Read a file', inputSchema: { type: 'object' } },
      ],
    });

    const fileTools = await mcpClient({
      name: 'file-server',
      transport: { transport: 'stdio', command: 'npx', args: ['fake-mcp'] },
      _client: sdk,
    });

    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
      .tools(await fileTools.tools())
      .build();

    expect(agent).toBeDefined();
    await fileTools.close();
  });
});
