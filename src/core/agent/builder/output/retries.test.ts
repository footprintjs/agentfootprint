import { describe, expect, it } from 'vitest';
import { resolveRetries } from './retries.js';

describe('output correction budget', () => {
  it('defaults to no corrective re-asks', () => {
    expect(resolveRetries(undefined)).toBe(0);
  });

  it.each([0, 1, 10])('keeps the permitted integer budget %s', (retries) => {
    expect(resolveRetries(retries)).toBe(retries);
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'refuses the non-integer or negative budget %s',
    (retries) => {
      expect(() => resolveRetries(retries)).toThrow(/must be a non-negative integer/);
    },
  );

  it('refuses an integer above the stated ceiling and names the bound', () => {
    expect(() => resolveRetries(11)).toThrow(/retries: 11.*ceiling of 10/);
  });
});
