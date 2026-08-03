/**
 * mcpServe — expose your agentfootprint tools AS an MCP server.
 *
 *   const handle = await mcpServe([lookupTool, refundTool], {
 *     name: 'support-desk',
 *     version: '1.0.0',
 *   });
 *
 *   // …later
 *   await handle.close();
 *
 * `mcpClient` pulls someone else's tools in. This pushes yours out, so
 * the tool you already wrote, tested and governed can be called by any
 * MCP client — a desktop host, another team's agent, an IDE — without
 * being rewritten against a second tool interface.
 *
 * Pattern: Adapter (GoF), pointed the other way. `mcpClient` translates
 *          MCP → `Tool`; this translates `Tool` → MCP. Same SDK, same
 *          lazy-require discipline, mirrored lifecycle (`close()`).
 *
 * ── The one promise worth stating plainly ────────────────────────────
 * A served tool is THE SAME OBJECT you passed in. `mcpServe` holds your
 * `Tool` by reference and calls `tool.execute(args, ctx)` — it never
 * copies the schema and re-implements the body, never unwraps a
 * decorator, never reaches past a wrapper to an inner tool. So whatever
 * governance you composed around that tool — a permission check inside
 * `execute`, a redaction step, an audit hook — is still the thing that
 * runs when a remote client calls it. Serving is not a second door into
 * your tool; it is the same door with a longer corridor.
 *
 * Two demands the library CANNOT keep over MCP are refused at
 * construction rather than silently dropped:
 *   - `checkIn` (human consent before the tool runs) needs a pause
 *     channel that a request/response protocol does not have.
 *   - `needs` (declare-and-push credentials) needs a provider; without
 *     one the tool would run with `ctx.credential` undefined.
 *
 * ── Schemas ──────────────────────────────────────────────────────────
 * Tools already carry JSON Schema in `schema.inputSchema`, and MCP's
 * `tools/list` wants JSON Schema, so the mapping is the identity
 * function. That is also why this builds on the SDK's low-level
 * `Server` rather than its `McpServer` convenience wrapper — the latter
 * takes zod schemas, which would mean converting a JSON Schema you
 * already have into zod (a new dependency) to convert it straight back.
 */

// Type-only: erased at compile time, so this does not pull node:http into
// a bundle. The listener itself is still built from a dynamic import.
import type { ServerResponse } from 'node:http';

import type { Tool, ToolExecutionContext } from '../../core/tools.js';
import type { Credential, CredentialProvider } from '../../identity/types.js';
import { unconfiguredCredentialProvider } from '../../identity/types.js';
import type {
  McpCallToolRequest,
  McpHttpServeTransport,
  McpSdkServer,
  McpServeHandle,
  McpServeOptions,
  McpServeTransport,
} from './types.js';
import { lazyRequire } from '../lazyRequire.js';
import { runToolChain } from '../../core/agent/middleware/runChain.js';

const DEFAULT_SERVER_NAME = 'agentfootprint';
const DEFAULT_SERVER_VERSION = '0.0.0';
const DEFAULT_HTTP_PATH = '/mcp';

/**
 * Serve `tools` over MCP. Resolves once the transport is connected (for
 * `http`, once the socket is listening), so holding the handle means the
 * server is live.
 *
 * @throws at construction when `tools` is empty, when two tools share a
 *   name, when a tool declares `checkIn`, or when a tool declares `needs`
 *   without `opts.credentials` — see the module header. Also throws when
 *   `@modelcontextprotocol/sdk` is not installed.
 */
