/** Dependency contract: the shared engine must preserve Agent's recording identity. */
import { describe, expect, it } from 'vitest';
import {
  assertionKey as sharedKey,
  comparableValueOf as sharedComparableValueOf,
  conflictsOf as sharedConflictsOf,
  participates as sharedParticipates,
  sameSubject as sharedSameSubject,
} from 'contextfootprint';
import { conflictsOf } from '../../src/integrity/assertion/conflicts.js';
import {
  assertionKey,
  comparableValueOf,
  participates,
  sameSubject,
  type Assertion,
} from '../../src/integrity/assertion/types.js';
import { known, unknown } from '../../src/lib/claim/claim.js';

const assertion = (value: unknown, over: Partial<Assertion> = {}): Assertion => ({
  subject: { kind: 'tool', id: 'inventory' },
  predicate: 'available',
  epoch: 7,
  stratum: 'asserted',
  provenance: 'shared-boundary fixture',
  value,
  ...over,
});

describe('shared assertion dependency boundary', () => {
  it('uses the shared value and subject helpers, rather than private copies', () => {
    expect(participates).toBe(sharedParticipates);
    expect(comparableValueOf).toBe(sharedComparableValueOf);
    expect(sameSubject).toBe(sharedSameSubject);
  });

  it('preserves existing recording keys and original witnesses through the shared comparison', () => {
    const first = assertion(known(false, 'registered availability'));
    const second = assertion(true, { provenance: 'offered tool schema' });
    const repeated = assertion(false);
    const assertions = [first, second, repeated];
    const conflicts = conflictsOf(assertions);
    expect(conflicts).toEqual(sharedConflictsOf(assertions, new Set(), assertionKey));
    expect(conflicts[0]?.key).toBe('tool\u0000inventory\u0000available\u00007');
    expect(conflicts[0]?.key).not.toBe(sharedKey(first));
    expect(conflicts[0]?.assertions[0]).toBe(first);
    expect(conflicts[0]?.assertions[1]).toBe(second);
    expect(conflicts[0]?.assertions[2]).toBe(repeated);
    expect(assertionKey(assertion(0, { epoch: undefined }))).toBe(
      'tool\u0000inventory\u0000available\u0000',
    );
  });

  it('retains the non-comparable boundaries and Agent Claim interoperability', () => {
    const observed = assertion(0);
    const excluded = [
      assertion(unknown('source unavailable')),
      assertion({ kind: 'not-applicable', reason: 'not measured' }),
      assertion(undefined),
      assertion(10, { stratum: 'quoted' }),
      assertion(10, { epoch: 6 }),
      assertion(10, { subject: { kind: 'tool', id: 'other' } }),
      assertion(10, { predicate: 'other' }),
    ];
    expect(conflictsOf([observed, ...excluded])).toEqual([]);
    expect(conflictsOf([observed, assertion(known(1, 'other source'))])).toHaveLength(1);
    expect(conflictsOf([observed, assertion(1)], new Set(['available']))).toEqual([]);
  });
});
