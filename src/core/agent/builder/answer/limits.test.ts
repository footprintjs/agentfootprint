import { describe, expect, it } from 'vitest';
import { configureAnswerLimits, type AnswerLimitsPort } from './limits.js';

describe('the builder answer-limit declaration', () => {
  it('returns the actual fluent object and refuses another boundary without another write', () => {
    let writes = 0;
    let armed = false;
    const receiver: AnswerLimitsPort = {
      get limitsTravelValue() {
        return armed;
      },
      set limitsTravelValue(value) {
        writes += 1;
        armed = value;
      },
    };
    const original = {};
    expect(configureAnswerLimits(receiver, original)).toBe(original);
    expect(() => configureAnswerLimits(receiver, original)).toThrow(/one coverage block/i);
    expect(writes).toBe(1);
  });
});
