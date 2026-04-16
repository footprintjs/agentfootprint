/**
 * Shared helpers for call module stages.
 */

import type { LLMResponse, AdapterResult, ToolCall, Message } from '../../types';
import { toolResultMessage } from '../../types';
import type { ToolRegistry } from '../../tools';
import { isAskHumanResult } from '../../tools/askHuman';
import { validateToolInput, formatValidationErrors } from '../../tools/validateInput';
import type { ToolProvider } from '../../core';
import type {
  LLMInstruction,
  InstructionContext,
  RuntimeFollowUp,
  InstructionTemplate,
} from '../instructions';
import type { ResolvedInstruction } from '../instructions';
import { processInstructions } from '../instructions';
import type { AgentStreamEventHandler } from '../../streaming';

/**
 * Normalize an LLMResponse into an AdapterResult discriminated union.
 */
export function normalizeAdapterResponse(response: LLMResponse): AdapterResult {
  if (response.toolCalls && response.toolCalls.length > 0) {
    return {
      type: 'tools',
      content: response.content ?? '',
      toolCalls: response.toolCalls,
      usage: response.usage,
      model: response.model,
    };
  }
  return {
    type: 'final',
    content: response.content,
    usage: response.usage,
    model: response.model,
  };
}

/**
 * Optional instruction processing config for executeToolCalls.
 * When provided, instructions are evaluated after each tool call
 * and injected into the tool result message content.
 */
/** Function that mutates the Decision Scope after a tool result. */
export type DecideFn = (decision: Record<string, unknown>, ctx: InstructionContext) => void;

export interface InstructionConfig {
  /** Build-time instructions keyed by tool ID. */
  readonly instructionsByToolId: Map<string, readonly LLMInstruction[]>;
  /** Optional custom template for formatting. */
  readonly template?: InstructionTemplate;
  /** Callback when instructions fire (for InstructionRecorder). */
  readonly onInstructionsFired?: (toolId: string, fired: ResolvedInstruction[]) => void;
  /**
   * decide() functions keyed by instruction rule ID.
   * Built at loop construction time from AgentInstruction.onToolResult rules + per-tool instructions.
   * Functions can't travel through scope (stripped on write), so they're captured by closure.
   */
  readonly decideFunctions?: ReadonlyMap<string, DecideFn>;
  /**
   * Agent-level response rules captured at build time.
   * These are the onToolResult rules from matched AgentInstructions.
   * Captured by closure because functions (`when`, `decide`, `followUp.params`)
   * are stripped when values pass through footprintjs scope.
   */
  readonly agentResponseRules?: readonly LLMInstruction[];
  /** Stream event handler for tool lifecycle events (tool_start, tool_end). */
  readonly onStreamEvent?: AgentStreamEventHandler;
}

/**
 * Execute tool calls and append results to conversation messages.
 *
 * Tries ToolProvider.execute() first (for remote tools like MCP/A2A),
 * falls back to ToolRegistry.get().handler (for local ToolDefinitions).
 *
 * When `instructionConfig` is provided, evaluates LLM instructions after
 * each tool call and appends matched instruction text to the tool result
 * message — landing in the LLM's recency window.
 */
/** Result of executeToolCalls — messages + optional ask_human pause info. */
export interface ToolCallsResult {
  messages: Message[];
  /** When set, one of the tools was ask_human — pause with this data. */
  askHumanPause?: { question: string; toolCallId: string };
}

