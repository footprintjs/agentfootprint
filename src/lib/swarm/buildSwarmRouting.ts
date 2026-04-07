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
 * **First-match dispatch:** Iterates toolCalls to find the first specialist or
 * extra tool match. That branch runs; remaining specialist calls get synthetic
 * "deferred" tool-results so the LLM sees a response for every tool_call ID.
 * Extra tools are all executed in one pass by the swarm-tools subflow.
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

/** Type guard: does the runner expose toFlowChart() for subflow composition? */
function hasFlowChart(runner: RunnerLike): runner is RunnerLike & { toFlowChart(): FlowChart } {
  return typeof (runner as unknown as Record<string, unknown>).toFlowChart === 'function';
}

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
  /** Structural tracking: IDs of specialists invoked during this run. */
  invokedSpecialists?: string[];
  /** Synthetic tool-results for non-dispatched tool calls (LLMs expect every tool_call to have a result). */
  skippedToolResults?: Array<{ content: string; toolCallId: string }>;
  /** Debug: set for unknown tool names or routing anomalies. */
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

/**
 * Build a RoutingConfig for Swarm specialist routing.
 *
 * Replaces the entire `buildSwarmLoop` — this function produces
 * just the routing strategy. The loop itself is built by `buildAgentLoop`.
 */
