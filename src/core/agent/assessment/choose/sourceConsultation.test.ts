import { describe, expect, it } from 'vitest';

import { MAX_ENTERED_TOOL_CALLS } from '../../honesty/enteredToolCalls.js';
import { foldState } from '../chart.js';
import { assessmentDataOf, standingFactsOf, standingLineOf } from '../compose.js';

const group = { group: '0', callables: [1, 2] };
const offer = { group: '0', callable: 1, name: 'the fabric monitor' };
const receipt = { complete: true, offers: [offer], attempted: [], groups: [group] };
const occurrence = [1, 2, 3, 4, 0];
const origin = {
  callOccurrenceKey: occurrence,
  execution: 'returned',
  delivery: 'native',
  empty: 'declared-absent',
};

function assess(state: Readonly<Record<string, unknown>>, served = false) {
  return foldState(state, undefined, served);
}

function warning(state: Readonly<Record<string, unknown>>) {
  const assessment = assess(state);
  return standingLineOf(
    assessmentDataOf(assessment),
    [],
    false,
    standingFactsOf(assessment, new Map()),
  );
}

describe('recorded source consultation', () => {
  it('uses a positive witness with only the declared display name and a record address', () => {
    const result = assess({ sourceConsultation: receipt });
    expect(result.standing).toBe('not-sure');
    expect(result.reasons).toEqual([
      {
        reason: 'source-not-consulted',
        layer: 1,
        source: { kind: 'run' },
        witness: [{ kind: 'state', key: 'sourceConsultation', path: '/offers/0/callable' }],
        detail: { unusedTools: ['the fabric monitor'] },
      },
    ]);
    expect(warning({ sourceConsultation: receipt })).toBe(
      'Not sure — the run left declared ground unchecked after it was offered the fabric monitor.',
    );
  });

  it('suppresses every equivalent path after an attempt and keeps independently requested groups', () => {
    const result = assess({
      sourceConsultation: {
        ...receipt,
        offers: [offer, { group: '1', callable: 3, name: 'the independent audit' }],
        attempted: [2],
        groups: [group, { group: '1', callables: [3] }],
      },
    });
    expect(result.reasons).toEqual([
      expect.objectContaining({
        witness: [{ kind: 'state', key: 'sourceConsultation', path: '/offers/1/callable' }],
        detail: { unusedTools: ['the independent audit'] },
      }),
    ]);
  });

  it('uses the generic line for an admitted offer with no display name', () => {
    expect(
      warning({ sourceConsultation: { ...receipt, offers: [{ group: '0', callable: 1 }] } }),
    ).toBe('Not sure — the run left a declared source unchecked.');
  });

  it('bounds distinct display names without discarding evidence rows', () => {
    const offers = ['zones', 'storage', 'capacity', 'arrays', 'storage'].map((name, callable) => ({
      group: '0',
      callable,
      name,
    }));
    const result = assess({
      sourceConsultation: {
        ...receipt,
        offers,
        groups: [{ group: '0', callables: offers.map(({ callable }) => callable) }],
      },
    });
    expect(result.reasons[0]?.detail?.unusedTools).toEqual(['arrays', 'capacity', 'storage']);
    expect(result.reasons[0]?.witness).toHaveLength(offers.length);
  });

  it('keeps a typed suggestion only with a uniquely settled and natively served absence', () => {
    const sourceConsultation = { ...receipt, groups: [{ ...group, origins: [occurrence] }] };
    const state = { sourceConsultation, settledToolCallsComplete: true };
    const reasons = (settledToolCalls: readonly unknown[]) =>
      assess({ ...state, settledToolCalls }).reasons.map(({ reason }) => reason);
    expect(reasons([origin])).toContain('source-not-consulted');
    for (const facts of [
      [],
      [{ ...origin, delivery: 'withheld' }],
      [{ ...origin, delivery: 'rewritten' }],
      [{ ...origin, empty: 'empty-undeclared' }],
      [origin, origin],
    ])
      expect(reasons(facts)).not.toContain('source-not-consulted');
    const retained = foldState(
      { ...state, settledToolCalls: [origin] },
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      (key, value) => (key === 'settledToolCalls' ? 'REDACTED' : value),
    );
    expect(retained.reasons.map(({ reason }) => reason)).not.toContain('source-not-consulted');
  });

  it('keeps a hidden offer out and a hidden optional record from changing unrelated standing', () => {
    const baseline = { sourceConsultation: receipt, stoppedEarly: {} };
    const hiddenOffer = {
      ...receipt,
      offers: [offer, { group: '0', callable: 2, name: 'REDACTED' }],
    };
    expect(assess({ ...baseline, sourceConsultation: hiddenOffer }, true)).toEqual(
      assess(baseline),
    );
    const unrelated = { stoppedEarly: {} };
    expect(assess({ ...unrelated, sourceConsultation: 'REDACTED' }, true)).toEqual(
      assess(unrelated),
    );
    expect(
      foldState(baseline, undefined, false, undefined, undefined, undefined, (key, value) =>
        key === 'sourceConsultation' ? 'REDACTED' : value,
      ),
    ).toEqual(assess(unrelated));
  });

  it('rejects incomplete, oversized, unbound and ambiguous records without invoking accessors', () => {
    let reads = 0;
    const accessorOffer = {
      group: '0',
      callable: 1,
      get name() {
        reads++;
        return 'private monitor';
      },
    };
    for (const sourceConsultation of [
      undefined,
      { ...receipt, complete: false },
      { ...receipt, attempted: [undefined] },
      { ...receipt, attempted: new Array(MAX_ENTERED_TOOL_CALLS + 1) },
      { ...receipt, groups: [group, group] },
      { ...receipt, groups: [{ group: '0', callables: [2] }] },
      { ...receipt, offers: [accessorOffer] },
    ])
      expect(assess({ sourceConsultation })).toEqual(assess({}));
    expect(reads).toBe(0);
  });

  it('requires an intact omission witness and never displaces a proved offer', () => {
    const selection = {
      iteration: 1,
      consumer: { series: 'call-a', attempt: 1 },
      reason: 'ledger',
    };
    const omission = { group: '0', callable: 2, iteration: 1, name: 'archive', selection };
    const state = (row: object) => ({
      sourceConsultation: { ...receipt, offers: [], omissions: [row] },
    });
    expect(assess(state(omission)).reasons[0]?.detail).toEqual({ unavailableTools: ['archive'] });
    for (const row of [
      { ...omission, iteration: 2 },
      { ...omission, selection: undefined },
      { ...omission, selection: { ...selection, reason: 'collision' } },
      { ...omission, selection: { ...selection, consumer: { series: 'call-a', attempt: 0 } } },
      {
        ...omission,
        get selection() {
          throw Error('must not invoke');
        },
      },
    ])
      expect(assess(state(row)).reasons).toEqual([]);
    expect(assess({ sourceConsultation: { ...receipt, omissions: [omission] } })).toEqual(
      assess({ sourceConsultation: receipt }),
    );
  });

  it('keeps an unfinished paused turn from claiming a source was skipped', () => {
    const paused = assess({ sourceConsultation: receipt, pausedToolCallId: 'waiting' });
    expect(paused.standing).toBe('ask');
    expect(paused.reasons.map(({ reason }) => reason)).toEqual(['asked']);
  });
});
