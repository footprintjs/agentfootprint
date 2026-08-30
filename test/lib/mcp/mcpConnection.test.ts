/**
 * `mcpClient({ connection })` and `mcpClient({ sdk })` — the two seams that
 * let a browser speak MCP, pinned against hand-written fakes.
 *
 * The barrier was never the protocol and never the SDK. It was one line:
 * `mcpClient` reaches for `lazyRequire`, `lazyRequire` reaches for
 * `createRequire`, and `createRequire` does not exist in a browser bundle. So
 * the fix is to let the caller supply what the library would otherwise have
 * loaded — either the two SDK modules (`sdk`, the library still builds the
 * transport) or the connected client itself (`connection`, the library builds
 * nothing).
 *
 * What this file proves, and it is deliberately the awkward half:
 *   - `connect()` is NEVER called on a connection you handed over (the fake
 *     throws from `connect`, so the tests pass only because it is unreachable);
 *   - `close()` closes it exactly once, and is idempotent;
 *   - every option that only a transport could honour is REFUSED at
 *     construction, in a message naming where the behaviour moved;
 *   - `_meta` declarations land on the wrapped `Tool` identically on all three
 *     arms. Same `wrapMcpTool` either way — but `readToolExtras` never throws
 *     by design, so a dropped declaration would vanish in silence, which is the
 *     same class of quiet failure the whole change exists to end.
 */

import { describe, expect, it, vi } from 'vitest';

import { mcpClient, MCP_TOOL_EXTRAS_KEY } from '../../../src/tool-providers/index.js';
import type {
  McpConnection,
  McpListedTool,
  McpSdk,
  McpSdkClient,
} from '../../../src/lib/mcp/types.js';

// ─── Fakes ────────────────────────────────────────────────────────

/** The declarations a server sends in MCP's `_meta` bag. */
const DECLARED = {
  argumentsFrom: ['list_ports'],
  resultKind: 'dataset/rows',
  resultCeiling: { maxChars: 4000, narrowBy: ['fabric'] },
} as const;

const LISTED: readonly McpListedTool[] = [
  {
    name: 'lookup',
    description: 'Look a thing up',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    _meta: { [MCP_TOOL_EXTRAS_KEY]: DECLARED },
  },
];

interface Fake {
  readonly connection: McpConnection;
  readonly connectCalls: () => number;
  readonly closeCalls: () => number;
}

/**
 * A connection nobody may connect. `connect` is present (so this doubles as an
 * SDK-shaped client) and throws — the only way to prove a call never happens is
 * to make the call fatal.
 */
function makeFake(): Fake {
  let closeCalls = 0;
  let connectCalls = 0;
  const connection: McpSdkClient = {
    connect: async () => {
      connectCalls++;
      throw new Error('connect() must never be called on a connection the caller handed over');
    },
    listTools: async () => ({ tools: LISTED }),
    callTool: async (params) => ({
      content: [
        { type: 'text', text: `called ${params.name} with ${JSON.stringify(params.arguments)}` },
      ],
    }),
    close: async () => {
      closeCalls++;
    },
  };
  return { connection, connectCalls: () => connectCalls, closeCalls: () => closeCalls };
}

/** An `McpSdk` whose two modules are fakes — no vendor package involved. */
function makeFakeSdk(fake: Fake): { sdk: McpSdk; transports: unknown[] } {
  const transports: unknown[] = [];
  const sdk: McpSdk = {
    Client: class {
      listTools = fake.connection.listTools.bind(fake.connection);
      callTool = fake.connection.callTool.bind(fake.connection);
      close = fake.connection.close.bind(fake.connection);
      // The library DOES connect on this arm — it built the transport.
      connect = async (transport: unknown): Promise<void> => {
        transports.push(transport);
      };
    } as unknown as McpSdk['Client'],
    StreamableHTTPClientTransport: class {
      constructor(readonly url: URL, readonly options?: unknown) {}
    } as unknown as McpSdk['StreamableHTTPClientTransport'],
  };
  return { sdk, transports };
}

// ─── The connection arm ───────────────────────────────────────────