export async function executeToolCalls(
  toolCalls: ToolCall[],
  registry: ToolRegistry,
  messages: Message[],
  toolProvider?: ToolProvider,
  signal?: AbortSignal,
  instructionConfig?: InstructionConfig,
  decision?: Record<string, unknown>,
  options?: { parallel?: boolean },
): Promise<ToolCallsResult> {
  // Single copy upfront — O(M+N) instead of O(M*N) from repeated spreads
  const result = [...messages];
  let askHumanPause: ToolCallsResult['askHumanPause'];

  const onStreamEvent = instructionConfig?.onStreamEvent;

  // Parallel mode: run per-tool work concurrently, collect tool result messages in
  // original order, surface the first ask_human pause (if any). Decide() mutations
  // to the shared `decision` object are NOT serialized — parallel tools should not
  // rely on strict decide ordering. Sequential mode (default) preserves prior semantics.
  if (options?.parallel && toolCalls.length > 1) {
    type PerTool = { resultMessage: Message; askHumanMarker?: ToolCallsResult['askHumanPause'] };
    const perTool = await Promise.all(
      toolCalls.map(
        (toolCall): Promise<PerTool> =>
          executeOneToolCall(
            toolCall,
            registry,
            toolProvider,
            signal,
            instructionConfig,
            decision,
            onStreamEvent,
          ),
      ),
    );
    for (const { resultMessage, askHumanMarker } of perTool) {
      result.push(resultMessage);
      if (!askHumanPause && askHumanMarker) askHumanPause = askHumanMarker;
    }
    return { messages: result, askHumanPause };
  }

  for (const toolCall of toolCalls) {
    let resultContent: string;
    let runtimeInstructions: readonly string[] | undefined;
    let runtimeFollowUps: readonly RuntimeFollowUp[] | undefined;
    let errorInfo: { code?: string; message: string } | undefined;
    const startMs = Date.now();

    onStreamEvent?.({
      type: 'tool_start',
      toolName: toolCall.name,
      toolCallId: toolCall.id,
      args: (toolCall.arguments ?? {}) as Record<string, unknown>,
    });

    // Try ToolProvider.execute() first (handles remote tools, gated tools, etc.)
    // Skip ToolProvider for ask_human — it must run locally (uses Symbol marker for pause detection).
    if (toolProvider?.execute && toolCall.name !== 'ask_human') {
      try {
        const execResult = await toolProvider.execute(toolCall, signal);
        resultContent = execResult.content;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errorInfo = { message: msg };
        resultContent = JSON.stringify({ error: true, message: msg });
      }
    } else {
      // Fall back to ToolRegistry (local ToolDefinition handlers)
      const tool = registry.get(toolCall.name);
      if (!tool) {
        // Sanitize tool name to prevent injection into error messages fed back to LLM
        const safeName = String(toolCall.name)
          .slice(0, 100)
          .replace(/[\n\r]/g, '');
        errorInfo = { code: 'NOT_FOUND', message: `Tool '${safeName}' not found` };
        resultContent = JSON.stringify({ error: true, message: errorInfo.message });
      } else {
        // Validate input against tool's inputSchema before calling handler
        const toolArgs = (toolCall.arguments ?? {}) as Record<string, unknown>;
        if (tool.inputSchema && Object.keys(tool.inputSchema).length > 0) {
          const validation = validateToolInput(toolArgs, tool.inputSchema);
          if (!validation.valid) {
            errorInfo = {
              code: 'INVALID_INPUT',
              message: `Invalid arguments for '${tool.id}': ${formatValidationErrors(
                validation.errors,
              )}`,
            };
            resultContent = JSON.stringify({ error: true, message: errorInfo.message });
            result.push(toolResultMessage(resultContent, toolCall.id));
            continue;
          }
        }

        try {
          const execResult = await tool.handler(toolArgs);
          resultContent = execResult.content;
          // Check for ask_human pause marker
          if (isAskHumanResult(execResult)) {
            askHumanPause = { question: execResult.question, toolCallId: toolCall.id };
          }
          // Check for InstructedToolResult (runtime instructions/followUps)
          const instructed = execResult as {
            instructions?: readonly string[];
            followUps?: readonly RuntimeFollowUp[];
          };
          runtimeInstructions = instructed.instructions;
          runtimeFollowUps = instructed.followUps;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errorInfo = { message: msg };
          resultContent = JSON.stringify({ error: true, message: msg });
        }
      }
    }

    // Capture tool execution latency BEFORE instruction processing overhead
    const toolExecLatencyMs = Date.now() - startMs;
    const latencyMs = toolExecLatencyMs;

    // Process instructions if config provided (build-time, agent-level, or runtime)
    if (instructionConfig) {
      const perToolInstructions = instructionConfig.instructionsByToolId.get(toolCall.name);
      const agentRules = instructionConfig.agentResponseRules;
      // Merge agent-level response rules (captured by closure) with per-tool instructions
      const buildTimeInstructions = agentRules?.length
        ? [...agentRules, ...(perToolInstructions ?? [])]
        : perToolInstructions;
      const hasInstructions =
        buildTimeInstructions?.length || runtimeInstructions?.length || runtimeFollowUps?.length;

      if (hasInstructions) {
        // Parse content for InstructionContext — try JSON, fall back to raw string
        let parsedContent: unknown;
        try {
          parsedContent = JSON.parse(resultContent);
        } catch {
          parsedContent = resultContent;
        }

        const ctx: InstructionContext = {
          content: parsedContent,
          error: errorInfo,
          latencyMs,
          input: toolCall.arguments,
          toolId: toolCall.name,
        };

        const injectionResult = processInstructions(
          resultContent,
          buildTimeInstructions,
          ctx,
          runtimeInstructions || runtimeFollowUps
            ? { instructions: runtimeInstructions, followUps: runtimeFollowUps }
            : undefined,
          instructionConfig?.template,
        );

        if (injectionResult.injected) {
          resultContent = injectionResult.content;
        }

        if (injectionResult.fired.length > 0 && instructionConfig?.onInstructionsFired) {
          instructionConfig.onInstructionsFired(toolCall.name, injectionResult.fired);
        }

        // Run decide() functions for matched instructions — updates Decision Scope.
        // decide functions are in the closure map (not in scope — functions stripped on scope write).
        if (decision && instructionConfig?.decideFunctions?.size) {
          for (const fired of injectionResult.fired) {
            const decideFn = instructionConfig.decideFunctions.get(fired.id);
            if (decideFn) {
              try {
                decideFn(decision, ctx);
              } catch {
                // decide errors are fail-open — don't crash tool execution
              }
            }
          }
        }
      }
    }

    onStreamEvent?.({
      type: 'tool_end',
      toolName: toolCall.name,
      toolCallId: toolCall.id,
      result: resultContent,
      error: !!errorInfo,
      latencyMs: toolExecLatencyMs,
    });

    result.push(toolResultMessage(resultContent, toolCall.id));
  }

  return { messages: result, askHumanPause };
}

