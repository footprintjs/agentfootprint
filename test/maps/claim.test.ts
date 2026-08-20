/**
 * Claim<T> — the honesty primitive: an unknown can never render as a zero,
 * because the type has no door from `unknown` to `.value`.
 *
 * Test types (Convention 3): unit (constructors, guards) / contract (the
 * describe sentence states the standing, never a bare gap).
 */

import { describe, expect, it } from 'vitest';
import {
  describeClaim,
  isKnown,
  known,
  notApplicable,
  unknown,
  valueOr,
} from '../../src/doors/maps.js';

describe('unit: constructors and the one door to the value', () => {
  it('known carries value + evidence; isKnown is the only door', () => {
    const c = known(11, 'the app declared total');
    expect(isKnown(c)).toBe(true);
    if (isKnown(c)) expect(c.value).toBe(11);
    expect(c.evidence).toBe('the app declared total');
  });

  it('unknown demands a reason and never yields a value', () => {
    const c = unknown<number>('nobody measured it');
    expect(isKnown(c)).toBe(false);
    expect(c.kind).toBe('unknown');
    // valueOr forces the caller to STATE the fallback — no silent undefined.
    expect(valueOr(c, -1)).toBe(-1);
  });

  it('notApplicable is its own standing, not a flavor of unknown', () => {
    const c = notApplicable<number>('a decision tree holds no cursor');
    expect(c.kind).toBe('not-applicable');
    expect(valueOr(c, 0)).toBe(0);
  });

  it('claims are plain data — they survive structuredClone byte-for-byte', () => {
    const c = known({ a: 1 }, 'ev');
    expect(structuredClone(c)).toEqual(c);
  });
});

describe('contract: the rendered sentence states the standing', () => {
  it('renders known with evidence, unknown with reason, n/a with why', () => {
    expect(describeClaim(known(4, 'served rows'))).toBe('4 (served rows)');
    expect(describeClaim(unknown('cap applied by nobody'))).toBe('unknown — cap applied by nobody');
    expect(describeClaim(notApplicable('no cursor on a tree'))).toBe(
      'not applicable — no cursor on a tree',
    );
  });
});
