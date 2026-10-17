import { describe, expect, it } from 'vitest';
import type { RequirementResult } from 'foottrace';
import {
  checkClaimRequirements,
  type ClaimRequirementPolicy,
} from '../../src/answer-validation/requirements.js';
import {
  executeAnswerValidation,
  resolveAnswerValidation,
} from '../../src/answer-validation/validate.js';

const policy: ClaimRequirementPolicy = {
  claimRef: 'claim:attribution',
  findingRef: 'finding:latency',
  windowRef: 'window:two-hours',
  requirementRefs: ['requirement:mapping'],
};
function receipt(overrides: Partial<RequirementResult> = {}): RequirementResult {
  return {
    id: 'result:mapping',
    requirementRef: 'requirement:mapping',
    findingRef: policy.findingRef,
    windowRef: policy.windowRef,
    affects: [policy.claimRef],
    state: 'satisfied',
    evidenceRefs: [],
    checks: [],
    actionRefs: [],
    ...overrides,
  } as RequirementResult;
}
const unreachable = (reason: string) => ({
  check: { id: policy.claimRef, disposition: 'unreachable', reason },
});

describe('claim requirement prerequisites', () => {
  it('passes all expected exact bindings, retaining result IDs separately from artifact refs', () => {
    const results = [receipt(), receipt({ id: 'result:other', affects: ['claim:other'] })];
    const assessment = checkClaimRequirements(policy, results);
    expect(assessment).toEqual({
      check: { id: policy.claimRef, disposition: 'checked-pass' },
      requirementResultRefs: ['result:mapping'],
    });
    expect(Object.isFrozen(assessment)).toBe(true);
    expect(Object.isFrozen(assessment.check)).toBe(true);
    expect(Object.isFrozen(assessment.requirementResultRefs)).toBe(true);
    (results[0] as { affects: string[] }).affects = [];
    expect(assessment.requirementResultRefs).toEqual(['result:mapping']);
    expect(assessment.check).not.toHaveProperty('evidenceRefs');
  });

  it('requires every host-authored obligation rather than accepting one satisfied result', () => {
    expect(
      checkClaimRequirements(
        { ...policy, requirementRefs: ['requirement:mapping', 'requirement:time'] },
        [receipt()],
      ),
    ).toMatchObject(unreachable('not-collected'));
    expect(checkClaimRequirements(policy, [])).toEqual({
      ...unreachable('not-collected'),
      requirementResultRefs: [],
    });
  });

  it.each(['findingRef', 'windowRef', 'requirementRef', 'affects'] as const)(
    'does not satisfy an obligation using a foreign %s',
    (field) => {
      const foreign = receipt({ [field]: field === 'affects' ? ['claim:other'] : 'foreign:value' });
      const assessment = checkClaimRequirements(policy, [foreign]);
      expect(assessment.check.disposition).toBe('unreachable');
      expect(assessment.requirementResultRefs).toEqual(
        field === 'requirementRef' ? ['result:mapping'] : [],
      );
    },
  );

  it('does not mix identity fields that collide under delimiter concatenation', () => {
    const scoped = { ...policy, findingRef: 'a:b', windowRef: 'c' };
    expect(
      checkClaimRequirements(scoped, [receipt({ findingRef: 'a', windowRef: 'b:c' })]).check
        .disposition,
    ).toBe('unreachable');
    expect(
      checkClaimRequirements(scoped, [receipt({ findingRef: 'a:b', windowRef: 'c' })]).check
        .disposition,
    ).toBe('checked-pass');
  });

  it('keeps same-scope unresolved obligations dominant over a satisfied duplicate or extra obligation', () => {
    const missing = receipt({ id: 'result:missing', state: 'unresolved', reason: 'not-collected' });
    for (const results of [
      [receipt(), missing],
      [missing, receipt()],
    ]) {
      expect(checkClaimRequirements(policy, results)).toMatchObject(unreachable('not-collected'));
    }
    expect(
      checkClaimRequirements(policy, [
        receipt(),
        { ...missing, requirementRef: 'requirement:extra' },
      ]),
    ).toMatchObject(unreachable('not-collected'));
    expect(
      checkClaimRequirements(policy, [receipt(), { ...missing, affects: ['claim:other'] }]).check
        .disposition,
    ).toBe('checked-pass');
  });

  it('does not turn an unrelated historical window into a denial of a complete current binding', () => {
    expect(
      checkClaimRequirements(policy, [
        receipt(),
        receipt({
          id: 'result:old',
          windowRef: 'window:old',
          state: 'unresolved',
          reason: 'stale',
        }),
      ]).check.disposition,
    ).toBe('checked-pass');
  });

  it('chooses an order-independent unresolved reason and returns stable sorted selectors', () => {
    const first = receipt({ id: 'result:z', state: 'unresolved', reason: 'timeout' });
    const second = receipt({ id: 'result:a', state: 'unresolved', reason: 'not-collected' });
    expect(checkClaimRequirements(policy, [first, second])).toEqual(
      checkClaimRequirements(policy, [second, first]),
    );
    expect(checkClaimRequirements(policy, [first, second])).toEqual({
      ...unreachable('not-collected'),
      requirementResultRefs: ['result:a', 'result:z'],
    });
  });

  it.each([
    undefined,
    null,
    {},
    [receipt(), receipt()],
    [receipt({ state: 'invented' } as never)],
    [receipt({ state: 'unresolved', reason: 'node-limit' } as never)],
    Array.from({ length: 513 }, (_, index) => receipt({ id: `result:${index}` })),
  ])(
    'sanitizes malformed or oversized receipt sets without passing structural refusal codes through',
    (results) => {
      expect(checkClaimRequirements(policy, results)).toEqual({
        ...unreachable('invalid-data'),
        requirementResultRefs: [],
      });
    },
  );

  it('does not invoke receipt getters, iterators or toJSON while refusing malformed data', () => {
    let calls = 0;
    const malicious = Object.defineProperty(receipt(), 'state', {
      enumerable: true,
      get() {
        calls++;
        return 'satisfied';
      },
    });
    expect(checkClaimRequirements(policy, [malicious])).toMatchObject(unreachable('invalid-data'));
    const decorated = Object.assign([receipt()], {
      toJSON() {
        calls++;
        return [];
      },
    });
    expect(checkClaimRequirements(policy, decorated)).toMatchObject(unreachable('invalid-data'));
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(checkClaimRequirements(policy, revoked.proxy)).toMatchObject(
      unreachable('invalid-data'),
    );
    expect(calls).toBe(0);
  });

  it.each([
    null,
    {},
    { ...policy, unknown: true },
    { ...policy, requirementRefs: [] },
    { ...policy, requirementRefs: ['requirement:x', 'requirement:x'] },
    {
      ...policy,
      requirementRefs: Array.from({ length: 17 }, (_, index) => `requirement:${index}`),
    },
    { ...policy, claimRef: 'a'.repeat(129) },
    { ...policy, findingRef: 'a'.repeat(513) },
    { ...policy, windowRef: 'white space' },
    { ...policy, claimRef: 'claim:\u0000' },
    {
      ...policy,
      requirementRefs: Array.from({ length: 16 }, (_, index) => `${'界'.repeat(510)}:${index}`),
    },
    Object.create(policy),
  ])('rejects malformed closed host policies with a fixed non-payload error', (raw) => {
    expect(() => checkClaimRequirements(raw as never, [])).toThrow(
      'Invalid claim requirement policy.',
    );
    try {
      checkClaimRequirements(raw as never, []);
    } catch (error) {
      expect(error).toMatchObject({ code: 'ERR_CLAIM_REQUIREMENT_POLICY' });
    }
  });

  it('does not invoke host policy getters or inherited/array accessors', () => {
    let calls = 0;
    const getter = Object.defineProperty({ ...policy }, 'claimRef', {
      enumerable: true,
      get() {
        calls++;
        return policy.claimRef;
      },
    });
    const array = Object.defineProperty(['requirement:mapping'], '0', {
      enumerable: true,
      get() {
        calls++;
        return 'requirement:mapping';
      },
    });
    expect(() => checkClaimRequirements(getter, [])).toThrow();
    expect(() => checkClaimRequirements({ ...policy, requirementRefs: array }, [])).toThrow();
    expect(calls).toBe(0);
  });

  it.each([0, 17])(
    'rejects copied policy length %i when a proxy preflight reports one',
    (count) => {
      const target = Array.from({ length: count }, (_, index) => `requirement:${index}`);
      const requirementRefs = new Proxy(target, {
        getOwnPropertyDescriptor(array, key) {
          const descriptor = Reflect.getOwnPropertyDescriptor(array, key);
          return key === 'length' && descriptor ? { ...descriptor, value: 1 } : descriptor;
        },
      });
      expect(() => checkClaimRequirements({ ...policy, requirementRefs }, [])).toThrow(
        'Invalid claim requirement policy.',
      );
      try {
        checkClaimRequirements({ ...policy, requirementRefs }, []);
      } catch (error) {
        expect(error).toMatchObject({ code: 'ERR_CLAIM_REQUIREMENT_POLICY' });
      }
    },
  );

  it('accepts the distinct expected-reference ceiling and exact opaque names without folding', () => {
    const requirements = Array.from({ length: 16 }, (_, index) => `requirement:${index}`);
    const exact = { ...policy, findingRef: 'f'.repeat(512), requirementRefs: requirements };
    const results = requirements.map((requirementRef, index) =>
      receipt({
        id: `result:${index}`,
        requirementRef,
        findingRef: exact.findingRef,
      }),
    );
    expect(checkClaimRequirements(exact, results).check.disposition).toBe('checked-pass');
    expect(
      checkClaimRequirements({ ...policy, claimRef: 'claim:Attribution' }, [receipt()]).check
        .disposition,
    ).toBe('unreachable');
    const nullPrototype = Object.assign(Object.create(null) as ClaimRequirementPolicy, policy);
    expect(checkClaimRequirements(nullPrototype, [receipt()]).check.disposition).toBe(
      'checked-pass',
    );
  });

  it('fits the existing AnswerCheck identity limit and can be consumed without an artifact resolver read', async () => {
    const exact = { ...policy, claimRef: 'a'.repeat(128) };
    const result = await executeAnswerValidation(
      '{"latency":137.45}',
      { parse: (value) => value },
      resolveAnswerValidation({
        id: 'prerequisites',
        version: '1',
        validate: () => ({
          checks: [checkClaimRequirements(exact, [receipt({ affects: [exact.claimRef] })]).check],
        }),
      }),
      undefined,
      { conversationId: 'synthetic-requirements' },
    );
    expect(result.report.status).toBe('passed');
    expect(result.report.resolvedRefs).toEqual([]);
    expect(result.content).toBe('{"latency":137.45}');
  });
});
