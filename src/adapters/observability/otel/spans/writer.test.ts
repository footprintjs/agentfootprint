import { describe, expect, it } from 'vitest';
import { makeCapture } from '../../../../../test/helpers/otelCapture.js';
import { createSpanWriter } from './writer.js';

describe('OTel span writer boundary', () => {
  it('reads the parent context before lazily acquiring a tracer', () => {
    const capture = makeCapture();
    const parent = capture.tracer.startSpan('parent');
    const calls: string[] = [];
    const writer = createSpanWriter(
      {
        serviceName: 'svc',
        _otelApi: {
          trace: {
            getTracer(scope) {
              calls.push(`get:${scope}`);
              return {
                startSpan(name, opts, ctx) {
                  calls.push('start');
                  return capture.tracer.startSpan(name, opts, ctx);
                },
              };
            },
            setSpan(ctx, span) {
              calls.push('parent');
              return capture.otelApi.trace.setSpan(ctx, span);
            },
          },
          context: {
            active() {
              calls.push('active');
              return {};
            },
            with: (_ctx, fn) => fn(),
          },
        },
      },
      'scope',
    );
    expect(calls).toEqual([]);
    writer.startSpanUnder(parent, 'child');
    expect(calls).toEqual(['active', 'parent', 'get:scope', 'start']);
    expect(capture.spans[1]?.parent).toBe(0);
  });

  it('caps before the flattened fallback and does not cap opened content twice', () => {
    const capture = makeCapture();
    const writer = createSpanWriter({ serviceName: 'svc', tracer: capture.tracer }, 'scope');
    const span = writer.startSpanUnder(undefined, 'root');
    span.addEvent = () => {
      throw new Error('exporter failure');
    };
    writer.recordSpanEvent(span, 'event', {
      label: 'a'.repeat(300),
      'gen_ai.task.input': 'x'.repeat(300),
    });
    expect(capture.spans[0]?.attributes['event.label']).toBe('a'.repeat(255) + '…');
    expect(capture.spans[0]?.attributes['event.gen_ai.task.input']).toBe('x'.repeat(300));
    writer.endSpan(span, { error: true });
    expect(capture.spans[0]?.status).toEqual({ code: 2 });
    expect(capture.spans[0]?.ended).toBe(true);
  });
});
