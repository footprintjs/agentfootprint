/**
 * The fold over the one REAL field recording the library keeps — the answer
 * account's fixture A (`test/lib/answer-account/fixtures/turn2.recorded.json`).
 *
 * That fixture was REDUCED before the fold existed: its state keeps `history`,
 * `userMessage`, `turnNumber` and `pausedToolCallId`, and drops every other
 * committed key — `coverageDeclared` among them. The events still carry the
 * tool's absence (`tools.absent`), and the account prints it; the fold reads
 * committed rows only, never events, so on this record it can check nothing
 * and says "not assessed". That is the law working, pinned here so it is never
 * mistaken for a defect: the fold does not rebuild a row from an event.
 *
 * A SYNTHETIC variant (named so) restores the one row the reducer dropped —
 * the absence's `coverageDeclared` row, copied field by field from the
 * record's own `tools.absent` event (the run's dispatch door files the two
 * from one reading) — and the fold then reads what the run declared: not sure,
 * a coverage gap and a declared absence. The earlier turn's result (turn 1's
 * `powerstore_get_volumes`) is not this answer's, whatever the app declares
 * about its shape.
 *
 * Test types: REGRESSION on the real record; INTEGRATION with the account.
 */

import { describe, expect, it } from 'vitest';

import { assessAnswer } from '../../../../src/core/agent/assessment/assess.js';
import { accountForAnswer } from '../../../../src/lib/answer-account/account.js';
import {
  fixtureA,
  FLAGSHIP_RUN_ID,
  NEO_DECLARATIONS,
} from '../../../lib/answer-account/helpers.js';

type Ev = { type: string; payload: Record<string, unknown> };

/** Fixture A with the absence's coverage row restored from its own `tools.absent` event. */
function withCoverageRow() {
  const recording = fixtureA() as unknown as {
    snapshot: { sharedState: Record<string, unknown> };
    events: Ev[];
  };
  const event = recording.events.find((e) => e.type === 'agentfootprint.tools.absent')!;
  const p = event.payload;
  recording.snapshot.sharedState.coverageDeclared = [
    {
      kind: 'absence',
      toolName: p.toolName,
      toolCallId: p.toolCallId,
      iteration: p.iteration,
      lookedFor: p.lookedFor,
      checked: p.checked,
      notChecked: p.notChecked ?? [],
      cannotCover: p.cannotCover ?? [],
    },
  ];
  return recording;
}

describe('fixture A — the real recording, reduced', () => {
  it('its committed rows hold no verdict the fold can read: not assessed (never rebuilt from events)', () => {
    const a = assessAnswer(fixtureA(), NEO_DECLARATIONS);
    expect(a.standing).toBe('not-assessed');
    expect(a.reasons).toEqual([]);
    // It read this turn only: one result (get_array_inventory's), not turn 1's.
    expect(a.checked).toEqual([
      { layer: 3, check: 'tool-coverage', ran: 0, of: 1, witness: [] },
      { layer: 3, check: 'result-shape', ran: 0, of: 1, witness: [] },
    ]);
    expect(a.turnFrom).toBe('person');
  });

  it('SYNTHETIC — its coverage row restored: not sure, a gap and a declared absence', () => {
    const recording = withCoverageRow();
    const a = assessAnswer(recording, NEO_DECLARATIONS);
    expect(a.standing).toBe('not-sure');
    expect(a.reasons.map((r) => r.reason)).toEqual(['coverage-gap', 'declared-absent']);
    expect(a.checked.find((c) => c.check === 'result-shape')).toMatchObject({ ran: 1, of: 1 });
    // The account renders the same fold.
    const account = accountForAnswer(recording as never, NEO_DECLARATIONS, {
      runId: FLAGSHIP_RUN_ID,
    });
    expect(account.facts.standing.value).toBe('not-sure');
    const howSure = account.rows.find((r) => r.id === 'how-sure')!.lines.map((l) => l.text);
    expect(howSure.slice(0, 3)).toEqual([
      'Not sure — the record holds 2 reasons this answer may not stand:',
      '1 call declared ground it did not check or can never cover.',
      '1 call declared that nothing matched.',
    ]);
  });
});
