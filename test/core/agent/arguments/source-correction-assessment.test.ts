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
const failed = { ...base, source: 'model', claimed: 'user', failed: 'quote-not-found' };
const corrected = {
  ...base,
  iteration: 2,
  claimed: 'none',
  correction: 'source-declaration-required',
};

describe('argument witnesses when a later proposal reuses a landed call ID', () => {
  const proposal = {
    role: 'assistant',
    content: '',
    toolCalls: [{ id: base.toolCallId, name: base.toolName, args: { vm: 'fixture' } }],
  };
  const result = {
    role: 'tool',
    toolCallId: base.toolCallId,
    toolName: base.toolName,
    content: 'fixture result',
  };
  const witness = { kind: 'state', key: 'findingsLedger', path: '/0/argument' };

  it.each([
    { later: [], label: 'one landed call', placed: true, rowCount: 1 },
    { later: [proposal], label: 'a second proposal without a result', placed: false, rowCount: 2 },
    { later: [proposal, result], label: 'two landed calls', placed: false, rowCount: 2 },
  ])('preserves the first failure with $label', ({ later, placed, rowCount }) => {
    const traced = { ...base, iteration: 2, source: 'said', claimed: 'user' };
    const assessment = assessAnswer({
      snapshot: {
        sharedState: {
          turnNumber: 1,
          history: [{ role: 'user', content: 'Look up the fixture.' }, proposal, result, ...later],
          findingsLedger: rowCount === 1 ? [failed] : [failed, traced],
        },
      },
    });
    expect(assessment.reasons.find((row) => row.reason === 'argument-unverified')).toMatchObject({
      witness: [witness],
      source: placed
        ? { kind: 'calls', calls: [{ toolCallId: base.toolCallId, toolName: base.toolName }] }
        : { kind: 'calls', calls: [], unplaced: [witness] },
    });
    expect(assessment.checked.find((row) => row.check === 'argument-sources')).toMatchObject({
      ran: rowCount,
      of: rowCount,
    });
  });
});

describe('withheld proposals retain the current pointer without earning execution credit', () => {
  it.each([{ correction: 'source-declaration-required' }, { withheld: 'batch-preempted' }])(
    'last-wins before native assessment filters %j',
    (outcome) => {
      const findingsLedger = [
        failed,
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

  it.each([{ notices: [] }, { notices: [{ toolResultOrigin: 'not-entered' }] }])(
    'retains the failed argument of a landed occurrence with later retained notices %j',
    ({ notices }) => {
      const result = {
        role: 'tool',
        toolCallId: base.toolCallId,
        toolName: base.toolName,
        content: 'lookup result',
      };
      const assessment = assessAnswer({
        snapshot: {
          sharedState: {
            turnNumber: 1,
            history: [
              { role: 'user', content: 'Look up the VM.' },
              result,
              ...notices.map((notice) => ({ ...result, ...notice })),
            ],
            findingsLedger: [failed, corrected],
          },
        },
      });
      expect(assessment.reasons.find((row) => row.reason === 'argument-unverified')).toMatchObject({
        witness: [{ kind: 'state', key: 'findingsLedger', path: '/0/argument' }],
      });
      expect(assessment.checked.find((row) => row.check === 'argument-sources')).toMatchObject({
        ran: 1,
        of: 1,
      });
    },
  );

  it.each([{ turn: 2 }, { toolName: 'different-tool' }, { argument: 'zone' }])(
    'retains the failed argument when the later unlanded row changes its identity %j',
    (other) => {
      const assessment = assessAnswer({
        snapshot: { sharedState: { findingsLedger: [failed, { ...corrected, ...other }] } },
      });
      expect(assessment.reasons.map((row) => row.reason)).toContain('argument-unverified');
      expect(assessment.checked.find((row) => row.check === 'argument-sources')).toMatchObject({
        ran: 1,
        of: 1,
      });
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
