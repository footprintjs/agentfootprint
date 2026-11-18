import { describe, expect, it } from 'vitest';
import { configureSkillToolScope, type SkillToolScopePort } from './scope.js';

describe('the builder active-skill tool posture', () => {
  it('arms the live posture once and preserves the original fluent object', () => {
    const writes: boolean[] = [];
    let armed = false;
    const receiver: SkillToolScopePort = {
      get toolsFromActiveSkillValue() {
        return armed;
      },
      set toolsFromActiveSkillValue(value) {
        writes.push(value);
        armed = value;
      },
    };
    const original = {};
    expect(configureSkillToolScope(receiver, original)).toBe(original);
    expect(() => configureSkillToolScope(receiver, original)).toThrow(/one posture/i);
    expect(writes).toEqual([true]);
  });
});
