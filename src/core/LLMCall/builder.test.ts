import { expect, it } from 'vitest';
import { LLMCall, LLMCallBuilder } from '../LLMCall.js';
import { MockProvider } from '../../adapters/llm/MockProvider.js';

it('preserves the fluent builder behind a Proxy and its instance keys', async () => {
  const builder = new LLMCallBuilder({
    provider: new MockProvider({ reply: 'complete' }),
    model: 'mock',
  });
  expect(Object.keys(builder)).toEqual(['opts', 'systemPromptValue', 'systemPromptSet']);
  const proxy = new Proxy(builder, { get: Reflect.get });
  expect(proxy.system('preserve the complete prompt')).toBe(proxy);
  expect(() => proxy.system('a replacement')).toThrow('already set');
  const runner = proxy.build();
  expect(runner).toBeInstanceOf(LLMCall);
  expect(await runner.run({ message: 'hello' })).toBe('complete');
});
