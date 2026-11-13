import { describe, expect, it } from 'vitest';
import { otelObservability, type OtelObservabilityOptions } from '../otel.js';
import { makeCapture, envelope } from '../../../../test/helpers/otelCapture.js';

describe('OTel factory wiring', () => {
  it('preserves option accessor order and leaves serviceName/error hooks live', () => {
    const capture = makeCapture();
    const reads: string[] = [];
    let service = 'before';
    const seen: string[] = [];
    const values: Omit<OtelObservabilityOptions, 'serviceName'> = {
      tracer: capture.tracer,
      _otelApi: capture.otelApi,
      onError: () => seen.push('option'),
    };
    const opts = new Proxy(
      {
        ...values,
        get serviceName() {
          return service;
        },
      },
      {
        get(target, key, receiver) {
          reads.push(String(key));
          return Reflect.get(target, key, receiver);
        },
      },
    );
    const strategy = otelObservability(opts);
    expect(reads).toEqual([
      'serviceName',
      'sampleRate',
      'genAiSpanNames',
      'explainability',
      'scopeName',
      'captureContent',
      'captureToolContent',
      'maxContentChars',
      'conversationId',
      'checkAccounting',
      'tracer',
      '_otelApi',
    ]);
    service = 'after';
    strategy.exportEvent(envelope('agentfootprint.agent.turn_start', {}));
    expect(capture.spans[0]?.name).toBe('after');
    strategy.exportEvent(envelope('agentfootprint.eval.score', {}));
    expect(seen).toEqual(['option']);
    strategy._onError = () => {
      seen.push('replacement');
    };
    strategy.exportEvent(envelope('agentfootprint.eval.score', {}));
    expect(seen).toEqual(['option', 'replacement']);
    strategy.stop?.();
  });
});
