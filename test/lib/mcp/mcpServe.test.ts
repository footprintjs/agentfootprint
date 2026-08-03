/**
 * mcpServe — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Covers the `tools/list` + `tools/call` handlers, the construction-time
 * refusals, the governance-preservation law, hostile-client robustness,
 * and shutdown. The SDK is mock-injected via `_server` (same convention
 * as `mcpClient`'s `_client`) so tests don't require
 * @modelcontextprotocol/sdk or a real transport.
 */

import { describe, expect, it, vi } from 'vitest';

import { allow, ask, defineTool, deny } from '../../../src/index.js';
import { mcpServe } from '../../../src/tool-providers/index.js';
import { PermissionPolicy } from '../../../src/security/index.js';
import { staticTokens } from '../../../src/identity.js';
import type { McpCallToolRequest, McpSdkServer } from '../../../src/lib/mcp/types.js';
import type { Tool } from '../../../src/core/tools.js';

// ─── Mock SDK server ──────────────────────────────────────────────

type Handler = (req: McpCallToolRequest, extra: { signal?: AbortSignal }) => unknown;

interface MockServer extends McpSdkServer {
  list(): Promise<{ tools: { name: string; description?: string; inputSchema: unknown }[] }>;
  call(
    name: unknown,
    args?: unknown,
    extra?: { signal?: AbortSignal },
  ): Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
  readonly closeSpy: ReturnType<typeof vi.fn>;
  readonly connectSpy: ReturnType<typeof vi.fn>;
}

function makeMockServer(): MockServer {
  const handlers = new Map<string, Handler>();
  const connectSpy = vi.fn(async () => {});
  const closeSpy = vi.fn(async () => {});
  return {
    setRequestHandler(schema: unknown, handler: Handler) {
      handlers.set((schema as { method: string }).method, handler);
    },
    connect: connectSpy,
    close: closeSpy,
    connectSpy,
    closeSpy,
    async list() {
      return (await handlers.get('tools/list')?.({}, {})) as never;
    },
    async call(name: unknown, args?: unknown, extra: { signal?: AbortSignal } = {}) {
      return (await handlers.get('tools/call')?.(
        { params: { name: name as string, arguments: args } },
        extra,
      )) as never;
    },
  };
}

const echo = defineTool<{ text: string }, string>({
  name: 'echo',
  description: 'Echo the input back',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  execute: ({ text }) => `echo: ${text}`,
});

// ─── Unit — schemas + lifecycle ───────────────────────────────────

