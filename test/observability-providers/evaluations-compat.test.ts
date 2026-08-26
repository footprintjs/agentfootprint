/**
 * Spans a trace-SCORING service can actually read — and the default that
 * still refuses to export content.
 *
 * Two settings decide whether an outside grader sees an agentfootprint turn at
 * all: the instrumentation scope name it classifies by, and whether the turn's
 * prompt and answer are on the span for it to grade. Both are opt-in, and the
 * point of this file is that BOTH halves hold — the opt-in works, and the
 * default is unchanged for everyone who never asked.
 *
 * The vendor case that forced them (AWS Bedrock AgentCore Evaluations) is
 * asserted through `agentCoreEvaluationSpans`, which is a configuration of the
 * neutral adapter rather than a second one. That the neutral adapter has no
 * idea who AgentCore is, is the design being pinned here.
 */

import { describe, expect, it } from 'vitest';

import {
  otelObservability,
  type OtelSpanLike,
  type OtelSpanOptions,
  type OtelTracerLike,
} from '../../src/adapters/observability/otel.js';
import {
  agentCoreEvaluationSpans,
  AGENTCORE_EVALUATIONS_SCOPE_NAME,
} from '../../src/adapters/observability/agentcore.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';

interface CapturedSpan {
  readonly name: string;
  readonly attributes: Record<string, string | number | boolean>;
  ended: boolean;
}

/** A tracer that also records the SCOPE NAME it was requested under. */
function makeMockTracer(): { tracer: OtelTracerLike; spans: CapturedSpan[] } {
  const spans: CapturedSpan[] = [];
  const tracer: OtelTracerLike = {
    startSpan(name: string, options?: OtelSpanOptions): OtelSpanLike {
      const captured: CapturedSpan = {
        name,
        attributes: { ...(options?.attributes ?? {}) },
        ended: false,
      };
      spans.push(captured);
      return {
        setAttribute(key: string, value: string | number | boolean): unknown {
          captured.attributes[key] = value;
          return undefined;
        },
        setStatus(): unknown {
          return undefined;
        },
        end(): void {
          captured.ended = true;
        },
        spanContext(): { traceId: string; spanId: string; traceFlags: number } {
          return { traceId: 't', spanId: `s-${spans.indexOf(captured)}`, traceFlags: 1 };
        },
      };
    },
  };
  return { tracer, spans };
}

function event(type: string, extra: Record<string, unknown> = {}): AgentfootprintEvent {
  return {
    type: type as never,
    payload: { runId: 'r-1', ...extra },
    timestamp: Date.now(),
  } as unknown as AgentfootprintEvent;
}

const PROMPT = 'why did the refund fail?';
const ANSWER = 'The card issuer declined it; retry with a different instrument.';

/** One complete turn through a strategy, returning the spans it produced. */
function runTurn(strat: { exportEvent(e: AgentfootprintEvent): void }): void {
  strat.exportEvent(event('agentfootprint.agent.turn_start', { turnIndex: 0, userPrompt: PROMPT }));
  strat.exportEvent(
    event('agentfootprint.agent.turn_end', {
      turnIndex: 0,
      finalContent: ANSWER,
      totalInputTokens: 10,
      totalOutputTokens: 20,
      iterationCount: 1,
    }),
  );
}

// ─── the default: nothing changes for anyone who did not ask ─────────

describe('content stays off the span unless asked', () => {
  it('emits neither task.input nor task.output by default', () => {
    const { tracer, spans } = makeMockTracer();
    runTurn(otelObservability({ serviceName: 'svc', tracer }));

    const root = spans[0];
    expect(root).toBeDefined();
    expect(root!.attributes['gen_ai.task.input']).toBeUndefined();
    expect(root!.attributes['gen_ai.task.output']).toBeUndefined();
    // The prompt must not have reached the span under ANY key — a rename of
    // the attribute would otherwise slip an export past this test.
    expect(JSON.stringify(root!.attributes)).not.toContain(PROMPT);
    expect(JSON.stringify(root!.attributes)).not.toContain(ANSWER);
  });

  it('still emits the attributes it always did', () => {
    const { tracer, spans } = makeMockTracer();
    runTurn(otelObservability({ serviceName: 'svc', tracer }));

    const root = spans[0]!;
    expect(root.attributes['gen_ai.operation.name']).toBe('invoke_agent');
    expect(root.attributes['gen_ai.agent.name']).toBe('svc');
    expect(root.attributes['gen_ai.usage.input_tokens']).toBe(10);
  });
});

