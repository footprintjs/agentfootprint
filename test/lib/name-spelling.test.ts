/**
 * ONE spelling owner for names and claim text — `lib/normalize.ts`.
 *
 * A resolved entity binds a sent value, and a delivered claim's text meets the
 * record's, by the same case rule: a foldable word (letters only, more than
 * three, not mixed case) may differ in case; a short word, a mixed-case one or
 * anything with a digit keeps its case. `ARRAY-X9` and `array-x9`, `MW` and
 * `mW` are different names.
 *
 * Sections: Unit · Contract.
 */

import { describe, expect, it } from 'vitest';

import { sameName } from '../../src/lib/normalize.js';
import { resolvedFor } from '../../src/semantics/coverage/search/binding.js';
import { compareClaimValues } from '../../src/integrity/unsupported-claim/evaluate.js';

describe('sameName — unit', () => {
  it.each([
    ['payments', 'PAYMENTS', true],
    ['Payments', 'payments', true],
    [' payments ', 'payments', true],
    ['ARRAY-X9', 'array-x9', false],
    ['MW', 'mW', false],
    ['iPhone', 'iphone', false],
    ['pay-svc', 'pay-svc', true],
  ])('%s vs %s → %s', (a, b, same) => {
    expect(sameName(a, b)).toBe(same);
  });
});

describe('sameName — contract: one rule with the claim comparator', () => {
  it.each([
    ['payments', 'PAYMENTS'],
    ['ARRAY-X9', 'array-x9'],
    ['MW', 'mW'],
    ['Settled', 'SETTLED'],
  ])('%s / %s: same name exactly when the comparator agrees', (a, b) => {
    expect(sameName(a, b)).toBe(compareClaimValues(a, b) === 'agrees');
  });

  it('a resolved entity binds a sent value only under that rule', () => {
    const resolved = [{ argument: 'array', id: 'array-x9' }];
    expect(resolvedFor('array', 'ARRAY-X9', resolved)).toBeUndefined();
    expect(resolvedFor('array', 'array-x9', resolved)?.id).toBe('array-x9');
    expect(resolvedFor('service', 'PAYMENTS', [{ argument: 'service', id: 'payments' }])?.id).toBe(
      'payments',
    );
  });
});
