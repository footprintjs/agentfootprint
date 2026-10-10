import { describe, expect, it } from 'vitest';
import { defineSkill } from '../../../src/injection-engine.js';

describe('current skill option vocabulary', () => {
  const base = { id: 'billing', description: 'd', body: 'b' };
  it('accepts structurally valid class options and inherited supported getters', () => {
    class Options {
      id = 'billing';
      description = 'd';
      get body() {
        return 'b';
      }
    }
    expect(defineSkill(new Options()).inject.systemPrompt).toBe('b');
    expect(() => defineSkill({ ...base, constructor: 'not an option' })).toThrow(
      'unsupported option constructor',
    );
  });
  it.each(['refreshPolicy', 'viaToolName', 'surfaceMod'])(
    'refuses unsupported %s without printing its value',
    (key) => {
      expect(() => defineSkill({ ...base, [key]: 'PRIVATE' })).toThrow(
        `defineSkill(billing): unsupported option ${key}.`,
      );
    },
  );
  it.each([true, false])('refuses inherited unknown options (enumerable=%s)', (enumerable) => {
    const parent = Object.defineProperty({}, 'viaToolName', { value: 'PRIVATE', enumerable });
    const options = Object.assign(Object.create(parent), base);
    expect(() => defineSkill(options)).toThrow('unsupported option viaToolName');
  });
  it('does not evaluate unknown getters', () => {
    let evaluated = false;
    const options = Object.defineProperty({ ...base }, 'refreshPolicy', {
      get() {
        evaluated = true;
        throw new Error('must not run');
      },
    });
    expect(() => defineSkill(options)).toThrow('unsupported option refreshPolicy');
    expect(evaluated).toBe(false);
  });
  it('leaves the supported declaration and metadata unchanged', () => {
    const skill = defineSkill({ ...base, surfaceMode: 'both' });
    expect(skill.metadata).toEqual({ surfaceMode: 'both', cache: 'while-active' });
    expect(skill.trigger).toEqual({ kind: 'llm-activated', viaToolName: 'read_skill' });
  });
});
