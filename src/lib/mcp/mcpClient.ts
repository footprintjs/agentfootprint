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
 *          Since 9.71.0 that is true of DECLARATIONS too: a server's
 *          `_meta` bag becomes `argumentsFrom` / `resultKind` / `owner`
 *          / `resultClass` / `resultCeiling` on the registered `Tool`,
 *          so the integrity checks, the placement mint and the identity
 *          joins arm for a remote tool exactly as for a local one. The
 *          reading NEVER throws — see `toolExtras.ts`.
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
import type {
  McpClient,
  McpClientOptions,
  McpConnection,
  McpConnectionOptions,
  McpListedTool,
  McpSdk,
  McpSdkClient,
  McpTransport,
} from './types.js';
import { readToolExtras } from './toolExtras.js';
import { readToolResult, resultModeOf } from './toolResult.js';
import { createVendingFetch } from './gatewayTransport.js';
import { retryingFetch, type RetryOnThrottle } from './throttleRetry.js';
import { refuseConflictingOptions } from './connectionRefusals.js';
import { sdkLoadFailure } from './sdkLoadFailure.js';
import { transportUrl } from './transportUrl.js';
import { lazyRequire } from '../lazyRequire.js';

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
 * Three ways to get a connection, and they are three because a browser can
 * only take the last two:
 *
 *   - `{ transport }` — the library loads the SDK through its Node loader and
 *     builds everything. The default, and what every Node consumer already
 *     does.
 *   - `{ transport, sdk }` — you supply the two SDK modules with static
 *     imports; the library still builds the transport, so gateway vending,
 *     `retryOnThrottle`, `headers` and your own `fetch` all keep working.
 *   - `{ connection }` — you built and connected the client yourself; the
 *     library only adapts its tools.
 *
 * @throws when the two arms are mixed, when a `connection` is not one, or when
 *   `@modelcontextprotocol/sdk` cannot be loaded (the message says which of
 *   "not installed" and "no Node loader here" actually happened), or when the
 *   transport fails to connect.
 */
export async function mcpClient(opts: McpClientOptions | McpConnectionOptions): Promise<McpClient> {
  const name = opts.name ?? 'mcp';
  const resultMode = resultModeOf(opts.resultMode, name);
  // Before anything connects: an option that names a behaviour which cannot
  // happen on the chosen arm is a defect, not a preference.
  refuseConflictingOptions(opts, name);
  const connection = await openConnection(opts);

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
    // `signal` rides in the SDK's THIRD argument (RequestOptions), not in
    // the request params — see `wrapMcpTool`.
    const listed = opts.signal
      ? await connection.listTools(undefined, { signal: opts.signal })
      : await connection.listTools();
    return listed.tools.map((t) => wrapMcpTool(name, connection, t, opts.signal, resultMode));
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
      await connection.close();
    },
  };
}

// ─── Getting a connection ──────────────────────────────────────────

/**
 * The one funnel every arm passes through, in precedence order: a connection
 * you handed over, the internal test seam, then the library building one.
 *
 * A call with neither `connection` nor `sdk` reaches `resolveClient` with two
 * `undefined` arguments and takes the identical path it always took.
 */
async function openConnection(
  opts: McpClientOptions | McpConnectionOptions,
): Promise<McpConnection> {
  if (opts.connection !== undefined) return opts.connection;
  if (opts._client !== undefined) return opts._client;
  // `refuseConflictingOptions` has already refused the case where this is
  // absent, so the assertion documents that guarantee rather than assuming it.
  const transport = opts.transport as McpTransport;
  return resolveClient(transport, opts.clientInfo, opts.signal, opts.retryOnThrottle, opts.sdk);
}

// ─── SDK construction (lazy require, unless the caller supplied it) ─

async function resolveClient(
  transport: McpTransport,
  clientInfo?: { name: string; version: string },
  signal?: AbortSignal,
  retryOnThrottle?: RetryOnThrottle,
  sdk?: McpSdk,
): Promise<McpSdkClient> {
  const mod: McpSdkExports = sdk ?? loadClientModule();

  const client: McpSdkClient = new mod.Client(clientInfo ?? DEFAULT_CLIENT_INFO, {
    capabilities: {},
  });

  const transportImpl = await buildTransport(transport, retryOnThrottle, sdk);
  // Same rule as callTool: options ride beside the transport, never inside it.
  if (signal) await client.connect(transportImpl, { signal });
  else await client.connect(transportImpl);
  return client;
}

