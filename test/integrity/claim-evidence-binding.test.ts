/**
 * Internal receipt ports, not an enabled claims feature or a support verdict.
 * Real-Agent execution seam demonstrations live in claim-evidence-boundary.
 * All data is synthetic; malformed casts below exercise JSON trust boundaries.
 */
import { describe, expect, it } from 'vitest';
import { describedResult, type DeclaredPeriod } from '../../src/index.js';
import { known, unknown as unknownValue } from '../../src/doors/maps.js';
import { readSemantics, semanticsForModel } from '../../src/lib/semantics/envelope.js';
import {
  captureDispatch,
  captureReturnedEvidence,
  evidenceSnapshot,
  finalizeEvidence,
  resultIdentityOf,
} from '../../src/integrity/claim-binding/capture.js';
import { bindClaim } from '../../src/integrity/claim-binding/bindEvidence.js';
import { BINDING_LIMITS, executedScope } from '../../src/integrity/claim-binding/scope.js';
import { BINDING_REASONS } from '../../src/integrity/claim-binding/types.js';
import type {
  ClaimBindingRule,
  EvidenceSnapshot,
  ResultEvidence,
  ScopeDeclaration,
} from '../../src/integrity/claim-binding/types.js';
import { evaluateClaimPair } from '../../src/integrity/unsupported-claim/evaluate.js';

const WINDOW = { from: '2026-10-01T00:00:00Z', to: '2026-10-08T00:00:00Z' };
const ARGS = { population: 'north', channel: 'online', currency: 'USD', window: WINDOW };
const DECLARATION: ScopeDeclaration = {
  id: 'revenue-scope',
  version: '1',
  dimensions: ['population', 'channel', 'currency', 'window'].map((name) => ({
    name,
    argumentPath: [name],
  })),
  periodDimension: 'window',
};
const RULE: ClaimBindingRule = {
  id: 'revenue',
  version: '1',
  toolName: 'read_revenue',
  scopeDeclaration: DECLARATION,
  fact: { entity: { scopeDimension: 'population' }, field: 'revenue' },
  // Explicit fixture-owner completeness decision, not a prose parser.
  coverage: () => 'complete',
};
const ACCESS = { completed: true, resultVisible: true, scopeVisible: true };

function semantic(
  value: unknown = 51200,
  period: DeclaredPeriod | false = { queried: WINDOW, held: WINDOW },
) {
  return describedResult({
    facts: [{ entity: 'north', revenue: value }],
    provenance: { measuredAt: '2026-10-08T00:00:00Z', source: 'synthetic revenue fixture' },
    coverage: { checked: ['Synthetic online population only.'] },
    ...(period === false ? {} : { period }),
  });
}

function served(original: unknown): unknown {
  const semantics = readSemantics(original);
  if (semantics === undefined) throw new Error('Fixture must be a real semantic envelope.');
  return semanticsForModel(semantics);
}

function receipt(
  options: {
    value?: unknown;
    ordinal?: number;
    runId?: string;
    namespace?: string;
    args?: unknown;
    declaration?: ScopeDeclaration;
    period?: DeclaredPeriod | false;
  } = {},
): ResultEvidence {
  const original = semantic(options.value === undefined ? 51200 : options.value, options.period);
  const dispatch = captureDispatch(
    {
      namespace: options.namespace ?? 'recording',
      runId: options.runId ?? 'run',
      ordinal: options.ordinal ?? 1,
    },
    { toolName: 'read_revenue', toolCallId: 'provider-reused-id', iteration: 7 },
    options.args ?? ARGS,
    options.declaration ?? DECLARATION,
  );
  return finalizeEvidence(
    dispatch,
    captureReturnedEvidence(dispatch, original),
    served(original),
    ACCESS,
  );
}

function bind(
  result: ResultEvidence = receipt(),
  value: unknown = 51200,
  rule = RULE,
  intended?: unknown,
) {
  return bindClaim(
    { result: result.id, value, rule: rule.id },
    evidenceSnapshot(result.identity.namespace, [result.identity.runId], [result]),
    [rule],
    intended,
  );
}

