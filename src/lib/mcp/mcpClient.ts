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
  McpCallToolResult,
  McpClient,
  McpClientOptions,
  McpListedTool,
  McpSdkClient,
  McpTransport,
} from './types.js';
import { readToolExtras } from './toolExtras.js';
import { createVendingFetch } from './gatewayTransport.js';
import { retryingFetch, type RetryOnThrottle } from './throttleRetry.js';
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
 * @throws when `@modelcontextprotocol/sdk` is not installed (see
 *   error message for `npm install` hint), or when the transport
 *   fails to connect.
 */
export async function mcpClient(opts: McpClientOptions): Promise<McpClient> {
  const name = opts.name ?? 'mcp';
  const sdk =
    opts._client ??
    (await resolveClient(opts.transport, opts.clientInfo, opts.signal, opts.retryOnThrottle));

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
      ? await sdk.listTools(undefined, { signal: opts.signal })
      : await sdk.listTools();
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
  signal?: AbortSignal,
  retryOnThrottle?: RetryOnThrottle,
): Promise<McpSdkClient> {
  let mod: McpSdkExports;
  try {
    mod = lazyRequire<McpSdkExports>('@modelcontextprotocol/sdk/client/index.js');
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

  const transportImpl = await buildTransport(transport, retryOnThrottle);
  // Same rule as callTool: options ride beside the transport, never inside it.
  if (signal) await client.connect(transportImpl, { signal });
  else await client.connect(transportImpl);
  return client;
}

async function buildTransport(
  t: McpTransport,
  retryOnThrottle?: RetryOnThrottle,
): Promise<unknown> {
  if (t.transport === 'stdio') {
    let stdioMod: McpStdioExports;
    try {
      stdioMod = lazyRequire<McpStdioExports>('@modelcontextprotocol/sdk/client/stdio.js');
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

  // http + gateway transports both ride Streamable HTTP. They differ only in
  // WHEN the auth headers are decided: `http` fixes them at construction,
  // `gateway` vends them inside every request (see gatewayTransport.ts).
  let httpMod: McpHttpExports;
  try {
    httpMod = lazyRequire<McpHttpExports>('@modelcontextprotocol/sdk/client/streamableHttp.js');
  } catch {
    throw new Error(
      `mcpClient(${t.transport}) requires @modelcontextprotocol/sdk/client/streamableHttp.js — ` +
        'check that @modelcontextprotocol/sdk is installed at the latest version.',
    );
  }
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
    return new httpMod.StreamableHTTPClientTransport(new URL(t.url), {
      fetch: retryingFetch(createVendingFetch(t, t.fetch), retryOnThrottle),
    });
  }
  // Both options ride the SAME SDK transport, and both are forwarded when both
  // are given. The SDK folds `requestInit.headers` into the `init.headers` it
  // hands the custom fetch, so a signer sees the static headers and has the
  // final word over the bytes — see `McpHttpTransport.fetch`.
  const httpFetch = retryingFetch(t.fetch, retryOnThrottle);
  return new httpMod.StreamableHTTPClientTransport(new URL(t.url), {
    ...(t.headers && { requestInit: { headers: { ...t.headers } } }),
    ...(httpFetch && { fetch: httpFetch }),
  });
}

// ─── Tool wrapping ─────────────────────────────────────────────────

function wrapMcpTool(
  serverName: string,
  sdk: McpSdkClient,
  mcp: McpListedTool,
  signal?: AbortSignal,
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
        ? await sdk.callTool(params, undefined, { signal })
        : await sdk.callTool(params);
      return readToolResult(result, mcp.name, serverName);
    },
  };
  return tool;
}

// ─── Reading a tools/call answer (both arms of the protocol) ───────

