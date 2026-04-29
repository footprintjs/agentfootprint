/**
 * agentfootprint/tool-providers — chainable tool dispatch + tool sources.
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
 */

export { staticTools } from './staticTools.js';
export { gatedTools } from './gatedTools.js';
export type {
  ToolProvider,
  ToolDispatchContext,
  ToolGatePredicate,
} from './types.js';

// Re-export tool sources from the MCP module so consumers find them in
// one place. The top-level barrel still exports `mcpClient` for v2.2
// back-compat.
export { mcpClient, mockMcpClient } from '../lib/mcp/index.js';
export type {
  McpClient,
  McpClientOptions,
  McpTransport,
  McpStdioTransport,
  McpHttpTransport,
  MockMcpClientOptions,
  MockMcpTool,
} from '../lib/mcp/index.js';
