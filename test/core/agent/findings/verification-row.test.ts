/** Saved protocol admission only: no checker or callbacks are run on restore. */
import { describe, expect, it, vi } from 'vitest';
import { unknown as unknownValue } from '../../../../src/doors/maps.js';
import {
  claimIdentityOf,
  readClaimIdentity,
  isClaimVerificationRow,
  readClaimVerificationRow,
  VERIFICATION_LIMITS,
} from '../../../../src/core/agent/findings/verificationRow.js';
import { resultIdentityOf } from '../../../../src/integrity/claim-binding/capture.js';
import { BINDING_LIMITS } from '../../../../src/integrity/claim-binding/scope.js';
import { VERIFICATION_UNVERIFIED_REASONS } from '../../../../src/core/agent/findings/verificationTypes.js';

const identity = { namespace: 'record', runId: 'run', ordinal: 1 };
const resultId = resultIdentityOf(identity);
function saved() {
  return {
    kind: 'claim-verification',
    claimId: claimIdentityOf(identity),
    declaredOn: { toolCallId: 'later-call' },
    standing: 'fact',
    iteration: 1,
    turn: 2,
    checker: { id: 'claim-pair', version: 1 },
    declaredResult: resultId,
    declaredRule: 'value-rule',
    declaredValue: 7,
    outcome: 'supported',
    reason: 'no-conflict',
    resolved: {
      resultId,
      rule: { id: 'value-rule', version: 'one' },
      scope: { population: 'north' },
      coverage: { checked: [{ what: 'north population' }], notChecked: [], cannotCover: [] },
      evidence: {
        subject: { kind: 'entity', id: 'north' },
        predicate: 'count',
        value: 7,
        stratum: 'asserted',
        provenance: `result ${resultId}`,
      },
      claim: {
        subject: { kind: 'entity', id: 'north' },
        predicate: 'count',
        value: 7,
        stratum: 'asserted',
        provenance: 'rule value-rule',
      },
    },
  };
}

function unverified(reason: string) {
  const { resolved: _resolved, ...row } = saved();
  const { declaredRule, ...rest } = row;
  return {
    ...rest,
    ...(reason !== 'missing-check' && { declaredRule }),
    outcome: 'unverified',
    reason,
  };
}

