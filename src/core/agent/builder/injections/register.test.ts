import { describe, expect, it } from 'vitest';
import type { Injection } from '../../../../injection-engine/types.js';
import type { RecipeSource } from '../../../../recipes/provenance.js';
import { registerInjection, type InjectionPort } from './register.js';

const skill = (id: string): Injection => ({
  id,
  flavor: 'skill',
  trigger: { kind: 'always' },
  inject: { systemPrompt: 'Guidance' },
});

describe('the builder injection declaration', () => {
  it('attributes after registration and delegates a collision before reading its body', () => {
    const source: RecipeSource = { kind: 'recipe', stack: [{ id: 'guide', version: '1.0.0' }] };
    const receiver: InjectionPort = {
      injectionList: [],
      injectionSources: new Map(),
      currentSource() {
        expect(this).toBe(receiver);
        expect(this.injectionList).toHaveLength(1);
        return source;
      },
      duplicateRefusal(what, id, sources, door) {
        expect(this).toBe(receiver);
        expect([what, id, sources.get(id), door]).toEqual([
          'injection id',
          'guide',
          source,
          'Agent.injection()',
        ]);
        return 'both registrations are named';
      },
    };
    const first = skill('guide');
    expect(registerInjection(receiver, first, receiver)).toBe(receiver);
    expect(receiver.injectionSources.get('guide')).toBe(source);
    const duplicate: Injection = {
      ...skill('guide'),
      get inject(): never {
        throw new Error('a duplicate body must not be read');
      },
    };
    expect(() => registerInjection(receiver, duplicate, receiver)).toThrow(
      'both registrations are named',
    );
    expect(receiver.injectionList).toEqual([first]);
  });

  it('refuses tool-role messages before registration or source attribution', () => {
    const receiver: InjectionPort = {
      injectionList: [],
      injectionSources: new Map(),
      currentSource() {
        throw new Error('must not attribute a refused injection');
      },
      duplicateRefusal: () => 'duplicate',
    };
    const injection: Injection = {
      ...skill('hand-built'),
      inject: { messages: [{ role: 'tool', content: 'not an answer to a tool call' }] },
    };
    expect(() => registerInjection(receiver, injection, receiver)).toThrow(
      /hand-built.*role: 'tool'/,
    );
    expect(receiver.injectionList).toEqual([]);
    expect(receiver.injectionSources.size).toBe(0);
  });
});
