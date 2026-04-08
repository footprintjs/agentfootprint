/**
 * CompositeRecorder — fans out events to multiple AgentRecorders.
 *
 * Convenience wrapper that dispatches each event to all child recorders.
 * Error in one recorder does not affect others (error isolation).
 *
 * Usage:
 *   const composite = new CompositeRecorder([
 *     new TokenRecorder(),
 *     new QualityRecorder(judge),
 *     new GuardrailRecorder(check),
 *   ]);
 *   agent.recorder(composite);
 */

import type {
  AgentRecorder,
  TurnStartEvent,
  LLMCallEvent,
  ToolCallEvent,
  TurnCompleteEvent,
  AgentErrorEvent,
} from '../core';

export class CompositeRecorder implements AgentRecorder {
  readonly id: string;
  private readonly recorders: readonly AgentRecorder[];

  constructor(recorders: readonly AgentRecorder[], id = 'composite-recorder') {
    this.recorders = recorders;
    this.id = id;
  }

  onTurnStart(event: TurnStartEvent): void {
    this.dispatch('onTurnStart', event);
  }

  onLLMCall(event: LLMCallEvent): void {
    this.dispatch('onLLMCall', event);
  }

  onToolCall(event: ToolCallEvent): void {
    this.dispatch('onToolCall', event);
  }

  onTurnComplete(event: TurnCompleteEvent): void {
    this.dispatch('onTurnComplete', event);
  }

  onError(event: AgentErrorEvent): void {
    this.dispatch('onError', event);
  }

  clear(): void {
    for (const recorder of this.recorders) {
      try {
        recorder.clear?.();
      } catch {
        /* error isolation */
      }
    }
  }

  /** Access child recorders for inspection. */
  getRecorders(): readonly AgentRecorder[] {
    return this.recorders;
  }

  private dispatch(hook: keyof AgentRecorder, event: unknown): void {
    for (const recorder of this.recorders) {
      try {
        const fn = recorder[hook];
        if (typeof fn === 'function') {
          (fn as (e: unknown) => void).call(recorder, event);
        }
      } catch {
        // Error isolation — one recorder failure must not affect others
      }
    }
  }
}
