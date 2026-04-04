/**
 * buildSwarmRouting — Creates a RoutingConfig for Swarm specialist routing.
 *
 * Used by the Swarm builder to plug into buildAgentLoop. The Swarm routing
 * replaces the default Agent routing (tool-calls | final) with specialist
 * routing (specialist-A | specialist-B | swarm-tools | final).
 *
 * Each specialist is mounted as a lazy subflow branch — only built when selected.
 * Extra tools (non-specialist) get an inline function branch.
 */

import { flowChart } from 'footprintjs';
import type { FlowChart, TypedScope } from 'footprintjs';
import { toolResultMessage } from '../../types';
import { getTextContent } from '../../types/content';
import { lastAssistantMessage } from '../../memory';
import type { RoutingConfig, RoutingBranch } from '../loop/types';
import type { RunnerLike } from '../../types/multiAgent';
import type { ToolDefinition } from '../../types/tools';

// ── Config ───────────────────────────────────────────────────

export interface SwarmSpecialist {
  readonly id: string;
  readonly description: string;
  readonly runner: RunnerLike;
}

export interface SwarmRoutingConfig {
  readonly specialists: readonly SwarmSpecialist[];
  /** Extra tools available to the orchestrator (calculator, search, etc). */
  readonly extraTools?: readonly ToolDefinition[];
  /** The original user message — fallback for specialist message. */
  readonly seedMessage: string;
}

// ── Builder ──────────────────────────────────────────────────

/**
 * Build a RoutingConfig for Swarm specialist routing.
 *
 * Replaces the entire `buildSwarmLoop` — this function produces
 * just the routing strategy. The loop itself is built by `buildAgentLoop`.
 */
export function buildSwarmRouting(config: SwarmRoutingConfig): RoutingConfig {
  const { specialists, extraTools, seedMessage } = config;
  const specialistIds = new Set(specialists.map((s) => s.id));
  const extraToolIds = new Set((extraTools ?? []).map((t) => t.id));

  // ── Decider ──────────────────────────────────────────────

  const decider = (scope: any): string => {
    const parsed = scope.parsedResponse;
    if (!parsed?.hasToolCalls || !parsed.toolCalls?.length) return 'final';

    const toolCall = parsed.toolCalls[0];
    const toolName = toolCall.name;

    if (specialistIds.has(toolName)) {
      // Write routing artifacts for specialist inputMapper
      scope.specialistMessage = (toolCall.arguments as Record<string, unknown>)?.message ?? seedMessage;
      scope.specialistToolCallId = toolCall.id;
      return toolName;
    }

    if (extraToolIds.has(toolName)) {
      scope.specialistToolCallId = toolCall.id;
      return 'swarm-tools';
    }

    return 'final';
  };

  // ── Branches ─────────────────────────────────────────────

  const branches: RoutingBranch[] = [];

  // Specialist branches — each as a lazy subflow
  for (const specialist of specialists) {
    branches.push({
      id: specialist.id,
      kind: 'lazy-subflow',
      name: specialist.id,
      factory: () => {
        const runner = specialist.runner as RunnerLike & { toFlowChart?: () => FlowChart };
        if (runner.toFlowChart) {
          return runner.toFlowChart();
        }
        // Fallback: wrap runner.run() in a single-stage flowchart
        return flowChart(
          specialist.id,
          async (scope: TypedScope<{ message: string; result: string }>) => {
            const res = await specialist.runner.run(scope.message ?? '');
            scope.result = res.content;
          },
          `${specialist.id}-run`,
          undefined,
          `Execute ${specialist.id} specialist`,
        ).build();
      },
      mount: {
        inputMapper: (parent: Record<string, unknown>) => ({
          message: parent.specialistMessage ?? seedMessage,
        }),
        outputMapper: (sfOutput: Record<string, unknown>, parentScope: Record<string, unknown>) => {
          const resultContent = (sfOutput.result as string) ?? (sfOutput.content as string) ?? '';
          const toolCallId = (parentScope.specialistToolCallId as string) ?? `specialist-${Date.now()}`;
          const preview = resultContent.length > 120 ? resultContent.slice(0, 120) + '...' : resultContent;
          return {
            messages: [toolResultMessage(resultContent, toolCallId)],
            loopCount: ((parentScope.loopCount as number) ?? 0) + 1,
            specialistResult: preview,
          };
        },
      },
    });
  }

  // Swarm-tools branch — inline execution for non-specialist tools
  if (extraTools && extraTools.length > 0) {
    const toolMap = new Map(extraTools.map((t) => [t.id, t]));
    branches.push({
      id: 'swarm-tools',
      kind: 'fn',
      name: 'ExecuteSwarmTool',
      fn: async (scope: any) => {
        const parsed = scope.parsedResponse;
        const toolCall = parsed?.toolCalls?.[0];
        if (!toolCall) return;

        const tool = toolMap.get(toolCall.name);
        if (!tool) return;

        try {
          const result = await tool.handler(toolCall.arguments as Record<string, unknown>);
          const messages = scope.messages ?? [];
          scope.messages = [...messages, toolResultMessage(result.content, toolCall.id)];
        } catch (err: unknown) {
          const messages = scope.messages ?? [];
          const errMsg = err instanceof Error ? err.message : String(err);
          scope.messages = [...messages, toolResultMessage(`Error: ${errMsg}`, toolCall.id)];
        }
        scope.loopCount = (scope.loopCount ?? 0) + 1;
      },
      description: 'Execute non-specialist tool and append result',
    });
  }

  // Final branch
  branches.push({
    id: 'final',
    kind: 'fn',
    name: 'Finalize',
    fn: (scope: any) => {
      const messages = (scope.messages ?? []) as any[];
      const lastAsst = lastAssistantMessage(messages);
      scope.result = (lastAsst ? getTextContent(lastAsst.content) : scope.parsedResponse?.content) ?? '';
      scope.$break();
    },
    description: 'Extract final answer and stop the swarm loop',
  });

  return {
    deciderName: 'RouteSpecialist',
    deciderId: 'route-specialist',
    deciderDescription: 'Route to the specialist the LLM selected, or finalize',
    decider,
    branches,
    defaultBranch: 'final',
  };
}
