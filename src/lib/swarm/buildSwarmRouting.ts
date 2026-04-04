/**
 * buildSwarmRouting — Creates a RoutingConfig for Swarm specialist routing.
 *
 * Used by the Swarm builder to plug into buildAgentLoop. The Swarm routing
 * replaces the default Agent routing (tool-calls | final) with specialist
 * routing (specialist-A | specialist-B | swarm-tools | final).
 *
 * Each specialist is mounted as a lazy subflow branch — only built when selected.
 * Extra tools (non-specialist) get an inline function branch.
 *
 * **Single-dispatch:** Only `toolCalls[0]` is processed per iteration.
 * If the LLM returns multiple tool calls, only the first is routed;
 * remaining calls are dropped with a debug warning on scope.
 */

import { flowChart } from 'footprintjs';
import type { FlowChart, TypedScope } from 'footprintjs';
import { toolResultMessage } from '../../types';
import type { Message } from '../../types/messages';
import { getTextContent } from '../../types/content';
import { lastAssistantMessage } from '../../memory';
import type { RoutingConfig, RoutingBranch } from '../loop/types';
import type { RunnerLike } from '../../types/multiAgent';
import type { ToolDefinition } from '../../types/tools';

// ── Swarm Scope State ────────────────────────────────────────

/**
 * Scope fields used by Swarm routing.
 * Not the full AgentLoopState — only the fields the routing reads/writes.
 */
interface SwarmRoutingScope {
  parsedResponse?: {
    hasToolCalls: boolean;
    toolCalls: Array<{ id: string; name: string; arguments: unknown }>;
    content: string;
  };
  messages: Message[];
  loopCount: number;
  maxIterations: number;
  result?: string;
  /** Routing artifact: message text for the specialist. LLM-controlled — treat as untrusted. */
  specialistMessage?: string;
  /** Routing artifact: tool call ID for building the tool result message. */
  specialistToolCallId?: string;
  /** Narrative: truncated preview of specialist result. */
  specialistResult?: string;
  /** Debug: set when multiple tool calls are dropped. */
  routingWarning?: string;
  [key: string]: unknown;
}

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
}

// ── Builder ──────────────────────────────────────────────────

/** Counter for unique fallback IDs (avoids Date.now collision). */
let _fallbackIdCounter = 0;

/**
 * Build a RoutingConfig for Swarm specialist routing.
 *
 * Replaces the entire `buildSwarmLoop` — this function produces
 * just the routing strategy. The loop itself is built by `buildAgentLoop`.
 */
export function buildSwarmRouting(config: SwarmRoutingConfig): RoutingConfig {
  const { specialists, extraTools } = config;
  const specialistIds = new Set(specialists.map((s) => s.id));
  const extraToolIds = new Set((extraTools ?? []).map((t) => t.id));

  // Validate: no specialist ID collides with extra tool ID
  for (const t of extraTools ?? []) {
    if (specialistIds.has(t.id)) {
      throw new Error(`Extra tool '${t.id}' collides with specialist ID. Use a different tool ID.`);
    }
  }

  // ── Decider ──────────────────────────────────────────────

  const decider = (scope: SwarmRoutingScope): string => {
    const parsed = scope.parsedResponse;
    if (!parsed?.hasToolCalls || !parsed.toolCalls?.length) return 'final';

    // Single-dispatch: only toolCalls[0] is processed per iteration
    if (parsed.toolCalls.length > 1) {
      scope.routingWarning = `Swarm processes one tool call per iteration. ${parsed.toolCalls.length - 1} additional call(s) dropped.`;
    }

    const toolCall = parsed.toolCalls[0];
    const toolName = toolCall.name;

    if (specialistIds.has(toolName)) {
      // Extract specialist message — validate it's a string (LLM-controlled, untrusted)
      const args = toolCall.arguments as Record<string, unknown> | undefined;
      const rawMsg = args?.message;
      scope.specialistMessage = typeof rawMsg === 'string' ? rawMsg : '';
      scope.specialistToolCallId = toolCall.id;
      return toolName;
    }

    if (extraToolIds.has(toolName)) {
      scope.specialistToolCallId = toolCall.id;
      return 'swarm-tools';
    }

    // Unknown tool name — route to final with warning
    scope.routingWarning = `Unknown tool '${String(toolName).slice(0, 100)}' — routing to final.`;
    return 'final';
  };

  // ── Branches ─────────────────────────────────────────────

  const branches: RoutingBranch[] = [];

  // Specialist branches — each as a lazy subflow (cached)
  for (const specialist of specialists) {
    let cachedChart: FlowChart | undefined;

    branches.push({
      id: specialist.id,
      kind: 'lazy-subflow',
      name: specialist.id,
      factory: () => {
        if (cachedChart) return cachedChart;

        // Use specialist's own flowchart if available (for BTS drill-down)
        if (typeof (specialist.runner as any).toFlowChart === 'function') {
          cachedChart = (specialist.runner as RunnerLike & { toFlowChart: () => FlowChart }).toFlowChart();
          return cachedChart;
        }

        // Fallback: wrap runner.run() in a single-stage flowchart
        cachedChart = flowChart(
          specialist.id,
          async (scope: TypedScope<{ message: string; result: string }>) => {
            const res = await specialist.runner.run(scope.message ?? '');
            scope.result = res.content;
          },
          `${specialist.id}-run`,
          undefined,
          `Execute ${specialist.id} specialist`,
        ).build();
        return cachedChart;
      },
      mount: {
        inputMapper: (parent: Record<string, unknown>) => ({
          message: parent.specialistMessage ?? '',
        }),
        outputMapper: (sfOutput: Record<string, unknown>, parentScope: Record<string, unknown>) => {
          const resultContent = String(sfOutput.result ?? sfOutput.content ?? '');
          const toolCallId = String(parentScope.specialistToolCallId ?? `specialist-${++_fallbackIdCounter}`);
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
      fn: async (scope: SwarmRoutingScope) => {
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
    fn: (scope: SwarmRoutingScope) => {
      const messages = scope.messages ?? [];
      const lastAsst = lastAssistantMessage(messages);
      scope.result = (lastAsst ? getTextContent(lastAsst.content) : scope.parsedResponse?.content) ?? '';
      (scope as any).$break();
    },
    description: 'Extract final answer and stop the swarm loop',
  });

  return {
    deciderName: 'RouteSpecialist',
    deciderId: 'route-specialist',
    deciderDescription: 'Route to the specialist the LLM selected, or finalize',
    decider: decider as any, // SAFETY: RoutingConfig.decider accepts (scope: any) => string
    branches,
    defaultBranch: 'final',
  };
}
