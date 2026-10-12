/** Immutable admission reuse: exact budgets and the real engine's tracked raw read. */
import { describe, expect, it } from 'vitest';
import { flowChart, FlowChartExecutor, type TypedScope } from 'footprintjs';
import {
  appendEvidenceSnapshot,
  readEvidenceSnapshot,
} from '../../src/integrity/claim-binding/admit.js';
import { resultIdentityOf } from '../../src/integrity/claim-binding/capture.js';
import { BINDING_LIMITS } from '../../src/integrity/claim-binding/scope.js';
import type { ResultEvidence, ResultIdentity } from '../../src/integrity/claim-binding/types.js';
import {
  createVerificationState,
  continueVerificationState,
  readVerificationState,
  reserveResultIdentity,
  retainVerificationEvidence,
  type ClaimVerificationState,
} from '../../src/core/agent/findings/verificationState.js';

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const fresh = () => createVerificationState('run', () => 'recording');
function receipt(identity: ResultIdentity, value: unknown = 14): ResultEvidence {
  return {
    identity,
    id: resultIdentityOf(identity),
    toolName: 'count',
    toolCallId: 'same-provider-id',
    iteration: 1,
    scopeDeclaration: { id: 'site', version: '1' },
    scope: { site: 'north' },
    facts: [
      {
        entity: 'north',
        field: 'count',
        value,
        toolName: 'count',
        toolCallId: 'same-provider-id',
        iteration: 1,
      },
    ],
  };
}
function append(state: ClaimVerificationState, value: unknown = 14) {
  const reserved = reserveResultIdentity(state, state.evidence.runIds[0]);
  return retainVerificationEvidence(reserved.state, receipt(reserved.identity, value));
}
function nested(edges: number): unknown {
  let value: unknown = 0;
  for (let index = 0; index < edges; index++) value = { next: value };
  return value;
}