describe('claim verification saved rows', () => {
  it('reads, detaches and deeply freezes a JSON-restored row without altering its bytes', () => {
    const raw = saved();
    const before = JSON.stringify(raw);
    const row = readClaimVerificationRow(JSON.parse(before));
    expect(JSON.stringify(row)).toBe(before);
    expect(row).toEqual(raw);
    expect(Object.isFrozen(row)).toBe(true);
    expect(Object.isFrozen(row.resolved?.evidence.subject)).toBe(true);
    const detached = readClaimVerificationRow(raw);
    raw.resolved.scope.population = 'south';
    expect(detached.resolved?.scope).toEqual({ population: 'north' });
    expect(Reflect.set(detached.resolved!.scope, 'population', 'west')).toBe(false);
    expect(raw.resolved.scope).toEqual({ population: 'south' });
  });

  it('does not re-evaluate a stored comparison or claim to authenticate its truth', () => {
    const raw = saved();
    // A recording owner must authenticate stored evidence. Shape admission is
    // deliberately not a second comparator whose newer rules rewrite history.
    raw.resolved.evidence.value = 8;
    expect(readClaimVerificationRow(raw).reason).toBe('no-conflict');
  });

  it.each(['fact', 'open', 'ruled-out'])('keeps the model %s standing separate', (standing) => {
    expect(readClaimVerificationRow({ ...saved(), standing }).standing).toBe(standing);
  });

  it('admits numeric leniency without rewriting the literal declaration', () => {
    const raw = saved();
    expect(
      readClaimVerificationRow({
        ...raw,
        reason: 'numeric-leniency',
        declaredValue: '7',
        resolved: { ...raw.resolved, claim: { ...raw.resolved.claim, value: '7' } },
      }).declaredValue,
    ).toBe('7');
  });

  it('admits a contradiction with its actual eligible pair', () => {
    const raw = saved();
    raw.resolved.evidence.value = 8;
    expect(
      readClaimVerificationRow({ ...raw, outcome: 'contradicted', reason: 'conflict' }).outcome,
    ).toBe('contradicted');
  });

  it.each([
    'claim-result/record/run/01',
    'claim-result/record/run/0',
    'claim-result/record/run/9007199254740992',
    'claim-result/record/run/1e0',
    'claim-result/record/run/1/extra',
    'claim-result/%GG/run/1',
    'claim-result/_/run/1',
  ])('refuses a coherently paired but noncanonical result identity %s', (changedId) => {
    const raw = saved();
    raw.declaredResult = changedId;
    raw.resolved.resultId = changedId;
    raw.resolved.evidence.provenance = `result ${changedId}`;
    expect(isClaimVerificationRow(raw)).toBe(false);
  });

  it('refuses a resolved result from a different recording namespace', () => {
    const raw = saved();
    const changedId = resultIdentityOf({ ...identity, namespace: 'another-record' });
    raw.declaredResult = changedId;
    raw.resolved.resultId = changedId;
    raw.resolved.evidence.provenance = `result ${changedId}`;
    expect(isClaimVerificationRow(raw)).toBe(false);
  });

  it('permits an earlier run in the same recording namespace', () => {
    const raw = saved();
    const changedId = resultIdentityOf({ ...identity, runId: 'earlier-run' });
    raw.declaredResult = changedId;
    raw.resolved.resultId = changedId;
    raw.resolved.evidence.provenance = `result ${changedId}`;
    expect(readClaimVerificationRow(raw).resolved?.resultId).toBe(changedId);
  });

  it.each(VERIFICATION_UNVERIFIED_REASONS)('reads the finite unverified reason %s', (reason) => {
    const raw = unverified(reason);
    if (reason === 'ineligible-noise') raw.standing = 'noise';
    expect(readClaimVerificationRow(raw).reason).toBe(reason);
  });

  it('accepts a minimal missing-check row with no invented references', () => {
    const {
      declaredResult: _result,
      declaredRule: _rule,
      turn: _turn,
      ...raw
    } = unverified('missing-check');
    const row = readClaimVerificationRow({ ...raw, declaredOn: 'answer' });
    expect(row).not.toHaveProperty('resolved');
    expect(row).not.toHaveProperty('declaredResult');
    expect(row).not.toHaveProperty('declaredRule');
    expect(row).not.toHaveProperty('turn');
  });

  it('refuses reason/reference combinations its writer cannot produce', () => {
    expect(
      isClaimVerificationRow({ ...unverified('missing-check'), declaredRule: 'invented' }),
    ).toBe(false);
    const { declaredRule: _rule, ...missingRule } = unverified('unknown-rule');
    expect(isClaimVerificationRow(missingRule)).toBe(false);
    const { declaredResult: _result, ...missingResult } = unverified('scope-mismatch');
    expect(isClaimVerificationRow(missingResult)).toBe(false);
    expect(isClaimVerificationRow({ ...missingResult, reason: 'missing-result' })).toBe(true);
  });

  const badTop: ReadonlyArray<readonly [string, unknown]> = [
    ['kind', 'standing'],
    ['claimId', resultId],
    ['claimId', 'claim-verification/_/run/1'],
    ['claimId', 'claim-verification/record/run/01'],
    ['claimId', 'claim-verification/record/run/0'],
    ['claimId', 'claim-verification/record/run/9007199254740992'],
    ['standing', 'certain'],
    ['standing', 'noise'],
    ['iteration', -1],
    ['iteration', 1.2],
    ['turn', 0],
    ['turn', '2'],
    ['checker', { id: 'other', version: 1 }],
    ['checker', { id: 'claim-pair', version: 2 }],
    ['checker', { id: 'claim-pair', version: 1, trusted: true }],
    ['declaredOn', { toolCallId: 'x', resultId }],
    ['declaredOn', { toolCallId: '' }],
    ['declaredRule', ''],
    ['declaredRule', 'other'],
    ['declaredResult', 'claim-result/other'],
    ['outcome', 'certain'],
    ['outcome', 'unverified'],
    ['outcome', 'contradicted'],
    ['reason', 'conflict'],
    ['reason', 'unknown-rule'],
    ['reason', 'new-unknown'],
    ['declaredValue', 8],
    ['declaredValue', undefined],
    ['declaredValue', NaN],
    ['declaredValue', -0],
    ['declaredValue', BigInt(7)],
    ['extra', true],
  ];
  it.each(badTop)('refuses invalid top-level %s=%s', (key, value) => {
    const raw = { ...saved(), [key]: value };
    expect(() => readClaimVerificationRow(raw)).toThrow();
    expect(isClaimVerificationRow(raw)).toBe(false);
  });

  it.each([
    'claimId',
    'checker',
    'declaredOn',
    'standing',
    'iteration',
    'declaredValue',
    'resolved',
  ])('refuses a missing required %s', (key) => {
    const raw: Record<string, unknown> = saved();
    delete raw[key];
    expect(isClaimVerificationRow(raw)).toBe(false);
  });

  it.each([
    { outcome: 'unverified', reason: 'no-conflict' },
    { outcome: 'unverified', reason: 'conflict' },
    { outcome: 'unverified', reason: 'ineligible-noise' },
    { outcome: 'unverified', reason: 'missing-check', standing: 'noise' },
  ])('refuses incoherent unverified state %j', (patch) => {
    expect(isClaimVerificationRow({ ...unverified('missing-check'), ...patch })).toBe(false);
  });

  it.each(['scope', 'rule', 'coverage', 'evidence', 'claim'])(
    'refuses unknown fields within %s',
    (key) => {
      const raw = saved();
      const fields = raw.resolved as unknown as Record<string, Record<string, unknown>>;
      fields[key] = { ...fields[key], unexpected: true };
      // Scope dimension names are authored, not a closed vocabulary.
      if (key === 'scope') fields.scope = {};
      expect(isClaimVerificationRow(raw)).toBe(false);
    },
  );

  it.each([
    ['subject', { kind: 'other', id: 'north' }],
    ['subject', { kind: 'entity', id: 'south' }],
    ['predicate', 'other'],
    ['stratum', 'quoted'],
    ['provenance', 'result other'],
    ['epoch', 1],
    ['value', null],
    ['value', 'unknown'],
    ['value', unknownValue('not measured')],
  ])('refuses ineligible or mismatched evidence %s', (key, value) => {
    const raw = saved();
    expect(
      isClaimVerificationRow({
        ...raw,
        resolved: { ...raw.resolved, evidence: { ...raw.resolved.evidence, [key]: value } },
      }),
    ).toBe(false);
  });

  it('refuses invalid period and coverage using their existing owners', () => {
    const raw = saved();
    expect(isClaimVerificationRow({ ...raw, resolved: { ...raw.resolved, period: {} } })).toBe(
      false,
    );
    for (const coverage of [
      { checked: [], notChecked: [], cannotCover: [{ what: 'blind' }] },
      { checked: [{ what: 'x', kind: 'scope' }], notChecked: [], cannotCover: [] },
      { checked: [], notChecked: [], cannotCover: [], invented: [] },
      { checked: ['ground'], notChecked: [], cannotCover: [] },
    ])
      expect(isClaimVerificationRow({ ...raw, resolved: { ...raw.resolved, coverage } })).toBe(
        false,
      );
  });

  it('refuses accessors without invoking them, including inherited array toJSON', () => {
    const getter = vi.fn(() => 7);
    const raw = saved();
    Object.defineProperty(raw, 'declaredValue', { enumerable: true, get: getter });
    expect(isClaimVerificationRow(raw)).toBe(false);
    const list: unknown[] = [];
    Object.setPrototypeOf(list, { toJSON: getter });
    expect(isClaimVerificationRow({ ...unverified('missing-check'), declaredValue: list })).toBe(
      false,
    );
    expect(getter).not.toHaveBeenCalled();
  });

  it('refuses sparse/decorated arrays, cycles, nonenumerable keys and symbols', () => {
    const values: unknown[] = [new Array(1), Object.assign([], { extra: true }), new Date(0)];
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    values.push(cycle, Object.defineProperty({}, 'hidden', { value: 1 }), { [Symbol('x')]: 1 });
    for (const declaredValue of values)
      expect(isClaimVerificationRow({ ...unverified('missing-check'), declaredValue })).toBe(false);
  });

  it('keeps __proto__ data ordinary without mutating a prototype', () => {
    const declaredValue: unknown = JSON.parse('{"__proto__":{"safe":1}}');
    const row = readClaimVerificationRow({ ...unverified('missing-check'), declaredValue });
    expect(Object.getPrototypeOf(row.declaredValue)).toBe(Object.prototype);
    expect(Object.hasOwn(row.declaredValue as object, '__proto__')).toBe(true);
  });

  it('enforces compact value, scope and whole-row limits independently', () => {
    expect(
      isClaimVerificationRow({
        ...unverified('missing-check'),
        declaredValue: 'x'.repeat(VERIFICATION_LIMITS.valueBytes),
      }),
    ).toBe(false);
    const raw = saved();
    expect(
      isClaimVerificationRow({
        ...raw,
        resolved: { ...raw.resolved, scope: { population: 'x'.repeat(BINDING_LIMITS.scopeBytes) } },
      }),
    ).toBe(false);
    expect(
      isClaimVerificationRow({
        ...raw,
        resolved: {
          ...raw.resolved,
          evidence: { ...raw.resolved.evidence, value: 'x'.repeat(VERIFICATION_LIMITS.rowBytes) },
        },
      }),
    ).toBe(false);
  });
});

