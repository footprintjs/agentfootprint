/** Pure protocol adapter over real receipt ports; no runtime feature is mounted. */
import { describe, expect, it, vi } from 'vitest';
import { describedResult } from '../../../../src/index.js';
import { known, unknown as unknownValue } from '../../../../src/doors/maps.js';
import { readSemantics, semanticsForModel } from '../../../../src/semantics/envelope.js';
import {
  captureDispatch,
  captureReturnedEvidence,
  evidenceSnapshot,
  finalizeEvidence,
} from '../../../../src/integrity/claim-binding/capture.js';
import type {
  ClaimBindingRule,
  ResultEvidence,
  ScopeDeclaration,
} from '../../../../src/integrity/claim-binding/types.js';
import {
  checkFindingClaim,
  type FindingClaimCheckInput,
} from '../../../../src/core/agent/findings/verificationCheck.js';
import { readClaimVerificationRow } from '../../../../src/core/agent/findings/verificationRow.js';

const declaration: ScopeDeclaration = {
  id: 'population',
  version: 'one',
  dimensions: [{ name: 'population', argumentPath: ['population'] }],
};
const rule: ClaimBindingRule = {
  id: 'count',
  version: 'one',
  toolName: 'read_count',
  scopeDeclaration: declaration,
  fact: { entity: { scopeDimension: 'population' }, field: 'count' },
  coverage: () => 'complete',
};

function receipt(value: unknown = 7, ordinal = 1, overrides: Partial<ResultEvidence> = {}) {
  const original = describedResult({
    facts: [{ entity: 'north', count: value }],
    provenance: { measuredAt: '2026-10-01T00:00:00Z', source: 'synthetic fixture' },
    coverage: { checked: ['north population'] },
  });
  const semantics = readSemantics(original);
  if (semantics === undefined) throw new Error('Fixture requires real semantic evidence.');
  const dispatch = captureDispatch(
    { namespace: 'record', runId: 'run', ordinal },
    { toolName: 'read_count', toolCallId: 'duplicate-provider-id', iteration: 0 },
    { population: 'north' },
    declaration,
  );
  return {
    ...finalizeEvidence(
      dispatch,
      captureReturnedEvidence(dispatch, original),
      semanticsForModel(semantics),
      {
        completed: true,
        resultVisible: true,
        scopeVisible: true,
      },
    ),
    ...overrides,
  };
}

function input(value: unknown = 7, result = receipt()): FindingClaimCheckInput {
  return {
    identity: { namespace: 'record', runId: 'run', ordinal: 2 },
    declaredOn: { toolCallId: 'declaring-call' },
    standing: 'fact',
    iteration: 1,
    request: { value, check: { rule: 'count' } },
    parentResult: result.id,
    snapshot: evidenceSnapshot('record', ['run'], [result]),
    rules: [rule],
  };
}