/**
 * Execute a single tool call and return its result message + optional pause marker.
 * Pure in the sense of side-effect-on-messages — does not mutate any shared array.
 * DOES mutate `decision` via decide() functions when instructions fire (shared by design).
 *
 * Used by executeToolCalls in parallel mode so multiple tool calls can run concurrently
 * while the caller appends results in toolCall order.
 */
async function executeOneToolCall(
  toolCall: ToolCall,
  registry: ToolRegistry,
  toolProvider: ToolProvider | undefined,
  signal: AbortSignal | undefined,
  instructionConfig: InstructionConfig | undefined,
  decision: Record<string, unknown> | undefined,
  onStreamEvent: AgentStreamEventHandler | undefined,
): Promise<{ resultMessage: Message; askHumanMarker?: { question: string; toolCallId: string } }> {
  let resultContent: string;
  let runtimeInstructions: readonly string[] | undefined;
  let runtimeFollowUps: readonly RuntimeFollowUp[] | undefined;
  let errorInfo: { code?: string; message: string } | undefined;
  let askHumanMarker: { question: string; toolCallId: string } | undefined;
  const startMs = Date.now();

  onStreamEvent?.({
    type: 'tool_start',
    toolName: toolCall.name,
    toolCallId: toolCall.id,
    args: (toolCall.arguments ?? {}) as Record<string, unknown>,
  });

  // Try ToolProvider.execute() first (handles remote tools, gated tools, etc.)
  // Skip ToolProvider for ask_human — it must run locally (uses Symbol marker for pause detection).
  if (toolProvider?.execute && toolCall.name !== 'ask_human') {
    try {
      const execResult = await toolProvider.execute(toolCall, signal);
      resultContent = execResult.content;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errorInfo = { message: msg };
      resultContent = JSON.stringify({ error: true, message: msg });
    }
  } else {
    const tool = registry.get(toolCall.name);
    if (!tool) {
      const safeName = String(toolCall.name).slice(0, 100).replace(/[\n\r]/g, '');
      errorInfo = { code: 'NOT_FOUND', message: `Tool '${safeName}' not found` };
      resultContent = JSON.stringify({ error: true, message: errorInfo.message });
    } else {
      const toolArgs = (toolCall.arguments ?? {}) as Record<string, unknown>;
      if (tool.inputSchema && Object.keys(tool.inputSchema).length > 0) {
        const validation = validateToolInput(toolArgs, tool.inputSchema);
        if (!validation.valid) {
          errorInfo = {
            code: 'INVALID_INPUT',
            message: `Invalid arguments for '${tool.id}': ${formatValidationErrors(
              validation.errors,
            )}`,
          };
          resultContent = JSON.stringify({ error: true, message: errorInfo.message });
          return {
            resultMessage: toolResultMessage(resultContent, toolCall.id),
            askHumanMarker: undefined,
          };
        }
      }
      try {
        const execResult = await tool.handler(toolArgs);
        resultContent = execResult.content;
        if (isAskHumanResult(execResult)) {
          askHumanMarker = { question: execResult.question, toolCallId: toolCall.id };
        }
        const instructed = execResult as {
          instructions?: readonly string[];
          followUps?: readonly RuntimeFollowUp[];
        };
        runtimeInstructions = instructed.instructions;
        runtimeFollowUps = instructed.followUps;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errorInfo = { message: msg };
        resultContent = JSON.stringify({ error: true, message: msg });
      }
    }
  }

  const toolExecLatencyMs = Date.now() - startMs;

  if (instructionConfig) {
    const perToolInstructions = instructionConfig.instructionsByToolId.get(toolCall.name);
    const agentRules = instructionConfig.agentResponseRules;
    const buildTimeInstructions = agentRules?.length
      ? [...agentRules, ...(perToolInstructions ?? [])]
      : perToolInstructions;
    const hasInstructions =
      buildTimeInstructions?.length || runtimeInstructions?.length || runtimeFollowUps?.length;

    if (hasInstructions) {
      let parsedContent: unknown;
      try {
        parsedContent = JSON.parse(resultContent);
      } catch {
        parsedContent = resultContent;
      }

      const ctx: InstructionContext = {
        content: parsedContent,
        error: errorInfo,
        latencyMs: toolExecLatencyMs,
        input: toolCall.arguments,
        toolId: toolCall.name,
      };

      const injectionResult = processInstructions(
        resultContent,
        buildTimeInstructions,
        ctx,
        runtimeInstructions || runtimeFollowUps
          ? { instructions: runtimeInstructions, followUps: runtimeFollowUps }
          : undefined,
        instructionConfig?.template,
      );

      if (injectionResult.injected) {
        resultContent = injectionResult.content;
      }

      if (injectionResult.fired.length > 0 && instructionConfig?.onInstructionsFired) {
        instructionConfig.onInstructionsFired(toolCall.name, injectionResult.fired);
      }

      if (decision && instructionConfig?.decideFunctions?.size) {
        for (const fired of injectionResult.fired) {
          const decideFn = instructionConfig.decideFunctions.get(fired.id);
          if (decideFn) {
            try {
              decideFn(decision, ctx);
            } catch {
              // decide errors are fail-open — don't crash tool execution
            }
          }
        }
      }
    }
  }

  onStreamEvent?.({
    type: 'tool_end',
    toolName: toolCall.name,
    toolCallId: toolCall.id,
    result: resultContent,
    error: !!errorInfo,
    latencyMs: toolExecLatencyMs,
  });

  return {
    resultMessage: toolResultMessage(resultContent, toolCall.id),
    askHumanMarker,
  };
}
