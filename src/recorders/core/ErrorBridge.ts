/**
 * ErrorBridge — translates footprintjs's STRUCTURAL `onRunFailed` (the
 * terminal run-boundary event fired when a run throws a non-pause error)
 * into agentfootprint's TYPED `agentfootprint.error.fatal` domain event.
 *
 * Pattern: Adapter (GoF) — same role as EmitBridge, different channel.
 * Role:    Close the "failed run is invisible" gap. footprintjs fires
 *          `onError` (stage-level) + `onRunFailed` (run-level) on the
 *          FlowRecorder channel, but agentfootprint's typed consumers
 *          (LiveStateRecorder clearing in-flight, monitors setting
 *          status) listen on the DISPATCHER. Without a bridge, a thrown
 *          LLM call left `isLLMInFlight()` stuck true ("Chatbot is
 *          thinking…" forever) and downstream STATUS showed "ok". This
 *          re-dispatches one terminal typed event so every consumer
 *          reacts uniformly.
 * Emits:   agentfootprint.error.fatal (once per failed top-level run).
 *
 * Fires at the TOP LEVEL only — footprintjs `onRunFailed` is a run
 * boundary, not a per-stage event. Subflow errors propagate up and
 * surface here once.
 */

import type { CombinedRecorder, FlowRunFailedEvent } from 'footprintjs';
import type { EventDispatcher } from '../../events/dispatcher.js';
import { buildEventMeta, type RunContext } from '../../bridge/eventMeta.js';
import { humanizeLLMError } from '../../lib/humanizeLLMError.js';
import { isDeferredPayloadSummary, type DeferredPayloadSummary } from './deferredPayload.js';

interface FailureProjection {
  readonly message: string;
  readonly runtimeStageId?: string;
  readonly subflowPath?: readonly string[];
  readonly stage: string;
}

function projectFailure(event: FlowRunFailedEvent): FailureProjection {
  const context = event.traversalContext;
  return {
    message: event.structuredError.message,
    runtimeStageId: context?.runtimeStageId,
    subflowPath: context?.subflowPath === undefined ? undefined : [...context.subflowPath],
    stage: context?.stageName ?? '__root__',
  };
}

export interface ErrorBridgeOptions {
  readonly dispatcher: EventDispatcher;
  /** Recorder id — must be unique among attached recorders. */
  readonly id?: string;
  readonly getRunContext: () => RunContext;
  /** Use run-level wording when no provider-specific wording matches. */
  readonly fallback?: 'run';
}

export class ErrorBridge implements CombinedRecorder {
  readonly id: string;
  private readonly dispatcher: EventDispatcher;
  private readonly getRunContext: () => RunContext;
  private readonly fallback: ErrorBridgeOptions['fallback'];
  private projectedFailure?: FailureProjection;

  constructor(options: ErrorBridgeOptions) {
    this.dispatcher = options.dispatcher;
    this.id = options.id ?? 'agentfootprint.error-bridge';
    this.getRunContext = options.getRunContext;
    this.fallback = options.fallback;
  }

  clear(): void {
    this.projectedFailure = undefined;
  }

  /**
   * Keep the small served projection at the native failure origin. The deferred
   * hook still publishes in queue order, even if a foreign raw error made the
   * engine's whole event uncopyable.
   */
  preserveFailureForDeferredCapture(): CombinedRecorder {
    return {
      id: `${this.id}.source`,
      onRunFailed: (event) => {
        this.projectedFailure = projectFailure(event);
      },
    };
  }

  onRunFailed(event: FlowRunFailedEvent | DeferredPayloadSummary): void {
    const failure = isDeferredPayloadSummary(event) ? this.projectedFailure : projectFailure(event);
    this.clear();
    if (failure === undefined) return;
    const meta = buildEventMeta(
      { runtimeStageId: failure.runtimeStageId, subflowPath: failure.subflowPath },
      this.getRunContext(),
    );
    // Dispatch unconditionally (no hasListenersFor guard): failures are
    // rare, and a wildcard subscriber (the live monitor) must always see
    // the terminal signal even if no error-specific listener is attached.
    // Humanize HERE — the single terminal translation point. The raw
    // error already propagated through the reliability/merge layers (which
    // classify on the raw message) and out to the run()'s caller. This
    // event is what the live monitor renders, so non-developers see a
    // plain-language, actionable sentence ("Couldn't reach the AI model…")
    // instead of "[browser-anthropic] Failed to fetch".
    this.dispatcher.dispatch({
      type: 'agentfootprint.error.fatal',
      payload: {
        error: humanizeLLMError({ message: failure.message }, this.fallback),
        stage: failure.stage,
        scope: 'run',
      },
      meta,
    });
  }
}

export function errorBridge(options: ErrorBridgeOptions): ErrorBridge {
  return new ErrorBridge(options);
}
