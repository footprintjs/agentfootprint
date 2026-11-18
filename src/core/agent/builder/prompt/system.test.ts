import { describe, expect, it } from 'vitest';
import { setSystem, type PromptPort } from './system.js';

describe('builder base prompt declaration', () => {
  it('keeps an empty prompt distinct from an unset prompt on the actual receiver', () => {
    const writes: PropertyKey[] = [];
    const state: PromptPort = {
      systemPromptSet: false,
      systemPromptValue: 'before',
      systemPromptCachePolicy: 'always',
      systemPromptCacheExplicit: false,
    };
    const receiver = new Proxy(state, {
      set(target, key, value, proxy) {
        writes.push(key);
        return Reflect.set(target, key, value, proxy);
      },
    });

    expect(setSystem(receiver, '', { cache: 'never' }, receiver)).toBe(receiver);
    expect(state).toEqual({
      systemPromptSet: true,
      systemPromptValue: '',
      systemPromptCachePolicy: 'never',
      systemPromptCacheExplicit: true,
    });
    expect(writes).toEqual([
      'systemPromptSet',
      'systemPromptValue',
      'systemPromptCachePolicy',
      'systemPromptCacheExplicit',
    ]);
    expect(() => setSystem(receiver, 'replacement', undefined, receiver)).toThrow(
      'AgentBuilder.system: already set.',
    );
    expect(state.systemPromptValue).toBe('');
  });
});
