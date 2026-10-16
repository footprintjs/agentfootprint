/**
 * A bundled app (esbuild, webpack) cannot follow the library's lazy `require`
 * of the MCP SDK or the AWS SDK. These pin the two things that make that
 * survivable:
 *
 *   1. the public `sdk` hook on `mcpClient` and `agentCoreRuntimeMcpTransport`
 *      bypasses the loader entirely (`_sdk` on the transport is the older
 *      spelling, kept because it shipped in a published type);
 *   2. without it, a missing SDK is refused when the client or transport is
 *      BUILT — before any request — in words that name the hook.
 *
 * The loader is replaced with one that fails the way each bundler's runtime
 * does, so nothing here depends on what is installed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { McpSdk } from '../../src/mcp/types.js';
import { fakeAgentCoreRuntime } from './fixtures/fakeAgentCoreRuntime.js';

const ARN = 'arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/orders_mcp-a1b2c3';
const REGION = 'us-west-2';

/** How each bundler's output fails to load a module it could not follow. */
const BUNDLER_FAILURES = [
  ['esbuild (cjs) / webpack', (id: string) => new Error(`Cannot find module '${id}'`)],
  ['esbuild (esm shim)', (id: string) => new Error(`Dynamic require of "${id}" is not supported`)],
] as const;

const loads: string[] = [];

/** Import the modules under test with a loader that fails like `failure`. */
async function withFailingLoader(failure: (id: string) => Error) {
  vi.resetModules();
  vi.doMock('../../src/lib/lazyRequire.js', () => ({
    lazyRequire: (id: string): never => {
      loads.push(id);
      throw failure(id);
    },
  }));
  // Vitest's manual-mock callstack is shared: concurrent imports of these
  // graphs can bypass their common lazyRequire mock. Resolve them in order.
  const { mcpClient } = await import('../../src/mcp/mcpClient.js');
  const { agentCoreRuntimeMcpTransport } = await import(
    '../../src/adapters/mcp/agentcoreRuntime/transport.js'
  );
  return { mcpClient, agentCoreRuntimeMcpTransport };
}

afterEach(() => {
  loads.length = 0;
  vi.doUnmock('../../src/lib/lazyRequire.js');
  vi.resetModules();
});

