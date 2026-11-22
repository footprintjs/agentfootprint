import { describe, expect, it } from 'vitest';
import { libraryResultReasons } from './stage.js';

const cut = {
  turn: 7,
  toolName: 'readLog',
  toolCallId: 'call',
  kind: 'result-cut',
  totalChars: 3000,
  keptChars: 1600,
  maxChars: 2000,
};

describe('library result reasons from committed state', () => {
  it('keeps the exact index after an earlier turn and a missing row', () => {
    const rows = [{ ...cut, turn: 6 }, undefined, cut];
    expect(libraryResultReasons({ turnNumber: 7, libraryResultLimits: rows })).toEqual([
      {
        reason: 'result-cut',
        witness: { kind: 'state', key: 'libraryResultLimits', path: '/2/keptChars' },
      },
    ]);
  });
  it('leaves older recordings alone and reports an explicit recording gap', () => {
    expect(libraryResultReasons({ turnNumber: 7 })).toEqual([]);
    expect(libraryResultReasons({ turnNumber: 7, libraryResultLimitsIncomplete: true })).toEqual([
      {
        reason: 'check-unreachable',
        witness: { kind: 'state', key: 'libraryResultLimitsIncomplete', path: '' },
      },
    ]);
  });
});
