/** Authored configuration and permission, not a production verifier mount. */
import { describe, expect, it } from 'vitest';
import { describedResult } from '../../../../src/lib/semantics/described.js';
import { readSemantics, semanticsForModel } from '../../../../src/lib/semantics/envelope.js';
import {
  captureDispatch,
  captureReturnedEvidence,
  finalizeEvidence,
} from '../../../../src/integrity/claim-binding/capture.js';
import type { ClaimBindingRule } from '../../../../src/integrity/claim-binding/types.js';
import {
  compileVerificationConfig,
  type EvidenceAuthorizationInput,
  type FindingsVerificationOptions,
} from '../../../../src/core/agent/findings/verificationConfig.js';

const RULE: ClaimBindingRule = {
  id: 'count',
  version: '1',
  toolName: 'read_count',
  scopeDeclaration: {
    id: 'count-scope',
    version: '1',
    dimensions: [{ name: 'site', argumentPath: ['site'] }],
  },
  fact: { entity: { scopeDimension: 'site' }, field: 'count' },
  coverage: () => 'complete',
};
const ALLOW = { resultVisible: true, scopeVisible: true };
const DENY = { resultVisible: false, scopeVisible: false };

function input(): EvidenceAuthorizationInput {
  const original = describedResult({
    facts: [{ entity: 'north', count: 14 }],
    provenance: { measuredAt: '2026-10-12T00:00:00Z', source: 'Synthetic private source.' },
    coverage: {
      checked: [{ what: 'All synthetic north rows.', short: 'North' }],
      notChecked: [{ what: 'Other synthetic sites.', short: 'Other sites', kind: 'scope' }],
    },
  });
  const dispatch = captureDispatch(
    { namespace: 'recording', runId: 'run', ordinal: 1 },
    { toolName: 'read_count', toolCallId: 'provider-call', iteration: 1 },
    { site: 'north', secretNotInScope: 'not-selected' },
    RULE.scopeDeclaration,
  );
  const returned = captureReturnedEvidence(dispatch, original);
  const semantics = readSemantics(original);
  if (semantics === undefined) throw new Error('Invalid synthetic fixture.');
  return { dispatch, returned, served: semanticsForModel(semantics) };
}

const options = (authorizeEvidence: unknown = () => ALLOW) => ({
  rules: [RULE],
  authorizeEvidence,
});

