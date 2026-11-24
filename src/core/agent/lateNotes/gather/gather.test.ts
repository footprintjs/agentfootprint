import { describe, expect, it } from 'vitest';

import { gatherLateNotePoints } from './gather.js';

const first = [0, 1, 2, 3, 0] as const;
const second = [0, 1, 2, 3, 1] as const;
const elsewhere = [0, 1, 2, 3, 2] as const;
const names = new Map([
  ['lookup', 'Attachment lookup'],
  ['search', 'Catalog search'],
  ['REDACTED', 'Must not appear'],
]);

const native = (key: readonly number[]) => ({
  callOccurrenceKey: key,
  execution: 'returned',
  delivery: 'native',
});

const failed = (key: readonly number[], failureCategory?: string) => ({
  callOccurrenceKey: key,
  execution: 'threw',
  outcome: 'failed',
  ...(failureCategory !== undefined && { failureCategory }),
});

const historyRow = (key: readonly number[], toolName: string) => ({
  role: 'tool',
  toolCallId: 'provider-reused-id',
  toolName,
  callOccurrenceKey: key,
  content: 'a tool result',
});

function gap(key: readonly number[], toolName = 'lookup', why?: string) {
  return {
    kind: 'ledger',
    toolName,
    toolCallId: 'provider-reused-id',
    callOccurrenceKey: key,
    notChecked: [{ what: 'the archived copy', ...(why !== undefined && { why }) }],
  };
}

const cut = {
  kind: 'result-cut',
  turn: 7,
  toolName: 'lookup',
  toolCallId: 'provider-reused-id',
  callOccurrenceKey: first,
  keptChars: 12,
  totalChars: 120,
  maxChars: 12,
};

describe('gatherLateNotePoints', () => {
  it('orders committed gaps, library limits and exact failures and preserves the visible WHY', () => {
    const why = 'Network log stopped at line 12.\nQuotes and brackets are authored: "[evidence]".';
    const points = gatherLateNotePoints(
      {
        turnNumber: 7,
        coverageDeclared: [gap(first, 'lookup', why)],
        libraryResultLimits: [cut],
        settledToolCalls: [native(first), failed(second, 'timeout')],
        settledToolCallsComplete: true,
        history: [historyRow(first, 'lookup'), historyRow(second, 'search')],
      },
      names,
    );
    expect(points).toEqual([
      { owner: 'tool', kind: 'notChecked', tool: 'Attachment lookup', why },
      { owner: 'library', kind: 'result-cut', tool: 'Attachment lookup' },
      { owner: 'tool', kind: 'call-failed:timeout', tool: 'Catalog search' },
    ]);
  });

  it('requires same-occurrence admission and retains only a native, visible gap', () => {
    const points = gatherLateNotePoints(
      {
        turnNumber: 7,
        coverageDeclared: [
          gap(first, 'lookup', 'admitted'),
          gap(second, 'search', 'tool content was withheld'),
          gap(elsewhere, 'search', 'unproved despite a reused provider id'),
        ],
        settledToolCalls: [native(first), { ...native(second), delivery: 'withheld' }],
        settledToolCallsComplete: true,
        history: [historyRow(first, 'lookup'), historyRow(elsewhere, 'search')],
        findingsLedger: [{ kind: 'conflict', turn: 7 }],
        sourceConsultation: { complete: true, offers: [{ name: 'Unopened' }] },
      },
      names,
    );
    expect(points).toEqual([
      { owner: 'tool', kind: 'notChecked', tool: 'Attachment lookup', why: 'admitted' },
    ]);
  });

  it('drops hidden tool names and subjects, and leaves an optional hidden WHY absent', () => {
    const row = {
      ...gap(first, 'lookup', '[REDACTED]'),
      cannotCover: [{ what: 'REDACTED', why: 'a visible fragment of a hidden item' }],
    };
    const served = {
      coverageDeclared: [row, gap(second, 'REDACTED', 'withheld tool')],
      settledToolCalls: [native(first), native(second)],
      settledToolCallsComplete: true,
    };
    expect(gatherLateNotePoints(served, names)).toEqual([
      { owner: 'tool', kind: 'notChecked', tool: 'Attachment lookup' },
    ]);
    expect(
      gatherLateNotePoints(
        { ...served, coverageDeclared: [row, gap(second, 'REDACTED', 'different hidden value')] },
        names,
      ),
    ).toEqual(gatherLateNotePoints(served, names));
  });

  it('admits the existing cut exception and refuses older-turn limits', () => {
    const points = gatherLateNotePoints(
      {
        turnNumber: 7,
        libraryResultLimits: [cut, { ...cut, turn: 6, toolName: 'search' }],
        settledToolCalls: [{ callOccurrenceKey: first, execution: 'returned-unserved' }],
        settledToolCallsComplete: true,
      },
      names,
    );
    expect(points).toEqual([{ owner: 'library', kind: 'result-cut', tool: 'Attachment lookup' }]);
  });

  it('uses an unqualified failure for an unknown category and rejects ambiguous names', () => {
    const state = {
      settledToolCalls: [failed(first, 'unadmitted-text'), failed(second, 'timeout')],
      settledToolCallsComplete: true,
      history: [
        historyRow(first, 'lookup'),
        historyRow(second, 'search'),
        historyRow(second, 'lookup'),
      ],
    };
    expect(gatherLateNotePoints(state, names)).toEqual([
      { owner: 'tool', kind: 'call-failed', tool: 'Attachment lookup' },
    ]);
    expect(
      gatherLateNotePoints(
        { ...state, settledToolCallsComplete: undefined, settledToolCalls: undefined },
        names,
      ),
    ).toEqual([]);
  });
});
