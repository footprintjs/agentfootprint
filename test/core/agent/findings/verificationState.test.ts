/** Pure carrier tests: no Agent mounting, provider or authenticated-record claim. */
import { describe, expect, it } from 'vitest';
import {
  continueVerificationState,
  createVerificationState,
  readVerificationState,
  reserveClaimIdentity,
  reserveResultIdentity,
  retainVerificationEvidence,
  type ClaimVerificationState,
} from '../../../../src/core/agent/findings/verificationState.js';
import { resultIdentityOf } from '../../../../src/integrity/claim-binding/capture.js';
import { bindClaim } from '../../../../src/integrity/claim-binding/bindEvidence.js';
import type {
  ClaimBindingRule,
  ResultEvidence,
  ResultIdentity,
} from '../../../../src/integrity/claim-binding/types.js';

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

const fresh = () => createVerificationState('run', () => 'recording');
const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function receipt(identity: ResultIdentity, value: unknown = 14): ResultEvidence {
  return {
    identity,
    id: resultIdentityOf(identity),
    toolName: 'read_count',
    toolCallId: 'reused-provider-id',
    iteration: 1,
    scopeDeclaration: { id: 'count-scope', version: '1' },
    scope: { site: 'north' },
    facts: [
      {
        entity: 'north',
        field: 'count',
        value,
        toolName: 'read_count',
        toolCallId: 'reused-provider-id',
        iteration: 1,
      },
    ],
    coverage: { checked: [{ what: 'Synthetic north site.' }], notChecked: [], cannotCover: [] },
  };
}

function withReceipt(state = fresh(), value: unknown = 14) {
  const reserved = reserveResultIdentity(state, 'run');
  const result = receipt(reserved.identity, value);
  return { state: retainVerificationEvidence(reserved.state, result), result };
}

