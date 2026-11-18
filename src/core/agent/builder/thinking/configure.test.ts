import { describe, expect, it } from 'vitest';
import { setThinkingBudget, type ThinkingBudgetPort } from './configure.js';

describe('builder thinking budget', () => {
  it('refuses a non-positive or non-finite budget before changing the receiver', () => {
    const receiver: ThinkingBudgetPort = {};
    for (const budget of [0, -1, Infinity, NaN]) {
      expect(() => setThinkingBudget(receiver, { budget }, receiver)).toThrow(
        'positive finite number',
      );
      expect(receiver.thinkingBudgetValue).toBeUndefined();
    }
    expect(setThinkingBudget(receiver, { budget: 0.5 }, receiver)).toBe(receiver);
    expect(() => setThinkingBudget(receiver, { budget: 1 }, receiver)).toThrow('already set');
    expect(receiver.thinkingBudgetValue).toBe(0.5);
  });
});
