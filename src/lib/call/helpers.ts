/**
 * Shared helpers for call module stages.
 */

import type { LLMResponse, AdapterResult, ToolCall, Message } from '../../types';
import { toolResultMessage } from '../../types';
import type { ToolRegistry } from '../../tools';
import type { ToolProvider } from '../../core';
import type { LLMInstruction, InstructionContext, RuntimeFollowUp, InstructionTemplate } from '../instructions';
import type { ResolvedInstruction } from '../instructions';
import { processInstructions } from '../instructions';

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
export interface InstructionConfig {
  /** Build-time instructions keyed by tool ID. */
  readonly instructionsByToolId: Map<string, readonly LLMInstruction[]>;
  /** Optional custom template for formatting. */
  readonly template?: InstructionTemplate;
  /** Callback when instructions fire (for InstructionRecorder). */
  readonly onInstructionsFired?: (toolId: string, fired: ResolvedInstruction[]) => void;
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
export async function executeToolCalls(
  toolCalls: ToolCall[],
  registry: ToolRegistry,
  messages: Message[],
  toolProvider?: ToolProvider,
  signal?: AbortSignal,
  instructionConfig?: InstructionConfig,
): Promise<Message[]> {
  // Single copy upfront — O(M+N) instead of O(M*N) from repeated spreads
  const result = [...messages];

  for (const toolCall of toolCalls) {
    let resultContent: string;
    let runtimeInstructions: readonly string[] | undefined;
    let runtimeFollowUps: readonly RuntimeFollowUp[] | undefined;
    let errorInfo: { code?: string; message: string } | undefined;
    const startMs = Date.now();

    // Try ToolProvider.execute() first (handles remote tools, gated tools, etc.)
    if (toolProvider?.execute) {
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
        const safeName = String(toolCall.name).slice(0, 100).replace(/[\n\r]/g, '');
        errorInfo = { code: 'NOT_FOUND', message: `Tool '${safeName}' not found` };
        resultContent = JSON.stringify({ error: true, message: errorInfo.message });
      } else {
        try {
          const execResult = await tool.handler(toolCall.arguments);
          resultContent = execResult.content;
          // Check for InstructedToolResult (runtime instructions/followUps)
          const instructed = execResult as { instructions?: readonly string[]; followUps?: readonly RuntimeFollowUp[] };
          runtimeInstructions = instructed.instructions;
          runtimeFollowUps = instructed.followUps;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errorInfo = { message: msg };
          resultContent = JSON.stringify({ error: true, message: msg });
        }
      }
    }

    const latencyMs = Date.now() - startMs;

    // Process instructions if config provided
    if (instructionConfig) {
      const buildTimeInstructions = instructionConfig.instructionsByToolId.get(toolCall.name);
      const hasInstructions = buildTimeInstructions?.length || runtimeInstructions?.length || runtimeFollowUps?.length;

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
          (runtimeInstructions || runtimeFollowUps)
            ? { instructions: runtimeInstructions, followUps: runtimeFollowUps }
            : undefined,
          instructionConfig.template,
        );

        if (injectionResult.injected) {
          resultContent = injectionResult.content;
        }

        if (injectionResult.fired.length > 0 && instructionConfig.onInstructionsFired) {
          instructionConfig.onInstructionsFired(toolCall.name, injectionResult.fired);
        }
      }
    }

    result.push(toolResultMessage(resultContent, toolCall.id));
  }

  return result;
}