describe('mcpServe — unit', () => {
  it('returns a handle naming the server + the tools it serves', async () => {
    const handle = await mcpServe([echo], { name: 'support-desk', _server: makeMockServer() });

    expect(handle.name).toBe('support-desk');
    expect(handle.toolNames).toEqual(['echo']);
    expect(typeof handle.close).toBe('function');
  });

  it("default server name is 'agentfootprint'", async () => {
    const handle = await mcpServe([echo], { _server: makeMockServer() });
    expect(handle.name).toBe('agentfootprint');
  });

  it('LAW: tools/list maps schemas 1:1 — the JSON Schema is passed through unchanged', async () => {
    const server = makeMockServer();
    await mcpServe([echo], { _server: server });

    const listed = await server.list();

    expect(listed.tools).toEqual([
      {
        name: 'echo',
        description: 'Echo the input back',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      },
    ]);
    // Not merely equal — the identical object the tool carries.
    expect(listed.tools[0]?.inputSchema).toBe(echo.schema.inputSchema);
  });

  it('tools/call runs the tool and returns its result as a text block', async () => {
    const server = makeMockServer();
    await mcpServe([echo], { _server: server });

    const result = await server.call('echo', { text: 'hi' });

    expect(result).toEqual({ content: [{ type: 'text', text: 'echo: hi' }] });
    expect(result.isError).toBeUndefined();
  });

  it('a non-string tool result is JSON-serialized', async () => {
    const structured = defineTool<Record<string, never>, unknown>({
      name: 'structured',
      description: 'Returns an object',
      execute: () => ({ ok: true, items: [1, 2] }),
    });
    const server = makeMockServer();
    await mcpServe([structured], { _server: server });

    expect((await server.call('structured', {})).content[0]?.text).toBe(
      '{"ok":true,"items":[1,2]}',
    );
  });

  it('connects the transport before returning the handle', async () => {
    const server = makeMockServer();
    await mcpServe([echo], { _server: server });
    expect(server.connectSpy).toHaveBeenCalledTimes(1);
  });

  it('an undefined tool result becomes an empty text block, not "undefined"', async () => {
    const silent = defineTool({
      name: 'silent',
      description: 'Returns nothing',
      execute: () => undefined,
    });
    const server = makeMockServer();
    await mcpServe([silent], { _server: server });

    expect((await server.call('silent', {})).content[0]?.text).toBe('');
  });

  it('without @modelcontextprotocol/sdk installed, it says how to install it', async () => {
    // The SDK is now a devDependency (the real transports are exercised in
    // mcpServe.stdio.real.test.ts / mcpServe.http.real.test.ts), so absence
    // has to be staged rather than borrowed from the environment: the
    // lazy-require is mocked to fail exactly as a missing module does.
    // Staging it is also what makes this deterministic — it used to pass
    // for the incidental reason that nobody had installed the peer.
    vi.doMock('../../../src/lib/lazyRequire.js', () => ({
      lazyRequire: () => {
        throw new Error("Cannot find module '@modelcontextprotocol/sdk/server/index.js'");
      },
    }));
    vi.resetModules();
    try {
      const { mcpServe: withoutSdk } = await import('../../../src/lib/mcp/mcpServe.js');
      await expect(withoutSdk([echo], { name: 'support-desk' })).rejects.toThrow(
        /mcpServe requires @modelcontextprotocol\/sdk[\s\S]*npm install @modelcontextprotocol\/sdk/,
      );
    } finally {
      vi.doUnmock('../../../src/lib/lazyRequire.js');
      vi.resetModules();
    }
  });

  it('LAW: close() shuts the server down, and is idempotent', async () => {
    const server = makeMockServer();
    const handle = await mcpServe([echo], { _server: server });

    await handle.close();
    await handle.close();

    expect(server.closeSpy).toHaveBeenCalledTimes(1);
  });
});

// ─── Scenario — construction-time refusals ────────────────────────

describe('mcpServe — scenario (refusals)', () => {
  it('refuses an empty tool list', async () => {
    await expect(mcpServe([], { _server: makeMockServer() })).rejects.toThrow(/no tools to serve/);
  });

  it('refuses duplicate tool names, naming the name', async () => {
    const other = defineTool({
      name: 'echo',
      description: 'A different echo',
      execute: () => 'other',
    });

    await expect(mcpServe([echo, other], { _server: makeMockServer() })).rejects.toThrow(
      /duplicate tool name 'echo'/,
    );
  });

  it('LAW: refuses a checkIn tool — MCP has no pause to carry the consent ask', async () => {
    const refund = defineTool<{ amount: number }, string>({
      name: 'refund',
      description: 'Issue a refund',
      checkIn: 'always',
      execute: () => 'refunded',
    });

    await expect(mcpServe([refund], { _server: makeMockServer() })).rejects.toThrow(
      /tool 'refund' declares checkIn/,
    );
  });

  it('refuses a needs-declaring tool when no credential provider was passed', async () => {
    const gh = defineTool({
      name: 'github',
      description: 'Call GitHub',
      needs: { credential: 'github' },
      execute: () => 'ok',
    });

    await expect(mcpServe([gh], { _server: makeMockServer() })).rejects.toThrow(
      /declares needs\.credential 'github' but no credential provider was passed/,
    );
  });

  it('resolves a declared credential before execute when a provider IS passed', async () => {
    let seen: string | undefined;
    const gh = defineTool({
      name: 'github',
      description: 'Call GitHub',
      needs: { credential: 'github' },
      execute: (_args, ctx) => {
        seen = ctx.credential?.kind;
        return 'ok';
      },
    });
    const server = makeMockServer();
    await mcpServe([gh], {
      _server: server,
      credentials: staticTokens({ github: 'ghp_test' }),
    });

    expect((await server.call('github', {})).content[0]?.text).toBe('ok');
    expect(seen).toBe('bearer');
  });
});

