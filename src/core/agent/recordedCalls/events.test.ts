import { expect, it } from 'vitest';
import { readCallOccurrences } from '../recordedCalls.js';

function event(index: number, type: string, stage: string, runId = 'sample-run') {
  return { index, type, meta: { runtimeStageId: stage, runId }, payload: { toolCallId: 'sample' } };
}

it('pairs starts and ends in execution order and preserves missing partners', () => {
  const calls = readCallOccurrences(
    [
      event(0, 'stream.tool_end', 'dispatch#1'),
      event(1, 'stream.tool_start', 'dispatch#1'),
      event(2, 'stream.tool_start', 'dispatch#1'),
      event(3, 'stream.tool_end', 'dispatch#1'),
      event(4, 'stream.tool_end', 'dispatch#1'),
      event(5, 'stream.tool_start', 'dispatch#2'),
      event(6, 'stream.tool_end', 'dispatch#2', 'next-run'),
      event(7, 'tools.coverage_declared', 'dispatch#3'),
    ],
    [],
  );
  expect(calls.map(({ start, end, order }) => [start?.index, end?.index, order])).toEqual([
    [undefined, 0, 0],
    [1, 3, 1],
    [2, 4, 2],
    [5, undefined, 0],
    [undefined, 6, 0],
  ]);
  expect(calls.flatMap((call) => call.eventsOf('tools.coverage_declared'))).toEqual([]);
});
