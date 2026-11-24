import { describe, expect, it } from 'vitest';

import { REASONS, reasonEntry } from '../../../../src/core/agent/assessment/reasons.js';
import type { AssessmentReason } from '../../../../src/core/agent/assessment/types.js';

describe('UNIT — the reason table', () => {
  it('covers the union, once each, and names the class of each', () => {
    const union: readonly AssessmentReason[] = [
      'asked',
      // Honesty layer 2 (the inputs layer, steps 3 and 4).
      'argument-asked',
      'argument-assumed',
      'argument-unverified',
      // …and step 5 (declared sources).
      'argument-read',
      'value-contingent',
      'declared-absent',
      'coverage-gap',
      'empty-undeclared',
      'call-not-completed',
      'result-cut',
      'placed-unread',
      'times-without-zone',
      'result-withheld',
      'result-dropped-from-window',
      'memory-retrieval-timeout',
      'memory-retrieval-excluded',
      'work-not-finished',
      // Honesty layer 3 (the results layer's period verdicts, step 7b).
      'period-not-held',
      'period-partly-held',
      'period-unknown',
      'period-undeclared',
      // The time layer's result checks (step T8).
      'period-differs-from-asked',
      'period-beyond-retention',
      'sources-conflict',
      'value-unsupported',
      'value-survived-revision',
      // The time layer (step T7): a time value the library spelled from a reading.
      'derived-from-reading',
      // Code in an answer (`code: 'match'`): a shown block matches no submission of the turn.
      'script-unmatched',
      'stopped-early',
      'answer-output-limit',
      // Honesty layer 4 (the answer layer's procedure witness rows, step 6).
      'steps-unfinished',
      'step-skipped',
      'answer-check-failed',
      'check-unreachable',
      'negative-prose-unverified',
      'claim-exceeds-search',
      'declaration-overclaimed',
      // Integrity findings on the record, and a `.claims()` field no tool settled.
      'invariant-violation',
      'unsupported-argument',
      'column-type-mismatch',
      'missing-column',
      'ungrounded-entity',
      'unsupported-claim',
      'claim-unsettled',
    ];
    expect([...REASONS.map((r) => r.reason)].sort()).toEqual([...union].sort());
    expect(REASONS.filter((r) => r.class === 'ask').map((r) => r.reason)).toEqual([
      'asked',
      'argument-asked',
    ]);
    expect(reasonEntry('work-not-finished').class).toBe('not-sure');
    expect(reasonEntry('step-skipped').class).toBe('not-sure');
    expect(Object.isFrozen(REASONS)).toBe(true);
    expect(() => reasonEntry('nope' as AssessmentReason)).toThrow(/no table entry/);
  });
});