/** The Node loader path, unchanged — reached only when no `sdk` was supplied. */
function loadClientModule(): McpSdkExports {
  try {
    return lazyRequire<McpSdkExports>('@modelcontextprotocol/sdk/client/index.js');
  } catch (err) {
    throw new Error(
      sdkLoadFailure(err, {
        notInstalled:
          'mcpClient requires @modelcontextprotocol/sdk.\n' +
          '  Install:  npm install @modelcontextprotocol/sdk\n' +
          '  Or pass `_client` for test injection.',
        caller: 'mcpClient',
        specifier: '@modelcontextprotocol/sdk/client/index.js',
        instead:
          'Pass `sdk` (the two SDK modules, imported statically) or `connection` ' +
          '(a client you connected yourself).',
      }),
    );
  }
}

async function buildTransport(
  t: McpTransport,
  retryOnThrottle?: RetryOnThrottle,
  sdk?: McpSdk,
): Promise<unknown> {
  if (t.transport === 'stdio') {
    // Deliberately NOT served by `sdk`: stdio spawns a subprocess, so it can
    // never run in a browser, and `client/stdio.js` is the SDK's one client
    // module that imports `node:process`/`node:stream`. Keeping it behind the
    // loader is what keeps it off every browser module graph.
    let stdioMod: McpStdioExports;
    try {
      stdioMod = lazyRequire<McpStdioExports>('@modelcontextprotocol/sdk/client/stdio.js');
    } catch (err) {
      throw new Error(
        sdkLoadFailure(err, {
          notInstalled:
            'mcpClient(stdio) requires @modelcontextprotocol/sdk/client/stdio.js — ' +
            'check that @modelcontextprotocol/sdk is installed at the latest version.',
          caller: 'mcpClient(stdio)',
          specifier: '@modelcontextprotocol/sdk/client/stdio.js',
          instead:
            'stdio spawns a subprocess, so it cannot run in a browser at all — ' +
            "reach the server over `transport: { transport: 'http', url }` instead.",
        }),
      );
    }
    return new stdioMod.StdioClientTransport({
      command: t.command,
      args: t.args ? [...t.args] : [],
      ...(t.env && { env: { ...t.env } }),
      ...(t.cwd !== undefined && { cwd: t.cwd }),
    });
  }

  // http + gateway transports both ride Streamable HTTP. They differ only in
  // WHEN the auth headers are decided: `http` fixes them at construction,
  // `gateway` vends them inside every request (see gatewayTransport.ts).
  const httpMod: McpHttpExports = sdk ?? loadHttpModule(t.transport);
  // Throttle retry wraps the OUTERMOST fetch, so every attempt is re-signed
  // and re-vended: signatures expire, and a token that would have died during
  // the wait is simply never the one reused. `retryingFetch` returns its input
  // untouched when retry is off — including `undefined`, so a plain `http`
  // transport with no custom fetch still passes none and behaves exactly as it
  // did before 8.11.0.
  if (t.transport === 'gateway') {
    // The consumer's own `fetch` (9.32.0) goes UNDERNEATH the vending, not
    // beside it: `createVendingFetch` resolves the credential, applies it to
    // this one request, and then calls the base fetch — so an mTLS agent or a
    // DPoP signer sees the final headers and has the last word, while the
    // credential is still vended per request. Passing `undefined` is the
    // default global `fetch`, which is byte-identical to every release before
    // the seam existed.
    return new httpMod.StreamableHTTPClientTransport(transportUrl(t.url, 'mcpClient'), {
      fetch: retryingFetch(createVendingFetch(t, t.fetch), retryOnThrottle),
    });
  }
  // Both options ride the SAME SDK transport, and both are forwarded when both
  // are given. The SDK folds `requestInit.headers` into the `init.headers` it
  // hands the custom fetch, so a signer sees the static headers and has the
  // final word over the bytes — see `McpHttpTransport.fetch`.
  const httpFetch = retryingFetch(t.fetch, retryOnThrottle);
  return new httpMod.StreamableHTTPClientTransport(transportUrl(t.url, 'mcpClient'), {
    ...(t.headers && { requestInit: { headers: { ...t.headers } } }),
    ...(httpFetch && { fetch: httpFetch }),
  });
}

