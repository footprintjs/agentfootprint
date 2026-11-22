import { describe, expect, it } from 'vitest';
import type { CoverageRow } from '../../coverageRows.js';
import { statePointer } from '../../pointer.js';
import { declaredWordsReader } from './stage.js';

function absence(index: number, toolName: string, tryInstead: unknown = 'Try backup records') {
  return {
    kind: 'absence',
    toolName,
    tryInstead,
    callOccurrenceKey: [1, 2, 3, 4, index],
  };
}

function readRows(rows: ReturnType<typeof absence>[]) {
  const coverage = rows.map(
    (row, index): CoverageRow => ({
      index,
      kind: 'absence',
      occurrenceKey: row.callOccurrenceKey.join('.'),
      gap: false,
    }),
  );
  return declaredWordsReader(coverage, rows);
}

describe('bounded declaration words', () => {
  it('counts identical advice from distinct tools against the entry budget', () => {
    const rows = [
      absence(0, 'archive'),
      absence(1, 'archive'),
      absence(2, 'live'),
      absence(3, 'backup'),
      absence(4, 'cold'),
    ];
    const witnesses = rows.map((_, index) => statePointer('coverageDeclared', index, 'tryInstead'));
    expect(readRows(rows)('declared-absent', witnesses)).toEqual({
      entries: ['archive', 'live', 'backup'].map((toolName) => ({
        kind: 'tryInstead',
        text: 'Try backup records',
        toolName,
      })),
      omitted: 1,
    });
  });

  it('accounts for omitted advice only on reasons that can use it', () => {
    const read = readRows([absence(0, 'archive', { omitted: true })]);
    const witnesses = [statePointer('coverageDeclared', 0, 'tryInstead')];
    expect(read('declared-absent', witnesses)).toEqual({ entries: [], omitted: 1 });
    expect(read('coverage-gap', witnesses)).toBeUndefined();
  });

  it('cannot borrow words from an unadmitted index with a different retained occurrence', () => {
    const read = declaredWordsReader(
      [{ index: 0, kind: 'absence', occurrenceKey: '1.2.3.4.0', gap: false }],
      [absence(1, 'archive')],
    );
    expect(read('declared-absent', [statePointer('coverageDeclared', 0)])).toBeUndefined();
  });
});