describe('mcpClient({ connection }) — a client you connected yourself', () => {
  it('LAW: connect() is never called on it', async () => {
    const fake = makeFake();
    const client = await mcpClient({ name: 'browser', connection: fake.connection });

    const tools = await client.tools();
    await tools[0]!.execute({ id: 'p1' });
    await client.close();

    expect(fake.connectCalls()).toBe(0);
  });

  it('LAW: close() closes the given connection exactly once, and is idempotent', async () => {
    const fake = makeFake();
    const client = await mcpClient({ connection: fake.connection });

    await client.tools();
    await client.close();
    await client.close();
    await client.close();

    expect(fake.closeCalls()).toBe(1);
    await expect(client.tools()).rejects.toThrow(/called after close/);
  });

  it('lists and calls through the connection, stamping the server name as provenance', async () => {
    const fake = makeFake();
    const client = await mcpClient({ name: 'sidecar', connection: fake.connection });
    try {
      const [tool] = await client.tools();
      expect(tool!.schema.name).toBe('lookup');
      expect(tool!.source).toBe('sidecar');
      expect(await tool!.execute({ id: 'p1' })).toBe('called lookup with {"id":"p1"}');
    } finally {
      await client.close();
    }
  });

  it("REGRESSION: the server's `_meta` declarations land identically on all three arms", async () => {
    // If `readToolExtras` ever stopped running on one arm, nothing would throw:
    // the tool would simply register with no declarations, the integrity checks
    // would quietly not arm, and the first sign would be a check that never
    // fires. So the three arms are compared to each other, field by field.
    const viaConnection = await mcpClient({ connection: makeFake().connection });
    const viaClient = await mcpClient({
      transport: { transport: 'stdio', command: 'never-spawned' },
      _client: makeFake().connection as McpSdkClient,
    });
    const fake = makeFake();
    const viaSdk = await mcpClient({
      sdk: makeFakeSdk(fake).sdk,
      transport: { transport: 'http', url: 'https://example.invalid/mcp' },
    });
    try {
      const declared = (tool: {
        argumentsFrom?: unknown;
        resultKind?: unknown;
        resultCeiling?: unknown;
      }) => ({
        argumentsFrom: tool.argumentsFrom,
        resultKind: tool.resultKind,
        resultCeiling: tool.resultCeiling,
      });
      const expected = {
        argumentsFrom: ['list_ports'],
        resultKind: 'dataset/rows',
        resultCeiling: { maxChars: 4000, narrowBy: ['fabric'] },
      };

      expect(declared((await viaConnection.tools())[0]!)).toEqual(expected);
      expect(declared((await viaClient.tools())[0]!)).toEqual(expected);
      expect(declared((await viaSdk.tools())[0]!)).toEqual(expected);
    } finally {
      await viaConnection.close();
      await viaClient.close();
      await viaSdk.close();
    }
  });

  it('honours `signal` — it rides the request options, not a transport', async () => {
    const seen: unknown[] = [];
    const controller = new AbortController();
    const connection: McpConnection = {
      listTools: async (_params, options) => {
        seen.push(options);
        return { tools: [] };
      },
      callTool: async () => ({ content: [] }),
      close: async () => {},
    };
    const client = await mcpClient({ connection, signal: controller.signal });
    try {
      await client.tools();
      expect(seen).toEqual([{ signal: controller.signal }]);
    } finally {
      await client.close();
    }
  });
});

// ─── Refusals, at construction ────────────────────────────────────

