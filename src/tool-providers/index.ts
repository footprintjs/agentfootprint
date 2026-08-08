/**
 * tool-providers — chainable tool dispatch + tool sources.
 *
 * Two layers under one subpath:
 *
 * 1. Tool dispatch (this folder)
 *    - `staticTools(arr)` — wrap a flat tool list
 *    - `gatedTools(inner, predicate)` — decorator that filters
 *    - `ToolProvider` interface — the contract
 *    - `ToolDispatchContext` — read-only context per iteration
 *
 * 2. Tool sources (re-exported from existing modules)
 *    - `mcpClient(opts)` — connect to an MCP server (real)
 *    - `mockMcpClient({ tools })` — in-memory MCP source for dev / tests
 *    - `gatewayTransport({ url, credentials, service })` — an MCP
 *      transport whose auth headers are vended PER REQUEST by a
 *      `CredentialProvider`, for endpoints behind a token with an
 *      expiry. The token is used once and never stored.
 *
 * 3. Tool sink — the other direction
 *    - `mcpServe(tools, opts)` — expose your own `Tool[]` AS an MCP
 *      server, so any MCP client can call them. The served tool is the
 *      SAME object you pass in, so whatever governance you composed
 *      around it still runs.
 *
 * Compose freely. The dispatch layer is decorator-shaped (mirroring
 * `withRetry` / `withFallback` over LLMProvider). Tool sources produce
 * `Tool[]` that flow into a `staticTools(arr)` provider, which can
 * then be wrapped by `gatedTools(...)` for permission gating or
 * per-skill filtering.
 *
 * @example  Static (90% case — what `agent.tools(arr)` does today)
 *   const provider = staticTools([weatherTool, lookupTool]);
 *
 * @example  Read-only enforcement
 *   const readOnly = gatedTools(
 *     staticTools(allTools),
 *     (name) => policy.isAllowed(name),
 *   );
 *
 * @example  MCP source + permission gate
 *   const slack = await mcpClient({ transport: ... });
 *   const slackTools = await slack.tools();
 *   const provider = gatedTools(staticTools(slackTools), (name) => allowed(name));
 *
 * Not an import path of its own since 9.0.0. This is the implementation barrel
 * behind `agentfootprint/providers`, which re-exports every name here — same
 * symbols, one door. Import from the door.
 */

export { staticTools } from './staticTools.js';
export { gatedTools } from './gatedTools.js';
export {
  skillScopedTools,
  // 8.7.0 — the provider-id convention, readable by anyone composing providers (and
  // by the agent builder, which uses it to name a redundant pairing at build time).
  skillScopedToolsTarget,
  SKILL_SCOPED_TOOLS_ID_PREFIX,
} from './skillScopedTools.js';
export type { ToolProvider, ToolDispatchContext, ToolGatePredicate } from './types.js';

// Re-export tool sources from the MCP module so consumers find them in
// one place. This subpath is the ONLY place `mcpClient` is public — the
// top-level barrel does not re-export it.
export {
  mcpClient,
  mcpServe,
  mockMcpClient,
  gatewayTransport,
  GatewayAuthorizationRequiredError,
} from '../lib/mcp/index.js';
export type {
  GatewayTransportOptions,
  McpCallToolResult,
  McpClient,
  McpClientOptions,
  McpSdkClient,
  McpTransport,
  McpStdioTransport,
  McpHttpTransport,
  McpGatewayTransport,
  MockMcpClientOptions,
  MockMcpTool,
  McpServeOptions,
  McpServeHandle,
  McpServeTransport,
  McpStdioServeTransport,
  McpHttpServeTransport,
  McpSdkServer,
} from '../lib/mcp/index.js';
