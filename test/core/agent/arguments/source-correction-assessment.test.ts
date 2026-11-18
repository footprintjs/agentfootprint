import { describe, expect, it } from 'vitest';
import { assessAnswer } from '../../../../src/core/agent/assessment/assess.js';

const base = {
  kind: 'argument',
  turn: 1,
  iteration: 1,
  toolCallId: 'reused',
  toolName: 'synthetic',
  argument: 'vm',
  rule: 'ask',
};
describe('withheld proposals retain the current pointer without earning execution credit', () => {
  it.each([{ correction: 'source-declaration-required' }, { withheld: 'batch-preempted' }])(
    'last-wins before native assessment filters %j',
    (outcome) => {
      const findingsLedger = [
        { ...base, source: 'model', claimed: 'user', failed: 'quote-not-found' },
        { ...base, iteration: 2, claimed: 'none', ...outcome },
        {
          kind: 'integrity-finding',
          turn: 1,
          iteration: 1,
          finding: 'column-type-mismatch',
          seam: 'write',
        },
      ];
      const assessment = assessAnswer({
        snapshot: { sharedState: { turnNumber: 1, findingsLedger } },
      });
      expect(
        assessment.checked.filter((row) =>
          ['argument-rules', 'argument-sources'].includes(row.check),
        ),
      ).toEqual([]);
      expect(
        assessment.reasons.some(
          (row) => row.reason === 'argument-unverified' || row.reason === 'argument-asked',
        ),
      ).toBe(false);
      expect(assessment.reasons.map((row) => row.reason)).toContain('column-type-mismatch');
      expect(findingsLedger).toHaveLength(3);
    },
  );

  it('a genuinely asked fallback and an earlier real argument failure retain their standing', () => {
    const assessment = assessAnswer({
      snapshot: {
        sharedState: {
          turnNumber: 1,
          argumentAsk: { waiting: { requestId: 'native-question' } },
          findingsLedger: [
            {
              ...base,
              toolCallId: 'earlier-executed',
              source: 'model',
              claimed: 'user',
              failed: 'quote-not-found',
            },
            { ...base, correction: 'source-declaration-required', claimed: 'none' },
            { ...base, toolCallId: 'fallback', asked: 'unverified', claimed: 'none' },
          ],
        },
      },
    });
    expect(assessment.reasons.map((row) => row.reason)).toContain('argument-unverified');
    expect(assessment.reasons.map((row) => row.reason)).toContain('argument-asked');
    expect(assessment.checked.find((row) => row.check === 'argument-sources')).toMatchObject({
      ran: 2,
      of: 2,
    });
  });
});
