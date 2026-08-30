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
// The 429 handling `mcpClient({ transport })` applies for you — public since
// 9.81.0 so the `connection` arm, which builds no transport of its own, can
// apply the SAME implementation instead of silently going without it.
export { retryingFetch } from './throttleRetry.js';
export type {
  RetryOnThrottle,
  ThrottleFetch,
  ThrottleRetryInfo,
  ThrottleRetryOptions,
} from './throttleRetry.js';
export type {
  McpCallToolResult,
  McpClient,
  McpClientOptions,
  McpConnection,
  McpConnectionOptions,
  McpSdk,
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
