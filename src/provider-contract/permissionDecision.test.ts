import { describe, expect, it } from 'vitest';

import { readPermissionDecision } from './permissionDecision.js';

describe('readPermissionDecision', () => {
  it('allows only a known allow, and keeps which one', () => {
    expect(readPermissionDecision({ result: 'allow' })).toEqual({ kind: 'allow', result: 'allow' });
    expect(readPermissionDecision({ result: 'gate_open' })).toEqual({
      kind: 'allow',
      result: 'gate_open',
    });
  });

  it('keeps deny and halt as they are', () => {
    expect(readPermissionDecision({ result: 'deny' })).toEqual({ kind: 'deny' });
    expect(readPermissionDecision({ result: 'halt' })).toEqual({ kind: 'halt' });
  });

  it('refuses every other answer and says it was not recognised', () => {
    const odd: unknown[] = [
      { result: 'ask' },
      { result: 'ALLOW' },
      { result: 'deny ' },
      { result: null },
      { result: 1 },
      { result: { allow: true } },
      {},
      null,
      undefined,
      'allow',
    ];
    for (const answer of odd) {
      const reading = readPermissionDecision(answer);
      expect(reading.kind).toBe('unrecognised');
      if (reading.kind === 'unrecognised') expect(reading.rationale).toMatch(/not recognised/);
    }
  });

  it('names what it got, bounded, so an operator can see the typo', () => {
    const quote = (answer: unknown) => {
      const r = readPermissionDecision(answer);
      return r.kind === 'unrecognised' ? r.rationale : '';
    };
    expect(quote({ result: 'deny ' })).toMatch(/got 'deny '$/);
    expect(quote({})).toMatch(/got no result$/);
    expect(quote(null)).toMatch(/got no decision$/);
    expect(quote({ result: null })).toMatch(/got null$/);
    expect(quote({ result: 7 })).toMatch(/got a number$/);
    expect(quote({ result: new String('allow') })).toMatch(/got an object$/);
    expect(quote({ result: { allow: true } })).toMatch(/got an object$/);
    expect(quote({ result: ['allow'] })).toMatch(/got an array$/);
    const revoked = Proxy.revocable([], {});
    revoked.revoke();
    expect(quote({ result: revoked.proxy })).toMatch(/got an object$/);
    expect(quote({ result: 'x'.repeat(500) }).length).toBeLessThan(200);
  });

  it('reads result once — a getter is not asked twice', () => {
    let reads = 0;
    const flipping = {
      get result() {
        reads += 1;
        return reads === 1 ? 'allow' : 'deny';
      },
    };
    expect(readPermissionDecision(flipping).kind).toBe('allow');
    expect(reads).toBe(1);
  });
});
