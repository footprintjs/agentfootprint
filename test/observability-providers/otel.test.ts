/**
 * otelObservability — 7-pattern tests.
 *
 *   P1 Unit         — strategy.name is 'otel', capabilities advertise traces
 *   P2 Boundary     — turn_start opens span; turn_end ends it
 *   P3 Scenario     — full hierarchy turn → iteration → llm + tool
 *   P4 Property     — sampleRate=0 produces zero spans
 *   P5 Security     — missing serviceName + missing OTel API + events without runId
 *   P6 Performance  — sync exportEvent under 200ms for 10k events
 *   P7 ROI          — gen_ai.* + tool.* attributes set per OTel semantic conventions
 */

import { describe, expect, it } from 'vitest';
import {
  otelObservability,
  type OtelSpanLike,
  type OtelSpanOptions,
  type OtelTracerLike,
} from '../../src/adapters/observability/otel.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';

// ── Mock OTel tracer + span (minimal subset we depend on) ────────────

interface CapturedSpan {
  readonly name: string;
  readonly attributes: Record<string, string | number | boolean>;
  readonly status?: { code: number; message?: string };
  ended: boolean;
  endTime?: number;
}

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
        setStatus(status: { code: number; message?: string }): unknown {
          captured.status = status;
          return undefined;
        },
        end(endTime?: number): void {
          captured.ended = true;
          captured.endTime = endTime;
        },
        spanContext(): { traceId: string; spanId: string; traceFlags: number } {
          return {
            traceId: 'mock-trace',
            spanId: `mock-${spans.indexOf(captured)}`,
            traceFlags: 1,
          };
        },
      };
    },
  };
  return { tracer, spans };
}

function event(type: string, extra: Record<string, unknown> = {}): AgentfootprintEvent {
  return {
    type: type as never,
    payload: { runId: 'r-test', ...extra },
    timestamp: Date.now(),
  } as unknown as AgentfootprintEvent;
}

// ─── P1 Unit ─────────────────────────────────────────────────────────

describe('otelObservability — P1 unit', () => {
  it('P1 strategy.name is `otel` and capabilities advertise traces + events', () => {
    const { tracer } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    expect(strat.name).toBe('otel');
    expect(strat.capabilities.traces).toBe(true);
    expect(strat.capabilities.events).toBe(true);
  });
});

// ─── P2 Boundary — turn lifecycle ────────────────────────────────────

describe('otelObservability — P2 boundary', () => {
  it('P2 turn_start creates root span; turn_end ends it', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'my-agent', tracer });
    strat.exportEvent(event('agentfootprint.agent.turn_start'));
    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe('my-agent');
    expect(spans[0]?.ended).toBe(false);
    strat.exportEvent(event('agentfootprint.agent.turn_end'));
    expect(spans[0]?.ended).toBe(true);
  });

  it('P2 root span carries service.name attribute', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'my-svc', tracer });
    strat.exportEvent(event('agentfootprint.agent.turn_start'));
    expect(spans[0]?.attributes['service.name']).toBe('my-svc');
  });
});

// ─── P3 Scenario — full hierarchy ────────────────────────────────────

describe('otelObservability — P3 scenario', () => {
  it('P3 turn → iteration → llm + tool produces correctly-named span tree', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });

    strat.exportEvent(event('agentfootprint.agent.turn_start'));
    strat.exportEvent(event('agentfootprint.agent.iteration_start', { iteration: 1 }));
    strat.exportEvent(event('agentfootprint.stream.llm_start', { model: 'gpt-4' }));
    strat.exportEvent(event('agentfootprint.stream.llm_end'));
    strat.exportEvent(event('agentfootprint.stream.tool_start', { toolName: 'search' }));
    strat.exportEvent(event('agentfootprint.stream.tool_end', { toolName: 'search' }));
    strat.exportEvent(event('agentfootprint.agent.iteration_end'));
    strat.exportEvent(event('agentfootprint.agent.turn_end'));

    expect(spans).toHaveLength(4);
    const names = spans.map((s) => s.name).sort();
    expect(names).toEqual(['iteration:1', 'llm', 'svc', 'tool:search']);
    // Every span ended (no leaks).
    expect(spans.every((s) => s.ended)).toBe(true);
  });

  it('P3 llm span carries gen_ai.request.model attribute (OTel semconv)', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    strat.exportEvent(event('agentfootprint.agent.turn_start'));
    strat.exportEvent(event('agentfootprint.agent.iteration_start', { iteration: 1 }));
    strat.exportEvent(event('agentfootprint.stream.llm_start', { model: 'claude-3' }));
    strat.exportEvent(event('agentfootprint.stream.llm_end'));
    strat.exportEvent(event('agentfootprint.agent.iteration_end'));
    strat.exportEvent(event('agentfootprint.agent.turn_end'));
    const llm = spans.find((s) => s.name === 'llm')!;
    // Following OTel GenAI semantic conventions.
    expect(llm.attributes['gen_ai.request.model']).toBe('claude-3');
  });

  it('P3 tool span carries tool.name attribute', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    strat.exportEvent(event('agentfootprint.agent.turn_start'));
    strat.exportEvent(event('agentfootprint.stream.tool_start', { toolName: 'search-web' }));
    strat.exportEvent(event('agentfootprint.stream.tool_end', { toolName: 'search-web' }));
    strat.exportEvent(event('agentfootprint.agent.turn_end'));
    const tool = spans.find((s) => s.name === 'tool:search-web')!;
    expect(tool.attributes['tool.name']).toBe('search-web');
  });
});

