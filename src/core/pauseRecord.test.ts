import { expect, it } from 'vitest';
import type { FlowchartCheckpoint } from 'footprintjs';
import { DEFAULT_PAUSE_REASON, pauseSegments } from './pauseRecord.js';

it('addresses the deepest cumulative cursor as path segments, not duplicated prefixes', () => {
  const checkpoint = { subflowPath: ['outer', 'outer/inner', 'outer/inner/member'] };
  expect(pauseSegments(checkpoint as FlowchartCheckpoint)).toEqual(['outer', 'inner', 'member']);
});

it.each([[undefined], [null], [[]], [['outer', 12]]])(
  'leaves a malformed cursor for native admission (%s)',
  (cursor) => {
    expect(pauseSegments({ subflowPath: cursor } as FlowchartCheckpoint)).toEqual([]);
  },
);

it('uses the fixed library reason when a stage provides none', () => {
  expect(DEFAULT_PAUSE_REASON).toBe('stage requested pause');
});
