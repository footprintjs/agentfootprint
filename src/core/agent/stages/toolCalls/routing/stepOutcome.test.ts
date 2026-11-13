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
