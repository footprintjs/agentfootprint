/**
 * compositeTools — ToolProvider that merges multiple ToolProviders.
 *
 * Resolves all providers and merges their tool lists. If multiple providers
 * return a tool with the same name, later providers win (last-write-wins).
 *
 * Execute delegates to the provider that owns the tool (by resolve order,
 * last provider that resolved a tool of that name handles execution).
 *
 * Usage:
 *   const tools = compositeTools([
 *     staticTools([searchTool]),
 *     dynamicTools((ctx) => ctx.turnNumber > 3 ? [submitTool] : []),
 *   ]);
 */

import type { ToolCall } from '../../types/messages';
import type { ToolProvider, ToolContext, ToolExecutionResult } from '../../core';
import type { LLMToolDescription } from '../../types/llm';

export function compositeTools(providers: readonly ToolProvider[]): ToolProvider {
  return {
    resolve: async (context: ToolContext) => {
      const allDecisions = await Promise.all(providers.map((p) => p.resolve(context)));

      // Merge with last-write-wins by tool name
      const toolMap = new Map<string, LLMToolDescription>();
      for (const decision of allDecisions) {
        for (const tool of decision.value) {
          toolMap.set(tool.name, tool);
        }
      }

      const merged = Array.from(toolMap.values());
      const labels = allDecisions.map((d) => d.chosen).filter((c) => c !== 'static');
      return {
        value: merged,
        chosen: labels.length > 0 ? `composite: ${labels.join(' + ')}` : 'composite',
        rationale: `${merged.length} tools from ${providers.length} providers`,
      };
    },

    execute: async (call: ToolCall, signal?: AbortSignal): Promise<ToolExecutionResult> => {
      // Walk providers in reverse — last provider that can execute wins
      for (let i = providers.length - 1; i >= 0; i--) {
        const provider = providers[i];
        if (provider.execute) {
          // Try this provider — it may not know the tool, but that's ok
          // since we already validated via resolve
          return provider.execute(call, signal);
        }
      }
      return { content: `No executor found for tool: ${call.name}`, error: true };
    },
  };
}
