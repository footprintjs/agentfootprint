import { describe, expect, it } from 'vitest';
import { TOOL_RESULT_STATUSES } from '../../../../../semantics/toolOutcome.js';
import { callOutcomeOf } from '../execution/callOutcome.js';
import { stepOutcomeOf } from './stepOutcome.js';

describe('stepOutcomeOf — a step is done only when its tool says so', () => {
  it('maps every status word the library has', () => {
    const table = Object.fromEntries(
      TOOL_RESULT_STATUSES.map((status) => [
        status,
        stepOutcomeOf({ ran: true, clean: true, status }).outcome,
      ]),
    );
    expect(table).toEqual({
      success: 'succeeded',
      absent: 'succeeded',
      failure: 'failed',
      denied: 'failed',
      invalid: 'failed',
      pending: 'not-finished',
      partial: 'not-finished',
    });
  });

  it('a held outcome carries the declared status', () => {
    expect(stepOutcomeOf({ ran: true, clean: true, status: 'denied' })).toEqual({
      outcome: 'failed',
      status: 'denied',
    });
    expect(stepOutcomeOf({ ran: true, clean: true, status: 'partial' })).toEqual({
      outcome: 'not-finished',
      status: 'partial',
    });
  });

  it('no declared status is not reported — never counted as a success', () => {
    expect(stepOutcomeOf({ ran: true, clean: true })).toEqual({ outcome: 'not-reported' });
  });

  it("a succeeded outcome carries the declared word, so 'absent' is told apart from 'success'", () => {
    expect(stepOutcomeOf({ ran: true, clean: true, status: 'success' })).toEqual({
      outcome: 'succeeded',
      status: 'success',
    });
    expect(stepOutcomeOf({ ran: true, clean: true, status: 'absent' })).toEqual({
      outcome: 'succeeded',
      status: 'absent',
    });
  });

  it('an unknown status word is not reported, carried to be told — never held', () => {
    expect(stepOutcomeOf({ ran: true, clean: true, unknownStatus: 'oops' })).toEqual({
      outcome: 'not-reported',
      unknownStatus: 'oops',
    });
    // A declared word wins: the unknown word is read only when none was declared.
    expect(
      stepOutcomeOf({ ran: true, clean: true, status: 'failure', unknownStatus: 'oops' }),
    ).toEqual({ outcome: 'failed', status: 'failure' });
    // The library's own stops still hold silently.
    expect(stepOutcomeOf({ ran: false, clean: true, unknownStatus: 'oops' })).toEqual({
      outcome: 'stopped',
    });
  });

  it("the library's own stops hold whatever the tool declared", () => {
    for (const status of [undefined, ...TOOL_RESULT_STATUSES]) {
      const s = status === undefined ? {} : { status };
      expect(stepOutcomeOf({ ran: false, clean: true, ...s }).outcome).toBe('stopped');
      expect(stepOutcomeOf({ ran: true, clean: false, ...s }).outcome).toBe('stopped');
    }
  });

  it('agrees with callOutcomeOf: a call the message records as failed or refused never completes a step', () => {
    for (const ran of [true, false]) {
      for (const clean of [true, false]) {
        for (const status of [undefined, ...TOOL_RESULT_STATUSES]) {
          const call = { ran, clean, ...(status !== undefined && { status }) };
          if (callOutcomeOf(call) === undefined) continue;
          expect(['failed', 'stopped']).toContain(stepOutcomeOf(call).outcome);
        }
      }
    }
  });
});
