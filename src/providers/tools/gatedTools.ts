/**
 * gatedTools — Permission-based tool filtering with defense in depth.
 *
 * Wraps any ToolProvider to filter tools based on a permission check.
 * Two layers of enforcement:
 *   1. resolve() — blocked tools are hidden from LLM (it never sees them)
 *   2. execute() — if LLM somehow calls a blocked tool, returns error
 *
 * The permission check runs every loop iteration (per-turn), so permissions
 * can change mid-conversation (e.g., user grants access after auth step).
 *
 * Narrative integration: blocked execution returns an error result that
 * flows through the normal tool result path → recorders see it via
 * onToolCall, LLM sees it in conversation history and can respond.
 *
 * Optional onBlocked callback for observability (logging, metrics).
 *
 * Usage:
 *   // Static permission set
 *   const tools = gatedTools(
 *     staticTools([searchTool, adminTool, codeTool]),
 *     (toolId) => userPermissions.has(toolId),
 *   );
 *
 *   // Context-aware (per-turn)
 *   const tools = gatedTools(
 *     staticTools(allTools),
 *     (toolId, ctx) => {
 *       if (ctx.turnNumber > 5) return false; // rate limit
 *       return allowedTools.has(toolId);
 *     },
 *   );
 *
 *   // With observability
 *   const tools = gatedTools(
 *     staticTools(allTools),
 *     (toolId) => permissions.has(toolId),
 *     { onBlocked: (toolId, phase) => console.log(`Blocked ${toolId} at ${phase}`) },
 *   );
 */

import type { ToolCall } from '../../types/messages';
import type { ToolProvider, ToolContext, ToolExecutionResult } from '../../core';
import type { LLMToolDescription } from '../../types/llm';

/**
 * Permission checker — called for each tool on each turn.
 * Return true to allow, false to block.
 */
export type PermissionChecker = (toolId: string, context: ToolContext) => boolean | Promise<boolean>;

export interface GatedToolsOptions {
  /** Called when a tool is blocked (at resolve or execute phase). For logging/metrics. */
  onBlocked?: (toolId: string, phase: 'resolve' | 'execute', context?: ToolContext) => void;
}

export function gatedTools(
  inner: ToolProvider,
  isAllowed: PermissionChecker,
  options?: GatedToolsOptions,
): ToolProvider {
  // Track the last ToolContext for use in execute() which doesn't receive it
  let lastContext: ToolContext | undefined;

  return {
    resolve: async (context: ToolContext) => {
      lastContext = context;
      const innerDecision = await inner.resolve(context);

      // Filter: only return tools the user has permission for
      const allowed: LLMToolDescription[] = [];
      const blocked: string[] = [];
      for (const tool of innerDecision.value) {
        const permitted = await isAllowed(tool.name, context);
        if (permitted) {
          allowed.push(tool);
        } else {
          blocked.push(tool.name);
          options?.onBlocked?.(tool.name, 'resolve', context);
        }
      }
      return {
        value: allowed,
        chosen: blocked.length > 0 ? 'gated' : innerDecision.chosen,
        rationale: blocked.length > 0
          ? `${allowed.length} allowed, ${blocked.length} blocked: ${blocked.join(', ')}`
          : innerDecision.rationale,
      };
    },

    execute: inner.execute
      ? async (call: ToolCall, signal?: AbortSignal): Promise<ToolExecutionResult> => {
          // Defense in depth: check permission even at execute time
          // (in case LLM hallucinates a tool name that was filtered from resolve)
          const ctx = lastContext ?? ({ message: '', turnNumber: 0, loopIteration: 0, messages: [] } as ToolContext);
          const permitted = await isAllowed(call.name, ctx);

          if (!permitted) {
            options?.onBlocked?.(call.name, 'execute', ctx);
            // This error flows into conversation history — LLM sees it
            // and recorders capture it via onToolCall
            return {
              content: `Permission denied: tool "${call.name}" is not available. ` +
                `Available tools are listed in the system prompt.`,
              error: true,
            };
          }

          return inner.execute!(call, signal);
        }
      : undefined,
  };
}