describe('mcpClient — the two arms refuse to be mixed', () => {
  const connection = makeFake().connection;

  it.each([
    [
      'transport',
      { transport: { transport: 'stdio' as const, command: 'x' } },
      /Drop one of the two/,
    ],
    ['sdk', { sdk: {} as McpSdk }, /already built it/],
    ['_client', { _client: connection as McpSdkClient }, /pass `connection` alone/],
    ['retryOnThrottle', { retryOnThrottle: true }, /retryingFetch\(yourFetch, options\)/],
    ['clientInfo', { clientInfo: { name: 'a', version: '1' } }, /new Client\(clientInfo/],
  ])(
    'refuses `connection` + `%s`, naming where the behaviour moved',
    async (option, extra, hint) => {
      await expect(
        // The union already refuses these at compile time; a spread is exactly
        // how a caller gets past that, so the runtime guard is what is tested.
        mcpClient({ name: 'x', connection, ...extra } as never),
      ).rejects.toThrow(
        new RegExp(`\`connection\` and \`${option.replace('_', '_')}\` cannot travel together`),
      );
      await expect(mcpClient({ name: 'x', connection, ...extra } as never)).rejects.toThrow(hint);
    },
  );

  it.each([
    ['listTools', { callTool: () => {}, close: () => {} }],
    ['callTool', { listTools: () => {}, close: () => {} }],
    ['close', { listTools: () => {}, callTool: () => {} }],
  ])('refuses a `connection` with no %s(), naming the near-miss', async (missing, partial) => {
    await expect(mcpClient({ connection: partial as never })).rejects.toThrow(
      new RegExp(`\`connection\` has no \`${missing}\\(\\)\``),
    );
    await expect(mcpClient({ connection: partial as never })).rejects.toThrow(
      /passing the TRANSPORT instead of the client/,
    );
  });

  it('refuses an options object that names nothing to connect to', async () => {
    await expect(mcpClient({} as never)).rejects.toThrow(/nothing to connect to/);
  });
});

// ─── The sdk arm ──────────────────────────────────────────────────

describe('mcpClient({ sdk }) — you supply the modules, the library builds the transport', () => {
  it('the library still builds the transport — headers and url land on it', async () => {
    const fake = makeFake();
    const { sdk, transports } = makeFakeSdk(fake);

    const client = await mcpClient({
      name: 'sidecar',
      sdk,
      transport: {
        transport: 'http',
        url: 'https://example.invalid/mcp',
        headers: { 'x-tenant': 'acme' },
      },
    });
    try {
      // The transport the library built carries the headers a `connection`
      // caller would have had to apply themselves — this is the whole reason
      // the `sdk` arm exists beside `connection`.
      const built = transports[0] as { url: URL; options: { requestInit?: { headers: unknown } } };
      expect(built.url.href).toBe('https://example.invalid/mcp');
      expect(built.options.requestInit?.headers).toEqual({ 'x-tenant': 'acme' });
      expect((await client.tools())[0]!.schema.name).toBe('lookup');
    } finally {
      await client.close();
    }
  });

  it('LAW: the Node loader is never touched on either browser arm', async () => {
    // THE property, and the only one that actually decides whether a browser
    // works: `lazyRequire` reaches `createRequire`, which a bundler stubs. So
    // the loader is replaced with one that THROWS, and both arms must still
    // work — while the default arm must still go through it.
    vi.resetModules();
    const reached: string[] = [];
    vi.doMock('../../../src/lib/lazyRequire.js', () => ({
      lazyRequire: (specifier: string): never => {
        reached.push(specifier);
        throw new TypeError('nodeModule.createRequire is not a function');
      },
    }));
    try {
      const fresh = await import('../../../src/lib/mcp/mcpClient.js');
      const fake = makeFake();

      const viaSdk = await fresh.mcpClient({
        sdk: makeFakeSdk(fake).sdk,
        transport: { transport: 'http', url: 'https://example.invalid/mcp' },
      });
      const viaConnection = await fresh.mcpClient({ connection: makeFake().connection });
      expect((await viaSdk.tools())[0]!.schema.name).toBe('lookup');
      expect((await viaConnection.tools())[0]!.schema.name).toBe('lookup');
      expect(reached).toEqual([]);
      await viaSdk.close();
      await viaConnection.close();

      // …and the default arm still goes through it, on the same specifiers it
      // always used. This is the half that proves nothing was routed around.
      await expect(
        fresh.mcpClient({ transport: { transport: 'http', url: 'https://example.invalid/mcp' } }),
      ).rejects.toThrow(/could not load .* through its Node loader/);
      expect(reached).toEqual(['@modelcontextprotocol/sdk/client/index.js']);
    } finally {
      vi.doUnmock('../../../src/lib/lazyRequire.js');
      vi.resetModules();
    }
  });

  it('the throttle wrapper still applies — the transport gets a fetch it did not have', async () => {
    const fake = makeFake();
    const { sdk, transports } = makeFakeSdk(fake);
    const client = await mcpClient({
      sdk,
      transport: { transport: 'http', url: 'https://example.invalid/mcp' },
    });
    try {
      const built = transports[0] as { options: { fetch?: unknown } };
      // `retryOnThrottle` defaults ON, and on this arm it is still the library
      // that wraps — which is exactly what a `connection` caller gives up.
      expect(typeof built.options.fetch).toBe('function');
    } finally {
      await client.close();
    }
  });
});

// ─── The Node path did not move ───────────────────────────────────

/**
 * The back-compat obligation, stated as arguments rather than as a promise.
 *
 * Every existing consumer passes neither `sdk` nor `connection`, so what has to
 * be unchanged is: which specifiers the loader is asked for, in which order, and
 * exactly what the SDK's two constructors then receive. All four are recorded
 * here by replacing the loader with doubles that write down what they were
 * handed — so a future edit that reroutes, reorders, or quietly adds an option
 * to the default path fails this test rather than a consumer's deployment.
 */
describe('mcpClient({ transport }) — the default arm, argument for argument', () => {
  interface Recorded {
    readonly specifiers: string[];
    readonly clients: { info: unknown; options: unknown }[];
    readonly https: { url: string; options: unknown }[];
    readonly stdios: unknown[];
    readonly connects: unknown[][];
  }

  /** Replace the Node loader with doubles that record, then re-import. */
  async function underRecordingLoader(
    run: (mcp: typeof import('../../../src/lib/mcp/mcpClient.js'), seen: Recorded) => Promise<void>,
  ): Promise<void> {
    vi.resetModules();
    const seen: Recorded = { specifiers: [], clients: [], https: [], stdios: [], connects: [] };
    vi.doMock('../../../src/lib/lazyRequire.js', () => ({
      lazyRequire: (specifier: string): unknown => {
        seen.specifiers.push(specifier);
        if (specifier.endsWith('client/index.js')) {
          return {
            Client: class {
              constructor(info: unknown, options: unknown) {
                seen.clients.push({ info, options });
              }
              connect = async (...args: unknown[]): Promise<void> => {
                seen.connects.push(args);
              };
              listTools = async () => ({ tools: LISTED });
              callTool = async () => ({ content: [] });
              close = async () => {};
            },
          };
        }
        if (specifier.endsWith('client/streamableHttp.js')) {
          return {
            StreamableHTTPClientTransport: class {
              constructor(url: URL, options: unknown) {
                seen.https.push({ url: url.href, options });
              }
            },
          };
        }
        return {
          StdioClientTransport: class {
            constructor(params: unknown) {
              seen.stdios.push(params);
            }
          },
        };
      },
    }));
    try {
      await run(await import('../../../src/lib/mcp/mcpClient.js'), seen);
    } finally {
      vi.doUnmock('../../../src/lib/lazyRequire.js');
      vi.resetModules();
    }
  }

  it('LAW: http — the same two specifiers, the same client identity, the same transport options', async () => {
    await underRecordingLoader(async (mcp, seen) => {
      const client = await mcp.mcpClient({
        transport: {
          transport: 'http',
          url: 'https://example.invalid/mcp',
          headers: { 'x-tenant': 'acme' },
        },
      });
      await client.close();

      expect(seen.specifiers).toEqual([
        '@modelcontextprotocol/sdk/client/index.js',
        '@modelcontextprotocol/sdk/client/streamableHttp.js',
      ]);
      // The version-less identity, unchanged since it was introduced.
      expect(seen.clients).toEqual([
        { info: { name: 'agentfootprint', version: '0.0.0' }, options: { capabilities: {} } },
      ]);
      expect(seen.https[0]!.url).toBe('https://example.invalid/mcp');
      expect(seen.https[0]!.options).toMatchObject({
        requestInit: { headers: { 'x-tenant': 'acme' } },
      });
      // `retryOnThrottle` is ON by default, so a fetch is supplied — and
      // `connect` is called with the transport alone when there is no signal.
      expect(typeof (seen.https[0]!.options as { fetch?: unknown }).fetch).toBe('function');
      expect(seen.connects).toHaveLength(1);
      expect(seen.connects[0]).toHaveLength(1);
    });
  });

  it('LAW: retryOnThrottle:false still passes NO fetch at all — pre-8.11.0 bytes', async () => {
    await underRecordingLoader(async (mcp, seen) => {
      const client = await mcp.mcpClient({
        transport: { transport: 'http', url: 'https://example.invalid/mcp' },
        retryOnThrottle: false,
      });
      await client.close();

      // Not "a fetch that does nothing" — no key. `retryingFetch` returns its
      // input untouched when retry is off, including `undefined`, and the
      // spread drops the key entirely.
      expect(seen.https[0]!.options).toEqual({});
    });
  });

  it('LAW: stdio is bit-for-bit the branch it always was, loader and all', async () => {
    await underRecordingLoader(async (mcp, seen) => {
      const client = await mcp.mcpClient({
        transport: { transport: 'stdio', command: 'npx', args: ['@example/mcp'], cwd: '/tmp' },
      });
      await client.close();

      expect(seen.specifiers).toEqual([
        '@modelcontextprotocol/sdk/client/index.js',
        '@modelcontextprotocol/sdk/client/stdio.js',
      ]);
      expect(seen.stdios).toEqual([{ command: 'npx', args: ['@example/mcp'], cwd: '/tmp' }]);
    });
  });

  it('LAW: a signal still rides connect()’s second argument, never the transport', async () => {
    await underRecordingLoader(async (mcp, seen) => {
      const controller = new AbortController();
      const client = await mcp.mcpClient({
        transport: { transport: 'http', url: 'https://example.invalid/mcp' },
        signal: controller.signal,
      });
      await client.close();

      expect(seen.connects[0]).toHaveLength(2);
      expect(seen.connects[0]![1]).toEqual({ signal: controller.signal });
    });
  });
});