describe('claim evidence admission reuse', () => {
  it('reuses only detached deeply frozen owner outputs, not frozen inputs or proxies', () => {
    const original = append(fresh()).evidence;
    expect(Object.isFrozen(original)).toBe(true);
    expect(readEvidenceSnapshot(original)).toBe(original);
    const raw = Object.freeze(clone(original));
    const admitted = readEvidenceSnapshot(raw);
    expect(admitted).not.toBe(raw);
    expect(admitted.results[0]).not.toBe(raw.results[0]);
    expect(readEvidenceSnapshot(admitted)).toBe(admitted);
    const proxied = new Proxy(original, {});
    const detached = readEvidenceSnapshot(proxied);
    expect(detached).not.toBe(original);
    expect(detached).not.toBe(proxied);
    expect(detached).toEqual(original);
    expect(Reflect.set(admitted.results[0].facts![0], 'value', 999)).toBe(false);
    expect(Reflect.set(admitted, 'extra', true)).toBe(false);
  });

  it('shallow-copies the array and shell while retaining old receipt identities and bytes', () => {
    const first = append(fresh());
    const before = JSON.stringify(first);
    const second = append(first, { number: 2 });
    expect(second.evidence).not.toBe(first.evidence);
    expect(second.evidence.results).not.toBe(first.evidence.results);
    expect(second.evidence.results[0]).toBe(first.evidence.results[0]);
    expect(second.evidence.runIds).toBe(first.evidence.runIds);
    expect(Object.isFrozen(second.evidence.results)).toBe(true);
    expect(JSON.stringify(first)).toBe(before);
    expect(readEvidenceSnapshot(clone(second.evidence))).toEqual(second.evidence);
  });

  it('strictly admits a JSON restore once and still checks each caller claim maximum', () => {
    const state = append(fresh());
    const raw = clone(state);
    const restored = readVerificationState(raw, 0);
    expect(restored.evidence).not.toBe(raw.evidence);
    expect(readVerificationState(restored, 0).evidence).toBe(restored.evidence);
    expect(() => readVerificationState(restored, 1)).toThrow(/carrier/);
    const next = append(restored);
    expect(next.evidence.results[0]).toBe(restored.evidence.results[0]);
    expect(() => readVerificationState({ ...restored, nextResultOrdinal: 1 }, 0)).toThrow(
      /ordinal/,
    );
    expect(() =>
      readVerificationState(
        {
          ...restored,
          evidence: {
            ...restored.evidence,
            results: [restored.evidence.results[0], restored.evidence.results[0]],
          },
        },
        0,
      ),
    ).toThrow(/ordinal/);
  });

  it('never treats a poisoned clone, accessor, or mutated external receipt as admitted', () => {
    const first = append(fresh());
    let reads = 0;
    const poisoned = { ...first.evidence };
    Object.defineProperty(poisoned, 'results', {
      enumerable: true,
      get() {
        reads++;
        return [];
      },
    });
    expect(() => readEvidenceSnapshot(Object.freeze(poisoned))).toThrow(/data property/);
    expect(reads).toBe(0);
    expect(() => readEvidenceSnapshot({ ...first.evidence, extra: true })).toThrow(/Unknown/);
    const reserved = reserveResultIdentity(first, 'run');
    const external = receipt(reserved.identity, { count: 4 });
    const completed = retainVerificationEvidence(reserved.state, external);
    (external.facts![0].value as { count: number }).count = 999;
    expect(completed.evidence.results[1].facts![0].value).toEqual({ count: 4 });
    expect(completed.evidence.results[0]).toBe(first.evidence.results[0]);
  });

  it('preserves the unbranded slow-path refusal and invalid incoming receipt ordering', () => {
    const first = append(fresh());
    const reserved = reserveResultIdentity(first, 'run');
    const damaged = clone(reserved.state);
    Object.defineProperty(damaged.evidence.results[0], 'extra', { value: true, enumerable: true });
    const refused = retainVerificationEvidence(damaged, receipt(reserved.identity));
    expect(refused.limited).toBe(true);
    expect(refused.evidence).toBe(damaged.evidence);
    const invalid = { ...receipt(reserved.identity), extra: true };
    expect(() => retainVerificationEvidence(damaged, invalid)).toThrow(/Unknown/);
  });

  it('refreshes header accounting on continuation and refuses mismatched singleton headers', () => {
    const first = append(fresh());
    const continued = continueVerificationState(first, 'later-雪-"-\\');
    const next = reserveResultIdentity(continued, 'later-雪-"-\\');
    const singleton = readEvidenceSnapshot({
      ...continued.evidence,
      results: [receipt(next.identity)],
    });
    expect(() => appendEvidenceSnapshot(first.evidence, singleton)).toThrow(/header/);
    expect(() => appendEvidenceSnapshot(continued.evidence, { ...singleton, results: [] })).toThrow(
      /one receipt/,
    );
    expect(() =>
      appendEvidenceSnapshot(continued.evidence, { ...singleton, namespace: 'foreign' }),
    ).toThrow(/header/);
    const retained = retainVerificationEvidence(next.state, receipt(next.identity, '雪🧭"\\'));
    expect(retained.evidence.results[0]).toBe(continued.evidence.results[0]);
    expect(bytes(retained.evidence)).toBe(bytes(readEvidenceSnapshot(clone(retained.evidence))));
    expect(retained.evidence.runIds).toEqual(['run', 'later-雪-"-\\']);
    expect(first.evidence.runIds).toEqual(['run']);
  });

  it.each(['recording', 'recording-雪-"-\\-🧭'])(
    'counts exact UTF-8, escaping and every comma at one MiB: %s',
    (namespace) => {
      let state = createVerificationState('run-雪-"-\\', () => namespace);
      for (let index = 0; index < 4; index++) state = append(state, 'x'.repeat(200_000));
      const reserved = reserveResultIdentity(state, state.evidence.runIds[0]);
      const empty = receipt(reserved.identity, '');
      const padding =
        BINDING_LIMITS.snapshotBytes -
        bytes({ ...state.evidence, results: [...state.evidence.results, empty] });
      expect(padding).toBeGreaterThan(0);
      const exact = retainVerificationEvidence(
        reserved.state,
        receipt(reserved.identity, 'x'.repeat(padding)),
      );
      expect(exact.limited).toBeUndefined();
      expect(bytes(exact.evidence)).toBe(BINDING_LIMITS.snapshotBytes);
      expect(readEvidenceSnapshot(clone(exact.evidence))).toEqual(exact.evidence);
      const overflow = retainVerificationEvidence(
        reserved.state,
        receipt(reserved.identity, 'x'.repeat(padding + 1)),
      );
      expect(overflow.limited).toBe(true);
      expect(overflow.evidence).toBe(state.evidence);
      expect(overflow.evidence.results).toHaveLength(4);
      const later = reserveResultIdentity(overflow, state.evidence.runIds[0]);
      expect(retainVerificationEvidence(later.state, receipt(later.identity))).toBe(later.state);
    },
  );

  it('preserves snapshot-root depth admission even when the receipt alone is shallower', () => {
    // snapshot.results[0].facts[0].value starts at depth five.
    const accepted = append(fresh(), nested(95));
    expect(readEvidenceSnapshot(clone(accepted.evidence))).toEqual(accepted.evidence);
    expect(() => append(fresh(), nested(96))).toThrow(/nesting/);
    expect(() => append(accepted, nested(96))).toThrow(/nesting/);
  });

  it('still enforces per-receipt and per-scope caps before combined capacity', () => {
    expect(() => append(fresh(), 'x'.repeat(BINDING_LIMITS.resultBytes))).toThrow(/byte limit/);
    const reserved = reserveResultIdentity(fresh(), 'run');
    expect(() =>
      retainVerificationEvidence(reserved.state, {
        ...receipt(reserved.identity),
        scope: { site: 'x'.repeat(BINDING_LIMITS.scopeBytes) },
      }),
    ).toThrow(/byte limit/);
  });

  it.each(['full', 'delta'] as const)(
    'admits each committed stage once, then reuses 256 actual retained results through tracked raw reads (%s)',
    async (commitValues) => {
      interface State {
        [key: string]: unknown;
        claimVerification?: ClaimVerificationState;
      }
      let current = fresh();
      const initialBytes = JSON.stringify(current);
      const chart = flowChart<State>(
        'seed',
        (scope: TypedScope<State>) => {
          scope.claimVerification = current;
          expect(scope.$getValue('claimVerification')).toBe(current);
        },
        'seed',
      )
        .addFunction(
          'first',
          async (scope: TypedScope<State>) => {
            // Changed commit payloads are detached by the engine, not owner-branded.
            const committed = scope.$getValue('claimVerification');
            expect(committed).not.toBe(current);
            expect(committed).toEqual(current);
            current = readVerificationState(committed, 0);
            scope.claimVerification = current;
            const reserved = reserveResultIdentity(current, 'run');
            current = reserved.state;
            scope.claimVerification = current; // published before the asynchronous boundary
            await Promise.resolve();
            expect(scope.$getValue('claimVerification')).toBe(current);
            const raw = scope.$getValue('claimVerification') as ClaimVerificationState;
            current = retainVerificationEvidence(raw, receipt(reserved.identity));
            scope.claimVerification = current;
          },
          'first',
        )
        .addFunction(
          'next',
          (scope: TypedScope<State>) => {
            const committed = scope.$getValue('claimVerification');
            expect(committed).not.toBe(current);
            expect(committed).toEqual(current);
            const raw = readVerificationState(committed, 0);
            expect(raw.evidence).not.toBe(current.evidence);
            scope.claimVerification = raw;
            expect(scope.$getValue('claimVerification')).toBe(raw);
            const prior = raw.evidence.results[0];
            const before = JSON.stringify(raw);
            for (let index = 1; index < 256; index++) {
              const active = scope.$getValue('claimVerification') as ClaimVerificationState;
              expect(readVerificationState(active, 0).evidence).toBe(active.evidence);
              const reserved = reserveResultIdentity(active, 'run');
              scope.claimVerification = reserved.state;
              const published = scope.$getValue('claimVerification') as ClaimVerificationState;
              expect(published).toBe(reserved.state);
              current = retainVerificationEvidence(published, receipt(reserved.identity, index));
              expect(current.evidence.results[0]).toBe(prior);
              scope.claimVerification = current;
            }
            expect(JSON.stringify(raw)).toBe(before);
          },
          'next',
        )
        .build();
      // Match Agent.ts's read dial; full read capture is an opt-in engine mode.
      const executor = new FlowChartExecutor(chart, { commitValues, readTracking: 'summary' });
      await executor.run({});
      expect(current.evidence.results).toHaveLength(256);
      expect(initialBytes).toBe(JSON.stringify(fresh()));
      expect(executor.getSnapshot().sharedState.claimVerification).toEqual(current);
    },
  );
});
