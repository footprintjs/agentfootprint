/**
 * The typed half of the ANSWER.
 *
 * `AskComponent` gave the question a typed half in 9.24.0 — which registered
 * component collects the answer, and what it renders with. The answer kept
 * travelling as `approved` plus a free-text `note`, so a picked row or a brushed
 * range had to be written as prose and parsed back out by the model. That is the
 * failure the typed ask exists to prevent, surviving on the return leg.
 */
import { describe, expect, it } from 'vitest';

import { checkInApproved, checkInDeclined, isCheckInDecision } from '../../../src/index.js';
import type { DecisionValue } from '../../../src/index.js';

const rowChoice: DecisionValue = {
  kind: 'row-choice',
  value: { rowId: 'ord-1183' },
  from: 'art_R9xxKEM5uwJG9OYsCZYjBA' as DecisionValue['from'],
  coverage: { seen: 3, total: 5000, filter: 'acme' },
};

describe('a decision can carry what was chosen', () => {
  it('carries the value, the artifact it was chosen from, and what was visible', () => {
    const decision = checkInApproved({ by: 'alice@ops', value: rowChoice });
    expect(decision.value?.kind).toBe('row-choice');
    expect(decision.value?.value).toEqual({ rowId: 'ord-1183' });
    expect(decision.value?.from).toBe('art_R9xxKEM5uwJG9OYsCZYjBA');
  });

  it('records that they saw 3 of 5000 — the field that makes a pick defensible', () => {
    // Without coverage this pick is indistinguishable from a choice made over
    // the whole set. The difference is the entire value of the human's turn.
    const { value } = checkInApproved({ by: 'alice@ops', value: rowChoice });
    expect(value?.coverage).toEqual({ seen: 3, total: 5000, filter: 'acme' });
  });

  it('carries a value on a DECLINE too — "none of these" is an answer, with coverage', () => {
    const none = checkInDeclined({
      by: 'alice@ops',
      value: { kind: 'none-of-these', value: null, coverage: { seen: 12, total: 12 } },
    });
    expect(none.approved).toBe(false);
    expect(none.value?.kind).toBe('none-of-these');
    expect(none.value?.coverage?.seen).toBe(12);
  });

  it('is absent when nobody set one, so an approve/decline is what it always was', () => {
    expect(checkInApproved({ by: 'alice@ops' })).not.toHaveProperty('value');
    expect(checkInDeclined({ by: 'alice@ops', note: 'too high' })).not.toHaveProperty('value');
  });

  it('survives structuredClone, because a decision rides the checkpoint', () => {
    const decision = checkInApproved({ by: 'alice@ops', value: rowChoice });
    expect(structuredClone(decision)).toEqual(decision);
  });

  it('is still recognised as a decision by the resume guard', () => {
    expect(isCheckInDecision(checkInApproved({ by: 'alice@ops', value: rowChoice }))).toBe(true);
  });
});
