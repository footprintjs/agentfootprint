/**
 * MCP — Model Context Protocol, in both directions.
 *
 * MCP (https://modelcontextprotocol.io) is an open standard for
 * connecting LLMs to external tools and data sources. This module
 * bridges it both ways:
 *
 *   - `mcpClient(opts)`  — consume an MCP server; its tools become
 *     agentfootprint `Tool[]` you can hand to `agent.tools(...)`.
 *   - `mcpServe(tools, opts)` — the other direction: expose your own
 *     `Tool[]` AS an MCP server, so any MCP client can call them.
 *
 * Pattern: Adapter (GoF) — translates MCP wire format ↔ agentfootprint
 *          `Tool` interface. The MCP SDK does the protocol work; we
 *          just bridge.
 * Role:    Layer-3 tool integration. Pairs with `defineTool` (the
 *          inline alternative for non-MCP tools).
 * Emits:   N/A directly — wrapped tools emit the standard
 *          `agentfootprint.stream.tool_start` / `tool_end` events
 *          when the agent calls them. `mcpServe` runs OUTSIDE any
 *          agent run, so it emits nothing at all.
 */

import type { Tool } from '../../core/tools.js';

// ─── Transport options ─────────────────────────────────────────────

/**
 * `stdio` transport — spawns a local subprocess and speaks MCP over
 * its stdin/stdout. Best for development, single-user scenarios, and
 * testing against locally-installed MCP servers.
 */
export interface McpStdioTransport {
  readonly transport: 'stdio';
  /** Executable to spawn (e.g., `'npx'`, `'node'`, `'python'`). */
  readonly command: string;
  /** CLI args passed to the executable. */
  readonly args?: readonly string[];
  /**
   * Environment for the subprocess. Passed to the SDK as-is, and the SDK
   * treats it as the WHOLE environment: set this and the child no longer
   * inherits the safe default set (`PATH`, `HOME`, …). Omit it unless you
   * mean to replace the environment; to merely add a variable, include the
   * ones the child still needs.
   */
  readonly env?: Readonly<Record<string, string>>;
  /** Working directory for the subprocess. */
  readonly cwd?: string;
}

/**
 * `http` transport — speaks MCP over Streamable HTTP. Best for remote
 * servers, web environments, and multi-user scenarios.
 */
export interface McpHttpTransport {
  readonly transport: 'http';
  /** MCP server endpoint URL. */
  readonly url: string;
  /** Optional auth headers (e.g., `Authorization: Bearer ...`). */
  readonly headers?: Readonly<Record<string, string>>;
}

export type McpTransport = McpStdioTransport | McpHttpTransport;

// ─── Client options ────────────────────────────────────────────────

export interface McpClientOptions {
  /**
   * Logical name for observability + tool-call routing. Surfaces in
   * Lens chips and event payloads. Defaults to `'mcp'`. Recommend
   * setting per-server (`'slack-mcp'`, `'github-mcp'`) when you
   * connect to multiple servers.
   */
  readonly name?: string;

  /** Transport configuration — stdio or http. */
  readonly transport: McpTransport;

  /**
   * Optional client identity sent on connect. Default:
   * `{ name: 'agentfootprint', version: <package version> }`.
   */
  readonly clientInfo?: { readonly name: string; readonly version: string };

  /** Abort the connection / list / call paths. Honored by the SDK. */
  readonly signal?: AbortSignal;

  /**
   * @internal Pre-built SDK client for tests. Skips SDK import +
   * transport construction. Same convention as `AnthropicProvider._client`.
   */
  readonly _client?: McpSdkClient;
}

// ─── Public client surface ─────────────────────────────────────────

/**
 * What `mcpClient(opts)` returns. Connect once; call `.tools()` to
 * snapshot the tool list, `.refresh()` to re-list after the server's
 * tools change, `.close()` when done.
 */
export interface McpClient {
  /** Logical name from options (or default `'mcp'`). */
  readonly name: string;

  /**
   * List the server's tools as agentfootprint `Tool[]`. First call
   * after `mcpClient(...)` is the snapshot used to register on the
   * agent; subsequent calls re-fetch (cheap, in-memory cached by the
   * SDK between fetches).
   */
  tools(): Promise<readonly Tool[]>;

  /**
   * Force a refresh from the server. Use when you suspect the server
   * has dynamically added/removed tools mid-session (e.g., after the
   * server processes a config update).
   */
  refresh(): Promise<readonly Tool[]>;

  /** Close the underlying transport. After `close()` the client is unusable. */
  close(): Promise<void>;
}

// ─── SDK shim — minimal surface we need from @modelcontextprotocol/sdk ──