describe('strict verification configuration compilation', () => {
  it('detaches/freezes rules and keeps callbacks in configuration only', () => {
    const raw = {
      ...RULE,
      scopeDeclaration: {
        ...RULE.scopeDeclaration,
        dimensions: [...RULE.scopeDeclaration.dimensions],
      },
    };
    const config = compileVerificationConfig({ rules: [raw], authorizeEvidence: () => ALLOW });
    raw.scopeDeclaration.dimensions.push({ name: 'other', argumentPath: ['other'] });
    expect(config.rules[0].scopeDeclaration.dimensions).toHaveLength(1);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.rules)).toBe(true);
    expect(config.scopeForTool('read_count')).toEqual(RULE.scopeDeclaration);
    expect(config.scopeForTool('unknown')).toBeUndefined();
    expect(config.rules[0].coverage).toBe(RULE.coverage);
  });

  it.each([
    undefined,
    null,
    {},
    { rules: [] },
    { rules: [RULE] },
    { rules: [RULE], authorizeEvidence: true },
  ])('refuses absent rules or absent explicit authorizer', (raw) =>
    expect(() => compileVerificationConfig(raw)).toThrow(),
  );

  it('rejects unknown/inherited/accessor configuration without calling it', () => {
    let reads = 0;
    const raw = options();
    Object.defineProperty(raw, 'authorizeEvidence', {
      enumerable: true,
      get: () => {
        reads++;
        return () => ALLOW;
      },
    });
    expect(() => compileVerificationConfig(raw)).toThrow();
    expect(() => compileVerificationConfig(Object.create(options()))).toThrow();
    expect(() => compileVerificationConfig({ ...options(), allowEverything: true })).toThrow();
    const rule = { ...RULE };
    Object.defineProperty(rule, 'fact', {
      enumerable: true,
      get: () => {
        reads++;
        return RULE.fact;
      },
    });
    expect(() =>
      compileVerificationConfig({ rules: [rule], authorizeEvidence: () => ALLOW }),
    ).toThrow();
    expect(reads).toBe(0);
  });

  it('rejects sparse/decorated/accessor rule arrays and duplicate IDs', () => {
    const sparse = [RULE];
    sparse.length = 2;
    expect(() => compileVerificationConfig({ ...options(), rules: sparse })).toThrow();
    const decorated = Object.assign([RULE], { extra: true });
    expect(() => compileVerificationConfig({ ...options(), rules: decorated })).toThrow();
    let reads = 0;
    const accessors = [RULE];
    Object.defineProperty(accessors, '0', {
      enumerable: true,
      get: () => {
        reads++;
        return RULE;
      },
    });
    expect(() => compileVerificationConfig({ ...options(), rules: accessors })).toThrow();
    expect(reads).toBe(0);
    expect(() =>
      compileVerificationConfig({ ...options(), rules: [RULE, { ...RULE, version: '2' }] }),
    ).toThrow(/Duplicate/);
    expect(() =>
      compileVerificationConfig({
        ...options(),
        rules: Array.from({ length: 257 }, (_, i) => ({ ...RULE, id: String(i) })),
      }),
    ).toThrow();
  });

  it('allows multiple rules for one identical scope and distinct scopes for different tools', () => {
    const second = { ...RULE, id: 'other-count', fact: { ...RULE.fact, field: 'other' } };
    const otherTool = {
      ...RULE,
      id: 'elsewhere',
      toolName: 'other_tool',
      scopeDeclaration: { ...RULE.scopeDeclaration, id: 'different' },
    };
    const compiled = compileVerificationConfig({ ...options(), rules: [RULE, second, otherTool] });
    expect(compiled.rules).toHaveLength(3);
    expect(compiled.scopeForTool('other_tool')?.id).toBe('different');
  });

  it.each([
    { id: 'different' },
    { version: '2' },
    { dimensions: [{ name: 'site', argumentPath: ['region'] }] },
    { dimensions: [{ name: 'site', argumentPath: ['site'], default: 'north' }] },
    { periodDimension: 'site' },
  ])('rejects conflicting same-tool scopes rather than picking a winner', (change) => {
    const other = {
      ...RULE,
      id: 'second',
      scopeDeclaration: { ...RULE.scopeDeclaration, ...change },
    };
    expect(() => compileVerificationConfig({ ...options(), rules: [RULE, other] })).toThrow(
      /Conflicting/,
    );
  });

  it('compares normalizers by identity, never by source text or executing them', () => {
    let calls = 0;
    const normalize = (value: unknown) => {
      calls++;
      return value;
    };
    const first = {
      ...RULE,
      scopeDeclaration: {
        ...RULE.scopeDeclaration,
        dimensions: [{ ...RULE.scopeDeclaration.dimensions[0], normalize }],
      },
    };
    const same = { ...first, id: 'same-scope' };
    expect(compileVerificationConfig({ ...options(), rules: [first, same] }).rules).toHaveLength(2);
    const other = {
      ...same,
      scopeDeclaration: {
        ...same.scopeDeclaration,
        dimensions: [
          { ...same.scopeDeclaration.dimensions[0], normalize: (value: unknown) => value },
        ],
      },
    };
    expect(() => compileVerificationConfig({ ...options(), rules: [first, other] })).toThrow(
      /Conflicting/,
    );
    expect(calls).toBe(0);
  });
});