// ─── the opt-in ──────────────────────────────────────────────────────

describe('captureContent puts the turn on the span', () => {
  it('emits the prompt as task.input and the answer as task.output', () => {
    const { tracer, spans } = makeMockTracer();
    runTurn(otelObservability({ serviceName: 'svc', tracer, captureContent: true }));

    const root = spans[0]!;
    expect(root.attributes['gen_ai.task.input']).toBe(PROMPT);
    expect(root.attributes['gen_ai.task.output']).toBe(ANSWER);
  });

  it('omits each half independently when the payload does not carry it', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer, captureContent: true });
    // A turn that starts with no prompt field and ends with no final content:
    // absent is absent, never an empty string standing in for content.
    strat.exportEvent(event('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    strat.exportEvent(event('agentfootprint.agent.turn_end', { turnIndex: 0 }));

    const root = spans[0]!;
    expect(root.attributes['gen_ai.task.input']).toBeUndefined();
    expect(root.attributes['gen_ai.task.output']).toBeUndefined();
  });
});

// ─── the scope name ──────────────────────────────────────────────────

describe('the instrumentation scope name is a knob', () => {
  it('defaults to agentfootprint — existing dashboards keep their spans', () => {
    let requested: string | undefined;
    const api = {
      trace: {
        getTracer(name: string): OtelTracerLike {
          requested = name;
          return makeMockTracer().tracer;
        },
      },
    };
    // Reach the default path by NOT injecting a tracer: the adapter asks the
    // (here, faked) OTel API for one and that call carries the scope name.
    const strat = otelObservability({ serviceName: 'svc', _otelApi: api });
    strat.exportEvent(event('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    expect(requested).toBe('agentfootprint');
  });

  it('AgentCore Evaluations gets the one spelling its classifier accepts', () => {
    // The contract, asserted literally: their classifier skips any scope name
    // not under this prefix, silently — so the constant is the test.
    expect(AGENTCORE_EVALUATIONS_SCOPE_NAME).toBe('opentelemetry.instrumentation.agentfootprint');
    expect(AGENTCORE_EVALUATIONS_SCOPE_NAME.startsWith('opentelemetry.instrumentation.')).toBe(
      true,
    );
  });
});

// ─── the vendor configuration ────────────────────────────────────────

describe('agentCoreEvaluationSpans is a configuration, not a second adapter', () => {
  it('produces the same strategy identity as the neutral adapter', () => {
    const { tracer } = makeMockTracer();
    const strat = agentCoreEvaluationSpans({ serviceName: 'svc', tracer });
    // Same name and capabilities: nothing about it is a separate implementation.
    expect(strat.name).toBe('otel');
    expect(strat.capabilities.traces).toBe(true);
  });

  it('turns content capture on, because a scorer cannot grade what it cannot read', () => {
    const { tracer, spans } = makeMockTracer();
    runTurn(agentCoreEvaluationSpans({ serviceName: 'svc', tracer }));

    const root = spans[0]!;
    expect(root.attributes['gen_ai.task.input']).toBe(PROMPT);
    expect(root.attributes['gen_ai.task.output']).toBe(ANSWER);
  });

  it('lets a caller opt content back out, but never the scope name', () => {
    const { tracer, spans } = makeMockTracer();
    runTurn(agentCoreEvaluationSpans({ serviceName: 'svc', tracer, captureContent: false }));
    expect(spans[0]!.attributes['gen_ai.task.input']).toBeUndefined();

    // The scope name is the whole reason this function exists, so an override
    // of it is refused by construction rather than honoured into silence.
    let requested: string | undefined;
    const api = {
      trace: {
        getTracer(name: string): OtelTracerLike {
          requested = name;
          return makeMockTracer().tracer;
        },
      },
    };
    const strat = agentCoreEvaluationSpans({
      serviceName: 'svc',
      scopeName: 'something.else',
      _otelApi: api,
    });
    strat.exportEvent(event('agentfootprint.agent.turn_start', { turnIndex: 0 }));
    expect(requested).toBe(AGENTCORE_EVALUATIONS_SCOPE_NAME);
  });
});
