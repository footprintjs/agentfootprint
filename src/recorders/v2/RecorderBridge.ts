/**
 * RecorderBridge — dispatches AgentRecorder events from runner execution data.
 *
 * Runners call bridge methods at the right points:
 *   - dispatchTurnStart() before execution
 *   - dispatchLLMCall() after extracting LLM response from snapshot
 *   - dispatchTurnComplete() after successful execution
 *   - dispatchError() on failure
 */

import type { AgentRecorder, LLMCallEvent } from '../../core';
import type { LLMResponse } from '../../types';
import type { AgentStreamEvent } from '../../streaming';

export class RecorderBridge {
  private readonly recorders: AgentRecorder[];
  private turnNumber = 1;
  private loopIteration = 0;

  constructor(recorders: AgentRecorder[]) {
    this.recorders = recorders;
  }

  /** Dispatch turn start event. */
  dispatchTurnStart(message: string): void {
    this.dispatch('onTurnStart', { turnNumber: this.turnNumber, message });
  }

  /** Dispatch LLM call event from the adapter response stored in scope. */
  dispatchLLMCall(
    response: LLMResponse,
    latencyMs = 0,
    context?: {
      systemPrompt?: string;
      toolDescriptions?: Array<{ name: string; description: string }>;
      messages?: Array<{ role: string; content: unknown }>;
    },
  ): void {
    const event: LLMCallEvent = {
      model: response.model,
      usage: response.usage,
      latencyMs,
      turnNumber: this.turnNumber,
      loopIteration: this.loopIteration,
      finishReason: response.finishReason,
      systemPrompt: context?.systemPrompt,
      toolDescriptions: context?.toolDescriptions,
      messages: context?.messages,
    };
    this.dispatch('onLLMCall', event);
    this.loopIteration++;
  }

  /** Dispatch turn complete event. */
  dispatchTurnComplete(content: string, messageCount: number, totalLoopIterations = 0): void {
    this.dispatch('onTurnComplete', {
      turnNumber: this.turnNumber,
      messageCount,
      totalLoopIterations,
      content,
    });
    this.turnNumber++;
    this.loopIteration = 0;
  }

  /** Dispatch tool call event from stream events. */
  dispatchToolCall(
    toolName: string,
    args: Record<string, unknown>,
    result: { content: string; error?: boolean },
    latencyMs: number,
  ): void {
    this.dispatch('onToolCall', { toolName, args, result, latencyMs });
  }

  /**
   * Create an onStreamEvent handler that bridges tool events to recorders.
   * Attach this alongside the consumer's onEvent handler in AgentRunner.
   */
  createStreamEventBridge(): (event: AgentStreamEvent) => void {
    const pendingTools = new Map<
      string,
      { name: string; args: Record<string, unknown>; startMs: number }
    >();

    return (event: AgentStreamEvent) => {
      if (event.type === 'tool_start') {
        pendingTools.set(event.toolCallId, {
          name: event.toolName,
          args: event.args,
          startMs: Date.now(),
        });
      } else if (event.type === 'tool_end') {
        const pending = pendingTools.get(event.toolCallId);
        if (pending) {
          this.dispatchToolCall(
            pending.name,
            pending.args,
            { content: event.result, error: event.error },
            event.latencyMs,
          );
          pendingTools.delete(event.toolCallId);
        }
      }
    };
  }

  /** Dispatch error event. */
  dispatchError(phase: 'prompt' | 'llm' | 'tool' | 'message', error: unknown): void {
    this.dispatch('onError', { phase, error, turnNumber: this.turnNumber });
  }

  private dispatch(hook: keyof AgentRecorder, event: unknown): void {
    for (const recorder of this.recorders) {
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
}
