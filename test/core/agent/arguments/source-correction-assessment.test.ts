import { describe, expect, it } from 'vitest';
import { argumentRows } from '../../../../src/core/agent/assessment/argumentRows.js';
import { assessAnswer } from '../../../../src/core/agent/assessment/assess.js';
import { readHistoryCalls } from '../../../../src/core/agent/recordedCalls.js';
import type { CallOccurrenceKey } from '../../../../src/lib/callOccurrence.js';

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
const firstKey = [1, 2, 3, 4, 0] as const;
const secondKey = [1, 2, 3, 4, 1] as const;
const otherKey = [1, 2, 3, 4, 2] as const;
const entryProof = (...keys: readonly CallOccurrenceKey[]) => ({
  entries: keys.map((callOccurrenceKey) => ({ callOccurrenceKey, entered: true })),
  complete: true,
});
const keyedFailure = { ...failed, callOccurrenceKey: firstKey };
const keyedCorrection = { ...corrected, callOccurrenceKey: secondKey };
const landedResult = (
  callOccurrenceKey: CallOccurrenceKey,
  toolCallId = base.toolCallId,
  toolName = base.toolName,
) => ({
  role: 'tool',
  toolCallId,
  toolName,
  content: 'fixture result',
  toolResultExecution: 'returned',
  callOccurrenceKey,
});

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
  const keyedTraced = { ...traced, callOccurrenceKey: secondKey };
  const keyedProposal = (callOccurrenceKey: CallOccurrenceKey) => ({
    ...proposal,
    toolCalls: [{ ...proposal.toolCalls[0]!, callOccurrenceKey }],
  });
  const firstProposal = keyedProposal(firstKey);
  const secondProposal = keyedProposal(secondKey);
  const firstResult = landedResult(firstKey);
  const secondResult = landedResult(secondKey);
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
      label: 'a second entered call paused without returning',
      history: [firstProposal, firstResult, secondProposal],
      ledger: [keyedFailure, keyedTraced],
      entered: entryProof(firstKey, secondKey),
      placement: 'placed',
      checked: [0, 1],
      paused: true,
    },
    {
      label: 'two landed calls',
      history: [firstProposal, firstResult, secondProposal, secondResult],
      ledger: [keyedFailure, keyedTraced],
      entered: entryProof(firstKey, secondKey),
      placement: 'placed',
      checked: [0, 1],
    },
    {
      label: 'a landed failure before a withheld correction',
      history: [firstProposal, firstResult, secondProposal],
      ledger: [keyedFailure, keyedCorrection],
      entered: entryProof(firstKey),
      placement: 'placed',
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
      history: [firstProposal, secondProposal, secondResult],
      ledger: [{ ...withheld, iteration: 1, callOccurrenceKey: firstKey }, keyedTraced],
      entered: entryProof(secondKey),
      placement: 'no-failure',
      checked: [1],
    },
    {
      label: 'a failed proposal without a result before a clean result',
      history: [firstProposal, secondProposal, secondResult],
      ledger: [keyedFailure, keyedTraced],
      entered: entryProof(secondKey),
      placement: 'no-failure',
      checked: [1],
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
      history: [secondProposal, secondResult],
      ledger: [keyedFailure, keyedTraced],
      entered: entryProof(firstKey, secondKey),
      placement: 'unplaced',
      checked: [0, 1],
    },
    {
      label: 'both reused results were evicted and a different call remains',
      history: [
        { ...proposal, toolCalls: [{ ...otherId, callOccurrenceKey: otherKey }] },
        landedResult(otherKey, otherId.id),
      ],
      ledger: [keyedFailure, keyedTraced],
      entered: entryProof(firstKey, secondKey, otherKey),
      placement: 'unplaced',
      checked: [0, 1],
    },
    {
      label: 'both reused results were evicted and no call remains',
      history: [],
      ledger: [keyedFailure, keyedTraced],
      entered: entryProof(firstKey, secondKey),
      placement: 'unplaced',
      checked: [0, 1],
    },
    {
      label: 'the first result was evicted and the second entered call has no result',
      history: [secondProposal],
      ledger: [keyedFailure, keyedTraced],
      entered: entryProof(firstKey, secondKey),
      placement: 'unplaced',
      checked: [0, 1],
      paused: true,
    },
    {
      label: 'an unstamped legacy argument',
      history: [proposal, result],
      ledger: [{ ...failed, iteration: undefined }],
      placement: 'entry-unknown',
      checked: [],
    },
    {
      label: 'two calls in the same reply landed under one ID',
      history: [
        { ...proposal, toolCalls: [...firstProposal.toolCalls, ...secondProposal.toolCalls] },
        firstResult,
        secondResult,
      ],
      ledger: [keyedFailure, { ...keyedTraced, iteration: 1 }],
      entered: entryProof(firstKey, secondKey),
      placement: 'placed',
      checked: [0, 1],
    },
    {
      label: 'a pending proposal of a different tool reusing the ID',
      history: [
        firstProposal,
        firstResult,
        { ...proposal, toolCalls: [{ ...secondProposal.toolCalls[0]!, name: 'another_tool' }] },
      ],
      ledger: [keyedFailure, { ...keyedTraced, toolName: 'another_tool' }],
      entered: entryProof(firstKey),
      placement: 'placed',
      checked: [0],
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
      placement: 'entry-unknown',
      checked: [],
    },
  ])(
    'reads the argument witness with $label',
    ({ history, ledger, entered, placement, checked, paused }) => {
      const assessment = assessAnswer({
        snapshot: {
          sharedState: {
            turnNumber: 1,
            history: [{ role: 'user', content: 'Look up the fixture.' }, ...history],
            findingsLedger: ledger,
            ...(entered !== undefined && { enteredToolCalls: entered }),
            ...(paused && { pausedToolCallId: base.toolCallId }),
          },
        },
      });
      const reason = assessment.reasons.find((row) => row.reason === 'argument-unverified');
      if (placement === 'entry-unknown') {
        expect(reason).toBeUndefined();
        expect(assessment.reasons).toMatchObject([
          { reason: 'check-unreachable', witness: [witness], source: { kind: 'run' } },
        ]);
      } else if (placement === 'no-failure') expect(reason).toBeUndefined();
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
        keyedFailure,
        { ...base, callOccurrenceKey: firstKey, iteration: 2, claimed: 'none', ...outcome },
        {
          kind: 'integrity-finding',
          turn: 1,
          iteration: 1,
          finding: 'column-type-mismatch',
          seam: 'write',
          callOccurrenceKey: otherKey,
        },
      ];
      const history = [landedResult(otherKey, 'column-check', 'read_columns')];
      const sharedState = {
        turnNumber: 1,
        findingsLedger,
        history,
        enteredToolCalls: entryProof(otherKey),
      };
      expect(argumentRows(sharedState, readHistoryCalls(history), history, -1)).toMatchObject([
        { index: 1, withheld: true },
      ]);
      const assessment = assessAnswer({ snapshot: { sharedState } });
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
      const assessment = assessAnswer({
        snapshot: {
          sharedState: {
            turnNumber: 1,
            history: [
              { role: 'user', content: 'Look up the VM.' },
              landedResult(firstKey),
              ...notices.map((notice) => ({
                ...landedResult(secondKey),
                ...notice,
                toolResultExecution: 'not-entered',
              })),
            ],
            enteredToolCalls: entryProof(firstKey),
            findingsLedger: [keyedFailure, keyedCorrection],
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
        snapshot: {
          sharedState: {
            enteredToolCalls: entryProof(firstKey),
            findingsLedger: [
              keyedFailure,
              {
                ...keyedCorrection,
                ...other,
                ...('argument' in other && { callOccurrenceKey: firstKey }),
              },
            ],
          },
        },
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
          argumentAsk: { waiting: { requestId: 'native-question', iteration: 2 } },
          enteredToolCalls: entryProof(firstKey),
          findingsLedger: [
            {
              ...keyedFailure,
              toolCallId: 'earlier-executed',
            },
            keyedCorrection,
            {
              ...base,
              iteration: 2,
              callOccurrenceKey: otherKey,
              toolCallId: 'fallback',
              asked: 'unverified',
              claimed: 'none',
            },
          ],
        },
      },
    });
    expect(assessment.reasons.map((row) => row.reason)).toContain('argument-unverified');
    expect(assessment.reasons.map((row) => row.reason)).toContain('argument-asked');
    expect(assessment.checked.find((row) => row.check === 'argument-sources')).toMatchObject({
      ran: 1,
      of: 1,
      witness: [{ kind: 'state', key: 'findingsLedger', path: '/0/claimed' }],
    });
  });
});