describe('full-metadata authorization is not projection equality', () => {
  it('gives the author detached full original metadata and only selected scope', () => {
    const original = input();
    let seen: EvidenceAuthorizationInput | undefined;
    const config = compileVerificationConfig(
      options((view: EvidenceAuthorizationInput) => {
        seen = view;
        expect(view).not.toBe(original);
        expect(view.dispatch).not.toBe(original.dispatch);
        expect(view.returned).not.toBe(original.returned);
        expect(view.dispatch.scope).toEqual({ site: 'north' });
        expect(view.returned.semantics?.coverage?.checked?.[0]).toEqual({
          what: 'All synthetic north rows.',
          short: 'North',
        });
        expect(view.returned.semantics?.coverage?.not_checked?.[0]).toEqual({
          what: 'Other synthetic sites.',
          short: 'Other sites',
          kind: 'scope',
        });
        expect(JSON.stringify(view.served)).not.toContain('"short"');
        expect(Reflect.set(view.dispatch.scope!, 'site', 'elsewhere')).toBe(false);
        return ALLOW;
      }),
    );
    expect(config.authorizeEvidence(original)).toEqual(ALLOW);
    expect(seen).toBeDefined();
    expect(original.dispatch.scope).toEqual({ site: 'north' });
    expect(Object.isFrozen(seen!.returned.semantics?.coverage?.checked)).toBe(true);
  });

  it('withholds identical model projections unless BOTH explicit permissions are true', () => {
    const boundary = input();
    const config = compileVerificationConfig(options(() => DENY));
    const decision = config.authorizeEvidence(boundary);
    const result = finalizeEvidence(boundary.dispatch, boundary.returned, boundary.served, {
      completed: true,
      ...decision,
    });
    expect(result.unavailable).toBe('withheld-evidence');
    for (const key of ['facts', 'coverage', 'period', 'scope'])
      expect(result).not.toHaveProperty(key);
  });

  it.each([
    undefined,
    null,
    true,
    {},
    { resultVisible: true },
    { scopeVisible: true },
    { resultVisible: true, scopeVisible: false },
    { resultVisible: false, scopeVisible: true },
    { resultVisible: 'true', scopeVisible: true },
    { ...ALLOW, extra: true },
  ])('treats missing/partial/malformed permission as withheld', (response) => {
    expect(compileVerificationConfig(options(() => response)).authorizeEvidence(input())).toEqual(
      DENY,
    );
  });

  it('contains author exceptions and does not invoke decision getters or thenables', () => {
    const throws = compileVerificationConfig(
      options(() => {
        throw new Error('private policy details');
      }),
    );
    expect(throws.authorizeEvidence(input())).toEqual(DENY);
    let reads = 0;
    const response = Object.defineProperty({ scopeVisible: true }, 'resultVisible', {
      enumerable: true,
      get: () => {
        reads++;
        return true;
      },
    });
    expect(compileVerificationConfig(options(() => response)).authorizeEvidence(input())).toEqual(
      DENY,
    );
    expect(
      compileVerificationConfig(
        options(() => ({
          then: () => {
            reads++;
          },
        })),
      ).authorizeEvidence(input()),
    ).toEqual(DENY);
    expect(reads).toBe(0);
  });

  it('never waits for or grants an asynchronous decision, including a rejected promise', async () => {
    expect(
      compileVerificationConfig(options(() => Promise.resolve(ALLOW))).authorizeEvidence(input()),
    ).toEqual(DENY);
    expect(
      compileVerificationConfig(
        options(() => Promise.reject(new Error('private'))),
      ).authorizeEvidence(input()),
    ).toEqual(DENY);
    await Promise.resolve();
  });

  it('rejects mismatched identity, unknown context and unbounded input before the callback', () => {
    let calls = 0;
    const config = compileVerificationConfig(
      options(() => {
        calls++;
        return ALLOW;
      }),
    );
    const boundary = input();
    const malformed: unknown[] = [
      { ...boundary, credentials: { token: 'not-admitted' } },
      { ...boundary, returned: { ...boundary.returned, resultId: 'other' } },
      { ...boundary, dispatch: { ...boundary.dispatch, scope: undefined } },
      { ...boundary, served: 'x'.repeat(300_000) },
    ];
    for (const value of malformed)
      expect(config.authorizeEvidence(value as EvidenceAuthorizationInput)).toEqual(DENY);
    expect(calls).toBe(0);
  });

  it('has a synchronous boolean port, separate from the serialized carrier', () => {
    const typed: FindingsVerificationOptions = { rules: [RULE], authorizeEvidence: () => ALLOW };
    expect(compileVerificationConfig(typed).authorizeEvidence(input())).toEqual(ALLOW);
  });
});