// ─── Integration — governance survives the trip ───────────────────

describe('mcpServe — integration', () => {
  it('LAW: a served tool is the SAME object — a permission wrapper is not bypassed', async () => {
    const policy = PermissionPolicy.fromRoles(
      { readonly: ['lookup'], admin: ['lookup', 'delete_account'] },
      'readonly',
    );
    let dangerousWorkRan = 0;
    // The consumer's own governance: the check lives INSIDE execute, which
    // is exactly what serving must not be able to route around.
    const guarded = (inner: Tool): Tool => ({
      ...inner,
      execute: (args, ctx) => {
        if (!policy.isAllowed(inner.schema.name)) {
          return `denied: ${inner.schema.name} is not permitted for this role`;
        }
        return inner.execute(args, ctx);
      },
    });
    const deleteAccount = guarded(
      defineTool({
        name: 'delete_account',
        description: 'Delete an account',
        execute: () => {
          dangerousWorkRan++;
          return 'deleted';
        },
      }),
    );
    const lookup = guarded(
      defineTool({ name: 'lookup', description: 'Look something up', execute: () => 'found' }),
    );

    const server = makeMockServer();
    const handle = await mcpServe([lookup, deleteAccount], { _server: server });

    const denied = await server.call('delete_account', {});
    const allowed = await server.call('lookup', {});

    expect(denied.content[0]?.text).toMatch(/denied: delete_account is not permitted/);
    expect(dangerousWorkRan).toBe(0);
    expect(allowed.content[0]?.text).toBe('found');
    await handle.close();
  });

  it('serving does not copy the tool: state mutated through the served path is the tool own state', async () => {
    const calls: unknown[] = [];
    const recorder = defineTool<{ n: number }, string>({
      name: 'recorder',
      description: 'Records what it was called with',
      execute: (args) => {
        calls.push(args);
        return 'recorded';
      },
    });
    const server = makeMockServer();
    await mcpServe([recorder], { _server: server });

    await server.call('recorder', { n: 1 });
    await server.call('recorder', { n: 2 });

    expect(calls).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('forwards the request signal so a client cancellation reaches the tool', async () => {
    const controller = new AbortController();
    let sameSignal = false;
    const cancellable = defineTool({
      name: 'cancellable',
      description: 'Reads the signal',
      execute: (_args, ctx) => {
        sameSignal = ctx.signal === controller.signal;
        return 'ok';
      },
    });
    const server = makeMockServer();
    await mcpServe([cancellable], { _server: server });

    await server.call('cancellable', {}, { signal: controller.signal });

    expect(sameSignal).toBe(true);
  });
});

// ─── Property — args are forwarded verbatim ───────────────────────

describe('mcpServe — property', () => {
  it('whatever the client sends as arguments arrives at execute unchanged', async () => {
    const seen: unknown[] = [];
    const sink = defineTool({
      name: 'sink',
      description: 'Takes anything',
      execute: (args) => {
        seen.push(args);
        return 'ok';
      },
    });
    const server = makeMockServer();
    await mcpServe([sink], { _server: server });

    const inputs = [{ a: 1 }, {}, [], 'a string', 42, null, { nested: { deep: [1, { x: 2 }] } }];
    for (const input of inputs) await server.call('sink', input);

    expect(seen).toEqual(inputs);
  });

  it('every served tool is reachable by its own name, and only by its own name', async () => {
    const tools = ['alpha', 'bravo', 'charlie'].map((name) =>
      defineTool({ name, description: name, execute: () => `ran ${name}` }),
    );
    const server = makeMockServer();
    await mcpServe(tools, { _server: server });

    for (const name of ['alpha', 'bravo', 'charlie']) {
      expect((await server.call(name, {})).content[0]?.text).toBe(`ran ${name}`);
    }
    expect((await server.call('delta', {})).isError).toBe(true);
  });
});

// ─── Security — a hostile client cannot take the loop down ────────

describe('mcpServe — the governance chain (7.18)', () => {
  // The 7.13 promise is "what you serve is the object you passed in". Middleware
  // is the case that promise did not cover: it belongs to an AGENT, not to a
  // `Tool`, so serving a tool object carries none of it and there is nothing on
  // the tool to detect or refuse. Rather than let the rule dead-end at this
  // boundary, the served surface takes a chain of its own — and it means here
  // exactly what it means inside an agent.

  it('walks the chain before execute, and a transform is what the tool receives', async () => {
    const seen: unknown[] = [];
    const sink = defineTool<{ text: string }, string>({
      name: 'sink',
      description: 'records',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      execute: (args) => {
        seen.push(args);
        return 'ok';
      },
    });
    const server = makeMockServer();
    await mcpServe([sink], {
      _server: server,
      toolMiddleware: [
        {
          name: 'mask',
          onToolCall: (call) =>
            allow({ ...call.args, text: String(call.args.text).replace(/\d/g, '#') }, 'masked'),
        },
      ],
    });

    await server.call('sink', { text: 'code 4242' });
    expect(seen).toEqual([{ text: 'code ####' }]);
  });

  it('a deny is a tool error carrying the reason — the tool never runs', async () => {
    const seen: unknown[] = [];
    const sink = defineTool<Record<string, unknown>, string>({
      name: 'sink',
      description: 'records',
      inputSchema: { type: 'object', properties: {} },
      execute: (args) => {
        seen.push(args);
        return 'ok';
      },
    });
    const server = makeMockServer();
    await mcpServe([sink], {
      _server: server,
      toolMiddleware: [{ name: 'closed', onToolCall: () => deny('this server is read-only') }],
    });

    const result = await server.call('sink', {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('this server is read-only');
    expect(seen).toEqual([]);
  });

  it('an ask is REFUSED BY NAME rather than executed ungoverned', async () => {
    // MCP is request/response; there is no pause to carry the question. The
    // wrong answer here would be to run the tool anyway, having silently
    // dropped the gate — the exact failure the `checkIn` refusal exists to
    // prevent, so it gets the same wording.
    const seen: unknown[] = [];
    const sink = defineTool<Record<string, unknown>, string>({
      name: 'sink',
      description: 'records',
      inputSchema: { type: 'object', properties: {} },
      execute: (args) => {
        seen.push(args);
        return 'ok';
      },
    });
    const server = makeMockServer();
    await mcpServe([sink], {
      _server: server,
      toolMiddleware: [{ name: 'four-eyes', onToolCall: () => ask({ question: 'approve?' }) }],
    });

    const result = await server.call('sink', {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("middleware 'four-eyes'");
    expect(result.content[0]?.text).toContain('no pause here to carry that ask');
    expect(seen).toEqual([]);
  });

  it('a throwing middleware is a denial, never a silent pass', async () => {
    const seen: unknown[] = [];
    const sink = defineTool<Record<string, unknown>, string>({
      name: 'sink',
      description: 'records',
      inputSchema: { type: 'object', properties: {} },
      execute: (args) => {
        seen.push(args);
        return 'ok';
      },
    });
    const server = makeMockServer();
    await mcpServe([sink], {
      _server: server,
      toolMiddleware: [
        {
          name: 'broken',
          onToolCall: () => {
            throw new Error('policy service down');
          },
        },
      ],
    });

    const result = await server.call('sink', {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('policy service down');
    expect(seen).toEqual([]);
  });

  it('without a chain the served call is byte-identical to before', async () => {
    const seen: unknown[] = [];
    const sink = defineTool<Record<string, unknown>, string>({
      name: 'sink',
      description: 'records',
      inputSchema: { type: 'object', properties: {} },
      execute: (args) => {
        seen.push(args);
        return 'ok';
      },
    });
    const server = makeMockServer();
    await mcpServe([sink], { _server: server });

    await server.call('sink', { a: 1 });
    await server.call('sink');
    // Including `undefined`, which is not `{}` — a chain nobody configured
    // must not quietly normalise the client's payload.
    expect(seen).toEqual([{ a: 1 }, undefined]);
  });
});

describe('mcpServe — security', () => {
  it('LAW: an unknown tool name is a tool error, not a crash', async () => {
    const server = makeMockServer();
    await mcpServe([echo], { _server: server });

    const result = await server.call('rm_rf');

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Unknown tool 'rm_rf'\. Served tools: echo\./);
  });

  it.each([
    ['a missing name', undefined],
    ['a numeric name', 12345],
    ['an object name', { evil: true }],
    ['a null name', null],
  ])('LAW: %s is a tool error, not a crash', async (_label, name) => {
    const server = makeMockServer();
    await mcpServe([echo], { _server: server });

    const result = await server.call(name, {});

    expect(result.isError).toBe(true);
  });

  it("LAW: a tool that throws is the tool's problem — the server answers the next call", async () => {
    const bomb = defineTool({
      name: 'bomb',
      description: 'Always throws',
      execute: () => {
        throw new Error('boom: bad input');
      },
    });
    const server = makeMockServer();
    await mcpServe([bomb, echo], { _server: server });

    const failed = await server.call('bomb', { anything: true });
    const after = await server.call('echo', { text: 'still here' });

    expect(failed.isError).toBe(true);
    expect(failed.content[0]?.text).toBe('boom: bad input');
    expect(after.content[0]?.text).toBe('echo: still here');
  });

  it('LAW: a tool that rejects asynchronously is handled the same way', async () => {
    const flaky = defineTool({
      name: 'flaky',
      description: 'Rejects',
      execute: () => Promise.reject(new Error('upstream is down')),
    });
    const server = makeMockServer();
    await mcpServe([flaky], { _server: server });

    const result = await server.call('flaky', {});

    expect(result).toEqual({
      content: [{ type: 'text', text: 'upstream is down' }],
      isError: true,
    });
  });

  it('a circular tool result does not throw out of the handler', async () => {
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;
    const looper = defineTool({
      name: 'looper',
      description: 'Returns a cycle',
      execute: () => circular,
    });
    const server = makeMockServer();
    await mcpServe([looper], { _server: server });

    const result = await server.call('looper', {});

    expect(result.isError).toBeUndefined();
    expect(typeof result.content[0]?.text).toBe('string');
  });

  it('a blocked credential stops the tool running and says which service', async () => {
    let ran = 0;
    const gh = defineTool({
      name: 'github',
      description: 'Call GitHub',
      needs: { credential: 'github', mode: 'user' },
      execute: () => {
        ran++;
        return 'ok';
      },
    });
    const server = makeMockServer();
    await mcpServe([gh], {
      _server: server,
      credentials: {
        id: 'consent-required',
        getCredential: async () => ({
          status: 'authorization-required',
          authorizationUrl: 'https://example.test/authorize',
          sessionId: 's1',
        }),
      },
    });

    const result = await server.call('github', {});

    expect(ran).toBe(0);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/authorization required for 'github'/);
  });
});

// ─── Performance ──────────────────────────────────────────────────

describe('mcpServe — performance', () => {
  it('serving adds no per-call listing work: 500 calls stay well under a second', async () => {
    const server = makeMockServer();
    await mcpServe([echo], { _server: server });

    const start = Date.now();
    for (let i = 0; i < 500; i++) await server.call('echo', { text: String(i) });

    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('the tools/list payload is built once, not per request', async () => {
    const server = makeMockServer();
    await mcpServe([echo], { _server: server });

    const first = await server.list();
    const second = await server.list();

    expect(first.tools[0]).toBe(second.tools[0]);
  });
});

// ─── ROI — the round trip ─────────────────────────────────────────

describe('mcpServe — ROI', () => {
  it('the same tool object powers an agent and an MCP server — one definition, two consumers', async () => {
    const { Agent } = await import('../../../src/index.js');
    const { mock } = await import('../../../src/llm-providers.js');

    const server = makeMockServer();
    await mcpServe([echo], { _server: server });
    const overMcp = (await server.call('echo', { text: 'shared' })).content[0]?.text;

    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 't1', name: 'echo', args: { text: 'shared' } }] },
          { content: 'done' },
        ],
      }),
      model: 'mock-model',
    })
      .tool(echo)
      .build();
    await agent.run({ message: 'echo shared' });
    const inAgent = agent
      .getLastSnapshot()
      ?.commitLog.flatMap((b) => JSON.stringify(b))
      .join('\n');

    expect(overMcp).toBe('echo: shared');
    expect(inAgent).toContain('echo: shared');
  });
});