/**
 * Turn a `tools/call` answer into the text the agent hands the model.
 *
 * Three cases, because the protocol has three and pretending otherwise is what
 * broke on a server that answered the old way:
 *
 *   1. **content blocks** — today's shape. Text blocks are concatenated;
 *      non-text blocks (images, resources) are summarized with their type.
 *      `isError: true` becomes a thrown tool error, exactly as before.
 *   2. **`toolResult`** — the 2024-10-07 shape, which carries no `content` and
 *      no `isError`. The value BECOMES the tool text: a string verbatim,
 *      anything else JSON-stringified. That conversion is stated here and in
 *      the docs rather than left to be inferred from a mangled answer.
 *   3. **neither** — a corrective error naming the SHAPE that arrived (its
 *      type, or its keys) and never the payload: an unrecognised answer is
 *      still somebody's data, and a tool error is read by the model.
 *
 * **Order matters, and here is why the legacy check runs first.** The SDK's
 * default result schema declares `content` with a default of `[]`, so a legacy
 * `{ toolResult }` payload arrives here wearing an empty `content` it never
 * sent. Reading that array first would answer a real result with an empty
 * string — the same silence in a friendlier coat. So a `toolResult` beside an
 * EMPTY `content` is read as the legacy answer it is. A NON-empty `content`
 * always wins: a server that sent blocks meant the blocks.
 */
function readToolResult(result: McpCallToolResult, toolName: string, serverName: string): string {
  if (isLegacyResult(result) && !hasNonEmptyContent(result)) {
    return stringifyLegacyResult(result.toolResult);
  }
  if (hasContentBlocks(result)) {
    const text = result.content
      .map((c) => (c.type === 'text' && c.text ? c.text : `[${c.type}]`))
      .join('\n');
    if (result.isError) {
      throw new Error(`MCP tool '${toolName}' (server '${serverName}') returned an error: ${text}`);
    }
    return text;
  }
  throw new Error(
    `MCP tool '${toolName}' (server '${serverName}') answered with a shape this client does ` +
      `not understand: ${describeShape(result)}. A tools/call result carries either 'content' ` +
      `blocks or a legacy 'toolResult'; this had neither.`,
  );
}

/**
 * The current arm. Checked on the wire value, not on the declared type — and
 * defensively, because a `null` or a scalar is exactly the kind of answer that
 * has to reach the corrective error rather than crash on the way to it.
 */
function hasContentBlocks(
  result: McpCallToolResult,
): result is Extract<McpCallToolResult, { content: unknown }> {
  return Array.isArray(contentOf(result));
}

/** Blocks the server actually sent, as opposed to the schema's default `[]`. */
function hasNonEmptyContent(result: McpCallToolResult): boolean {
  const content = contentOf(result);
  return Array.isArray(content) && content.length > 0;
}

function contentOf(result: McpCallToolResult): unknown {
  if (typeof result !== 'object' || result === null) return undefined;
  return (result as { content?: unknown }).content;
}

/** The 2024-10-07 arm — the key's PRESENCE is the signal; its value may be anything. */
function isLegacyResult(result: McpCallToolResult): result is { toolResult: unknown } {
  return typeof result === 'object' && result !== null && 'toolResult' in result;
}

/** A legacy `toolResult` as tool text: a string verbatim, anything else as JSON. */
function stringifyLegacyResult(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // Circular or otherwise unserializable — say what we can rather than
    // throwing from a path whose whole job is to report an answer.
    return String(value);
  }
}

/** Name a value's SHAPE for an error message. Never its contents. */
function describeShape(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `an array of ${value.length} item(s)`;
  if (typeof value !== 'object') return `a ${typeof value}`;
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 0) return 'an object with no keys';
  const shown = keys.slice(0, 8);
  return `an object with keys [${shown.join(', ')}${keys.length > shown.length ? ', …' : ''}]`;
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
    options?: {
      requestInit?: { headers: Record<string, string> };
      /**
       * The SDK's hook for a custom fetch — how per-request vending AND
       * caller-supplied signing both get in. Typed exactly as the SDK types it
       * (`(url: string | URL, init?) => Promise<Response>`), so a function this
       * shim accepts is a function the real transport accepts.
       */
      fetch?: (url: string | URL, init?: RequestInit) => Promise<Response>;
    },
  ) => unknown;
}
