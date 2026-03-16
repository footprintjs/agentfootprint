/**
 * staticTools — ToolProvider with a fixed list of tools.
 *
 * The simplest tool provider. Same tools available every turn.
 * Resolves from a flat list of ToolDefinition objects and executes
 * by calling the handler directly.
 *
 * Usage:
 *   agentLoop().toolProvider(staticTools([searchTool, calcTool]))
 */

import type { ToolCall } from '../../types/messages';
import type { ToolProvider, ToolExecutionResult } from '../../core';
import type { ToolDefinition } from '../../types/tools';

export function staticTools(tools: ToolDefinition[]): ToolProvider {
  const toolMap = new Map(tools.map((t) => [t.id, t]));

  return {
    resolve: () =>
      tools.map((t) => ({
        name: t.id,
        description: t.description,
        inputSchema: t.inputSchema,
      })),

    execute: async (call: ToolCall): Promise<ToolExecutionResult> => {
      const tool = toolMap.get(call.name);
      if (!tool) {
        return { content: `Unknown tool: ${call.name}`, error: true };
      }
      return tool.handler(call.arguments);
    },
  };
}
