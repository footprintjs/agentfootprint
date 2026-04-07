/**
 * Sample 25: OpenTelemetry Recorder
 *
 * OTelRecorder exports agent events as OpenTelemetry spans.
 * Takes a duck-typed Tracer — zero @opentelemetry dependency.
 *
 * Follows OpenTelemetry Semantic Conventions for GenAI:
 *   - gen_ai.system, gen_ai.request.model, gen_ai.usage.*
 *   - tool.name, tool.latency_ms
 */
import { describe, it, expect } from 'vitest';
import { OTelRecorder } from '../../src/recorders/v2/OTelRecorder';
import type { OTelTracer } from '../../src/recorders/v2/OTelRecorder';

// Mock tracer that captures spans
interface MockSpan {
  name: string;
  attributes: Record<string, string | number | boolean>;
  ended: boolean;
  status?: { code: number; message?: string };
}

function mockTracer(): OTelTracer & { spans: MockSpan[] } {
  const spans: MockSpan[] = [];
  return {
    spans,
    startSpan(name: string, options?: { attributes?: Record<string, string | number | boolean> }) {
      const span: MockSpan = {
        name,
        attributes: { ...(options?.attributes ?? {}) },
        ended: false,
      };
      spans.push(span);
      return {
        setAttribute(key: string, value: string | number | boolean) { span.attributes[key] = value; },
        setStatus(status: { code: number; message?: string }) { span.status = status; },
        end() { span.ended = true; },
      };
    },
  };
}

describe('Sample 25: OTelRecorder', () => {
  it('creates turn span on turn start, ends on turn complete', () => {
    const tracer = mockTracer();
    const rec = new OTelRecorder(tracer);

    rec.onTurnStart({ turnNumber: 1, message: 'Hello' });
    expect(tracer.spans).toHaveLength(1);
    expect(tracer.spans[0].name).toBe('agent.turn');
    expect(tracer.spans[0].ended).toBe(false); // still open

    rec.onTurnComplete({ turnNumber: 1, content: 'Hi!', messageCount: 2, totalLoopIterations: 1 });
    expect(tracer.spans[0].ended).toBe(true);
    expect(tracer.spans[0].attributes['agent.iterations']).toBe(1);
  });

  it('creates gen_ai.chat span for LLM calls with semantic convention attributes', () => {
    const tracer = mockTracer();
    const rec = new OTelRecorder(tracer);

    rec.onLLMCall({
      model: 'claude-sonnet-4-20250514',
      usage: { inputTokens: 100, outputTokens: 50 },
      latencyMs: 420,
      turnNumber: 1,
      loopIteration: 1,
    });

    const span = tracer.spans.find(s => s.name === 'gen_ai.chat');
    expect(span).toBeDefined();
    expect(span!.attributes['gen_ai.request.model']).toBe('claude-sonnet-4-20250514');
    expect(span!.attributes['gen_ai.usage.input_tokens']).toBe(100);
    expect(span!.attributes['gen_ai.usage.output_tokens']).toBe(50);
    expect(span!.attributes['gen_ai.response.latency_ms']).toBe(420);
    expect(span!.ended).toBe(true);
  });

  it('creates tool span with error flag', () => {
    const tracer = mockTracer();
    const rec = new OTelRecorder(tracer);

    rec.onToolCall({
      toolName: 'lookup_order',
      args: { orderId: 'ORD-1' },
      result: { content: 'error', error: true },
      latencyMs: 5,
    });

    const span = tracer.spans.find(s => s.name === 'tool.lookup_order');
    expect(span).toBeDefined();
    expect(span!.attributes['tool.error']).toBe(true);
    expect(span!.ended).toBe(true);
  });

  it('creates error span with status code', () => {
    const tracer = mockTracer();
    const rec = new OTelRecorder(tracer);

    rec.onError({
      phase: 'llm',
      error: new Error('Rate limit exceeded'),
      turnNumber: 1,
    });

    const span = tracer.spans.find(s => s.name === 'agent.error');
    expect(span).toBeDefined();
    expect(span!.status?.code).toBe(2); // OTel ERROR
    expect(span!.status?.message).toBe('Rate limit exceeded');
  });

  it('clear() resets state safely', () => {
    const tracer = mockTracer();
    const rec = new OTelRecorder(tracer);

    rec.onTurnStart({ turnNumber: 1, message: 'Hi' });
    rec.clear();

    // onTurnComplete after clear should not throw
    rec.onTurnComplete({ turnNumber: 1, content: 'Bye', messageCount: 1, totalLoopIterations: 1 });
  });
});
