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
// Who may send a tool call again — the app's declaration for one server
// (`mcpClient({ replay })`), read once when the client is built.
export type {
  McpReplayDeduplication,
  McpReplayKind,
  McpReplayOptions,
  McpReplayPolicy,
  McpReplayTool,
} from './replay.js';
// A call under 'app-authorized' that a connection cannot honour is refused
// before it is sent, with a typed reason.
export { McpReplayUnavailableError, type McpReplayUnavailableReason } from './replayUnavailable.js';
// A tool list that could not be read to its end (past 100 requests, or a cursor
// sent twice) is refused with this error and a typed reason, never cut short.
export { McpToolListIncompleteError, type McpToolListIncompleteReason } from './toolList.js';
// An earlier page's tool whose output this connection cannot check — no JSON
// Schema validator reachable — is refused before it is sent.
export { McpOutputUncheckedError } from './callChecks.js';
export type {
  McpCallToolResult,
  McpClient,
  McpClientOptions,
  McpConnection,
  McpConnectionOptions,
  McpJsonSchemaValidator,
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
