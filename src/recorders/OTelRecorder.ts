/**
 * OTelRecorder — exports agent events as OpenTelemetry spans.
 *
 * Takes a duck-typed Tracer from the consumer — zero @opentelemetry dependency in core.
 * Follows OpenTelemetry Semantic Conventions for GenAI where applicable.
 *
 * Usage:
 *   import { trace } from '@opentelemetry/api';
 *   import { OTelRecorder } from 'agentfootprint/observe';
 *
 *   const recorder = new OTelRecorder(trace.getTracer('agentfootprint'));
 *   agent.recorder(recorder);
 */

import type {
  AgentRecorder,
  TurnStartEvent,
  LLMCallEvent,
  ToolCallEvent,
  TurnCompleteEvent,
  AgentErrorEvent,
} from '../core';

/** Duck-typed OpenTelemetry Span — no @opentelemetry/api dependency. */
interface OTelSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus?(status: { code: number; message?: string }): void;
  end(): void;
}

/** Duck-typed OpenTelemetry Tracer — consumer provides their own. */
export interface OTelTracer {
  startSpan(
    name: string,
    options?: { attributes?: Record<string, string | number | boolean> },
  ): OTelSpan;
}

export interface OTelRecorderOptions {
  /** Recorder ID. Default: 'otel-recorder'. */
  id?: string;
  /** Service name for span attributes. Default: 'agentfootprint'. */
  serviceName?: string;
}

export class OTelRecorder implements AgentRecorder {
  readonly id: string;
  private readonly tracer: OTelTracer;
  private readonly serviceName: string;
  private turnSpan?: OTelSpan;

  constructor(tracer: OTelTracer, options?: OTelRecorderOptions) {
    this.tracer = tracer;
    this.id = options?.id ?? 'otel-recorder';
    this.serviceName = options?.serviceName ?? 'agentfootprint';
  }

  onTurnStart(event: TurnStartEvent): void {
    this.turnSpan = this.tracer.startSpan('agent.turn', {
      attributes: {
        'gen_ai.system': this.serviceName,
        'agent.turn_number': event.turnNumber,
      },
    });
  }

  onLLMCall(event: LLMCallEvent): void {
    const span = this.tracer.startSpan('gen_ai.chat', {
      attributes: {
        'gen_ai.system': this.serviceName,
        'gen_ai.request.model': event.model ?? 'unknown',
        'gen_ai.response.finish_reason': event.finishReason ?? 'unknown',
        'gen_ai.usage.input_tokens': event.usage?.inputTokens ?? 0,
        'gen_ai.usage.output_tokens': event.usage?.outputTokens ?? 0,
        'gen_ai.response.latency_ms': event.latencyMs,
        'agent.loop_iteration': event.loopIteration,
      },
    });
    span.end();
  }

  onToolCall(event: ToolCallEvent): void {
    const span = this.tracer.startSpan(`tool.${event.toolName}`, {
      attributes: {
        'tool.name': event.toolName,
        'tool.latency_ms': event.latencyMs,
        'tool.error': Boolean(event.result.error),
      },
    });
    span.end();
  }

  onTurnComplete(event: TurnCompleteEvent): void {
    if (this.turnSpan) {
      this.turnSpan.setAttribute('agent.iterations', event.totalLoopIterations);
      this.turnSpan.setAttribute('agent.message_count', event.messageCount);
      this.turnSpan.end();
      this.turnSpan = undefined;
    }
  }

  onError(event: AgentErrorEvent): void {
    const span = this.tracer.startSpan('agent.error', {
      attributes: {
        'error.phase': event.phase,
        'error.type': event.error instanceof Error ? event.error.name : 'unknown',
      },
    });
    // OTel StatusCode.ERROR = 2
    span.setStatus?.({
      code: 2,
      message: event.error instanceof Error ? event.error.message : String(event.error),
    });
    span.end();
  }

  clear(): void {
    this.turnSpan = undefined;
  }
}
