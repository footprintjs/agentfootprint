/**
 * dynamicTools — resolver-only ToolProvider that resolves tools based on context.
 *
 * The resolver function receives the current ToolContext and returns
 * the tools available for this turn. Useful when:
 * - Different tools are available based on conversation state
 * - Tools are loaded from an external source (MCP, DB, API)
 * - Tool availability depends on user permissions
 *
 * This provider does NOT include `execute` — the core loop calls
 * `ToolDefinition.handler` directly from the resolved set. This avoids
 * stale cache issues and temporal coupling between resolve/execute.
 *
 * For providers where execution is remote (MCP, A2A), implement
 * `ToolProvider` directly with both `resolve` and `execute`.
 *
 * Usage:
 *   agentLoop().toolProvider(dynamicTools((ctx) => {
 *     if (ctx.message.includes('code')) return [runCodeTool];
 *     return [searchTool];
 *   }))
 */

import type { ToolProvider, ToolContext } from '../../core';
import type { ToolDefinition } from '../../types/tools';

export type ToolResolver = (context: ToolContext) => ToolDefinition[] | Promise<ToolDefinition[]>;

export function dynamicTools(resolver: ToolResolver): ToolProvider {
  return {
    resolve: async (context: ToolContext) => {
      const tools = await resolver(context);
      return tools.map((t) => ({
        name: t.id,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
    },
    // No execute — core loop uses ToolDefinition.handler from resolved set.
    // This avoids cache staleness. For remote execution, implement ToolProvider directly.
  };
}
