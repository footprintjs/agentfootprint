/**
 * MCP — Model Context Protocol client integration. Connect to an MCP
 * server, register its tools on your Agent. Server-side support is
 * separate (consumer exposes their agent as an MCP tool — different
 * use case, not yet shipped).
 */
export { mcpClient } from './mcpClient.js';
export { mockMcpClient, type MockMcpClientOptions, type MockMcpTool } from './mockMcpClient.js';
export type {
  McpClient,
  McpClientOptions,
  McpHttpTransport,
  McpStdioTransport,
  McpTransport,
  McpSdkClient,
} from './types.js';
