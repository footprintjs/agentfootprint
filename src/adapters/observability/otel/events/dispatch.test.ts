import { describe, expect, it } from 'vitest';
import { otelObservability } from '../../otel.js';
import { envelope, makeCapture } from '../../../../../test/helpers/otelCapture.js';

describe('OTel shared event owners', () => {
  it('a code-run event after proposal capture still withholds the program at completion', () => {
    const capture = makeCapture();
    const strategy = otelObservability({
      serviceName: 'svc', tracer: capture.tracer, captureToolContent: true,
    });
    strategy.exportEvent(envelope('agentfootprint.agent.turn_start', {}));
    strategy.exportEvent(envelope('agentfootprint.stream.tool_start', {
      toolName: 'runner', toolCallId: 'call', args: { code: 'private program' },
    }));
    strategy.exportEvent(envelope('agentfootprint.tools.code_run', { tool: 'runner' }));
    strategy.exportEvent(envelope('agentfootprint.stream.tool_end', {
      toolCallId: 'call', result: 'ok',
    }));
    expect(capture.spans[1]?.attributes['agentfootprint.tool.args.withheld']).toBe('code-runner');
    expect(capture.spans[1]?.attributes['gen_ai.tool.call.arguments']).toBeUndefined();
    expect(JSON.stringify(capture.spans)).not.toContain('private program');
    strategy.stop?.();
  });

  it('joins late scores to their own session and never guesses a live sibling', () => {
    const capture = makeCapture();
    const strategy = otelObservability({ serviceName: 'svc', tracer: capture.tracer, _otelApi: capture.otelApi });
    const start = (run: string, session: string) => strategy.exportEvent(envelope('agentfootprint.agent.turn_start', {}, run, { sessionId: session }));
    start('a', 'session-a'); start('b', 'session-b');
    strategy.exportEvent(envelope('agentfootprint.agent.turn_end', {}, 'a'));
    strategy.exportEvent(envelope('agentfootprint.eval.score', { metricId: 'quality', target: 'run', targetRef: 'a', value: 1 }, 'consumer-scope', { sessionId: 'session-a' }));
    expect(capture.spans[2]?.parent).toBe(0);
    strategy.exportEvent(envelope('agentfootprint.eval.score', { metricId: 'quality', target: 'run', targetRef: 'a', value: 0 }, 'consumer-scope', { sessionId: 'session-b' }));
    expect(capture.spans[3]?.parent).toBeNull();
    expect(capture.spans[3]?.root).toBe(true);
    expect(capture.spans[3]?.attributes['agentfootprint.eval.unparented']).toBe('owner-unverified');
    strategy.stop?.();
    const count = capture.spans.length;
    strategy.exportEvent(envelope('agentfootprint.eval.score', { metricId: 'quality' }, 'b'));
    expect(capture.spans).toHaveLength(count);
    expect(capture.spans.every(span => span.ended)).toBe(true);
  });
});