describe('private verification identity carrier', () => {
  it('creates randomness only on explicit creation and retains plain immutable state', () => {
    let calls = 0;
    const source = () => `recording-${++calls}`;
    expect(calls).toBe(0);
    const state = createVerificationState('run', source);
    expect(calls).toBe(1);
    expect(state.evidence.namespace).toBe('recording-1');
    expect(structuredClone(state)).toEqual(state);
    expect(jsonCopy(state)).toEqual(state);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.evidence.results)).toBe(true);
    expect(createVerificationState('run', source).evidence.namespace).not.toBe(
      state.evidence.namespace,
    );
    expect(calls).toBe(2);
  });

  it('uses browser-safe cryptographic namespaces without changing run IDs', () => {
    const first = createVerificationState('run');
    const second = createVerificationState('run');
    expect(first.evidence.namespace).not.toBe(second.evidence.namespace);
    expect(first.evidence.runIds).toEqual(['run']);
  });

  it('reserves before completion and keeps gaps from failed/unretained calls', () => {
    const original = fresh();
    const failed = reserveResultIdentity(original, 'run');
    const completed = reserveResultIdentity(failed.state, 'run');
    const retained = retainVerificationEvidence(completed.state, receipt(completed.identity));
    expect(original.nextResultOrdinal).toBe(1);
    expect(retained.nextResultOrdinal).toBe(3);
    expect(retained.evidence.results.map((r) => r.identity.ordinal)).toEqual([2]);
    expect(readVerificationState(jsonCopy(retained), 0)).toEqual(retained);
  });

  it('resumes with monotonic result and claim counters even if the run ID repeats', () => {
    const first = withReceipt();
    const claim = reserveClaimIdentity(first.state, 'run');
    const restored = readVerificationState(jsonCopy(claim.state), claim.ordinal);
    const next = reserveResultIdentity(restored, 'run');
    const nextClaim = reserveClaimIdentity(next.state, 'run');
    expect(next.identity.ordinal).toBe(2);
    expect(nextClaim.ordinal).toBe(2);
    expect(next.id).not.toBe(first.result.id);
    expect(nextClaim.id).not.toBe(claim.id);
    const resumed = continueVerificationState(nextClaim.state, 'new-process-run');
    expect(resumed.evidence.namespace).toBe('recording');
    expect(resumed.evidence.runIds).toEqual(['run', 'new-process-run']);
    expect(resumed.nextResultOrdinal).toBe(3);
    expect(resumed.nextClaimOrdinal).toBe(3);
  });

  it('does not confuse independent result and claim ordinal domains', () => {
    let state = fresh();
    for (let count = 0; count < 5; count++) state = withReceipt(state).state;
    expect(readVerificationState(state, 0).nextClaimOrdinal).toBe(1);
    expect(() => readVerificationState(state, 1)).toThrow();
  });

  it('retains both reserved calls when completion order reverses against current state', () => {
    const first = reserveResultIdentity(fresh(), 'run');
    const second = reserveResultIdentity(first.state, 'run');
    const secondLanded = retainVerificationEvidence(second.state, receipt(second.identity, 2));
    const bothLanded = retainVerificationEvidence(secondLanded, receipt(first.identity, 1));
    expect(bothLanded.evidence.results.map((result) => result.identity.ordinal)).toEqual([2, 1]);
    expect(readVerificationState(jsonCopy(bothLanded), 0)).toEqual(bothLanded);
    expect(secondLanded.evidence.results).toHaveLength(1);
  });

  it('encodes namespace and run boundaries rather than joining ambiguous strings', () => {
    const left = createVerificationState('c', () => 'a/b');
    const right = createVerificationState('b/c', () => 'a');
    expect(reserveResultIdentity(left, 'c').id).not.toBe(reserveResultIdentity(right, 'b/c').id);
    expect(reserveClaimIdentity(left, 'c').id).not.toBe(reserveClaimIdentity(right, 'b/c').id);
  });

  it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid restored counter %s',
    (counter) => {
      expect(() => readVerificationState({ ...fresh(), nextResultOrdinal: counter }, 0)).toThrow();
      expect(() => readVerificationState({ ...fresh(), nextClaimOrdinal: counter }, 0)).toThrow();
      if (counter !== 0) expect(() => readVerificationState(fresh(), counter)).toThrow();
    },
  );

  it('refuses exhausted reservations without rounding, wrapping or mutating state', () => {
    const state = readVerificationState(
      {
        ...fresh(),
        nextResultOrdinal: Number.MAX_SAFE_INTEGER,
        nextClaimOrdinal: Number.MAX_SAFE_INTEGER,
      },
      0,
    );
    expect(() => reserveResultIdentity(state, 'run')).toThrow(/capacity exhausted/);
    expect(() => reserveClaimIdentity(state, 'run')).toThrow(/capacity exhausted/);
    expect(state.nextResultOrdinal).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('closed checkpoint admission', () => {
  it('rejects unknown keys, versions, nontrue limit markers and stale counters', () => {
    const { state } = withReceipt();
    for (const change of [
      { version: 2 },
      { extra: true },
      { limited: false },
      { limited: undefined },
      { nextResultOrdinal: 1 },
    ])
      expect(() => readVerificationState({ ...state, ...change }, 0)).toThrow();
    expect(() => readVerificationState(fresh(), -1)).toThrow();
    expect(() => readVerificationState(fresh(), NaN)).toThrow();
  });

  it('does not execute getters on the carrier or a nested receipt', () => {
    let reads = 0;
    const getter = {
      enumerable: true,
      get: () => {
        reads++;
        return fresh().evidence;
      },
    };
    const hostile = { ...fresh() };
    Object.defineProperty(hostile, 'evidence', getter);
    expect(() => readVerificationState(hostile, 0)).toThrow();
    const saved = jsonCopy(withReceipt().state);
    Object.defineProperty(saved.evidence.results[0], 'facts', getter);
    expect(() => readVerificationState(saved, 0)).toThrow();
    expect(reads).toBe(0);
  });

  it('rejects foreign namespaces, absent run lineage and duplicate global ordinals', () => {
    const { state, result } = withReceipt();
    const foreign = receipt({ ...result.identity, namespace: 'elsewhere' });
    const otherRun = receipt({ ...result.identity, runId: 'other-run' });
    expect(() =>
      readVerificationState({ ...state, evidence: { ...state.evidence, results: [foreign] } }, 0),
    ).toThrow();
    expect(() =>
      readVerificationState({ ...state, evidence: { ...state.evidence, results: [otherRun] } }, 0),
    ).toThrow();
    expect(() =>
      readVerificationState(
        {
          ...state,
          evidence: {
            ...state.evidence,
            runIds: ['run', 'other-run'],
            results: [result, otherRun],
          },
        },
        0,
      ),
    ).toThrow();
    expect(() =>
      readVerificationState({ ...fresh(), evidence: { ...fresh().evidence, runIds: [] } }, 0),
    ).toThrow();
  });

  it('requires uniquely reserved receipts and detaches the retained input', () => {
    const original = fresh();
    const pending = reserveResultIdentity(original, 'run');
    const result = receipt(pending.identity);
    expect(() => retainVerificationEvidence(original, result)).toThrow(/reserved/);
    const retained = retainVerificationEvidence(pending.state, result);
    (result.scope as Record<string, unknown>).site = 'changed';
    expect(retained.evidence.results[0].scope).toEqual({ site: 'north' });
    expect(() => retainVerificationEvidence(retained, receipt(pending.identity))).toThrow(
      /reserved/,
    );
  });
});

describe('sticky retention limits preserve earlier evidence', () => {
  it('keeps 256 receipts intact, refuses the next and still binds old results', () => {
    let state: ClaimVerificationState = fresh();
    for (let index = 0; index < 256; index++) state = withReceipt(state).state;
    const before = JSON.stringify(state.evidence);
    const first = state.evidence.results[0];
    const next = reserveResultIdentity(state, 'run');
    state = retainVerificationEvidence(next.state, receipt(next.identity));
    expect(state.limited).toBe(true);
    expect(JSON.stringify(state.evidence)).toBe(before);
    expect(
      bindClaim({ result: first.id, value: 14, rule: 'count' }, state.evidence, [RULE]).kind,
    ).toBe('bound');
    const later = reserveResultIdentity(state, 'run');
    expect(retainVerificationEvidence(later.state, receipt(later.identity))).toBe(later.state);
    expect(later.state.nextResultOrdinal).toBe(259);
    expect(readVerificationState(jsonCopy(later.state), 0)).toEqual(later.state);
  });

  it('stops at the real 1 MiB snapshot limit without evicting or accepting a later small result', () => {
    let state = fresh();
    const value = 'x'.repeat(235_000);
    for (let index = 0; index < 4; index++) state = withReceipt(state, value).state;
    expect(state.limited).toBeUndefined();
    const before = JSON.stringify(state.evidence);
    state = withReceipt(state, value).state;
    expect(state.limited).toBe(true);
    expect(JSON.stringify(state.evidence)).toBe(before);
    state = withReceipt(state, 1).state;
    expect(state.evidence.results).toHaveLength(4);
    expect(state.nextResultOrdinal).toBe(7);
  });

  it('keeps new-run lineage when resuming a limited carrier', () => {
    const { state: prior } = withReceipt();
    const limited = readVerificationState({ ...prior, limited: true }, 0);
    const result = reserveResultIdentity(limited, 'new-run');
    const claim = reserveClaimIdentity(result.state, 'new-run');
    expect(claim.state.limited).toBe(true);
    expect(claim.state.evidence.runIds).toEqual(['run', 'new-run']);
    expect(claim.state.evidence.results).toEqual(prior.evidence.results);
    expect(readVerificationState(jsonCopy(claim.state), claim.ordinal)).toEqual(claim.state);
    expect(retainVerificationEvidence(claim.state, receipt(result.identity))).toBe(claim.state);
  });

  it('refuses a new run when lineage fills instead of minting an unrecorded identity', () => {
    let state = withReceipt().state;
    for (let index = 1; index < 256; index++)
      state = continueVerificationState(state, `run-${index}`);
    const before = JSON.stringify(state.evidence);
    expect(() => reserveResultIdentity(state, 'run-after-limit')).toThrow(/lineage capacity/);
    expect(() => reserveClaimIdentity(state, 'run-after-limit')).toThrow(/lineage capacity/);
    expect(JSON.stringify(state.evidence)).toBe(before);
    const repeated = reserveResultIdentity(state, 'run');
    expect(repeated.identity.ordinal).toBe(2);
    expect(repeated.identity.namespace).toBe('recording');
    expect(JSON.stringify(repeated.state.evidence)).toBe(before);
  });
});