/** The Node loader path for Streamable HTTP — reached only with no `sdk`. */
function loadHttpModule(transport: 'http' | 'gateway'): McpHttpExports {
  try {
    return lazyRequire<McpHttpExports>('@modelcontextprotocol/sdk/client/streamableHttp.js');
  } catch (err) {
    throw new Error(
      sdkLoadFailure(err, {
        notInstalled:
          `mcpClient(${transport}) requires @modelcontextprotocol/sdk/client/streamableHttp.js — ` +
          'check that @modelcontextprotocol/sdk is installed at the latest version.',
        caller: `mcpClient(${transport})`,
        specifier: '@modelcontextprotocol/sdk/client/streamableHttp.js',
        instead:
          'Pass `sdk` (the two SDK modules, imported statically) or `connection` ' +
          '(a client you connected yourself).',
      }),
    );
  }
}

// ─── Tool wrapping ─────────────────────────────────────────────────

function wrapMcpTool(
  serverName: string,
  connection: McpConnection,
  mcp: McpListedTool,
  signal?: AbortSignal,
  resultMode?: McpClientOptions['resultMode'],
): Tool {
  const tool: Tool = {
    schema: {
      name: mcp.name,
      description: mcp.description ?? `MCP tool: ${mcp.name}`,
      inputSchema: mcp.inputSchema,
    },
    // Provenance, carried to the decision point. Governance that matches on a
    // bare tool name cannot tell two servers' identically-named tools apart;
    // this is the fact that lets it. See `Tool.source`.
    source: serverName,
    // The DECLARATIONS the server sent in MCP's `_meta` bag (9.71.0) — read
    // defensively, per field, by the same rules `defineTool` enforces, and
    // NEVER throwing: a malformed field is warned about once and dropped, and
    // this tool still registers. That is what keeps one bad tool from killing
    // a forty-tool bulk register. A server that sent no bag adds no keys here,
    // so the Tool is byte-identical to one built before this existed.
    ...readToolExtras(mcp._meta, { server: serverName, tool: mcp.name }),
    execute: async (args) => {
      // The agent passes args as `unknown` per Tool contract. MCP
      // expects a JSON object — non-object inputs become `{}` rather
      // than failing the SDK call.
      const argsObj =
        args !== null && typeof args === 'object' && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      // The abort signal is NOT a request param — it belongs to the SDK's
      // third argument (`RequestOptions`). Put it in the params object and
      // it gets serialized onto the wire as an empty `{}` and the call is
      // uncancellable: a silent no-op that only a real transport reveals.
      // `resultSchema` (2nd arg) is left to the SDK's own default.
      const params = { name: mcp.name, arguments: argsObj };
      const result = signal
        ? await connection.callTool(params, undefined, { signal })
        : await connection.callTool(params);
      return readToolResult(result, mcp.name, serverName, resultMode);
    },
  };
  return tool;
}

// ─── Module shim types (for the lazy-required SDK) ─────────────────

/**
 * The two portable module shapes are now PUBLIC as `McpSdk` (types.ts) — a
 * caller who supplies them has to be able to name them. These aliases keep the
 * lazy-require sites reading the way they always did, and are what makes
 * `sdk ?? loadClientModule()` typecheck as one thing.
 */
type McpSdkExports = Pick<McpSdk, 'Client'>;
type McpHttpExports = Pick<McpSdk, 'StreamableHTTPClientTransport'>;

/**
 * Deliberately NOT part of `McpSdk`: stdio spawns a subprocess. It cannot run
 * in a browser, so there is nothing for a caller to portably supply, and
 * keeping it private is what keeps `client/stdio.js` — the SDK's only
 * Node-importing client module — out of the public contract.
 */
interface McpStdioExports {
  readonly StdioClientTransport: new (params: {
    command: string;
    args: string[];
    env?: Record<string, string>;
    cwd?: string;
  }) => unknown;
}
