import { describe, expect, it } from 'vitest';
import { capAttrs, spanNamePart } from './bounds.js';
import { coverageAttrs, evaluationAttrs, toolContentAttrs } from './projections.js';

describe('OTel attribute boundaries', () => {
  it('keeps unaffected identity and insertion order; caps a copy without splitting a surrogate', () => {
    const untouched = { first: 'small', second: 3 };
    expect(capAttrs(untouched)).toBe(untouched);
    const original = { first: 'a'.repeat(254) + '😀end', second: 3 };
    const capped = capAttrs(original);
    expect(capped).not.toBe(original);
    expect(Object.keys(capped)).toEqual(['first', 'second']);
    expect(capped.first).toBe('a'.repeat(254) + '…');
    expect(original.first).toContain('😀end');
    expect(spanNamePart('a'.repeat(62) + '😀end')).toBe('a'.repeat(62) + '…');
  });

  it('caps structure lists, while explicitly opened content bypasses that cap', () => {
    const content = 'x'.repeat(300);
    const capped = capAttrs({
      names: Array.from({ length: 22 }, (_, i) => String(i)),
      'gen_ai.tool.call.result': content,
    });
    expect(capped.names).toEqual([...Array.from({ length: 20 }, (_, i) => String(i)), '…+2 more']);
    expect(capped['gen_ai.tool.call.result']).toBe(content);
  });

  it('exports non-object tool text on its own key and omits oversized values whole', () => {
    expect(toolContentAttrs('result', '123', 3)).toEqual({
      'agentfootprint.tool.result.content': '123',
    });
    expect(toolContentAttrs('result', '{"n":1}', 7)).toEqual({
      'gen_ai.tool.call.result': '{"n":1}',
    });
    expect(toolContentAttrs('result', '{"n":1}', 6)).toEqual({
      'agentfootprint.tool.result.omitted_chars': 7,
    });
    expect(toolContentAttrs('args', { value: 1n }, 100)).toEqual({});
  });

  it('never exports an unrecognized suggestion or the coverage author’s sentences', () => {
    const attrs = coverageAttrs(
      {
        toolName: 'lookup',
        toolCallId: 'call',
        checked: [{ what: 'private' }],
        tryInsteadTool: { tool: 'private tool sentence', why: 'private reason' },
      },
      () => false,
    );
    expect(attrs).toEqual({
      'gen_ai.tool.name': 'lookup',
      'gen_ai.tool.call.id': 'call',
      'agentfootprint.coverage.checked.count': 1,
      'agentfootprint.coverage.not_checked.count': 0,
      'agentfootprint.coverage.cannot_cover.count': 0,
      'agentfootprint.coverage.try_instead.unregistered': true,
    });
  });

  it('exports an evaluation explanation only when enabled, complete, and within its ceiling', () => {
    const score = { metricId: 'quality', value: 0, explanation: 'private reason' };
    expect(evaluationAttrs(score, false, 3)).toEqual({
      'gen_ai.evaluation.name': 'quality',
      'gen_ai.evaluation.score.value': 0,
    });
    expect(evaluationAttrs(score, true, 3)).toEqual({
      'gen_ai.evaluation.name': 'quality',
      'gen_ai.evaluation.score.value': 0,
      'agentfootprint.eval.explanation.omitted_chars': 14,
    });
  });
});