export function buildSwarmRouting(config: SwarmRoutingConfig): RoutingConfig {
  const { specialists, extraTools } = config;
  let fallbackIdCounter = 0; // Per-routing instance, not module-level
  const specialistIds = new Set(specialists.map((s) => s.id));
  const extraToolIds = new Set((extraTools ?? []).map((t) => t.id));

  // Validate: no specialist ID collides with extra tool ID
  for (const t of extraTools ?? []) {
    if (specialistIds.has(t.id)) {
      throw new Error(`Extra tool '${t.id}' collides with specialist ID. Use a different tool ID.`);
    }
  }

  // ── Decider ──────────────────────────────────────────────

  const MAX_MESSAGE_LEN = 100_000; // 100KB — prevents LLM-controlled DoS

  const decider = (scope: SwarmRoutingScope, _breakFn: () => void, _streamCb?: unknown): string => {
    const parsed = scope.parsedResponse;
    if (!parsed?.hasToolCalls || !parsed.toolCalls?.length) return 'final';

    // Find the first specialist or extra tool call (first-match semantics)
    let matchedIndex = -1;
    let matchedBranch = 'final';

    for (let i = 0; i < parsed.toolCalls.length; i++) {
      const toolCall = parsed.toolCalls[i];
      const toolName = toolCall.name;

      if (specialistIds.has(toolName)) {
        const args = toolCall.arguments as Record<string, unknown> | undefined;
        const rawMsg = args?.message;
        const msg = typeof rawMsg === 'string' ? rawMsg : '';
        scope.specialistMessage =
          msg.length > MAX_MESSAGE_LEN ? msg.slice(0, MAX_MESSAGE_LEN) : msg;
        scope.specialistToolCallId = toolCall.id;
        matchedIndex = i;
        matchedBranch = toolName;
        break;
      }

      if (extraToolIds.has(toolName)) {
        scope.specialistToolCallId = toolCall.id;
        matchedIndex = i;
        matchedBranch = 'swarm-tools';
        break;
      }
    }

    // Inject synthetic tool-results for non-dispatched tool calls.
    // LLMs expect every tool_call ID to have a matching tool_result.
    const skipped: Array<{ content: string; toolCallId: string }> = [];
    for (let i = 0; i < parsed.toolCalls.length; i++) {
      if (i === matchedIndex) continue;
      const tc = parsed.toolCalls[i];
      if (specialistIds.has(tc.name)) {
        skipped.push({
          content: 'Deferred — will be handled in next iteration.',
          toolCallId: tc.id,
        });
      } else if (!extraToolIds.has(tc.name)) {
        skipped.push({
          content: `Unknown tool: ${String(tc.name).slice(0, 100)}`,
          toolCallId: tc.id,
        });
      }
      // Extra tools in swarm-tools branch are handled by the subflow
    }
    if (skipped.length > 0) {
      scope.skippedToolResults = skipped;
    }

    if (matchedIndex === -1) {
      const unknownNames = parsed.toolCalls.map((tc) => String(tc.name).slice(0, 50)).join(', ');
      scope.routingWarning = `Unknown tool(s): ${unknownNames}`;
      return 'final';
    }

    return matchedBranch;
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
        if (hasFlowChart(specialist.runner)) {
          cachedChart = specialist.runner.toFlowChart();
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
          const toolCallId = String(
            parentScope.specialistToolCallId ?? `specialist-${++fallbackIdCounter}`,
          );
          const preview =
            resultContent.length > 120 ? resultContent.slice(0, 120) + '...' : resultContent;
          // Include synthetic results for skipped tool calls (LLMs expect every call to have a result)
          const skipped = (parentScope.skippedToolResults ?? []) as Array<{
            content: string;
            toolCallId: string;
          }>;
          const skippedMessages = skipped.map((s) => toolResultMessage(s.content, s.toolCallId));
          return {
            messages: [toolResultMessage(resultContent, toolCallId), ...skippedMessages],
            loopCount: ((parentScope.loopCount as number) ?? 0) + 1,
            specialistResult: preview,
            invokedSpecialists: [specialist.id],
          };
        },
      },
    });
  }

  // Swarm-tools branch — executes ALL extra tool calls from the response.
  // Uses a subflow so narrative/recorders see tool execution as structured events.
  if (extraTools && extraTools.length > 0) {
    const toolMap = new Map(extraTools.map((t) => [t.id, t]));

    interface SwarmToolState {
      parsedResponse: SwarmRoutingScope['parsedResponse'];
      toolResults: Array<{ content: string; toolCallId: string }>;
      [key: string]: unknown;
    }

    const swarmToolSubflow = flowChart<SwarmToolState>(
      'ExecuteSwarmTools',
      async (scope) => {
        const parsed = scope.parsedResponse;
        const toolCalls = parsed?.toolCalls ?? [];
        const results: Array<{ content: string; toolCallId: string }> = [];

        // Execute ALL extra tool calls sequentially
        for (const toolCall of toolCalls) {
          const tool = toolMap.get(toolCall.name);
          if (!tool) continue; // skip specialist calls and unknowns

          try {
            const result = await tool.handler(toolCall.arguments as Record<string, unknown>);
            results.push({ content: result.content, toolCallId: toolCall.id });
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            results.push({ content: `Error: ${errMsg}`, toolCallId: toolCall.id });
          }
        }

        scope.toolResults = results;
      },
      'execute-swarm-tools',
      undefined,
      'Execute all non-specialist tool calls',
    ).build();

    branches.push({
      id: 'swarm-tools',
      kind: 'subflow',
      name: 'ExecuteSwarmTools',
      chart: swarmToolSubflow,
      mount: {
        inputMapper: (parent: Record<string, unknown>) => ({
          parsedResponse: parent.parsedResponse,
        }),
        outputMapper: (sfOutput: Record<string, unknown>, parentScope: Record<string, unknown>) => {
          const results = (sfOutput.toolResults ?? []) as Array<{
            content: string;
            toolCallId: string;
          }>;
          // Delta: return all tool result messages for array concat
          return {
            messages: results.map((r) => toolResultMessage(r.content, r.toolCallId)),
            loopCount: ((parentScope.loopCount as number) ?? 0) + 1,
          };
        },
      },
    });
  }

  // Final branch
  branches.push({
    id: 'final',
    kind: 'fn',
    name: 'Finalize',
    fn: (scope: SwarmRoutingScope, breakFn: () => void) => {
      const messages = scope.messages ?? [];
      const lastAsst = lastAssistantMessage(messages);
      scope.result =
        (lastAsst ? getTextContent(lastAsst.content) : scope.parsedResponse?.content) ?? '';
      breakFn();
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
