/** The public boundary index has one nominal owner, including its runtime class. */
import { describe, expect, it } from 'vitest';
import { CommitRangeIndex, UnknownVerbError, type CommitBundle } from 'foottrace';
import { keyedFold } from '../../src/index.js';
import { boundaryRecorder, type BoundaryRangeLabel } from '../../src/observe.js';

const index: CommitRangeIndex<BoundaryRangeLabel> = boundaryRecorder().boundaryIndex;

describe('boundary index ownership', () => {
  it('exposes the canonical Foottrace class through the public recorder API', () => {
    expect(index).toBeInstanceOf(CommitRangeIndex);
    expect(index.enclosing(0)).toEqual([]);
  });

  it('throws the canonical Foottrace error for a malformed recorded verb', () => {
    // Recorded input is external data. The cast deliberately models a malformed
    // record; valid TypeScript callers cannot construct an unknown trace verb.
    const row = {
      stage: 'external',
      stageId: 'external',
      runtimeStageId: 'external#0',
      trace: [{ path: 'x', verb: 'unknown' }],
      overwrite: { x: 1 },
      updates: {},
      redactedPaths: [],
    } as unknown as CommitBundle;
    const fold = keyedFold({ commitLog: [row], initialState: {} });
    expect(() => fold.valueAt('x', 0)).toThrow(UnknownVerbError);
  });
});
