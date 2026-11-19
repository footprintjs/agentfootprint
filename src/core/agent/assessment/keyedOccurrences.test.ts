import { describe, expect, it } from 'vitest';
import { foldState } from './assess.js';

const firstKey = [1, 2, 3, 4, 0];
const secondKey = [1, 2, 3, 4, 1];
const toolCallId = 'reused';
const toolName = 'inventory';
const request = { role: 'user', content: 'Read the shelf.' };

function proposal(callOccurrenceKey: readonly number[]) {
  return {
    role: 'assistant',
    content: '',
    toolCalls: [{ id: toolCallId, name: toolName, args: {}, callOccurrenceKey }],
  };
}

function result(callOccurrenceKey: readonly number[]) {
  return { role: 'tool', toolCallId, toolName, callOccurrenceKey, content: '["item"]' };
}

function observation(callOccurrenceKey: readonly number[], source: string) {
  return {
    kind: 'argument',
    argument: 'shelf',
    rule: 'assume',
    turn: 1,
    iteration: 1,
    toolCallId,
    toolName,
    callOccurrenceKey,
    source,
  };
}

const firstProposal = proposal(firstKey);
const secondProposal = proposal(secondKey);
const firstResult = result(firstKey);
const secondResult = result(secondKey);
const failed = observation(firstKey, 'model');
const clean = observation(secondKey, 'said');
const withheld = { ...clean, correction: 'source-declaration-required' };
const failedWitness = { kind: 'state', key: 'findingsLedger', path: '/0/argument' };

describe('argument standing from a recorded call key', () => {
  it.each([
    {
      label: 'one landed',
      history: [firstProposal, firstResult],
      rows: [failed],
      result: 'placed',
    },
    {
      label: 'second waiting without a result',
      history: [firstProposal, firstResult, secondProposal],
      rows: [failed, clean],
      paused: true,
      result: 'placed',
    },
    {
      label: 'both landed',
      history: [firstProposal, firstResult, secondProposal, secondResult],
      rows: [failed, clean],
      result: 'placed',
    },
    {
      label: 'second withheld for correction',
      history: [firstProposal, firstResult, secondProposal],
      rows: [failed, withheld],
      result: 'placed',
    },
    {
      label: 'same call corrected before it landed',
      history: [firstProposal],
      rows: [failed, { ...withheld, callOccurrenceKey: firstKey }],
      result: 'cleared',
    },
    {
      label: 'first withheld, second landed clean',
      history: [firstProposal, secondProposal, secondResult],
      rows: [{ ...withheld, callOccurrenceKey: firstKey }, clean],
      result: 'cleared',
    },
    {
      label: 'first never returned, second landed clean',
      history: [firstProposal, secondProposal, secondResult],
      rows: [failed, clean],
      result: 'placed',
    },
    {
      label: 'same landed call checked again',
      history: [firstProposal, firstResult],
      rows: [failed, { ...clean, callOccurrenceKey: firstKey }],
      result: 'cleared',
    },
    {
      label: 'first result evicted, second kept',
      history: [secondProposal, secondResult],
      rows: [failed, clean],
      result: 'unplaced',
    },
    {
      label: 'first result evicted, second withheld for correction',
      history: [secondProposal],
      rows: [failed, withheld],
      result: 'unplaced',
    },
  ])('keeps the exact witness when $label', ({ history, rows, paused, result }) => {
    const state = {
      turnNumber: 1,
      history: [request, ...history],
      findingsLedger: rows,
      ...(paused && { pausedToolCallId: toolCallId }),
    };
    const assessment = foldState(state, undefined, false);
    if (paused) expect(assessment.standing).toBe('ask');
    const reason = assessment.reasons.find((row) => row.reason === 'argument-unverified');
    if (result === 'cleared') {
      expect(reason).toBeUndefined();
      return;
    }
    expect(reason?.witness).toEqual([failedWitness]);
    expect(reason?.source).toEqual(
      result === 'placed'
        ? { kind: 'calls', calls: [{ toolCallId, toolName }] }
        : { kind: 'calls', calls: [], unplaced: [failedWitness] },
    );
  });

  it('keeps a middleware rewrite with its own argument observation', () => {
    const state = {
      turnNumber: 1,
      history: [request, firstProposal, firstResult, secondProposal, secondResult],
      findingsLedger: [failed, clean],
      middlewareDecisions: [
        {
          at: 'tool',
          toolCallId,
          toolName,
          changedKeys: ['shelf'],
          from: { shelf: 'person' },
          callOccurrenceKey: secondKey,
        },
      ],
    };
    const reason = foldState(state, undefined, false).reasons.find(
      (row) => row.reason === 'argument-unverified',
    );
    expect(reason?.witness).toEqual([failedWitness]);
    expect(reason?.source).toEqual({ kind: 'calls', calls: [{ toolCallId, toolName }] });
  });

  it('keeps keyed source attribution independent of event-derived declaration addresses', () => {
    const state = {
      history: [request, secondProposal, secondResult],
      coverageDeclared: [
        { kind: 'ledger', toolCallId, toolName, callOccurrenceKey: firstKey, notChecked: [{}] },
      ],
    };
    const assessment = foldState(state, undefined, false);
    const recorded = foldState(state, undefined, false, undefined, new Map([[0, 2]]));
    expect(recorded).toEqual(assessment);
    expect(assessment.reasons.find((row) => row.reason === 'coverage-gap')?.source).toEqual({
      kind: 'calls',
      calls: [],
      unplaced: [{ kind: 'state', key: 'coverageDeclared', path: '/0/kind' }],
    });
  });
});