// ─── P4 Property — sampling ──────────────────────────────────────────

describe('otelObservability — P4 property', () => {
  it('P4 sampleRate=0 produces ZERO spans', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', sampleRate: 0, tracer });
    strat.exportEvent(event('agentfootprint.agent.turn_start'));
    strat.exportEvent(event('agentfootprint.agent.iteration_start', { iteration: 1 }));
    strat.exportEvent(event('agentfootprint.stream.llm_start'));
    strat.exportEvent(event('agentfootprint.stream.llm_end'));
    strat.exportEvent(event('agentfootprint.agent.iteration_end'));
    strat.exportEvent(event('agentfootprint.agent.turn_end'));
    expect(spans).toHaveLength(0);
  });

  it('P4 sampleRate=1 (default) emits all events that have a turn anchor', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    strat.exportEvent(event('agentfootprint.agent.turn_start'));
    strat.exportEvent(event('agentfootprint.agent.turn_end'));
    expect(spans.length).toBeGreaterThan(0);
  });
});

// ─── P5 Security ─────────────────────────────────────────────────────

describe('otelObservability — P5 security', () => {
  it('P5 missing serviceName throws TypeError at factory time', () => {
    const { tracer } = makeMockTracer();
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      otelObservability({ serviceName: '' as any, tracer }),
    ).toThrow(TypeError);
  });

  it('P5 events without runId are dropped silently', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    strat.exportEvent({
      type: 'agentfootprint.agent.turn_start' as never,
      payload: {}, // no runId
      timestamp: Date.now(),
    } as unknown as AgentfootprintEvent);
    expect(spans).toHaveLength(0);
  });

  it('P5 missing @opentelemetry/api + no tracer → throws helpful install hint at first event', () => {
    const strat = otelObservability({ serviceName: 'svc' });
    expect(() => strat.exportEvent(event('agentfootprint.agent.turn_start'))).toThrow(
      /opentelemetry|api|peer dependency/i,
    );
  });

  it('P5 tool_end with error: payload sets ERROR status on the tool span', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    strat.exportEvent(event('agentfootprint.agent.turn_start'));
    strat.exportEvent(event('agentfootprint.stream.tool_start', { toolName: 'flaky' }));
    strat.exportEvent(
      event('agentfootprint.stream.tool_end', { toolName: 'flaky', error: 'timeout' }),
    );
    strat.exportEvent(event('agentfootprint.agent.turn_end'));
    const tool = spans.find((s) => s.name === 'tool:flaky')!;
    expect(tool.status?.code).toBeDefined();
    expect(tool.status?.code).not.toBe(0); // not OK
  });
});

// ─── P6 Performance ──────────────────────────────────────────────────

describe('otelObservability — P6 performance', () => {
  it('P6 10k mixed events processed under 200ms', () => {
    const { tracer } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    const t0 = performance.now();
    for (let turn = 0; turn < 1000; turn++) {
      const runId = `r-${turn}`;
      const evt = (type: string, extra: Record<string, unknown> = {}): AgentfootprintEvent =>
        ({
          type: type as never,
          payload: { runId, ...extra },
          timestamp: Date.now(),
        } as unknown as AgentfootprintEvent);
      strat.exportEvent(evt('agentfootprint.agent.turn_start'));
      strat.exportEvent(evt('agentfootprint.agent.iteration_start', { iteration: 1 }));
      strat.exportEvent(evt('agentfootprint.stream.llm_start', { model: 'm' }));
      strat.exportEvent(evt('agentfootprint.stream.llm_end'));
      strat.exportEvent(evt('agentfootprint.stream.tool_start', { toolName: 't' }));
      strat.exportEvent(evt('agentfootprint.stream.tool_end', { toolName: 't' }));
      strat.exportEvent(evt('agentfootprint.agent.iteration_end'));
      strat.exportEvent(evt('agentfootprint.agent.turn_end'));
      strat.exportEvent(evt('agentfootprint.cost.tick', { cumulativeCostUsd: 0.001 }));
      strat.exportEvent(evt('agentfootprint.context.injected'));
    }
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(200);
  });
});

// ─── P7 ROI — semconv compliance + cost annotation + stop() ──────────

describe('otelObservability — P7 ROI', () => {
  it('P7 cost.tick annotates the topmost active span with cost.cumulative_usd', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    strat.exportEvent(event('agentfootprint.agent.turn_start'));
    strat.exportEvent(event('agentfootprint.agent.iteration_start', { iteration: 1 }));
    strat.exportEvent(event('agentfootprint.cost.tick', { cumulativeCostUsd: 0.0234 }));
    strat.exportEvent(event('agentfootprint.agent.iteration_end'));
    strat.exportEvent(event('agentfootprint.agent.turn_end'));
    const iter = spans.find((s) => s.name === 'iteration:1')!;
    expect(iter.attributes['cost.cumulative_usd']).toBe(0.0234);
  });

  it('P7 stop() ends any in-flight spans defensively (no leaks)', () => {
    const { tracer, spans } = makeMockTracer();
    const strat = otelObservability({ serviceName: 'svc', tracer });
    strat.exportEvent(event('agentfootprint.agent.turn_start'));
    strat.exportEvent(event('agentfootprint.agent.iteration_start', { iteration: 1 }));
    // Don't send turn_end / iteration_end — simulate process exit.
    strat.stop?.();
    expect(spans.every((s) => s.ended)).toBe(true);
  });
});
