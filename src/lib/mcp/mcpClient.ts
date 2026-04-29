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
 * Lazy-require pattern: the `@modelcontextprotocol/sdk` peer-dep
 * loads only when a consumer actually constructs a client. Tests
 * inject `_client` and skip the import path entirely.
 */

import type { Tool } from '../../core/tools.js';
import type { McpClient, McpClientOptions, McpSdkClient, McpTransport } from './types.js';

// Version-less identity. The MCP `clientInfo` field is informational
// (server logs it); a hardcoded number drifts every release. Consumers
// who care about wire-level identity pass `clientInfo` explicitly.
const DEFAULT_CLIENT_INFO = {
  name: 'agentfootprint',
  version: '0.0.0',
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
  let closed = false;

  const ensureOpen = (op: string): void => {
    if (closed) {
      throw new Error(
        `mcpClient[${name}].${op}() called after close(). Construct a new client to reconnect.`,
      );
    }
  };

  const buildTools = async (): Promise<readonly Tool[]> => {
    const listed = await sdk.listTools();
    return listed.tools.map((t) => wrapMcpTool(name, sdk, t, opts.signal));
  };

  return {
    name,
    async tools(): Promise<readonly Tool[]> {
      ensureOpen('tools');
      if (!cache) cache = await buildTools();
      return cache;
    },
    async refresh(): Promise<readonly Tool[]> {
      ensureOpen('refresh');
      cache = await buildTools();
      return cache;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
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

  const client: McpSdkClient = new mod.Client(clientInfo ?? DEFAULT_CLIENT_INFO, {
    capabilities: {},
  });

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
  serverName: string,
  sdk: McpSdkClient,
  mcp: {
    readonly name: string;
    readonly description?: string;
    readonly inputSchema: Readonly<Record<string, unknown>>;
  },
  signal?: AbortSignal,
): Tool {
  const tool: Tool = {
    schema: {
      name: mcp.name,
      description: mcp.description ?? `MCP tool: ${mcp.name}`,
      inputSchema: mcp.inputSchema,
    },
    execute: async (args) => {
      // The agent passes args as `unknown` per Tool contract. MCP
      // expects a JSON object — non-object inputs become `{}` rather
      // than failing the SDK call.
      const argsObj =
        args !== null && typeof args === 'object' && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      const result = await sdk.callTool({
        name: mcp.name,
        arguments: argsObj,
        ...(signal && { signal }),
      });
      // MCP returns content blocks. We concatenate text blocks into
      // a single string for the agent's tool-result event payload.
      // Non-text blocks (images, resources) are summarized with their
      // type — full multi-modal mapping is a future-release follow-up.
      const text = result.content
        .map((c) => (c.type === 'text' && c.text ? c.text : `[${c.type}]`))
        .join('\n');
      if (result.isError) {
        throw new Error(
          `MCP tool '${mcp.name}' (server '${serverName}') returned an error: ${text}`,
        );
      }
      return text;
    },
  };
  return tool;
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