export async function mcpServe(
  tools: readonly Tool[],
  opts: McpServeOptions = {},
): Promise<McpServeHandle> {
  const name = opts.name ?? DEFAULT_SERVER_NAME;
  const version = opts.version ?? DEFAULT_SERVER_VERSION;
  const byName = validateServableTools(tools, name, opts.credentials);
  const credentials = opts.credentials ?? unconfiguredCredentialProvider();

  const listing = tools.map((t) => ({
    name: t.schema.name,
    ...(t.schema.description !== undefined && { description: t.schema.description }),
    inputSchema: t.schema.inputSchema ?? { type: 'object', properties: {} },
  }));

  // Order matters: the server is resolved FIRST so that a missing SDK is
  // reported by the message that tells you how to install it, rather than
  // by the narrower one about a single submodule.
  const rootServer = opts._server ?? (await resolveServer(name, version));
  const { listSchema, callSchema } = await resolveRequestSchemas(opts._server !== undefined);

  let callCounter = 0;
  const handleCall = async (
    request: McpCallToolRequest,
    extra: { readonly signal?: AbortSignal },
  ): Promise<unknown> => {
    // Everything below this line is inside one try/catch on purpose. A
    // client we do not control chose this request; a bad choice is a tool
    // error reported back over the protocol, never an exception that
    // escapes the SDK's dispatch loop and takes the server down with it.
    try {
      const toolName = request?.params?.name;
      const tool = typeof toolName === 'string' ? byName.get(toolName) : undefined;
      if (!tool) {
        return toolError(
          `Unknown tool '${String(toolName)}'. Served tools: ${listing
            .map((t) => t.name)
            .join(', ')}.`,
        );
      }

      const toolCallId = `mcp-${name}-${++callCounter}`;

      // Args are forwarded EXACTLY as the client sent them. Validating
      // them here would mean a second, weaker copy of the tool's own
      // contract — and a tool that already rejects bad input is the one
      // place that rejection belongs.
      let args = request?.params?.arguments as unknown;

      // The governance chain, when one was passed. Same walker the Agent's
      // dispatch loop uses, so the ordering rule, the transform rule and the
      // throw-is-a-denial rule mean here exactly what they mean there — and,
      // as there, it runs BEFORE credentials are resolved: a call the chain is
      // about to refuse should never have acquired a secret first.
      //
      // There is no history and no iteration at this boundary — a served call
      // is one call, not a turn in a conversation — so a middleware that needs
      // either belongs on an agent, not here.
      if (opts.toolMiddleware && opts.toolMiddleware.length > 0) {
        const proposed = (args ?? {}) as Readonly<Record<string, unknown>>;
        const verdict = await runToolChain(opts.toolMiddleware, {
          toolName: tool.schema.name,
          toolCallId,
          iteration: 0,
          args: proposed,
          history: [],
          ...(extra?.signal && { signal: extra.signal }),
          // No pause exists here. An `ask` becomes a named refusal rather than
          // an ungoverned execution.
          askPolicy: 'refuse',
        });
        if (verdict.kind === 'deny') return toolError(verdict.reason);
        // Replace only when the chain actually produced something different.
        // A served call nobody transformed reaches `execute` as the exact value
        // the client sent — including `undefined`, which is not `{}`.
        if (verdict.args !== proposed) args = verdict.args;
      }

      const ctx = await buildExecutionContext(tool, toolCallId, {
        credentials,
        hasCredentials: opts.credentials !== undefined,
        ...(extra?.signal && { signal: extra.signal }),
      });
      if ('blocked' in ctx) return toolError(ctx.blocked);

      const result = await tool.execute(args as never, ctx.context);
      return { content: [{ type: 'text', text: stringifyResult(result) }] };
    } catch (error) {
      return toolError(error instanceof Error ? error.message : String(error));
    }
  };

  /**
   * Put our two handlers on one SDK server. Factored out of the body
   * because the streamable-HTTP path cannot reuse a single server: the
   * SDK's stateless transport refuses a second request ("Stateless
   * transport cannot be reused across requests"), so that path builds a
   * fresh server + transport per request and needs to install the same
   * two handlers on each one. `listing` and `byName` are captured, so
   * every server instance serves the same tools — the same objects.
   */
  const install = (server: McpSdkServer): McpSdkServer => {
    server.setRequestHandler(listSchema, () => ({ tools: listing }));
    server.setRequestHandler(callSchema, handleCall);
    return server;
  };

  const sdk = install(rootServer);

  const connection = await connectTransport(
    sdk,
    opts.transport ?? { transport: 'stdio' },
    opts,
    async () => install(await resolveServer(name, version)),
  );

  let closed = false;
  return {
    name,
    toolNames: listing.map((t) => t.name),
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await connection.close();
      await sdk.close();
    },
  };
}

// ─── Construction-time refusals ────────────────────────────────────

/**
 * Build the dispatch map and refuse, by name, every tool this transport
 * cannot honour. All of these are author mistakes, and all of them are
 * invisible at run time if we let them through — a duplicate name means
 * one tool silently shadows another; a dropped `checkIn` means a
 * consent gate that quietly stopped gating.
 */
function validateServableTools(
  tools: readonly Tool[],
  serverName: string,
  credentials: CredentialProvider | undefined,
): Map<string, Tool> {
  if (tools.length === 0) {
    throw new Error(
      `mcpServe('${serverName}'): no tools to serve. Pass at least one Tool — a server ` +
        `advertising an empty tool list is indistinguishable from a broken one.`,
    );
  }
  const byName = new Map<string, Tool>();
  for (const tool of tools) {
    const name = tool.schema.name;
    if (byName.has(name)) {
      throw new Error(
        `mcpServe('${serverName}'): duplicate tool name '${name}'. MCP clients dispatch by ` +
          `name, so one of the two could never be reached.`,
      );
    }
    if (tool.checkIn !== undefined) {
      throw new Error(
        `mcpServe('${serverName}'): tool '${name}' declares checkIn, which asks a human to ` +
          `approve the call before it runs. MCP is request/response — there is no pause to ` +
          `carry that ask — so serving it would drop the consent gate silently. Serve a ` +
          `variant without checkIn, or keep this tool inside an agent that can pause.`,
      );
    }
    if (tool.needs !== undefined && credentials === undefined) {
      throw new Error(
        `mcpServe('${serverName}'): tool '${name}' declares needs.credential ` +
          `'${tool.needs.credential}' but no credential provider was passed. Pass ` +
          `mcpServe(tools, { credentials }) so the credential is resolved before execute, ` +
          `the same way the Agent resolves it.`,
      );
    }
    byName.set(name, tool);
  }
  return byName;
}