/**
 * Minimal structural type capturing the parts of the MCP SDK client
 * we touch. Defined locally so we can:
 *   1. Inject a mock for tests (`McpClientOptions._client`)
 *   2. Avoid a hard import on `@modelcontextprotocol/sdk` (which is
 *      a lazy peer-dep)
 *
 * The real SDK exports a richer surface; we narrow to what's needed.
 *
 * Argument POSITION matters here and is easy to get wrong: the SDK keeps
 * per-request options (`signal`, `timeout`) in a SEPARATE trailing
 * argument, never inside the JSON-RPC params. A `signal` smuggled into
 * the params object is serialized onto the wire as `{}` and silently
 * fails to cancel anything, so these signatures mirror the SDK's own
 * shape rather than a flattened convenience version of it.
 */
export interface McpSdkClient {
  connect(transport: unknown, options?: McpRequestOptions): Promise<void>;
  listTools(
    params?: undefined,
    options?: McpRequestOptions,
  ): Promise<{
    readonly tools: ReadonlyArray<{
      readonly name: string;
      readonly description?: string;
      readonly inputSchema: Readonly<Record<string, unknown>>;
    }>;
  }>;
  callTool(
    params: {
      readonly name: string;
      readonly arguments?: Readonly<Record<string, unknown>>;
    },
    /** The SDK's result schema. We always want its default, so we pass `undefined`. */
    resultSchema?: undefined,
    options?: McpRequestOptions,
  ): Promise<{
    readonly content: ReadonlyArray<{
      readonly type: string;
      readonly text?: string;
    }>;
    readonly isError?: boolean;
  }>;
  close(): Promise<void>;
}

/**
 * The SDK's trailing per-request options argument, narrowed to the one
 * field we forward from {@link McpClientOptions.signal}.
 */
export interface McpRequestOptions {
  readonly signal?: AbortSignal;
}

// ─── Serving: the other direction ──────────────────────────────────

/**
 * `stdio` transport — the server speaks MCP over its own stdin/stdout.
 * This is how a desktop MCP host launches a server: it spawns your
 * process and talks down the pipe. The default.
 *
 * One consequence worth stating out loud: stdout belongs to the
 * protocol. Anything else your process prints there corrupts the
 * stream, so log to stderr.
 */
export interface McpStdioServeTransport {
  readonly transport: 'stdio';
}

/**
 * `http` transport — the server listens on a port and speaks MCP over
 * Streamable HTTP. Stateless (no session ids): every request is
 * self-contained, which is what makes it safe to run several replicas
 * behind a load balancer.
 */
export interface McpHttpServeTransport {
  readonly transport: 'http';
  /** TCP port to listen on. */
  readonly port: number;
  /** Interface to bind. Defaults to Node's own default (all interfaces). */
  readonly host?: string;
  /** URL path the MCP endpoint answers on. Default `'/mcp'`. */
  readonly path?: string;
}

export type McpServeTransport = McpStdioServeTransport | McpHttpServeTransport;

export interface McpServeOptions {
  /**
   * Server name reported to clients on connect. Surfaces in the
   * client's server list. Default `'agentfootprint'`.
   */
  readonly name?: string;
  /** Server version reported to clients. Default `'0.0.0'`. */
  readonly version?: string;
  /** Transport configuration. Default `{ transport: 'stdio' }`. */
  readonly transport?: McpServeTransport;
  /**
   * Credential provider for served tools that declare `needs`. The
   * credential is resolved BEFORE `execute` and injected as
   * `ctx.credential`, exactly as the Agent's tool-call stage does it.
   *
   * Serving a `needs`-declaring tool without this is refused at
   * construction: the tool would run with `ctx.credential` undefined
   * and fail somewhere further in, or worse, not fail at all.
   */
  readonly credentials?: import('../../identity/types.js').CredentialProvider;
  /**
   * @internal Pre-built SDK server for tests. Skips SDK import +
   * transport construction. Mirrors `McpClientOptions._client`.
   */
  readonly _server?: McpSdkServer;
}

/**
 * What `mcpServe(...)` returns. The server is already listening by the
 * time you hold this; `close()` is the only thing left to do.
 */
export interface McpServeHandle {
  /** Server name from options (or the default). */
  readonly name: string;
  /** Names of the tools being served, in the order clients will list them. */
  readonly toolNames: readonly string[];
  /**
   * Stop serving: closes the transport (and, for `http`, the listening
   * socket) and then the MCP server. Idempotent — calling it twice is
   * not an error, so a shutdown hook and an explicit close can coexist.
   */
  close(): Promise<void>;
}

/**
 * Minimal structural type for the parts of the MCP SDK's low-level
 * `Server` we touch. Defined locally for the same two reasons as
 * {@link McpSdkClient}: test injection via `McpServeOptions._server`,
 * and no hard import on the lazy peer-dep.
 */
export interface McpSdkServer {
  setRequestHandler(
    schema: unknown,
    handler: (request: McpCallToolRequest, extra: { readonly signal?: AbortSignal }) => unknown,
  ): void;
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
}

/**
 * The shape `tools/call` requests arrive in. `tools/list` requests carry
 * no params we read, so one request type covers both handlers.
 */
export interface McpCallToolRequest {
  readonly params?: {
    readonly name?: string;
    readonly arguments?: unknown;
  };
}
