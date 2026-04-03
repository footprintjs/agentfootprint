/**
 * Swarm loop assembler — builds a ReAct loop with specialist lazy subflows.
 *
 * Same structure as Agent loop (buildAgentLoop) but the RouteResponse decider
 * has one branch per specialist instead of a single 'tool-calls' branch.
 * Each specialist runs as a lazy subflow — visible in BTS with drill-down.
 *
 * Flowchart:
 *   Seed → AssemblePrompt → CallLLM → ParseResponse
 *     → RouteSpecialist(decider)
 *         ├── 'coding'  → lazy subflow (coding.toFlowChart())
 *         ├── 'writing' → lazy subflow (writing.toFlowChart())
 *         └── 'final'   → Finalize ($break)
 *     → loopTo('call-llm')
 *
 * After a specialist subflow runs, its result maps back as a tool result
 * message (delta pattern) and the loop continues to CallLLM. The orchestrator
 * LLM sees the specialist's result and can call another specialist or finalize.
 */

import { flowChart } from 'footprintjs';
import type { FlowChart, TypedScope } from 'footprintjs';
import type { LLMProvider, LLMToolDescription, Message, ToolCall } from '../../types';
import { systemMessage, userMessage, assistantMessage, toolResultMessage } from '../../types';
import { createCallLLMStage } from '../../stages/callLLM';
import type { RunnerLike } from '../../types/multiAgent';

// ── State ───────────────────────────────────────────────────

interface SwarmLoopState {
  messages: Message[];
  systemPrompt?: string;
  toolDescriptions?: LLMToolDescription[];
  parsedResponse?: {
    hasToolCalls: boolean;
    toolCalls: ToolCall[];
    content: string;
  };
  loopCount: number;
  maxIterations: number;
  result?: string;
  /** The message extracted from the tool call to pass to the specialist. */
  specialistMessage?: string;
  /** The tool call ID for the specialist invocation (for tool result message). */
  specialistToolCallId?: string;
  [key: string]: unknown;
}

// ── Config ──────────────────────────────────────────────────

export interface SwarmSpecialist {
  readonly id: string;
  readonly description: string;
  readonly runner: RunnerLike;
}

export interface SwarmLoopConfig {
  readonly provider: LLMProvider;
  readonly systemPrompt?: string;
  readonly specialists: readonly SwarmSpecialist[];
  readonly maxIterations?: number;
}

export interface SwarmLoopSeed {
  readonly message: string;
}

// ── Builder ─────────────────────────────────────────────────