describe('runtime claim occurrence identity', () => {
  it('round-trips the largest admitted escaped runtime tuple', () => {
    const largest = {
      namespace: '%'.repeat(512),
      runId: '/'.repeat(512),
      ordinal: Number.MAX_SAFE_INTEGER,
    };
    const claimId = claimIdentityOf(largest);
    expect(readClaimIdentity(claimId)).toEqual(largest);
    expect(isClaimVerificationRow({ ...unverified('missing-check'), claimId })).toBe(true);
  });
  it('is distinct from result identity and injective across separators, escapes and absence lookalikes', () => {
    const tuples = [
      ['a/b', 'c'],
      ['a', 'b/c'],
      ['a%2Fb', 'c'],
      ['_', 'c'],
      ['%5F', 'c'],
      ['a', '%2F'],
      ['a', '/'],
      ['a', 'b'],
    ] as const;
    const ids = tuples.map(([namespace, runId]) =>
      claimIdentityOf({ namespace, runId, ordinal: 1 }),
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (let index = 0; index < ids.length; index++) {
      const claimId = ids[index];
      expect(isClaimVerificationRow({ ...unverified('missing-check'), claimId })).toBe(true);
      expect(readClaimIdentity(claimId)).toEqual({
        namespace: tuples[index]![0],
        runId: tuples[index]![1],
        ordinal: 1,
      });
    }
    expect(claimIdentityOf(identity)).not.toBe(resultIdentityOf(identity));
    expect(claimIdentityOf({ ...identity, ordinal: 2 })).not.toBe(claimIdentityOf(identity));
  });

  it.each([0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1])('refuses invalid ordinal %s', (ordinal) => {
    expect(() => claimIdentityOf({ ...identity, ordinal })).toThrow();
  });

  it('validates identity descriptors without invoking getters', () => {
    const getter = vi.fn(() => 'run');
    expect(() =>
      claimIdentityOf(Object.defineProperty({ ...identity }, 'runId', { get: getter })),
    ).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
});