const restored = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('unit: executed scope is authored, bounded, detached own data', () => {
  it('keeps the closed refusal vocabulary immutable at runtime', () => {
    const original = [...BINDING_REASONS];
    expect(Object.isFrozen(BINDING_REASONS)).toBe(true);
    expect(Reflect.set(BINDING_REASONS, '0', 'forged-reason')).toBe(false);
    expect(BINDING_REASONS).toEqual(original);
  });

  it('uses exact nested paths and explicit defaults; a normalizer cannot mutate execute arguments', () => {
    const args = { selection: { channels: ['online'] }, currency: ' usd ' };
    const declaration: ScopeDeclaration = {
      id: 'nested',
      version: '1',
      dimensions: [
        {
          name: 'channels',
          argumentPath: ['selection', 'channels'],
          normalize: (v) => [...(v as string[]), 'retail'],
        },
        {
          name: 'currency',
          argumentPath: ['currency'],
          normalize: (v) => String(v).trim().toUpperCase(),
        },
        { name: 'unit', argumentPath: ['unit'], default: 'dollars' },
      ],
    };
    const scope = executedScope(args, declaration);
    expect(scope).toEqual({ channels: ['online', 'retail'], currency: 'USD', unit: 'dollars' });
    expect(args).toEqual({ selection: { channels: ['online'] }, currency: ' usd ' });
    args.selection.channels.push('later');
    expect(scope.channels).toEqual(['online', 'retail']);
    expect(Object.isFrozen(scope)).toBe(true);
    expect(Object.isFrozen(scope.channels)).toBe(true);
  });

  it('missing and inherited arguments never supply an undeclared default', () => {
    expect(() => executedScope({}, DECLARATION)).toThrow();
    expect(() => executedScope(Object.create(ARGS), DECLARATION)).toThrow();
    expect(receipt({ args: {} }).unavailable).toBe('missing-scope');
  });

  it('an explicit default fills a missing own field, never an unsafe inherited field', () => {
    const declaration: ScopeDeclaration = {
      id: 'scope',
      version: '1',
      dimensions: [{ name: 'population', argumentPath: ['population'], default: 'north' }],
    };
    expect(executedScope({}, declaration)).toEqual({ population: 'north' });
    expect(() => executedScope(Object.create({ population: 'south' }), declaration)).toThrow();
  });

  it('rejects accessors without calling them and rejects non-JSON normalization results', () => {
    let reads = 0;
    const args = Object.defineProperty({}, 'population', {
      enumerable: true,
      get: () => {
        reads += 1;
        return 'north';
      },
    });
    expect(() => executedScope(args, DECLARATION)).toThrow();
    expect(reads).toBe(0);
    for (const value of [NaN, Infinity, -0, undefined, BigInt(1), new Date(), new Map()]) {
      expect(() =>
        executedScope(
          { a: 1 },
          {
            id: 'scope',
            version: '1',
            dimensions: [{ name: 'a', argumentPath: ['a'], normalize: () => value }],
          },
        ),
      ).toThrow();
    }
  });

  it('dangerous-looking own keys stay data, without consulting inherited setters', () => {
    const args: unknown = JSON.parse('{"__proto__":{"constructor":"prototype"}}');
    const scope = executedScope(args, {
      id: 'scope',
      version: '1',
      dimensions: [{ name: '__proto__', argumentPath: ['__proto__', 'constructor'] }],
    });
    expect(Object.hasOwn(scope, '__proto__')).toBe(true);
    expect(scope.__proto__).toBe('prototype');
    expect(Object.getPrototypeOf(scope)).toBe(Object.prototype);
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it.each([
    { ...DECLARATION, id: '' },
    { ...DECLARATION, version: '' },
    { ...DECLARATION, dimensions: [] },
    { ...DECLARATION, dimensions: [{ name: 'x', argumentPath: [] }] },
    {
      ...DECLARATION,
      dimensions: [
        { name: 'x', argumentPath: ['population'] },
        { name: 'x', argumentPath: ['channel'] },
      ],
    },
    { ...DECLARATION, periodDimension: 'absent' },
    {
      ...DECLARATION,
      dimensions: Array.from({ length: BINDING_LIMITS.dimensions + 1 }, (_, i) => ({
        name: String(i),
        argumentPath: ['population'],
      })),
    },
    {
      ...DECLARATION,
      dimensions: [
        { name: 'x', argumentPath: Array(BINDING_LIMITS.path + 1).fill('x') as string[] },
      ],
    },
  ])('refuses malformed scope declaration %#', (declaration) => {
    expect(() => executedScope(ARGS, declaration)).toThrow();
  });

  it('bounds the whole scope and rejects cycles/decorated arrays without running toJSON', () => {
    expect(() =>
      executedScope(
        { a: 'x'.repeat(BINDING_LIMITS.scopeBytes) },
        { id: 'scope', version: '1', dimensions: [{ name: 'a', argumentPath: ['a'] }] },
      ),
    ).toThrow();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let called = 0;
    const array: unknown[] = [];
    Object.setPrototypeOf(array, {
      toJSON: () => {
        called += 1;
        return [];
      },
    });
    for (const a of [cyclic, array, Object.assign([1], { extra: 2 }), Array(2)]) {
      expect(() =>
        executedScope(
          { a },
          { id: 'scope', version: '1', dimensions: [{ name: 'a', argumentPath: ['a'] }] },
        ),
      ).toThrow();
    }
    expect(called).toBe(0);
  });
});

describe('unit: exact occurrence and authorized result association', () => {
  it('binds eligible inputs without claiming their values agree', () => {
    const equal = bind();
    const different = bind(receipt(), 51000);
    expect(equal.kind).toBe('bound');
    expect(different.kind).toBe('bound');
    if (equal.kind !== 'bound' || different.kind !== 'bound')
      throw new Error('Fixture should bind.');
    expect(evaluateClaimPair(equal.evidence, equal.claim)).toBe('no-conflict');
    expect(evaluateClaimPair(different.evidence, different.claim)).toBe('conflict');
    expect(equal).not.toHaveProperty('supported');
    expect(equal).not.toHaveProperty('outcome');
    expect(equal.scope).toEqual(ARGS);
    expect(equal.evidence.value).toBe(51200);
  });

  it('keeps repeated provider IDs separate and never substitutes a later write', () => {
    const first = receipt();
    const second = receipt({ ordinal: 2, value: 40960 });
    const replayedId = receipt({ runId: 'new-process', value: 30000 });
    const snapshot = evidenceSnapshot(
      'recording',
      ['run', 'new-process'],
      [first, second, replayedId],
    );
    expect(new Set(snapshot.results.map((r) => r.id)).size).toBe(3);
    expect(new Set(snapshot.results.map((r) => r.toolCallId)).size).toBe(1);
    expect(new Set(snapshot.results.map((r) => r.iteration)).size).toBe(1);
    for (const result of [first, second, replayedId]) {
      const binding = bindClaim(
        { result: result.id, value: result.facts?.[0]?.value, rule: RULE.id },
        snapshot,
        [RULE],
      );
      expect(binding.kind).toBe('bound');
      if (binding.kind !== 'bound') throw new Error('Exact receipt should resolve.');
      expect(binding.evidence.value).toBe(result.facts?.[0]?.value);
      expect(binding.resultId).toBe(result.id);
    }
    expect(first.facts?.[0]?.value).toBe(51200);
  });

  it('encodes tuple separators and escape-looking IDs collision-safely', () => {
    const pairs = [
      ['a/b', 'c'],
      ['a', 'b/c'],
      ['a%2Fb', 'c'],
      ['_', 'c'],
      ['%5F', 'c'],
      ['a\u0000b', 'c'],
    ];
    const ids = pairs.map(([namespace, runId]) =>
      resultIdentityOf({ namespace: namespace!, runId: runId!, ordinal: 1 }),
    );
    expect(new Set(ids).size).toBe(pairs.length);
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'refuses invalid runtime ordinal %s',
    (ordinal) => {
      expect(() => resultIdentityOf({ namespace: 'recording', runId: 'run', ordinal })).toThrow();
    },
  );

  it('refuses a missing, duplicated or foreign exact result instead of guessing', () => {
    const result = receipt();
    const claim = { result: result.id, value: 51200, rule: RULE.id };
    expect(bindClaim(claim, evidenceSnapshot('recording', ['run'], []), [RULE])).toEqual({
      kind: 'unverified',
      reason: 'missing-result',
    });
    expect(
      bindClaim(claim, evidenceSnapshot('recording', ['run'], [result, result]), [RULE]),
    ).toEqual({ kind: 'unverified', reason: 'ambiguous-result' });
    expect(
      bindClaim(claim, evidenceSnapshot('another-recording', ['run'], [result]), [RULE]),
    ).toEqual({ kind: 'unverified', reason: 'foreign-result' });
    expect(
      bindClaim(claim, evidenceSnapshot('recording', ['other-run'], [result]), [RULE]),
    ).toEqual({ kind: 'unverified', reason: 'foreign-result' });
  });

  it.each([
    [{ ...ACCESS, completed: false }, 'incomplete-result'],
    [{ ...ACCESS, resultVisible: false }, 'withheld-evidence'],
    [{ ...ACCESS, scopeVisible: false }, 'withheld-evidence'],
  ] as const)(
    'withholds original facts and scope when boundary is unavailable %#',
    (access, reason) => {
      const dispatch = captureDispatch(
        { namespace: 'recording', runId: 'run', ordinal: 1 },
        { toolName: 'read_revenue', toolCallId: 'c1', iteration: 3 },
        ARGS,
        DECLARATION,
      );
      const original = semantic('PRIVATE-VALUE-CANARY');
      const result = finalizeEvidence(
        dispatch,
        captureReturnedEvidence(dispatch, original),
        served(original),
        access,
      );
      expect(bind(result, 'PRIVATE-VALUE-CANARY')).toEqual({ kind: 'unverified', reason });
      expect(result).not.toHaveProperty('facts');
      expect(result).not.toHaveProperty('scope');
      expect(result).not.toHaveProperty('period');
      expect(JSON.stringify(result)).not.toContain('PRIVATE-VALUE-CANARY');
    },
  );

  it.each([{ facts: [{ entity: 'north', revenue: 1 }] }, 'denied', 'artifact:ticket', '{bad json'])(
    'does not associate a rewritten/refused/placed result %#',
    (replacement) => {
      const dispatch = captureDispatch(
        { namespace: 'recording', runId: 'run', ordinal: 1 },
        { toolName: 'read_revenue', toolCallId: 'c1', iteration: 3 },
        ARGS,
        DECLARATION,
      );
      const result = finalizeEvidence(
        dispatch,
        captureReturnedEvidence(dispatch, semantic()),
        replacement,
        ACCESS,
      );
      expect(result.unavailable).toMatch(/^(unassociated-result|invalid-evidence)$/);
      expect(result).not.toHaveProperty('facts');
    },
  );

  it('accepts the exact JSON served projection, detaches it, and survives JSON snapshot replay', () => {
    const args = restored(ARGS);
    const original = semantic();
    const dispatch = captureDispatch(
      { namespace: 'recording', runId: 'run', ordinal: 1 },
      { toolName: 'read_revenue', toolCallId: 'c1', iteration: 9 },
      args,
      DECLARATION,
    );
    const result = finalizeEvidence(
      dispatch,
      captureReturnedEvidence(dispatch, original),
      JSON.stringify(served(original)),
      ACCESS,
    );
    args.channel = 'changed-after-execute';
    const snapshot = evidenceSnapshot('recording', ['run'], [result]);
    const before = bindClaim({ result: result.id, value: 51200, rule: RULE.id }, snapshot, [RULE]);
    expect(before.kind).toBe('bound');
    expect(
      bindClaim({ result: result.id, value: 51200, rule: RULE.id }, restored(snapshot), [RULE]),
    ).toEqual(before);
    expect(result.scope?.channel).toBe('online');
    expect(result.facts?.[0]?.iteration).toBe(9);
    expect(Object.isFrozen(result.facts?.[0])).toBe(true);
    expect(Object.isFrozen(snapshot.results)).toBe(true);
  });

  it('bounds raw results and snapshots without retaining refused payloads', () => {
    const dispatch = captureDispatch(
      { namespace: 'recording', runId: 'run', ordinal: 1 },
      { toolName: 'read_revenue', toolCallId: 'c1', iteration: 1 },
      ARGS,
      DECLARATION,
    );
    const original = semantic('x'.repeat(BINDING_LIMITS.resultBytes));
    expect(
      finalizeEvidence(
        dispatch,
        captureReturnedEvidence(dispatch, original),
        served(original),
        ACCESS,
      ).unavailable,
    ).toBe('invalid-evidence');
    expect(() =>
      evidenceSnapshot(
        'recording',
        ['run'],
        Array(BINDING_LIMITS.results + 1).fill(receipt()) as ResultEvidence[],
      ),
    ).toThrow();
    expect(() => evidenceSnapshot('recording', ['run', 'run'], [])).toThrow();
  });

  it.each(['scope', 'result'] as const)(
    'refuses an oversized restored %s even below the whole-snapshot limit',
    (boundary) => {
      const result = receipt();
      const oversized =
        boundary === 'scope'
          ? {
              ...result,
              scope: { ...result.scope, channel: 'x'.repeat(BINDING_LIMITS.scopeBytes) },
            }
          : {
              ...result,
              facts: result.facts!.map((fact) => ({
                ...fact,
                value: 'x'.repeat(BINDING_LIMITS.resultBytes),
              })),
            };
      const snapshot = restored(evidenceSnapshot('recording', ['run'], [oversized]));
      const boundedPart = boundary === 'scope' ? oversized.scope : oversized;
      const limit = boundary === 'scope' ? BINDING_LIMITS.scopeBytes : BINDING_LIMITS.resultBytes;
      expect(Buffer.byteLength(JSON.stringify(boundedPart))).toBeGreaterThan(limit);
      expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThan(
        BINDING_LIMITS.snapshotBytes,
      );
      expect(
        bindClaim({ result: result.id, value: 51200, rule: RULE.id }, snapshot, [RULE]),
      ).toEqual({ kind: 'unverified', reason: 'invalid-evidence' });
    },
  );

  it('captures return-time evidence before mutation and refuses pairing another return', () => {
    const dispatch = captureDispatch(
      { namespace: 'recording', runId: 'run', ordinal: 1 },
      { toolName: 'read_revenue', toolCallId: 'c1', iteration: 1 },
      ARGS,
      DECLARATION,
    );
    const other = captureDispatch(
      { namespace: 'recording', runId: 'run', ordinal: 2 },
      { toolName: 'read_revenue', toolCallId: 'c1', iteration: 1 },
      ARGS,
      DECLARATION,
    );
    const original = restored(semantic());
    const originalProjection = served(original);
    const returned = captureReturnedEvidence(dispatch, original);
    expect(Reflect.set(original.facts![0]!, 'revenue', 1)).toBe(true);
    const kept = finalizeEvidence(dispatch, returned, originalProjection, ACCESS);
    expect(kept.facts?.[0]?.value).toBe(51200);
    expect(finalizeEvidence(dispatch, returned, served(original), ACCESS).unavailable).toBe(
      'unassociated-result',
    );
    expect(finalizeEvidence(other, returned, originalProjection, ACCESS).unavailable).toBe(
      'unassociated-result',
    );
  });

  it('every accepted long runtime identity remains usable as a claim result reference', () => {
    const result = receipt({ namespace: 'n'.repeat(300), runId: 'r'.repeat(300) });
    expect(bind(result).kind).toBe('bound');
  });
});

describe('unit: scope, coverage and fact eligibility precede comparison', () => {
  it.each([
    { ...ARGS, channel: 'all' },
    { ...ARGS, currency: 'EUR' },
    { ...ARGS, population: 'south' },
    { ...ARGS, window: { ...WINDOW, to: '2026-10-09T00:00:00Z' } },
    { population: 'north', channel: 'online', currency: 'USD' },
    { ...ARGS, unit: 'dollars' },
  ])('does not widen, convert, omit or invent dimensions %#', (intended) => {
    expect(bind(receipt(), 51200, RULE, intended)).toEqual({
      kind: 'unverified',
      reason: 'scope-mismatch',
    });
  });

  it('exact scope ignores property order, not values', () => {
    expect(
      bind(receipt(), 51200, RULE, {
        window: { to: WINDOW.to, from: WINDOW.from },
        currency: 'USD',
        channel: 'online',
        population: 'north',
      }).kind,
    ).toBe('bound');
  });

  it('refuses scope-declaration version drift and missing required recorded dimensions', () => {
    expect(
      bind(receipt(), 51200, { ...RULE, scopeDeclaration: { ...DECLARATION, version: '2' } }),
    ).toEqual({ kind: 'unverified', reason: 'scope-version-mismatch' });
    const result = restored(receipt());
    const { currency: _removed, ...scope } = result.scope!;
    expect(bind({ ...result, scope })).toEqual({ kind: 'unverified', reason: 'missing-scope' });
  });

  it.each([
    [{ queried: WINDOW, held: 'unknown' }, 'coverage-unknown'],
    [{ queried: WINDOW, held: { ...WINDOW, to: '2026-10-04T00:00:00Z' } }, 'coverage-partial'],
    [
      { queried: WINDOW, held: { from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z' } },
      'coverage-partial',
    ],
    [false, 'coverage-undeclared'],
  ] as const)('does not turn declared temporal gaps into completeness %#', (period, reason) => {
    expect(bind(receipt({ period }))).toEqual({ kind: 'unverified', reason });
  });

  it('uses existing time-owner equivalence and refuses a query different from executed scope', () => {
    const equivalent = {
      queried: { from: '2026-09-30T19:00:00-05:00', to: '2026-10-07T19:00:00-05:00' },
      held: WINDOW,
    };
    expect(bind(receipt({ period: equivalent })).kind).toBe('bound');
    const changed = {
      queried: { ...WINDOW, to: '2026-10-09T00:00:00Z' },
      held: { ...WINDOW, to: '2026-10-09T00:00:00Z' },
    };
    expect(bind(receipt({ period: changed }))).toEqual({
      kind: 'unverified',
      reason: 'scope-mismatch',
    });
  });

  it.each(['partial', 'unknown', 'stale'] as const)(
    'requires the authored coverage checker, preserving %s',
    (verdict) => {
      expect(bind(receipt(), 51200, { ...RULE, coverage: () => verdict })).toEqual({
        kind: 'unverified',
        reason: `coverage-${verdict}`,
      });
    },
  );

  it('coverage prose and matching numbers are not an authored completeness rule', () => {
    const { coverage: _removed, ...rule } = RULE;
    expect(bind(receipt(), 51200, rule)).toEqual({
      kind: 'unverified',
      reason: 'coverage-undeclared',
    });
    expect(
      bind(receipt(), 51200, {
        ...RULE,
        coverage: () => {
          throw new Error('PRIVATE-FAILURE');
        },
      }),
    ).toEqual({ kind: 'unverified', reason: 'invalid-evidence' });
  });

  it('omitted coverage and period remain undeclared even when an author callback returns complete', () => {
    const declaration: ScopeDeclaration = { ...DECLARATION, periodDimension: undefined };
    const { periodDimension: _removed, ...withoutPeriod } = declaration;
    const dispatch = captureDispatch(
      { namespace: 'recording', runId: 'run', ordinal: 1 },
      { toolName: 'read_revenue', toolCallId: 'c1', iteration: 1 },
      ARGS,
      withoutPeriod,
    );
    const original = describedResult({
      facts: [{ entity: 'north', revenue: 51200 }],
      provenance: { measuredAt: '2026-10-08T00:00:00Z', source: 'synthetic fixture' },
    });
    const result = finalizeEvidence(
      dispatch,
      captureReturnedEvidence(dispatch, original),
      served(original),
      ACCESS,
    );
    expect(result).not.toHaveProperty('coverage');
    expect(bind(result, 51200, { ...RULE, scopeDeclaration: withoutPeriod })).toEqual({
      kind: 'unverified',
      reason: 'coverage-undeclared',
    });
  });

  it('period-only evidence retains that typed boundary for the authored completeness decision', () => {
    const dispatch = captureDispatch(
      { namespace: 'recording', runId: 'run', ordinal: 1 },
      { toolName: 'read_revenue', toolCallId: 'c1', iteration: 1 },
      ARGS,
      DECLARATION,
    );
    const original = describedResult({
      facts: [{ entity: 'north', revenue: 51200 }],
      provenance: { measuredAt: '2026-10-08T00:00:00Z', source: 'synthetic fixture' },
      period: { queried: WINDOW, held: WINDOW },
    });
    const result = finalizeEvidence(
      dispatch,
      captureReturnedEvidence(dispatch, original),
      served(original),
      ACCESS,
    );
    expect(result.coverage).toEqual({ checked: [], notChecked: [], cannotCover: [] });
    let decisions = 0;
    const rule = {
      ...RULE,
      coverage: (boundary: Parameters<NonNullable<ClaimBindingRule['coverage']>>[0]) => {
        decisions += 1;
        expect(boundary.period).toEqual({ queried: WINDOW, held: WINDOW });
        return 'complete' as const;
      },
    };
    expect(bind(result, 51200, rule).kind).toBe('bound');
    expect(decisions).toBe(1);
  });

  it('does not re-run scope normalization while reading a restored snapshot', () => {
    let normalizations = 0;
    const declaration: ScopeDeclaration = {
      ...DECLARATION,
      dimensions: DECLARATION.dimensions.map((dimension) => ({
        ...dimension,
        normalize: (value) => {
          normalizations += 1;
          return value;
        },
      })),
    };
    const result = receipt({ declaration });
    expect(normalizations).toBe(4);
    const rule = { ...RULE, scopeDeclaration: declaration };
    expect(bind(restored(result), 51200, rule).kind).toBe('bound');
    expect(normalizations).toBe(4);
  });

  it.each([null, 'unknown', unknownValue('not measured')])(
    'does not bind unasserted values %#',
    (value) => {
      expect(bind(receipt(), value)).toEqual({ kind: 'unverified', reason: 'unasserted-value' });
      expect(bind(receipt({ value }))).toEqual({ kind: 'unverified', reason: 'unasserted-value' });
    },
  );

  it('known wrappers retain original values for the existing pair evaluator', () => {
    const binding = bind(receipt({ value: known(51200, 'fixture') }), known(51200, 'fixture'));
    expect(binding.kind).toBe('bound');
    if (binding.kind !== 'bound') throw new Error('Known values should bind.');
    expect(binding.evidence.value).toEqual(known(51200, 'fixture'));
    expect(evaluateClaimPair(binding.evidence, binding.claim)).toBe('no-conflict');
  });

  it('does not choose among duplicate fact selectors or fabricate a missing one', () => {
    const result = receipt();
    expect(bind({ ...result, facts: [] })).toEqual({ kind: 'unverified', reason: 'missing-fact' });
    expect(bind({ ...result, facts: [...result.facts!, ...result.facts!] })).toEqual({
      kind: 'unverified',
      reason: 'ambiguous-fact',
    });
    expect(
      bind({
        ...result,
        facts: result.facts?.map((fact) => ({ ...fact, toolCallId: 'foreign-call' })),
      }),
    ).toEqual({ kind: 'unverified', reason: 'invalid-evidence' });
  });
});

describe('security: malformed model claims and saved snapshots fail closed', () => {
  it.each([
    null,
    [],
    {},
    { result: 1, value: 51200, rule: 'revenue' },
    { result: 'id', rule: 'revenue' },
    { result: 'id', value: 51200, rule: 'revenue', scope: ARGS },
  ])('refuses malformed claim %#', (claim) => {
    expect(bindClaim(claim, evidenceSnapshot('recording', ['run'], [receipt()]), [RULE])).toEqual({
      kind: 'unverified',
      reason: 'invalid-claim',
    });
  });

  it('does not execute claim or saved metadata accessors', () => {
    let reads = 0;
    const getter = {
      enumerable: true,
      get: () => {
        reads += 1;
        return 'SECRET';
      },
    };
    const claim = Object.defineProperty({}, 'result', getter);
    expect(bindClaim(claim, evidenceSnapshot('recording', ['run'], [receipt()]), [RULE])).toEqual({
      kind: 'unverified',
      reason: 'invalid-claim',
    });
    const snapshot = Object.defineProperty({}, 'version', getter) as EvidenceSnapshot;
    expect(
      bindClaim({ result: receipt().id, value: 51200, rule: RULE.id }, snapshot, [RULE]),
    ).toEqual({ kind: 'unverified', reason: 'invalid-evidence' });
    expect(reads).toBe(0);
  });

  it.each([
    { version: 2, namespace: 'recording', runIds: ['run'], results: [] },
    { version: 1, namespace: 'recording', runIds: ['run', 'run'], results: [] },
    { version: 1, namespace: 'recording', runIds: ['run'], results: [], extra: true },
    { version: 1, namespace: 'recording', runIds: ['run'], results: null },
  ])('refuses malformed JSON-restored snapshot %#', (snapshot) => {
    expect(
      bindClaim(
        { result: receipt().id, value: 51200, rule: RULE.id },
        snapshot as EvidenceSnapshot,
        [RULE],
      ),
    ).toEqual({ kind: 'unverified', reason: 'invalid-evidence' });
  });

  it('cannot rewrite a receipt identity to move it into another lineage', () => {
    const result = receipt();
    const forged = { ...result, identity: { ...result.identity, runId: 'foreign' } };
    expect(bind(forged)).toEqual({ kind: 'unverified', reason: 'invalid-evidence' });
  });

  it.each([
    { extra: 'unknown saved field' },
    { unavailable: 'invented-reason' },
    { iteration: -1 },
    { iteration: 1.5 },
    { coverage: { checked: ['not normalized'], notChecked: [], cannotCover: [] } },
    { period: { queried: WINDOW, held: { from: 'impossible', to: WINDOW.to } } },
    { scopeDeclaration: { id: DECLARATION.id, version: DECLARATION.version, surprise: true } },
  ])('does not admit malformed restored receipt metadata %#', (over) => {
    const result = { ...receipt(), ...over } as ResultEvidence;
    expect(bind(result)).toEqual({ kind: 'unverified', reason: 'invalid-evidence' });
  });

  it('validates the whole saved receipt universe, not just the selected row', () => {
    const result = receipt();
    const malformed = {
      ...receipt({ ordinal: 2 }),
      facts: 'not an array',
    } as unknown as ResultEvidence;
    expect(
      bindClaim(
        { result: result.id, value: 51200, rule: RULE.id },
        evidenceSnapshot('recording', ['run'], [result, malformed]),
        [RULE],
      ),
    ).toEqual({ kind: 'unverified', reason: 'invalid-evidence' });
  });

  it('requires one authored rule with the actual tool and selector', () => {
    const result = receipt();
    const snapshot = evidenceSnapshot('recording', ['run'], [result]);
    const claim = { result: result.id, value: 51200, rule: RULE.id };
    expect(bindClaim(claim, snapshot, [])).toEqual({ kind: 'unverified', reason: 'unknown-rule' });
    expect(bindClaim(claim, snapshot, [RULE, RULE])).toEqual({
      kind: 'unverified',
      reason: 'invalid-rule',
    });
    for (const rule of [
      { ...RULE, toolName: 'other' },
      { ...RULE, version: '' },
      { ...RULE, scopeDeclaration: { ...DECLARATION, dimensions: [] } },
      { ...RULE, fact: { entity: { scopeDimension: 'absent' }, field: 'revenue' } },
      { ...RULE, fact: { entity: 'north', field: '' } },
    ])
      expect(bindClaim(claim, snapshot, [rule])).toEqual({
        kind: 'unverified',
        reason: 'invalid-rule',
      });
  });

  it.each([null, { id: RULE.id }, { ...RULE, scopeDeclaration: null }, { ...RULE, fact: null }])(
    'refuses malformed authored registry entry %# without throwing',
    (rule) => {
      const result = receipt();
      expect(
        bindClaim(
          { result: result.id, value: 51200, rule: RULE.id },
          evidenceSnapshot('recording', ['run'], [result]),
          [rule as ClaimBindingRule],
        ),
      ).toEqual({ kind: 'unverified', reason: 'invalid-rule' });
    },
  );

  it('rejects inherited selectors instead of treating them as an authored own declaration', () => {
    const rule = {
      ...RULE,
      fact: { entity: Object.create({ scopeDimension: 'population' }), field: 'revenue' },
    } as ClaimBindingRule;
    expect(bind(receipt(), 51200, rule)).toEqual({ kind: 'unverified', reason: 'invalid-rule' });
  });

  it('never invokes authored configuration getters during admission', () => {
    let reads = 0;
    const getter = {
      enumerable: true,
      get: () => {
        reads += 1;
        return 'north';
      },
    };
    const fact = Object.defineProperty({ field: 'revenue' }, 'entity', getter);
    expect(bind(receipt(), 51200, { ...RULE, fact } as ClaimBindingRule)).toEqual({
      kind: 'unverified',
      reason: 'invalid-rule',
    });
    const dimension = Object.defineProperty(
      { name: 'population', argumentPath: ['population'] },
      'default',
      getter,
    );
    expect(() =>
      executedScope({}, { id: 'scope', version: '1', dimensions: [dimension] }),
    ).toThrow();
    expect(reads).toBe(0);
  });

  it('capture does not read configuration accessors before admission', () => {
    let reads = 0;
    const declaration = Object.defineProperty({ ...DECLARATION }, 'id', {
      enumerable: true,
      get: () => {
        reads += 1;
        return 'scope';
      },
    });
    expect(() =>
      captureDispatch(
        { namespace: 'recording', runId: 'run', ordinal: 1 },
        { toolName: 'read_revenue', toolCallId: 'c1', iteration: 1 },
        ARGS,
        declaration,
      ),
    ).toThrow();
    expect(reads).toBe(0);
  });

  it.each(['dimensions', 'argumentPath', 'rules'] as const)(
    'never invokes an indexed getter in the %s configuration array',
    (location) => {
      let reads = 0;
      const accessorArray = <T>(value: T): T[] =>
        Object.defineProperty([value], '0', {
          enumerable: true,
          get: () => {
            reads += 1;
            return value;
          },
        });
      if (location === 'rules') {
        const result = receipt();
        expect(
          bindClaim(
            { result: result.id, value: 51200, rule: RULE.id },
            evidenceSnapshot('recording', ['run'], [result]),
            accessorArray(RULE),
          ),
        ).toEqual({ kind: 'unverified', reason: 'invalid-rule' });
      } else {
        const dimensions =
          location === 'dimensions'
            ? accessorArray(DECLARATION.dimensions[0]!)
            : [{ ...DECLARATION.dimensions[0]!, argumentPath: accessorArray('population') }];
        expect(() => executedScope(ARGS, { id: 'scope', version: '1', dimensions })).toThrow();
      }
      expect(reads).toBe(0);
    },
  );

  for (const shape of ['sparse', 'decorated'] as const) {
    it.each(['dimensions', 'argumentPath', 'rules'] as const)(
      `refuses a ${shape} %s configuration array without invoking getters`,
      (location) => {
        let reads = 0;
        const malformedArray = <T>(value: T): T[] => {
          const values = [value];
          if (shape === 'sparse') values.length = 2;
          else
            Object.defineProperty(values, 'extra', {
              enumerable: true,
              get: () => {
                reads += 1;
                return value;
              },
            });
          return values;
        };
        if (location === 'rules') {
          const result = receipt();
          expect(
            bindClaim(
              { result: result.id, value: 51200, rule: RULE.id },
              evidenceSnapshot('recording', ['run'], [result]),
              malformedArray(RULE),
            ),
          ).toEqual({ kind: 'unverified', reason: 'invalid-rule' });
        } else {
          const dimensions =
            location === 'dimensions'
              ? malformedArray(DECLARATION.dimensions[0]!)
              : [{ ...DECLARATION.dimensions[0]!, argumentPath: malformedArray('population') }];
          expect(() => executedScope(ARGS, { id: 'scope', version: '1', dimensions })).toThrow();
        }
        expect(reads).toBe(0);
      },
    );
  }
});
