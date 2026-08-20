/**
 * Disposition accounting — silence is a state, not an absence (T9's substrate).
 *
 * The two theorems, pinned before any check exists:
 * (i)  a registered check that filed NO disposition while work existed fails
 *      the run — "zero findings" and "zero checks ran" are different states;
 * (ii) a check whose dev-posture canary was minted and never caught is dead
 *      even on a run with nothing real to find.
 *
 * Test types (Convention 3): unit (counters, report shape) / regression (the
 * wiring-rot alarm — the failure mode that killed two shipped checks) /
 * contract (synthetic counts never touch real ones).
 */

import { describe, expect, it } from 'vitest';
import { dispositionLedger, CheckerDeadError } from '../../src/integrity/disposition/ledger.js';

describe('unit: encounters aggregate into one honest row per (check, seam)', () => {
  it('counts pass/fail/not-applicable/unreachable separately, findings ≤ checked', () => {
    const l = dispositionLedger();
    l.register('duplicate-execution', 'choice');
    l.note('duplicate-execution', 'choice', 'checked-pass');
    l.note('duplicate-execution', 'choice', 'checked-fail', 1234);
    l.note('duplicate-execution', 'choice', 'not-applicable');
    l.note('duplicate-execution', 'choice', 'unreachable');
    expect(l.report()).toEqual([
      {
        check: 'duplicate-execution',
        seam: 'choice',
        checked: 2,
        findings: 1,
        notApplicable: 1,
        unreachable: 1,
        lastFiredAt: 1234,
        synthetic: 0,
      },
    ]);
  });

  it('lastFiredAt is absent until a finding fires — never a fabricated zero', () => {
    const l = dispositionLedger();
    l.register('invariant-violation', 'write');
    l.note('invariant-violation', 'write', 'checked-pass');
    expect('lastFiredAt' in l.report()[0]!).toBe(false);
  });
});

describe('regression: the wiring-rot alarm (theorem i)', () => {
  it('a clean run with real encounters passes', () => {
    const l = dispositionLedger();
    l.register('unsupported-argument', 'choice');
    l.note('unsupported-argument', 'choice', 'checked-pass');
    expect(() => l.assertAlive({ workExisted: true })).not.toThrow();
  });

  it('a registered check that filed nothing while work existed fails BY NAME', () => {
    const l = dispositionLedger();
    l.register('unsupported-argument', 'choice');
    expect(() => l.assertAlive({ workExisted: true })).toThrow(CheckerDeadError);
    expect(() => l.assertAlive({ workExisted: true })).toThrow(/unsupported-argument/);
  });

  it('a quiet run (no work) is healthy, and says nothing', () => {
    const l = dispositionLedger();
    l.register('unsupported-argument', 'choice');
    expect(() => l.assertAlive()).not.toThrow();
    expect(() => l.assertAlive({ workExisted: false })).not.toThrow();
  });
});

describe('contract: the canary (theorem ii) — synthetic counts stay apart', () => {
  it('minted and caught → alive; minted and NOT caught → checker_dead', () => {
    const l = dispositionLedger();
    l.register('invariant-violation', 'write');
    l.noteSynthetic('invariant-violation', 'write', 'minted');
    expect(() => l.assertAlive()).toThrow(/caught 0/);
    l.noteSynthetic('invariant-violation', 'write', 'caught');
    expect(() => l.assertAlive()).not.toThrow();
  });

  it('synthetic findings never touch the real numbers', () => {
    const l = dispositionLedger();
    l.register('invariant-violation', 'write');
    l.noteSynthetic('invariant-violation', 'write', 'minted');
    l.noteSynthetic('invariant-violation', 'write', 'caught');
    const row = l.report()[0]!;
    expect(row.findings).toBe(0);
    expect(row.checked).toBe(0);
    expect(row.synthetic).toBe(1);
  });

  it('a minted canary also satisfies theorem i (the mint proves wiring reaches the check)', () => {
    const l = dispositionLedger();
    l.register('invariant-violation', 'write');
    l.noteSynthetic('invariant-violation', 'write', 'minted');
    l.noteSynthetic('invariant-violation', 'write', 'caught');
    expect(() => l.assertAlive({ workExisted: true })).not.toThrow();
  });
});
