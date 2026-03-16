/**
 * mcpToolProvider — wraps an MCP server as a ToolProvider.
 *
 * MCP (Model Context Protocol) exposes tools from external servers.
 * This adapter bridges MCP's tool interface to agentfootprint's ToolProvider,
 * enabling agents to use MCP tools without knowing the protocol.
 *
 * The adapter accepts an MCPClient interface (transport-agnostic).
 * Users provide their own MCP client implementation — this adapter
 * only handles the ToolProvider mapping.
 *
 * Usage:
 *   const tools = mcpToolProvider({ client: myMcpClient });
 *   const agent = Agent.create({ provider }).build();
 *   // Agent can now call MCP tools
 */

import type { ToolCall } from '../../types/messages';
import type { ToolProvider, ToolExecutionResult } from '../../core';
import type { LLMToolDescription } from '../../types/llm';

// ── MCP Client Interface ─────────────────────────────────────

/** Minimal MCP client interface. Users bring their own implementation. */
export interface MCPClient {
  /** List available tools from the MCP server. */
  listTools(): Promise<MCPToolInfo[]>;
  /** Call a tool on the MCP server. */
  callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult>;
}

export interface MCPToolInfo {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
}

export interface MCPToolResult {
  readonly content: string;
  readonly isError?: boolean;
}

// ── Provider ─────────────────────────────────────────────────

export interface MCPToolProviderOptions {
  /** MCP client instance. */
  readonly client: MCPClient;
  /** Optional prefix for tool names to avoid collisions. */
  readonly prefix?: string;
}

export function mcpToolProvider(options: MCPToolProviderOptions): ToolProvider {
  const { client, prefix = '' } = options;

  return {
    resolve: async (): Promise<LLMToolDescription[]> => {
      const tools = await client.listTools();
      return tools.map((t) => ({
        name: prefix + t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema ?? {},
      }));
    },

    execute: async (call: ToolCall, _signal?: AbortSignal): Promise<ToolExecutionResult> => {
      // Strip prefix to get original tool name
      const toolName = prefix ? call.name.slice(prefix.length) : call.name;
      const result = await client.callTool(toolName, call.arguments);
      return {
        content: result.content,
        error: result.isError,
      };
    },
  };
}
