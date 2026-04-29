/**
 * mcpClient — connect to an MCP server, expose its tools to your Agent.
 *
 *   const slack = await mcpClient({
 *     name: 'slack',
 *     transport: { transport: 'stdio', command: 'npx', args: ['@example/slack-mcp'] },
 *   });
 *
 *   const tools = await slack.tools();   // → readonly Tool[]
 *   const agent = Agent.create({ ... }).tools(tools).build();
 *
 *   // ...
 *
 *   await slack.close();
 *
 * Pattern: Adapter (GoF) — translates MCP `listTools()` / `callTool()`
 *          into agentfootprint's `Tool` interface (schema + execute).
 *          Each MCP tool becomes ONE agentfootprint Tool. The agent's
 *          existing tool-call handler invokes `client.callTool()`
 *          inside the wrapped `execute`.
 *
 * Role:    Layer-3 integration. Sits next to `defineTool` — same
 *          shape, different source. Once tools land on the agent,
 *          the rest of the library doesn't know they came from MCP.
 *
 * Emits:   N/A — wrapped tools emit the standard
 *          `agentfootprint.stream.tool_start` / `tool_end` events
 *          when the agent calls them. Add `name: '<mcp-server>'` to
 *          `McpClientOptions` so observability surfaces can group
 *          tool calls by server.
 *
 * 7-panel review (2026-04-29):
 * - LLM Systems    ✅  inputSchema preserved verbatim — the LLM sees
 *                      the same tool schema MCP advertised
 * - Architect      ✅  pure adapter; no engine code. New tool sources
 *                      slot in via the same `Tool` interface
 * - API Designer   ✅  three methods (.tools / .refresh / .close)
 *                      mirror the MCP SDK lifecycle
 * - Performance    ✅  tool list cached after first fetch; .refresh
 *                      is opt-in. callTool round-trip is one network
 *                      hop per tool call (same as direct LLM-tool flow)
 * - Privacy        ✅  no implicit logging; consumer controls auth
 *                      via transport headers
 * - SoftEng        ✅  lazy-required SDK + friendly install error;
 *                      mock injection point for tests
 * - TS Engineer    ✅  structural McpSdkClient shim — works against
 *                      any future SDK version with the same shape
 *
 * Lazy-require pattern: the `@modelcontextprotocol/sdk` peer-dep
 * loads only when a consumer actually constructs a client. Tests
 * inject `_client` and skip the import path entirely.
 */

import type { Tool } from '../../core/tools.js';
import type {
  McpClient,
  McpClientOptions,
  McpSdkClient,
  McpTransport,
} from './types.js';

const DEFAULT_CLIENT_INFO = {
  name: 'agentfootprint',
  version: '2.1.0', // bumped per release
};

/**
 * Connect to an MCP server. Returns an `McpClient` that exposes the
 * server's tools as agentfootprint `Tool[]` and a `close()` to tear
 * down the transport.
 *
 * @throws when `@modelcontextprotocol/sdk` is not installed (see
 *   error message for `npm install` hint), or when the transport
 *   fails to connect.
 */
export async function mcpClient(opts: McpClientOptions): Promise<McpClient> {
  const name = opts.name ?? 'mcp';
  const sdk = opts._client ?? (await resolveClient(opts.transport, opts.clientInfo));

  // Tool cache so consumers calling `.tools()` more than once don't
  // hammer the server. `.refresh()` invalidates it.
  let cache: readonly Tool[] | null = null;

  const buildTools = async (): Promise<readonly Tool[]> => {
    const listed = await sdk.listTools();
    return listed.tools.map((t) => wrapMcpTool(sdk, t));
  };

  return {
    name,
    async tools(): Promise<readonly Tool[]> {
      if (!cache) cache = await buildTools();
      return cache;
    },
    async refresh(): Promise<readonly Tool[]> {
      cache = await buildTools();
      return cache;
    },
    async close(): Promise<void> {
      cache = null;
      await sdk.close();
    },
  };
}

