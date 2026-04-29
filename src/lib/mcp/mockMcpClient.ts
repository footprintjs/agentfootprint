/**
 * mockMcpClient — in-memory MCP client for development and tests.
 *
 *   const slack = mockMcpClient({
 *     tools: [
 *       {
 *         name: 'send_message',
 *         description: 'Post a message to a channel',
 *         inputSchema: { type: 'object' },
 *         handler: async ({ text }) => `Posted: ${text}`,
 *       },
 *     ],
 *   });
 *
 *   const agent = Agent.create({ provider: mock({ reply: 'ok' }) })
 *     .tools(await slack.tools())
 *     .build();
 *
 * Pattern: Adapter (GoF) — produces an `McpClient` with the same shape
 *          as `mcpClient(opts)` but driven by an in-memory tool table
 *          instead of the MCP SDK + transport. Drop-in for development:
 *          start with `mockMcpClient`, swap to `mcpClient` once the
 *          real server is ready.
 *
 * Why public: `mcpClient`'s `_client` injection is `@internal` because
 * the SDK shape isn't a stable public surface. `mockMcpClient` exposes
 * a curated tool-handler shape that's tied to OUR Tool contract instead
 * — stable, documented, and the right level of abstraction for
 * mock-first development.
 */

import type { Tool } from '../../core/tools.js';
import type { McpClient } from './types.js';

/** A scripted tool exposed by the mock MCP server. */
export interface MockMcpTool {
  /** Tool name as the LLM sees it. */
  readonly name: string;
  /** Description surfaced to the LLM via the tool schema. */
  readonly description?: string;
  /**
   * JSON-schema-like input schema. Passed through to the agent's tool
   * registry verbatim — same as a real MCP server's `listTools()`.
   */
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /**
   * Async handler that runs when the agent calls this tool. Receives
   * the args the LLM produced; returns the string result the agent
   * sees as the tool-result message.
   *
   * Defaults to `async () => '[mock result]'` when omitted — useful
   * when the consumer cares about wiring not behavior.
   */
  readonly handler?: (args: Record<string, unknown>) => Promise<string>;
}

export interface MockMcpClientOptions {
  /** Logical server name. Surfaces in observability + error messages. */
  readonly name?: string;
  /** Tools exposed by the mock server. */
  readonly tools: readonly MockMcpTool[];
}

/**
 * Build an in-memory `McpClient`. Useful when you want to develop
 * against MCP semantics without spawning subprocesses, hitting the
 * network, or installing `@modelcontextprotocol/sdk`. Same `McpClient`
 * shape as `mcpClient(opts)` — code that consumes one accepts the other.
 */
export function mockMcpClient(options: MockMcpClientOptions): McpClient {
  const name = options.name ?? 'mock-mcp';
  const toolMap = new Map<string, MockMcpTool>(options.tools.map((t) => [t.name, t]));

  let cache: readonly Tool[] | null = null;
  let closed = false;

  const ensureOpen = (op: string): void => {
    if (closed) {
      throw new Error(
        `mockMcpClient[${name}].${op}() called after close(). Construct a new client to reuse.`,
      );
    }
  };

  const buildTools = (): readonly Tool[] =>
    options.tools.map((mcp) => wrapMockTool(name, toolMap, mcp));

  return {
    name,
    async tools(): Promise<readonly Tool[]> {
      ensureOpen('tools');
      if (!cache) cache = buildTools();
      return cache;
    },
    async refresh(): Promise<readonly Tool[]> {
      ensureOpen('refresh');
      cache = buildTools();
      return cache;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      cache = null;
    },
  };
}

function wrapMockTool(
  serverName: string,
  toolMap: ReadonlyMap<string, MockMcpTool>,
  mcp: MockMcpTool,
): Tool {
  const tool: Tool = {
    schema: {
      name: mcp.name,
      description: mcp.description ?? `Mock MCP tool: ${mcp.name}`,
      inputSchema: mcp.inputSchema,
    },
    execute: async (args) => {
      const argsObj =
        args !== null && typeof args === 'object' && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      // Look up by name at call time so mid-test handler swaps via a
      // mutable Map could be supported later. For now `toolMap` is
      // built once at factory time.
      const handler = toolMap.get(mcp.name)?.handler;
      if (!handler) return '[mock result]';
      try {
        return await handler(argsObj);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Mock MCP tool '${mcp.name}' (server '${serverName}') threw: ${msg}`);
      }
    },
  };
  return tool;
}