describe('typed findings verification adapter', () => {
  it('binds an exact result then records a scoped comparison beside the declaration', () => {
    const row = checkFindingClaim(input());
    expect(row.outcome).toBe('supported');
    expect(row.reason).toBe('no-conflict');
    expect(row.standing).toBe('fact');
    expect(row.declaredValue).toBe(7);
    expect(row.declaredRule).toBe('count');
    expect(row.resolved?.rule).toEqual({ id: 'count', version: 'one' });
    expect(row.resolved?.scope).toEqual({ population: 'north' });
    expect(row.resolved?.evidence).toEqual({
      subject: { kind: 'entity', id: 'north' },
      predicate: 'count',
      value: 7,
      stratum: 'asserted',
      provenance: `result ${row.declaredResult}`,
    });
    expect(row.claimId).not.toBe(row.declaredResult);
    expect(readClaimVerificationRow(JSON.parse(JSON.stringify(row)))).toEqual(row);
  });

  it.each(['fact', 'open', 'ruled-out'] as const)(
    'does not rewrite the model %s standing',
    (standing) => {
      const row = checkFindingClaim({ ...input(), standing });
      expect(row.standing).toBe(standing);
      expect(row.outcome).toBe('supported');
      expect(row.resolved?.claim.stratum).toBe('asserted');
    },
  );

  it('uses the existing one-direction numeric leniency without replacing declared text', () => {
    const row = checkFindingClaim(input(' 7 '));
    expect(row).toMatchObject({
      outcome: 'supported',
      reason: 'numeric-leniency',
      declaredValue: ' 7 ',
    });
    expect(row.resolved?.claim.value).toBe(' 7 ');
    expect(checkFindingClaim(input(7, receipt('7')))).toMatchObject({
      outcome: 'contradicted',
      reason: 'conflict',
    });
  });

  it.each([0, false, '', { nested: [1, 2] }])(
    'checks actual eligible falsy/structured value %j',
    (value) => {
      expect(checkFindingClaim(input(value, receipt(value))).outcome).toBe('supported');
    },
  );

  it('records a contradiction with the exact selected evidence and literal claim', () => {
    const row = checkFindingClaim(input(8));
    expect(row).toMatchObject({ outcome: 'contradicted', reason: 'conflict', declaredValue: 8 });
    expect(row.resolved?.evidence.value).toBe(7);
    expect(row.resolved?.claim.value).toBe(8);
  });

  it('keeps tagged known values and delegates their comparable face to the shared owners', () => {
    const value = known(7, 'fixture');
    const row = checkFindingClaim(input(value, receipt(value)));
    expect(row.outcome).toBe('supported');
    expect(row.declaredValue).toEqual(value);
    expect(row.resolved?.evidence.value).toEqual(value);
  });

  it.each([null, 'unknown', unknownValue('not measured')])(
    'never promotes nonparticipation %j to support',
    (value) => {
      for (const args of [input(value), input(7, receipt(value))]) {
        const row = checkFindingClaim(args);
        expect(row).toMatchObject({ outcome: 'unverified', reason: 'unasserted-value' });
        expect(row).not.toHaveProperty('resolved');
      }
    },
  );

  it('never runs the binder/author callback for noise', () => {
    const coverage = vi.fn(() => 'complete' as const);
    const row = checkFindingClaim({
      ...input(),
      standing: 'noise',
      rules: [{ ...rule, coverage }],
    });
    expect(row).toMatchObject({
      standing: 'noise',
      outcome: 'unverified',
      reason: 'ineligible-noise',
      declaredValue: 7,
    });
    expect(row).not.toHaveProperty('resolved');
    expect(coverage).not.toHaveBeenCalled();
  });

  it('retains bounded declarations with no check and never invents result or rule refs', () => {
    const { parentResult: _result, ...args } = input();
    const row = checkFindingClaim({ ...args, request: { value: { count: 7 } } });
    expect(row).toMatchObject({
      outcome: 'unverified',
      reason: 'missing-check',
      declaredValue: { count: 7 },
    });
    expect(row).not.toHaveProperty('declaredResult');
    expect(row).not.toHaveProperty('declaredRule');
    expect(row).not.toHaveProperty('resolved');
  });

  it.each([null, {}, [], { rule: 1 }, { rule: '' }, { rule: 'count', scope: 'invented' }])(
    'records malformed check %j instead of inventing selectors',
    (check) => {
      const row = checkFindingClaim({ ...input(), request: { value: 7, check } });
      expect(row).toMatchObject({
        outcome: 'unverified',
        reason: 'malformed-check',
        declaredValue: 7,
      });
      expect(row).not.toHaveProperty('resolved');
    },
  );

  it('refuses accessor checks without invoking them and records a malformed-check reason', () => {
    const getter = vi.fn(() => 'count');
    const check = Object.defineProperty({}, 'rule', { enumerable: true, get: getter });
    expect(checkFindingClaim({ ...input(), request: { value: 7, check } }).reason).toBe(
      'malformed-check',
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it('does not accept model-invented scope or resolved evidence on the compact request', () => {
    const row = checkFindingClaim({
      ...input(),
      request: { value: 7, check: { rule: 'count' }, scope: { population: 'south' } },
    });
    expect(row).toMatchObject({ outcome: 'unverified', reason: 'malformed-check' });
  });

  it('records a new unretained result after exhaustion without evaluating a rule', () => {
    const coverage = vi.fn(() => 'complete' as const);
    const row = checkFindingClaim({
      ...input(),
      parentResult: receipt(8, 2).id,
      retentionLimited: true,
      rules: [{ ...rule, coverage }],
    });
    expect(row).toMatchObject({ outcome: 'unverified', reason: 'retention-limit' });
    expect(row).not.toHaveProperty('resolved');
    expect(coverage).not.toHaveBeenCalled();
  });

  it('keeps old retained evidence eligible after later capacity exhaustion', () => {
    const row = checkFindingClaim({ ...input(), retentionLimited: true });
    expect(row).toMatchObject({ outcome: 'supported', reason: 'no-conflict' });
    const result = receipt();
    expect(
      checkFindingClaim({
        ...input(),
        retentionLimited: true,
        snapshot: evidenceSnapshot('record', ['run'], [result, result]),
      }).reason,
    ).toBe('ambiguous-result');
    expect(checkFindingClaim({ ...input(), retentionLimited: true, rules: [] }).reason).toBe(
      'unknown-rule',
    );
  });

  it('requires legacy subject kind, id and predicate to match the selected assertion exactly', () => {
    const full = {
      value: 7,
      check: { rule: 'count' },
      subject: { kind: 'entity', id: 'north' },
      predicate: 'count',
    };
    expect(checkFindingClaim({ ...input(), request: full }).outcome).toBe('supported');
    for (const patch of [
      { subject: { kind: 'port', id: 'north' } },
      { subject: { kind: 'entity', id: 'south' } },
      { predicate: 'revenue' },
      { subject: null },
      { subject: { kind: 'entity', id: 'north', extra: true } },
    ]) {
      const row = checkFindingClaim({ ...input(), request: { ...full, ...patch } });
      expect(row).toMatchObject({ outcome: 'unverified', reason: 'assertion-mismatch' });
      expect(row).not.toHaveProperty('resolved');
    }
    for (const partial of [{ subject: full.subject }, { predicate: full.predicate }])
      expect(
        checkFindingClaim({ ...input(), request: { value: 7, check: full.check, ...partial } })
          .reason,
      ).toBe('assertion-mismatch');
  });

  it.each(['partial', 'unknown', 'stale'] as const)(
    'does not call equal values supported under %s coverage',
    (coverage) => {
      const row = checkFindingClaim({ ...input(), rules: [{ ...rule, coverage: () => coverage }] });
      expect(row).toMatchObject({ outcome: 'unverified', reason: `coverage-${coverage}` });
      expect(row).not.toHaveProperty('resolved');
    },
  );

  it('keeps scope mismatches unverified despite equal numeric values', () => {
    expect(checkFindingClaim({ ...input(), intendedScope: { population: 'south' } })).toMatchObject(
      { outcome: 'unverified', reason: 'scope-mismatch' },
    );
  });

  it('uses exact occurrence refs despite repeated tool ids and later writes', () => {
    const first = receipt(7, 1);
    const later = receipt(9, 2);
    const args = { ...input(), snapshot: evidenceSnapshot('record', ['run'], [first, later]) };
    expect(checkFindingClaim({ ...args, parentResult: first.id }).outcome).toBe('supported');
    expect(checkFindingClaim({ ...args, parentResult: later.id }).outcome).toBe('contradicted');
    expect(checkFindingClaim({ ...args, parentResult: 'duplicate-provider-id' }).reason).toBe(
      'invalid-claim',
    );
  });

  it('reports unavailable and ambiguous evidence without exposing the raw receipt', () => {
    const result = receipt();
    const unavailable = { ...result, unavailable: 'withheld-evidence' as const };
    delete unavailable.scope;
    delete unavailable.facts;
    delete unavailable.coverage;
    const row = checkFindingClaim(input(7, unavailable));
    expect(row).toMatchObject({ outcome: 'unverified', reason: 'withheld-evidence' });
    expect(row).not.toHaveProperty('resolved');
    expect(
      checkFindingClaim({
        ...input(),
        snapshot: evidenceSnapshot('record', ['run'], [result, result]),
      }).reason,
    ).toBe('ambiguous-result');
  });

  it('preserves missing result, unknown rule and malformed evidence as distinct failures', () => {
    const { parentResult: _result, ...args } = input();
    expect(checkFindingClaim(args).reason).toBe('missing-result');
    expect(checkFindingClaim({ ...input(), rules: [] }).reason).toBe('unknown-rule');
    expect(
      checkFindingClaim({
        ...input(),
        snapshot: { version: 1, namespace: 'record', runIds: [], results: [] },
      }).reason,
    ).toBe('missing-result');
    expect(
      checkFindingClaim({
        ...input(),
        snapshot: {
          ...input().snapshot,
          version: 2,
        } as unknown as FindingClaimCheckInput['snapshot'],
      }).reason,
    ).toBe('invalid-evidence');
  });

  it('calls the bound rule once, never at row restore, and returns detached immutable data', () => {
    const coverage = vi.fn(() => 'complete' as const);
    const normalize = vi.fn((value: unknown) => value);
    const selectedRule = {
      ...rule,
      coverage,
      scopeDeclaration: {
        ...declaration,
        dimensions: [{ ...declaration.dimensions[0]!, normalize }],
      },
    };
    const value = { nested: [7] };
    const args = { ...input(value, receipt(value)), rules: [selectedRule] };
    const row = checkFindingClaim(args);
    expect(coverage).toHaveBeenCalledTimes(1);
    expect(normalize).not.toHaveBeenCalled();
    value.nested[0] = 999;
    expect(row.declaredValue).toEqual({ nested: [7] });
    expect(Object.isFrozen(row.declaredValue)).toBe(true);
    expect(readClaimVerificationRow(JSON.parse(JSON.stringify(row)))).toEqual(row);
    expect(coverage).toHaveBeenCalledTimes(1);
    expect(normalize).not.toHaveBeenCalled();
  });

  it('never substitutes a value for missing or unsafe declarations', () => {
    const getter = vi.fn(() => 7);
    for (const request of [
      {},
      { value: undefined },
      { value: NaN },
      { value: 'x'.repeat(8192) },
      Object.defineProperty({}, 'value', { enumerable: true, get: getter }),
    ])
      expect(() => checkFindingClaim({ ...input(), request })).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
});
