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
  dispatchLLMCall(response: LLMResponse, latencyMs = 0): void {
    const event: LLMCallEvent = {
      model: response.model,
      usage: response.usage,
      latencyMs,
      turnNumber: this.turnNumber,
      loopIteration: this.loopIteration,
      finishReason: response.finishReason,
    };
    this.dispatch('onLLMCall', event);
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
