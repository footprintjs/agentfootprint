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
  const traced = { ...base, iteration: 2, source: 'said', claimed: 'user' };
  const withheld = { ...corrected, correction: undefined, withheld: 'batch-preempted' };
  const otherId = { ...proposal.toolCalls[0]!, id: 'other-call' };

  it.each([
    {
      label: 'one landed call',
      history: [proposal, result],
      ledger: [failed],
      placement: 'placed',
      checked: [0],
    },
    {
      label: 'a second proposal without a result',
      history: [proposal, result, proposal],
      ledger: [failed, traced],
      placement: 'unplaced',
      checked: [0, 1],
      paused: true,
    },
    {
      label: 'two landed calls',
      history: [proposal, result, proposal, result],
      ledger: [failed, traced],
      placement: 'unplaced',
      checked: [0, 1],
    },
    {
      label: 'a landed failure before a withheld correction',
      history: [proposal, result, proposal],
      ledger: [failed, corrected],
      placement: 'unplaced',
      checked: [0],
    },
    {
      label: 'a failed proposal corrected before either landed',
      history: [proposal, proposal],
      ledger: [failed, corrected],
      placement: 'no-failure',
      checked: [],
    },
    {
      label: 'a withheld proposal before a clean result',
      history: [proposal, proposal, result],
      ledger: [{ ...withheld, iteration: 1 }, traced],
      placement: 'no-failure',
      checked: [1],
    },
    {
      label: 'a failed proposal without a result before a clean result',
      history: [proposal, proposal, result],
      ledger: [failed, traced],
      placement: 'unplaced',
      checked: [0, 1],
    },
    {
      label: 'two observations of the same landed iteration',
      history: [proposal, result],
      ledger: [failed, { ...traced, iteration: 1 }],
      placement: 'no-failure',
      checked: [1],
    },
    {
      label: 'the window removed the first landed call',
      history: [proposal, result],
      ledger: [failed, traced],
      placement: 'unplaced',
      checked: [0, 1],
    },
    {
      label: 'both reused results were evicted and a different call remains',
      history: [
        { ...proposal, toolCalls: [otherId] },
        { ...result, toolCallId: otherId.id },
      ],
      ledger: [failed, traced],
      placement: 'without-result',
      checked: [0, 1],
    },
    {
      label: 'both reused results were evicted and no call remains',
      history: [],
      ledger: [failed, traced],
      placement: 'without-result',
      checked: [0, 1],
    },
    {
      label: 'the first result was evicted and the second proposal has no result',
      history: [proposal],
      ledger: [failed, traced],
      placement: 'without-result',
      checked: [0, 1],
      paused: true,
    },
    {
      label: 'an unstamped legacy argument',
      history: [proposal, result],
      ledger: [{ ...failed, iteration: undefined }],
      placement: 'unplaced',
      checked: [0],
    },
    {
      label: 'two calls in the same reply landed under one ID',
      history: [
        { ...proposal, toolCalls: [...proposal.toolCalls, ...proposal.toolCalls] },
        result,
        result,
      ],
      ledger: [failed, { ...traced, iteration: 1 }],
      placement: 'unplaced',
      checked: [0, 1],
    },
    {
      label: 'a pending proposal of a different tool reusing the ID',
      history: [
        proposal,
        result,
        { ...proposal, toolCalls: [{ ...proposal.toolCalls[0]!, name: 'another_tool' }] },
      ],
      ledger: [failed, { ...traced, toolName: 'another_tool' }],
      placement: 'placed',
      checked: [0, 1],
    },
    {
      label: 'a competing proposal beyond the read bound',
      history: [
        {
          ...proposal,
          toolCalls: [
            ...proposal.toolCalls,
            ...Array.from({ length: 999 }, (_, index) => ({
              ...proposal.toolCalls[0]!,
              id: `other-${index}`,
            })),
            ...proposal.toolCalls,
          ],
        },
        result,
      ],
      ledger: [failed],
      placement: 'unplaced',
      checked: [0],
    },
  ])(
    'reads the argument witness with $label',
    ({ history, ledger, placement, checked, paused }) => {
      const assessment = assessAnswer({
        snapshot: {
          sharedState: {
            turnNumber: 1,
            history: [{ role: 'user', content: 'Look up the fixture.' }, ...history],
            findingsLedger: ledger,
            ...(paused && { pausedToolCallId: base.toolCallId }),
          },
        },
      });
      const reason = assessment.reasons.find((row) => row.reason === 'argument-unverified');
      if (placement === 'no-failure') expect(reason).toBeUndefined();
      else {
        expect(reason?.witness).toEqual([witness]);
        expect(reason?.source).toEqual(
          placement === 'unplaced'
            ? { kind: 'calls', calls: [], unplaced: [witness] }
            : { kind: 'calls', calls: [{ toolCallId: base.toolCallId, toolName: base.toolName }] },
        );
      }
      const sources = assessment.checked.find((row) => row.check === 'argument-sources');
      if (checked.length === 0) expect(sources).toBeUndefined();
      else {
        expect(sources).toMatchObject({
          ran: checked.length,
          of: checked.length,
          witness: checked.map((index) => ({
            kind: 'state',
            key: 'findingsLedger',
            path: `/${index}/claimed`,
          })),
        });
      }
    },
  );
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
