/**
 * MCP — Model Context Protocol, both directions. `mcpClient` connects to
 * someone else's MCP server and registers its tools on your Agent;
 * `mcpServe` exposes your own tools AS an MCP server so any MCP client
 * can call them.
 */
export { mcpClient } from './mcpClient.js';
export { mcpServe } from './mcpServe.js';
// The declaration bag both directions speak (9.71.0) — one namespaced `_meta`
// key, and the shape a non-agentfootprint server writes to be understood.
export { MCP_TOOL_EXTRAS_KEY, type McpToolExtras } from './toolExtras.js';
export { mockMcpClient, type MockMcpClientOptions, type MockMcpTool } from './mockMcpClient.js';
export {
  gatewayTransport,
  GatewayAuthorizationRequiredError,
  type GatewayTransportOptions,
} from './gatewayTransport.js';
export type { RetryOnThrottle, ThrottleRetryInfo, ThrottleRetryOptions } from './throttleRetry.js';
export type {
  McpCallToolResult,
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
