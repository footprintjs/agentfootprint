/** A no-read observation describes the current native record, not the world.
 * Exact incidental clauses stay excluded without modifying the frozen detector. */
import { describe, expect, it } from 'vitest';
import { detectNegativeClaims } from '../../../src/integrity/negative-claim/detect.js';
import { eligibleNoReadClaim } from '../../../src/integrity/negative-claim/noRead.js';
import { judgeProseNegatives } from '../../../src/integrity/negative-claim/prose.js';
import type { TurnCall, TurnRecord } from '../../../src/integrity/negative-claim/types.js';
import { incidentCall, turnRecord } from './fixtures.js';

const eligible = (text: string) => detectNegativeClaims(text).claims.filter(eligibleNoReadClaim);

describe('no-read eligibility', () => {
  it.each([
    'None.',
    'NONE',
    'No action is needed.',
    'NO ACTION IS NEEDED!',
    'Tests: 0 failed.',
    'Tests — 0 failed.',
  ])('preserves the exact incidental exclusion: %s', (text) => {
    // These are raw grammar hits. Only the new observation's eligibility
    // excludes them; changing the frozen detector would falsify replay lineage.
    expect(detectNegativeClaims(text).claims.length).toBeGreaterThan(0);
    expect(eligible(text)).toEqual([]);
  });

  it.each([
    'Payments has no incidents.',
    'There are no incidents anywhere.',
    'No incidents are open.',
    'These are all the incidents.',
    'None of the incidents are open.',
    'The incidents are none.',
    'No action is needed for payments.',
    'Tests: 0 failed for payments.',
    'There are no actions needed.',
  ])('retains a real or extended negative clause: %s', (text) => {
    expect(eligible(text).length).toBeGreaterThan(0);
  });

  it('an incidental clause cannot hide a separate real negative', () => {
    const text = 'No action is needed. Tests: 0 failed. Payments has no incidents.';
    expect(detectNegativeClaims(text).claims).toHaveLength(3);
    const claims = eligible(text);
    expect(claims).toHaveLength(1);
    expect(text.slice(claims[0].unit.start, claims[0].unit.end)).toBe('Payments has no incidents.');
  });

  it('retains the clause after an incidental clause split by but', () => {
    const claims = eligible('No action is needed, but there are no incidents anywhere.');
    expect(claims).toHaveLength(1);
    expect(claims[0].phraseId).toBe('none.there-are-no');
  });

  it.each(['```\nThere are no incidents.\n```', 'No hay incidentes abiertos en payments.'])(
    'does not turn an unread language or code note into a no-read trigger: %s',
    (text) => {
      expect(eligible(text)).toEqual([]);
      expect(detectNegativeClaims(text).notes.length).toBeGreaterThan(0);
    },
  );
});

const observations = (calls: readonly TurnCall[], extra: Partial<TurnRecord> = {}) =>
  judgeProseNegatives({
    field: '/',
    text: 'Payments has no incidents.',
    record: { ...turnRecord(calls), ...extra },
  });
const noRead = (rows: ReturnType<typeof observations>) =>
  rows.filter((row) => row.kind === 'negative-claim-note' && row.code === 'no-read');

describe('no-read means no native read recorded for this turn', () => {
  it('notes an empty native record without inventing a bound claim', () => {
    expect(observations([])).toEqual([
      {
        kind: 'negative-claim-note',
        field: '/',
        code: 'no-read',
        span: { start: 0, end: 'Payments has no incidents.'.length },
        packVersion: '1',
      },
    ]);
  });

  it.each([
    ['a proposal refused before dispatch', { dispatched: false }],
    ['a dispatched write', { effect: 'not-read' }],
    ['an undeclared effect', { effect: undefined }],
    ['a different recording namespace', { resultId: 'claim-result/other/run-1/1' }],
    ['a provider call id standing in for a native identity', { resultId: 'call_provider_1' }],
  ] as const)('%s cannot suppress the warning', (_label, extra) => {
    expect(noRead(observations([{ ...incidentCall(), ...extra }]))).toHaveLength(1);
  });

  it.each([
    ['a successful dispatched read', {}],
    ['a failed dispatched read', { outcome: 'error', noRow: true }],
    ['a hidden dispatched read', { keptOut: true }],
    ['an earlier run leg of this same turn', { runId: 'run-before-pause' }],
  ] as const)('%s remains a recorded attempt', (_label, options) => {
    expect(noRead(observations([incidentCall(options)]))).toEqual([]);
  });

  it('retains stale evidence as a separate finding without calling it a current read', () => {
    const rows = observations([incidentCall({ turn: 1, readAt: '2026-10-21T10:00:00Z' })], {
      turn: 2,
    });
    expect(noRead(rows)).toHaveLength(1);
    expect(rows).toContainEqual(
      expect.objectContaining({
        kind: 'negative-claim',
        notes: ['stale-turn'],
        staleSince: { turn: 1, readAt: '2026-10-21T10:00:00Z' },
      }),
    );
  });

  it('an incomplete empty record still reports only that no read was recorded', () => {
    const rows = observations([], { ledgerComplete: false });
    expect(rows).toHaveLength(1);
    expect(noRead(rows)).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('results');
  });

  it('an incomplete record with a known read reports incompleteness, not no-read', () => {
    const rows = observations([incidentCall()], { ledgerComplete: false });
    expect(noRead(rows)).toEqual([]);
    expect(rows).toContainEqual(
      expect.objectContaining({
        kind: 'negative-claim',
        notes: ['record-incomplete'],
        results: [],
      }),
    );
  });

  it('records at most one no-read warning for several eligible clauses in one field', () => {
    const rows = judgeProseNegatives({
      field: '/',
      text: 'Payments has no incidents. Checkout has no incidents.',
      record: turnRecord([]),
    });
    expect(noRead(rows)).toHaveLength(1);
    expect(rows).toHaveLength(1);
  });
});