export function buildSwarmLoop(
  config: SwarmLoopConfig,
  seed: SwarmLoopSeed,
  options?: { captureSpec: true },
): { chart: FlowChart; spec?: unknown } {
  const { provider, systemPrompt, specialists } = config;
  const maxIterations = config.maxIterations ?? 10;

  // Build tool descriptions for the LLM — each specialist appears as a callable tool
  const toolDescs: LLMToolDescription[] = specialists.map((s) => ({
    name: s.id,
    description: s.description,
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The task or question to delegate to this specialist.' },
      },
      required: ['message'],
    },
  }));

  const callLLM = createCallLLMStage(provider);

  // ── Seed ──────────────────────────────────────────────────

  let builder = flowChart<SwarmLoopState>(
    'Seed',
    (scope) => {
      const msgs: Message[] = [];
      if (systemPrompt) {
        const specialistList = specialists
          .map((s) => `- ${s.id}: ${s.description}`)
          .join('\n');
        msgs.push(systemMessage(
          `${systemPrompt}\n\nYou have access to these specialist agents:\n${specialistList}\n\nCall the most appropriate specialist to handle the user's request. When done, respond directly without calling any specialist.`,
        ));
      }
      msgs.push(userMessage(seed.message));
      scope.messages = msgs;
      scope.toolDescriptions = toolDescs;
      scope.loopCount = 0;
      scope.maxIterations = maxIterations;
    },
    'seed',
    undefined,
    'Initialize swarm with specialist descriptions',
  );

  // ── AssemblePrompt (no-op for swarm — system prompt already in messages) ──

  // ── CallLLM → ParseResponse ───────────────────────────────

  builder = builder
    .addFunction('CallLLM', callLLM as any, 'call-llm', 'Send messages + specialist tools to LLM')
    .addFunction(
      'ParseResponse',
      (scope: TypedScope<SwarmLoopState>) => {
        const result = scope.adapterResult as any;
        if (!result) throw new Error('ParseResponse: no adapter result');
        if (result.type === 'error') throw new Error(`LLM error: [${result.code}] ${result.message}`);

        const parsed = {
          hasToolCalls: result.type === 'tools',
          toolCalls: result.type === 'tools' ? result.toolCalls : [],
          content: result.content ?? '',
        };
        scope.parsedResponse = parsed;

        // Append assistant message to conversation
        const messages = scope.messages ?? [];
        const asstMsg = assistantMessage(
          result.content ?? '',
          result.type === 'tools' ? result.toolCalls : undefined,
        );
        scope.messages = [...messages, asstMsg];
      },
      'parse-response',
      'Parse LLM response and extract specialist selection',
    );

  // ── RouteSpecialist decider ───────────────────────────────
  //
  // Reads parsedResponse.toolCalls[0].name to pick the specialist branch.
  // Each specialist is a lazy subflow branch — only built when selected.

  let decider = builder
    .addDeciderFunction(
      'RouteSpecialist',
      (scope: TypedScope<SwarmLoopState>) => {
        const parsed = scope.parsedResponse;
        const loopCount = scope.loopCount ?? 0;
        const maxIter = scope.maxIterations ?? 10;

        if (parsed?.hasToolCalls && parsed.toolCalls?.length > 0 && loopCount < maxIter) {
          const toolCall = parsed.toolCalls[0];
          const toolName = toolCall.name;
          const isSpecialist = specialists.some((s) => s.id === toolName);

          if (isSpecialist) {
            // Extract message from tool call arguments
            const args = toolCall.arguments as Record<string, unknown>;
            scope.specialistMessage = (args?.message as string) ?? seed.message;
            scope.specialistToolCallId = toolCall.id;
            return toolName;
          }
        }
        return 'final';
      },
      'route-specialist',
      'Route to the specialist the LLM selected, or finalize',
    );

  // ── Mount each specialist as a lazy subflow branch ────────

  for (const specialist of specialists) {
    decider = decider.addLazySubFlowChartBranch(
      specialist.id,
      () => {
        // Use specialist's own flowchart if available (for BTS drill-down)
        if ('toFlowChart' in specialist.runner && typeof specialist.runner.toFlowChart === 'function') {
          return (specialist.runner as any).toFlowChart();
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
      specialist.id,
      {
        inputMapper: (parent: Record<string, unknown>) => ({
          message: parent.specialistMessage ?? seed.message,
        }),
        outputMapper: (sfOutput: Record<string, unknown>, parentScope: Record<string, unknown>) => {
          // Map specialist result back as a tool result message (delta pattern).
          // applyOutputMapping concatenates arrays — return ONLY the new tool result message.
          const resultContent = (sfOutput.result as string) ?? (sfOutput.content as string) ?? '';
          const toolCallId = (parentScope.specialistToolCallId as string) ?? `specialist-${Date.now()}`;
          return {
            messages: [toolResultMessage(resultContent, toolCallId)],
            loopCount: ((parentScope.loopCount as number) ?? 0) + 1,
          };
        },
      },
    );
  }

  // ── Finalize branch ───────────────────────────────────────

  decider = decider.addFunctionBranch(
    'final',
    'Finalize',
    (scope: TypedScope<SwarmLoopState>) => {
      const parsed = scope.parsedResponse;
      scope.result = parsed?.content ?? '';
      scope.$break();
    },
    'Extract final answer and stop',
  );

  builder = decider.setDefault('final').end();

  // ── Loop ──────────────────────────────────────────────────

  builder = builder.loopTo('call-llm');

  if (options?.captureSpec) {
    const spec = builder.toSpec();
    return { chart: builder.build(), spec };
  }
  return { chart: builder.build() };
}
