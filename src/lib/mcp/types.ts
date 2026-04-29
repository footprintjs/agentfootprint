/**
 * MCP — Model Context Protocol client integration.
 *
 * MCP (https://modelcontextprotocol.io) is an open standard for
 * connecting LLMs to external tools and data sources. agentfootprint's
 * MCP adapter is **client-only** — it consumes MCP servers and exposes
 * their tools as agentfootprint `Tool[]` so consumers can plug them
 * straight into `agent.tool(...)`.
 *
 * Pattern: Adapter (GoF) — translates MCP wire format ↔ agentfootprint
 *          `Tool` interface. The MCP SDK does the protocol work; we
 *          just bridge.
 * Role:    Layer-3 tool integration. Pairs with `defineTool` (the
 *          inline alternative for non-MCP tools).
 * Emits:   N/A directly — wrapped tools emit the standard
 *          `agentfootprint.stream.tool_start` / `tool_end` events
 *          when the agent calls them.
 *
 * Server-side support (exposing an agent or LLMCall as an MCP tool)
 * is a separate concern not yet shipped. This module covers the
 * 80% case: pulling an existing MCP server's tools INTO an agent.
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
  /** Optional env vars set on the subprocess. */
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
 */
export interface McpSdkClient {
  connect(transport: unknown): Promise<void>;
  listTools(): Promise<{
    readonly tools: ReadonlyArray<{
      readonly name: string;
      readonly description?: string;
      readonly inputSchema: Readonly<Record<string, unknown>>;
    }>;
  }>;
  callTool(args: {
    readonly name: string;
    readonly arguments?: Readonly<Record<string, unknown>>;
  }): Promise<{
    readonly content: ReadonlyArray<{
      readonly type: string;
      readonly text?: string;
    }>;
    readonly isError?: boolean;
  }>;
  close(): Promise<void>;
}