describe('bundled app without the hook: refused at construction, naming `sdk`', () => {
  it.each(BUNDLER_FAILURES)(
    'agentCoreRuntimeMcpTransport refuses when it is built (%s)',
    async (_, failure) => {
      const { agentCoreRuntimeMcpTransport } = await withFailingLoader(failure);
      let error: unknown;
      try {
        agentCoreRuntimeMcpTransport({ agentRuntimeArn: ARN, region: REGION });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain('pass it as `sdk`');
      expect(message).toContain('bundled (esbuild, webpack)');
      expect(message).toContain(
        "sdk: { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore'",
      );
      expect(loads).toEqual(['@aws-sdk/client-bedrock-agentcore']);
    },
  );

  it.each(BUNDLER_FAILURES)(
    'mcpClient refuses when it is built, before any request (%s)',
    async (_, failure) => {
      const { mcpClient } = await withFailingLoader(failure);
      const fetch = vi.fn(async () => new Response(null, { status: 500 }));
      const error = await mcpClient({
        transport: { transport: 'http', url: 'https://mcp.example/mcp', fetch },
      }).then(
        () => new Error('should have refused'),
        (e: Error) => e,
      );
      expect(error.message).toContain('pass it as `sdk`');
      expect(error.message).toContain('bundled (esbuild, webpack)');
      expect(error.message).not.toContain('_client');
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

describe('the public `sdk` hook never touches the loader', () => {
  it('agentCoreRuntimeMcpTransport builds from `sdk` and calls through it', async () => {
    const { agentCoreRuntimeMcpTransport, mcpClient } = await withFailingLoader(
      BUNDLER_FAILURES[0][1],
    );
    const runtime = fakeAgentCoreRuntime({
      tools: [{ name: 'lookup', answer: () => 'shipped' }],
    });
    const transport = agentCoreRuntimeMcpTransport({
      agentRuntimeArn: ARN,
      region: REGION,
      sdk: runtime.sdk,
    });
    // The MCP SDK is real here; only the AWS SDK's loader is the failing one.
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/streamableHttp.js'
    );
    const client = await mcpClient({ transport, sdk: { Client, StreamableHTTPClientTransport } });
    const tools = await client.tools();
    expect(tools.map((t) => t.schema.name)).toEqual(['lookup']);
    expect(await tools[0]!.execute({}, {} as never)).toBe('shipped');
    await client.close();
    expect(loads).toEqual([]);
  });

  it('`_sdk` still works as the older spelling; the same module twice is fine', async () => {
    const { agentCoreRuntimeMcpTransport } = await withFailingLoader(BUNDLER_FAILURES[0][1]);
    const { sdk } = fakeAgentCoreRuntime({ tools: [] });
    expect(() =>
      agentCoreRuntimeMcpTransport({ agentRuntimeArn: ARN, region: REGION, _sdk: sdk }),
    ).not.toThrow();
    expect(() =>
      agentCoreRuntimeMcpTransport({ agentRuntimeArn: ARN, region: REGION, sdk, _sdk: sdk }),
    ).not.toThrow();
    expect(loads).toEqual([]);
  });

  it('`sdk` and `_sdk` naming two modules are refused', async () => {
    const { agentCoreRuntimeMcpTransport } = await withFailingLoader(BUNDLER_FAILURES[0][1]);
    expect(() =>
      agentCoreRuntimeMcpTransport({
        agentRuntimeArn: ARN,
        region: REGION,
        sdk: fakeAgentCoreRuntime({ tools: [] }).sdk,
        _sdk: fakeAgentCoreRuntime({ tools: [] }).sdk,
      }),
    ).toThrow(/two different AWS SDK modules/);
  });

  it.each(['sdk', '_sdk'] as const)(
    '`%s` beside a bearer is refused by the name it was given — that path loads no AWS SDK',
    async (option) => {
      const { agentCoreRuntimeMcpTransport } = await withFailingLoader(BUNDLER_FAILURES[0][1]);
      const build = () =>
        agentCoreRuntimeMcpTransport({
          agentRuntimeArn: ARN,
          region: REGION,
          auth: { bearer: { id: 'p', getCredential: async () => ({ kind: 'none' }) } as never },
          [option]: fakeAgentCoreRuntime({ tools: [] }).sdk,
        });
      expect(build).toThrow(`\`${option}\` is the SigV4 strategy’s AWS SDK module`);
      expect(build).toThrow(`Remove \`${option}\``);
    },
  );

  it('a wrong `sdk` is refused by name when the transport is built', async () => {
    const { agentCoreRuntimeMcpTransport } = await withFailingLoader(BUNDLER_FAILURES[0][1]);
    const build = (sdk: object) => () =>
      agentCoreRuntimeMcpTransport({ agentRuntimeArn: ARN, region: REGION, sdk });
    expect(build({})).toThrow(
      /the `sdk` you passed .* has no `InvokeAgentRuntimeCommand`\. Check the import\./,
    );
    expect(build({ InvokeAgentRuntimeCommand: class {} })).toThrow(
      /the `sdk` you passed .* has no `BedrockAgentCoreClient`\. Check the import\./,
    );
  });

  it('mcpClient over stdio needs only `Client` from `sdk`, and says so', async () => {
    const { mcpClient } = await withFailingLoader(BUNDLER_FAILURES[0][1]);
    const error = await mcpClient({
      transport: { transport: 'stdio', command: 'unused' },
      sdk: {} as unknown as McpSdk,
    }).then(
      () => new Error('should have refused'),
      (e: Error) => e,
    );
    expect(error.message).toContain('`sdk` has no `Client` constructor');
    expect(error.message).toContain('Pass the class itself');
    expect(error.message).toContain('`sdk: { Client }`');
    expect(error.message).not.toContain('StreamableHTTPClientTransport');
    expect(loads).toEqual([]);
  });

  it.each([
    [{}, /`Client` or `StreamableHTTPClientTransport`/],
    [{ Client: class {} }, /no `StreamableHTTPClientTransport` constructor/],
    [{ StreamableHTTPClientTransport: class {} }, /no `Client` constructor/],
    [{ default: {} }, /no `Client` or `StreamableHTTPClientTransport`/],
  ])('mcpClient refuses a wrong `sdk` by name, before building anything (%#)', async (sdk, re) => {
    const { mcpClient } = await withFailingLoader(BUNDLER_FAILURES[0][1]);
    const fetch = vi.fn(async () => new Response(null, { status: 500 }));
    await expect(
      mcpClient({
        transport: { transport: 'http', url: 'https://mcp.example/mcp', fetch },
        sdk: sdk as unknown as McpSdk,
      }),
    ).rejects.toThrow(re);
    expect(fetch).not.toHaveBeenCalled();
    expect(loads).toEqual([]);
  });
});
