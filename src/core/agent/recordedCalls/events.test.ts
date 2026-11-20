import { expect, it } from 'vitest';
import { declarationOccurrences, readCallOccurrences } from '../recordedCalls.js';

function event(index: number, type: string, stage: string, runId = 'sample-run') {
  return { index, type, meta: { runtimeStageId: stage, runId }, payload: { toolCallId: 'sample' } };
}

const firstKey = [1, 2, 3, 4, 0];
const secondKey = [1, 2, 3, 4, 1];

function keyed(
  index: number,
  type: string,
  callOccurrenceKey: unknown,
  stage = 'dispatch#1',
  runId = 'sample-run',
) {
  const row = event(index, type, stage, runId);
  return {
    ...row,
    payload: { ...row.payload, toolName: 'lookup', iteration: 1, callOccurrenceKey },
  };
}

function result(callOccurrenceKey: readonly number[]) {
  return { role: 'tool', toolCallId: 'sample', toolName: 'lookup', callOccurrenceKey };
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

it('joins by key when the same provider ID has overlapping brackets and history has been trimmed', () => {
  const calls = readCallOccurrences(
    [
      keyed(0, 'stream.tool_start', firstKey),
      keyed(1, 'stream.tool_start', secondKey),
      keyed(2, 'tools.coverage_declared', secondKey),
      keyed(3, 'stream.tool_end', secondKey),
      keyed(4, 'tools.absent', firstKey),
      keyed(5, 'stream.tool_end', firstKey),
    ],
    [result(secondKey)],
  );
  expect(
    calls.map((call) => [
      call.start?.index,
      call.end?.index,
      call.history?.index,
      call.eventsOf('tools.coverage_declared').map((e) => e.index),
      call.eventsOf('tools.absent').map((e) => e.index),
    ]),
  ).toEqual([
    [0, 5, undefined, [], [4]],
    [1, 3, 0, [2], []],
  ]);
});

it('uses the same address for a resume and when only the resumed end remains', () => {
  const start = keyed(0, 'stream.tool_start', firstKey);
  const decision = keyed(1, 'checkin.decision', firstKey, 'resume#9', 'next-run');
  const end = keyed(2, 'stream.tool_end', firstKey, 'resume#9', 'next-run');
  const history = [result(firstKey)];
  const complete = readCallOccurrences([start, decision, end], history);
  const resumed = readCallOccurrences([decision, end], history);
  const startOnly = readCallOccurrences([start], history);

  expect(complete).toHaveLength(1);
  expect(complete[0]).toMatchObject({ start, end, history: { index: 0 } });
  expect(resumed).toHaveLength(1);
  expect(resumed[0]).toMatchObject({ end, history: { index: 0 } });
  expect(resumed[0]?.start).toBeUndefined();
  expect(resumed[0]?.eventsOf('checkin.decision')).toEqual([decision]);
  expect(startOnly[0]).toMatchObject({ start, history: { index: 0 } });
  expect(startOnly[0]?.end).toBeUndefined();
});

it('leaves ambiguous, malformed, and partial keys unpaired without borrowing a legacy neighbor', () => {
  const calls = readCallOccurrences(
    [
      event(0, 'stream.tool_start', 'dispatch#1'),
      keyed(1, 'stream.tool_end', null),
      keyed(2, 'stream.tool_start', firstKey),
      keyed(3, 'stream.tool_start', firstKey),
      keyed(4, 'tools.coverage_declared', firstKey),
      keyed(5, 'tools.absent', secondKey),
      keyed(6, 'stream.tool_end', firstKey),
      event(7, 'stream.tool_end', 'dispatch#1'),
      event(8, 'checkin.decision', 'dispatch#1'),
    ],
    [result(firstKey), result(secondKey)],
  );
  expect(
    calls.map(({ start, end, history }) => [start?.index, end?.index, history?.index]),
  ).toEqual([
    [0, undefined, undefined],
    [undefined, 1, undefined],
    [2, undefined, undefined],
    [3, undefined, undefined],
    [undefined, 6, undefined],
    [undefined, 7, undefined],
  ]);
  expect(
    calls.flatMap((call) =>
      ['tools.coverage_declared', 'tools.absent', 'checkin.decision'].flatMap(call.eventsOf),
    ),
  ).toEqual([]);
});

it('places committed declarations by key when their event is missing or out of order', () => {
  const events = [
    keyed(0, 'stream.tool_start', firstKey),
    keyed(1, 'stream.tool_start', secondKey),
    keyed(2, 'tools.coverage_declared', secondKey),
    keyed(3, 'stream.tool_end', secondKey),
    keyed(4, 'stream.tool_end', firstKey),
  ];
  const declaration = { kind: 'ledger', toolName: 'lookup', toolCallId: 'sample', iteration: 1 };
  const rows = [
    { ...declaration, callOccurrenceKey: secondKey },
    { kind: 'ledger', callOccurrenceKey: firstKey },
    { ...declaration, callOccurrenceKey: 'unreadable' },
    { ...declaration, callOccurrenceKey: [1, 2, 3, 4, 2] },
    declaration,
  ];
  const calls = readCallOccurrences(events, [result(firstKey), result(secondKey)]);
  const linked = declarationOccurrences(rows, events, calls, false);

  expect(Array.from(linked, ([row, call]) => [row, call.history?.index])).toEqual([
    [0, 1],
    [1, 0],
  ]);
});

it('does not treat a served-out key as an older keyless event', () => {
  const start = event(0, 'stream.tool_start', 'dispatch#1');
  const covered = {
    ...event(1, 'tools.coverage_declared', 'dispatch#1'),
    redacted: ['callOccurrenceKey'],
  };
  const end = event(2, 'stream.tool_end', 'dispatch#1');
  const calls = readCallOccurrences([start, covered, end], []);
  expect(calls[0]?.eventsOf('tools.coverage_declared')).toEqual([]);

  const withMaskedEnd = readCallOccurrences(
    [start, { ...end, redacted: ['callOccurrenceKey'] }],
    [],
  );
  expect(withMaskedEnd.map(({ start, end }) => [start?.index, end?.index])).toEqual([
    [0, undefined],
    [undefined, 2],
  ]);
});
