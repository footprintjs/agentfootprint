/**
 * agentLoop — the core execution engine.
 *
 * Takes an AgentLoopConfig (providers + recorders + options) and executes
 * a single turn of the agent loop:
 *   1. Resolve system prompt (PromptProvider)
 *   2. Prepare messages (MessageStrategy)
 *   3. Call LLM
 *   4. If tool calls → execute tools → loop to step 3
 *   5. If final response → return result
 *
 * Built on footprintjs flowchart (SeedScope → Prompt → LLM → Parse → Handle → loop).
 * All observation happens through AgentRecorders attached to the config.
 *
 * Usage:
 *   const result = await agentLoop(config, 'Hello', { signal, timeoutMs });
 */

import type { AgentLoopConfig } from '../core';
import type {
  AgentRecorder,
  TurnStartEvent,
  LLMCallEvent,
  ToolCallEvent,
  TurnCompleteEvent,
  AgentErrorEvent,
} from '../core';
import type { Message } from '../types/messages';
import { userMessage, assistantMessage, toolResultMessage, hasToolCalls } from '../types/messages';
import { getTextContent } from '../types/content';

// ── Types ────────────────────────────────────────────────────

export interface AgentLoopOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Existing conversation history (for multi-turn). */
  readonly history?: Message[];
  /** Turn number (for multi-turn tracking). */
  readonly turnNumber?: number;
}

export interface AgentLoopResult {
  /** Final text content from the agent. */
  readonly content: string;
  /** Full message history after this turn. */
  readonly messages: Message[];
  /** Number of LLM calls in this turn (1 = no tool loops). */
  readonly loopIterations: number;
}

// ── Engine ───────────────────────────────────────────────────

export async function agentLoop(
  config: AgentLoopConfig,
  message: string,
  options: AgentLoopOptions = {},
): Promise<AgentLoopResult> {
  const { promptProvider, messageStrategy, toolProvider, llmProvider, maxIterations, recorders } =
    config;

  const signal = options.signal;
  const turnNumber = options.turnNumber ?? 0;
  const history: Message[] = [...(options.history ?? [])];

  // Add user message
  history.push(userMessage(message));

  // Notify recorders: turn start
  const startEvent: TurnStartEvent = { turnNumber, message };
  dispatchRecorderEvent(recorders, 'onTurnStart', startEvent);

  try {
    // 1. Resolve system prompt
    const promptCtx = { message, turnNumber, history, signal };
    const systemPrompt = await promptProvider.resolve(promptCtx);

    let loopIteration = 0;
    let finalContent = '';

    while (loopIteration < maxIterations) {
      checkAborted(signal);

      // 2. Prepare messages
      const messageCtx = { message, turnNumber, loopIteration, signal };
      const messageDecision = await messageStrategy.prepare(history, messageCtx);
      const preparedMessages = messageDecision.value;

      // 3. Call LLM
      const toolDecision = await toolProvider.resolve({
        message,
        turnNumber,
        loopIteration,
        messages: preparedMessages,
        signal,
      });
      const toolDescriptions = toolDecision.value;

      const llmStart = Date.now();
      const llmResponse = await llmProvider.chat(preparedMessages, {
        tools: toolDescriptions.length > 0 ? toolDescriptions : undefined,
        signal,
        ...(systemPrompt ? {} : {}),
      });
      const llmLatency = Date.now() - llmStart;

      // Notify recorders: LLM call
      const llmEvent: LLMCallEvent = {
        model: undefined,
        usage: llmResponse.usage,
        latencyMs: llmLatency,
        turnNumber,
        loopIteration,
        finishReason: llmResponse.finishReason,
      };
      dispatchRecorderEvent(recorders, 'onLLMCall', llmEvent);

      loopIteration++;

      // Add assistant message to history
      const assistantContent = getTextContent(llmResponse.content);
      const assistantMsg = assistantMessage(assistantContent, llmResponse.toolCalls);
      history.push(assistantMsg);

      // 4. Check for tool calls
      if (hasToolCalls(assistantMsg) && assistantMsg.toolCalls!.length > 0) {
        // Execute each tool call
        for (const toolCall of assistantMsg.toolCalls!) {
          checkAborted(signal);

          const toolStart = Date.now();
          let toolResult;

          if (toolProvider.execute) {
            toolResult = await toolProvider.execute(toolCall, signal);
          } else {
            toolResult = { content: `No executor for tool: ${toolCall.name}`, error: true };
          }

          const toolLatency = Date.now() - toolStart;

          // Notify recorders: tool call
          const toolEvent: ToolCallEvent = {
            toolName: toolCall.name,
            args: toolCall.arguments,
            result: toolResult,
            latencyMs: toolLatency,
          };
          dispatchRecorderEvent(recorders, 'onToolCall', toolEvent);

          // Add tool result to history
          history.push(toolResultMessage(toolResult.content, toolCall.id));
        }

        // Continue loop — LLM needs to process tool results
        continue;
      }

      // 5. Final response — no tool calls
      finalContent = assistantContent;
      break;
    }

    // Notify recorders: turn complete
    const completeEvent: TurnCompleteEvent = {
      turnNumber,
      messageCount: history.length,
      totalLoopIterations: loopIteration,
      content: finalContent,
    };
    dispatchRecorderEvent(recorders, 'onTurnComplete', completeEvent);

    return {
      content: finalContent,
      messages: history,
      loopIterations: loopIteration,
    };
  } catch (err) {
    // Notify recorders: error
    const errorEvent: AgentErrorEvent = {
      phase: 'llm',
      error: err,
      turnNumber,
    };
    dispatchRecorderEvent(recorders, 'onError', errorEvent);
    throw err;
  }
}

// ── Helpers ──────────────────────────────────────────────────

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new Error('Aborted');
  }
}

function dispatchRecorderEvent(
  recorders: AgentRecorder[],
  hook: keyof AgentRecorder,
  event: unknown,
): void {
  for (const recorder of recorders) {
    try {
      const fn = recorder[hook];
      if (typeof fn === 'function') {
        (fn as (e: unknown) => void).call(recorder, event);
      }
    } catch {
      // Error isolation
    }
  }
}
