import { describe, expect, it, vi } from 'vitest';

import type { LLMProvider, LLMResponse } from '../../src/provider-contract/types.js';
import { withFallback } from '../../src/resilience/withFallback.js';
import { dispatchThinkingHandler, tagThinkingResponse } from '../../src/thinking/dispatch.js';
import type { ThinkingHandler } from '../../src/thinking/types.js';

const answer: LLMResponse = {
  content: 'answer',
  toolCalls: [],
  usage: { input: 1, output: 1 },
};

function reader(id: string): ThinkingHandler {
  return {
    id,
    normalize: vi.fn((raw: unknown) => [{ type: 'thinking' as const, content: String(raw) }]),
  };
}

describe('shared selected-provider thinking envelope', () => {
  it('does not clone a response with no thinking', () => {
    expect(tagThinkingResponse(answer, 'primary')).toBe(answer);
  });

  it('wraps the exact raw value without copying or altering other response fields', () => {
    const raw = [{ signature: 'signed', thinking: 'source' }];
    const response = { ...answer, rawThinking: raw };
    expect(tagThinkingResponse(response, '1')).toEqual({
      ...response,
      rawThinking: { answeredBy: '1', raw },
    });
    expect(response.rawThinking).toBe(raw);
    expect(tagThinkingResponse(response, '1').toolCalls).toBe(response.toolCalls);
  });

  it('routes only to the selected own handler, including a declared no-handler side', () => {
    const primary = reader('first');
    const fallback = reader('second');
    const dispatch = dispatchThinkingHandler('pair', { primary, fallback, empty: undefined });
    expect(dispatch.id).toBe('pair');
    expect(dispatch.normalize({ answeredBy: 'fallback', raw: 'fallback-wire' })).toEqual([
      { type: 'thinking', content: 'fallback-wire' },
    ]);
    expect(primary.normalize).not.toHaveBeenCalled();
    expect(fallback.normalize).toHaveBeenCalledExactlyOnceWith('fallback-wire');
    expect(dispatch.normalize({ answeredBy: 'empty', raw: 'opaque' })).toEqual([]);
  });

  it.each([null, 'raw', { answeredBy: 'other', raw: 'x' }, { answeredBy: 'toString', raw: 'x' }])(
    'does not guess a handler for an absent or unknown side: %j',
    (raw) => {
      const primary = reader('first');
      const dispatch = dispatchThinkingHandler('pair', { primary });
      expect(() => dispatch.normalize(raw)).toThrow(TypeError);
      expect(primary.normalize).not.toHaveBeenCalled();
    },
  );

  it('uses an explicit untagged reader without peeling unknown caller-owned content', () => {
    const primary = reader('first');
    const untagged = reader('untagged');
    const raw = { answeredBy: 'opaque-external-tag', raw: 'preserve' };
    dispatchThinkingHandler('pair', { primary }, untagged).normalize(raw);
    expect(untagged.normalize).toHaveBeenCalledExactlyOnceWith(raw);
    expect(primary.normalize).not.toHaveBeenCalled();
  });

  it('allows nested dispatch without confusing an outer and inner selected side', () => {
    const leaf = reader('leaf');
    const inner = dispatchThinkingHandler('inner', { fallback: leaf });
    const outer = dispatchThinkingHandler('outer', { primary: inner });
    outer.normalize({ answeredBy: 'primary', raw: { answeredBy: 'fallback', raw: 'leaf-wire' } });
    expect(leaf.normalize).toHaveBeenCalledExactlyOnceWith('leaf-wire');
  });

  it('keeps fallback’s strict untagged error and same-handler identity', async () => {
    const first = reader('first');
    const second = reader('second');
    const provider = (thinkingHandler: ThinkingHandler): LLMProvider => ({
      name: thinkingHandler.id,
      thinkingHandler,
      complete: async () => answer,
    });
    const same = withFallback(provider(first), provider(first));
    expect(same.thinkingHandler).toBe(first);
    expect(await same.complete({ messages: [] })).toBe(answer);
    const mixed = withFallback(provider(first), provider(second));
    expect(mixed.thinkingHandler?.id).toBe('first-or-second');
    expect(() => mixed.thinkingHandler?.normalize('untagged')).toThrow(
      "withFallback: this thinking does not say which side answered, so neither side's handler can read it",
    );
  });
});