// ─── SDK construction (lazy require) ───────────────────────────────

async function resolveClient(
  transport: McpTransport,
  clientInfo?: { name: string; version: string },
): Promise<McpSdkClient> {
  let mod: McpSdkExports;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('@modelcontextprotocol/sdk/client/index.js') as McpSdkExports;
  } catch {
    throw new Error(
      'mcpClient requires @modelcontextprotocol/sdk.\n' +
        '  Install:  npm install @modelcontextprotocol/sdk\n' +
        '  Or pass `_client` for test injection.',
    );
  }

  const client: McpSdkClient = new mod.Client(
    clientInfo ?? DEFAULT_CLIENT_INFO,
    { capabilities: {} },
  );

  const transportImpl = await buildTransport(transport);
  await client.connect(transportImpl);
  return client;
}

async function buildTransport(t: McpTransport): Promise<unknown> {
  if (t.transport === 'stdio') {
    let stdioMod: McpStdioExports;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      stdioMod = require('@modelcontextprotocol/sdk/client/stdio.js') as McpStdioExports;
    } catch {
      throw new Error(
        'mcpClient(stdio) requires @modelcontextprotocol/sdk/client/stdio.js — ' +
          'check that @modelcontextprotocol/sdk is installed at the latest version.',
      );
    }
    return new stdioMod.StdioClientTransport({
      command: t.command,
      args: t.args ? [...t.args] : [],
      ...(t.env && { env: { ...t.env } }),
      ...(t.cwd !== undefined && { cwd: t.cwd }),
    });
  }

  // http transport
  let httpMod: McpHttpExports;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    httpMod = require('@modelcontextprotocol/sdk/client/streamableHttp.js') as McpHttpExports;
  } catch {
    throw new Error(
      'mcpClient(http) requires @modelcontextprotocol/sdk/client/streamableHttp.js — ' +
        'check that @modelcontextprotocol/sdk is installed at the latest version.',
    );
  }
  return new httpMod.StreamableHTTPClientTransport(new URL(t.url), {
    ...(t.headers && { requestInit: { headers: { ...t.headers } } }),
  });
}

// ─── Tool wrapping ─────────────────────────────────────────────────

function wrapMcpTool(
  sdk: McpSdkClient,
  mcp: {
    readonly name: string;
    readonly description?: string;
    readonly inputSchema: Readonly<Record<string, unknown>>;
  },
): Tool {
  return {
    schema: {
      name: mcp.name,
      description: mcp.description ?? `MCP tool: ${mcp.name}`,
      inputSchema: mcp.inputSchema,
    },
    execute: async (args) => {
      const result = await sdk.callTool({
        name: mcp.name,
        arguments: (args as Record<string, unknown>) ?? {},
      });
      // MCP returns content blocks. We concatenate text blocks into
      // a single string for the agent's tool-result event payload.
      // Non-text blocks (images, resources) are summarized with their
      // type — full multi-modal mapping is a v2.x follow-up.
      const text = result.content
        .map((c) => (c.type === 'text' && c.text ? c.text : `[${c.type}]`))
        .join('\n');
      if (result.isError) {
        throw new Error(`MCP tool '${mcp.name}' returned an error: ${text}`);
      }
      return text;
    },
  } as Tool;
}

// ─── Module shim types (for the lazy-required SDK) ─────────────────

interface McpSdkExports {
  readonly Client: new (
    info: { name: string; version: string },
    options: { capabilities: Record<string, unknown> },
  ) => McpSdkClient;
}

interface McpStdioExports {
  readonly StdioClientTransport: new (params: {
    command: string;
    args: string[];
    env?: Record<string, string>;
    cwd?: string;
  }) => unknown;
}

interface McpHttpExports {
  readonly StreamableHTTPClientTransport: new (
    url: URL,
    options?: { requestInit?: { headers: Record<string, string> } },
  ) => unknown;
}