// ─── Per-call execution context ────────────────────────────────────

/**
 * Assemble the `ToolExecutionContext` for one served call, resolving a
 * declared credential first. Returns `{ blocked }` instead of throwing
 * when the credential is unavailable, so the client is told WHY in a
 * tool-error result rather than seeing a generic failure.
 */
async function buildExecutionContext(
  tool: Tool,
  toolCallId: string,
  wiring: {
    readonly credentials: CredentialProvider;
    readonly hasCredentials: boolean;
    readonly signal?: AbortSignal;
  },
): Promise<{ context: ToolExecutionContext } | { blocked: string }> {
  const { credentials, hasCredentials, signal } = wiring;
  let credential: Credential | undefined;
  const need = tool.needs;
  if (need) {
    const resolved = await credentials.getCredential({
      service: need.credential,
      ...(need.scopes && { scopes: need.scopes }),
      ...(need.mode && { mode: need.mode }),
    });
    // Fail-closed, mirroring the Agent's tool-call stage: a tool that
    // asked for a credential never runs without one.
    if (resolved.status !== 'issued') {
      return {
        blocked: `authorization required for '${need.credential}': ${resolved.authorizationUrl}`,
      };
    }
    credential = resolved.credential;
  }
  return {
    context: {
      toolCallId,
      // There is no ReAct loop out here — a served call is a single
      // request, so the iteration a tool might branch on is zero.
      iteration: 0,
      credentials,
      hasCredentials,
      ...(signal && { signal }),
      ...(credential && { credential }),
    },
  };
}

// ─── Result mapping ────────────────────────────────────────────────

/** MCP carries text blocks; a Tool returns anything JSON-serializable. */
function stringifyResult(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result === undefined) return '';
  try {
    return JSON.stringify(result) ?? String(result);
  } catch {
    // Circular or otherwise unserializable — say so rather than throwing
    // from the happy path.
    return String(result);
  }
}

/** A tool-level error: reported IN the result, per the MCP spec, not thrown. */
function toolError(message: string): {
  content: { type: string; text: string }[];
  isError: true;
} {
  return { content: [{ type: 'text', text: message }], isError: true };
}

// ─── SDK construction (lazy require) ───────────────────────────────

async function resolveServer(name: string, version: string): Promise<McpSdkServer> {
  let mod: McpServerExports;
  try {
    mod = lazyRequire<McpServerExports>('@modelcontextprotocol/sdk/server/index.js');
  } catch {
    throw new Error(
      'mcpServe requires @modelcontextprotocol/sdk.\n' +
        '  Install:  npm install @modelcontextprotocol/sdk\n' +
        '  Or pass `_server` for test injection.',
    );
  }
  return new mod.Server({ name, version }, { capabilities: { tools: {} } });
}

/**
 * The request schemas the SDK dispatches on. With an injected `_server`
 * there is no SDK to read them from, so tests get stable sentinel
 * objects — the injected server decides what to do with them.
 */
async function resolveRequestSchemas(
  injected: boolean,
): Promise<{ listSchema: unknown; callSchema: unknown }> {
  if (injected) {
    return { listSchema: LIST_TOOLS_SENTINEL, callSchema: CALL_TOOL_SENTINEL };
  }
  let types: McpTypesExports;
  try {
    types = lazyRequire<McpTypesExports>('@modelcontextprotocol/sdk/types.js');
  } catch {
    throw new Error(
      'mcpServe requires @modelcontextprotocol/sdk/types.js — check that ' +
        '@modelcontextprotocol/sdk is installed at the latest version.',
    );
  }
  return { listSchema: types.ListToolsRequestSchema, callSchema: types.CallToolRequestSchema };
}

/**
 * Sentinels handed to an injected `_server` in place of the SDK's zod
 * schemas. Exported so a test can tell the two handlers apart.
 * @internal
 */
export const LIST_TOOLS_SENTINEL = Object.freeze({ method: 'tools/list' });
/** @internal @see LIST_TOOLS_SENTINEL */
export const CALL_TOOL_SENTINEL = Object.freeze({ method: 'tools/call' });

// ─── Transports ────────────────────────────────────────────────────

