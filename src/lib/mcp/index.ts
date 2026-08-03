/**
 * MCP — Model Context Protocol, both directions. `mcpClient` connects to
 * someone else's MCP server and registers its tools on your Agent;
 * `mcpServe` exposes your own tools AS an MCP server so any MCP client
 * can call them.
 */
export { mcpClient } from './mcpClient.js';
export { mcpServe } from './mcpServe.js';
export { mockMcpClient, type MockMcpClientOptions, type MockMcpTool } from './mockMcpClient.js';
export {
  gatewayTransport,
  GatewayAuthorizationRequiredError,
  type GatewayTransportOptions,
} from './gatewayTransport.js';
export type {
  McpClient,
  McpClientOptions,
  McpGatewayTransport,
  McpHttpTransport,
  McpStdioTransport,
  McpTransport,
  McpSdkClient,
  McpServeOptions,
  McpServeHandle,
  McpServeTransport,
  McpHttpServeTransport,
  McpStdioServeTransport,
  McpSdkServer,
} from './types.js';
