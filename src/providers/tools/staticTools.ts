/**
 * staticTools — ToolProvider with a fixed list of tools.
 */

import type { ToolCall } from '../../types/messages';
import type { ToolProvider, ToolExecutionResult } from '../../core';
import type { ToolDefinition } from '../../types/tools';

export function staticTools(tools: ToolDefinition[]): ToolProvider {
  const toolMap = new Map(tools.map((t) => [t.id, t]));

  return {
    resolve: () => ({
      value: tools.map((t) => ({
        name: t.id,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
      chosen: 'static',
      rationale: `${tools.length} tool${tools.length !== 1 ? 's' : ''}`,
    }),

    execute: async (call: ToolCall): Promise<ToolExecutionResult> => {
      const tool = toolMap.get(call.name);
      if (!tool) {
        return { content: `Unknown tool: ${call.name}`, error: true };
      }
      return tool.handler(call.arguments);
    },
  };
}