/** What `close()` has to tear down, over and above the server itself. */
interface Connection {
  close(): Promise<void>;
}

/**
 * For stdio and for an injected test server there is nothing extra to
 * unwind: the SDK's own `server.close()` closes the transport it is
 * connected to. Only the HTTP path owns a socket of its own.
 */
const NOTHING_TO_UNWIND: Connection = { close: () => Promise.resolve() };

async function connectTransport(
  sdk: McpSdkServer,
  transport: McpServeTransport,
  opts: McpServeOptions,
  newServer: () => Promise<McpSdkServer>,
): Promise<Connection> {
  // An injected server is a test double: there is no real transport to
  // build, and building one would spawn a listener or seize stdio.
  if (opts._server) {
    await sdk.connect(undefined);
    return NOTHING_TO_UNWIND;
  }
  if (transport.transport === 'stdio') {
    let stdioMod: McpStdioServerExports;
    try {
      stdioMod = lazyRequire<McpStdioServerExports>('@modelcontextprotocol/sdk/server/stdio.js');
    } catch {
      throw new Error(
        'mcpServe(stdio) requires @modelcontextprotocol/sdk/server/stdio.js — ' +
          'check that @modelcontextprotocol/sdk is installed at the latest version.',
      );
    }
    await sdk.connect(new stdioMod.StdioServerTransport());
    return NOTHING_TO_UNWIND;
  }
  // HTTP deliberately does not use `sdk`: it mints a server per request
  // (see connectHttp). The root server stays unconnected, which makes the
  // handle's `sdk.close()` a harmless no-op on this path.
  return connectHttp(transport, newServer);
}

/**
 * Streamable HTTP. The SDK's transport handles the protocol but does not
 * own a socket — it expects to be driven from a request handler — so the
 * listener is ours, built on node:http (built in; no new dependency).
 *
 * Stateless (`sessionIdGenerator: undefined`): no session table to keep,
 * nothing to expire, and several replicas can serve the same tools.
 *
 * Statelessness is not just a config flag here — it decides the shape of
 * this function. The SDK's stateless transport is single-use by design
 * (reusing one would let two clients collide on JSON-RPC message ids), so
 * it throws on its second request. Each request therefore gets its own
 * transport, and — because one SDK server can only be attached to one
 * transport — its own server. Both are thrown away when the response
 * closes. The tools they serve are the same objects either way.
 */
async function connectHttp(
  transport: McpHttpServeTransport,
  newServer: () => Promise<McpSdkServer>,
): Promise<Connection> {
  let httpMod: McpHttpServerExports;
  try {
    httpMod = lazyRequire<McpHttpServerExports>(
      '@modelcontextprotocol/sdk/server/streamableHttp.js',
    );
  } catch {
    throw new Error(
      'mcpServe(http) requires @modelcontextprotocol/sdk/server/streamableHttp.js — ' +
        'check that @modelcontextprotocol/sdk is installed at the latest version.',
    );
  }
  const { createServer } = await import('node:http');

  const serveOne = async (req: unknown, res: ServerResponse): Promise<void> => {
    const server = await newServer();
    const mcpTransport = new httpMod.StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    // The pair lives exactly as long as the response does.
    res.on('close', () => {
      void mcpTransport.close();
      void server.close();
    });
    await server.connect(mcpTransport);
    await mcpTransport.handleRequest(req, res);
  };

  const path = transport.path ?? DEFAULT_HTTP_PATH;
  const listener = createServer((req, res) => {
    // Route on the path only; the transport itself decides which HTTP
    // methods it accepts on the MCP endpoint.
    const url = req.url ?? '';
    if (url.split('?')[0] !== path) {
      res.statusCode = 404;
      res.end();
      return;
    }
    // One failed request must not take the listener down. The client is
    // told (500 is a protocol-level error it surfaces); the next request
    // is served normally.
    void serveOne(req, res).catch(() => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    if (transport.host !== undefined) listener.listen(transport.port, transport.host, resolve);
    else listener.listen(transport.port, resolve);
  });

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        listener.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

// ─── Module shim types (for the lazy-required SDK) ─────────────────

interface McpServerExports {
  readonly Server: new (
    info: { name: string; version: string },
    options: { capabilities: Record<string, unknown> },
  ) => McpSdkServer;
}

interface McpTypesExports {
  readonly ListToolsRequestSchema: unknown;
  readonly CallToolRequestSchema: unknown;
}

interface McpStdioServerExports {
  readonly StdioServerTransport: new () => unknown;
}

interface McpHttpServerExports {
  readonly StreamableHTTPServerTransport: new (options: { sessionIdGenerator: undefined }) => {
    handleRequest(req: unknown, res: unknown): Promise<void>;
    close(): Promise<void>;
  };
}
