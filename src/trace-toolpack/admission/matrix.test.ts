import { describe, expect, it } from 'vitest';
import { innerRunStore } from '../../core/innerRunRecords.js';
import type { CallOccurrenceKey } from '../../lib/callOccurrence.js';
import { callTraceTool, traceToolpack } from '../traceToolpack.js';
import type { TraceToolpackArtifacts } from '../types.js';
import { TRACE_WITHHELD } from './marker.js';

type Disposition = 'withheld' | 'rewritten';
type Encoding = 'full' | 'delta';

const stage = 'schedule#0';
const toolName = 'schedule';
const occurrence = (index: number): CallOccurrenceKey => [10, 20, 30, 40, index];

function resultRow(
  toolCallId: string,
  content: string,
  callOccurrenceKey?: CallOccurrenceKey,
  toolResultDisposition?: Disposition,
) {
  return {
    role: 'tool',
    toolName,
    toolCallId,
    content,
    ...(callOccurrenceKey && { callOccurrenceKey }),
    ...(toolResultDisposition && { toolResultDisposition }),
  };
}

function decisionRow(row: ReturnType<typeof resultRow>, disposition: Disposition | 'unchanged') {
  return {
    moment: 'after-tool',
    at: 'tool',
    toolName: row.toolName,
    toolCallId: row.toolCallId,
    ...(row.callOccurrenceKey && { callOccurrenceKey: row.callOccurrenceKey }),
    outcome: disposition === 'withheld' ? 'deny' : 'allow',
    changed: disposition !== 'unchanged',
  };
}

function recording({
  history = [],
  earlierHistory = [],
  decisions,
  organizerNotes = 'Ordinary schedule notes',
  encoding = 'full',
}: {
  history?: readonly unknown[];
  earlierHistory?: readonly unknown[];
  decisions?: readonly unknown[];
  organizerNotes?: unknown;
  encoding?: Encoding;
} = {}): TraceToolpackArtifacts {
  const sharedHistory = [...earlierHistory, ...history];
  return {
    snapshot: {
      runId: 'scheduling-example',
      initialState: {
        history: earlierHistory,
        ...(decisions && { middlewareDecisions: decisions }),
      },
      sharedState: {
        history: sharedHistory,
        organizerNotes,
        ...(decisions && { middlewareDecisions: decisions }),
      },
      executionTree: {
        id: 'schedule',
        runtimeStageId: stage,
        name: 'Schedule',
        logs: {},
        errors: {},
        metrics: {},
        evals: {},
      },
      commitLog: [
        {
          stage: 'Schedule',
          stageId: 'schedule',
          runtimeStageId: stage,
          trace: [
            { path: 'history', verb: encoding === 'delta' ? 'append' : 'set' },
            { path: 'organizerNotes', verb: 'set' },
          ],
          overwrite: {
            history: encoding === 'delta' ? history : sharedHistory,
            organizerNotes,
          },
          updates: {},
          redactedPaths: [],
        },
      ],
      commitValues: encoding,
      writeProvenance: 'off',
    },
    narrative: ['The schedule is ready.'],
  };
}

function viewHistory(record: TraceToolpackArtifacts) {
  return callTraceTool(traceToolpack(record), 'get_value', {
    runtimeStageId: stage,
    key: 'history',
  });
}

const unlistedShapes = [
  { name: 'text', first: 'Orchard plans', second: 'Repairs and travel dates' },
  { name: 'list', first: ['orchard'], second: ['repairs', 'travel'] },
  { name: 'declaration', first: { scope: 'orchard' }, second: { scope: ['repairs', 'travel'] } },
  { name: 'status', first: { state: 'pending', due: 1 }, second: { state: 'ready', due: 99 } },
];
const ordinaryDeliveries = ['withheld', 'rewritten'] as const;
const shapesAndDeliveries = unlistedShapes.flatMap((shape) =>
  ordinaryDeliveries.map((disposition) => ({ ...shape, disposition })),
);

describe('trace admission for recorded histories', () => {
  it.each(shapesAndDeliveries)(
    'keeps $name data outside the $disposition history view',
    async ({ disposition, first, second }) => {
      const content = disposition === 'withheld' ? 'Unavailable notice' : 'Tuesday confirmed';
      const result = resultRow('draft-date', content, occurrence(0), disposition);
      const recorded = { history: [result], decisions: [decisionRow(result, disposition)] };
      const admitted = await viewHistory(recording({ ...recorded, organizerNotes: first }));
      expect(admitted).toBe(await viewHistory(recording({ ...recorded, organizerNotes: second })));
      expect(admitted).toContain(TRACE_WITHHELD);
      if (disposition === 'rewritten') expect(admitted).toContain(content);
      else expect(admitted).not.toContain(content);
    },
  );

  it.each(['full', 'delta'] as const)(
    'retains admitted siblings for repeated provider IDs in %s replay across a checkpoint',
    async (encoding) => {
      const earlier = resultRow('rescheduled', 'Earlier notice', occurrence(0), 'withheld');
      const allowed = resultRow('rescheduled', 'Tuesday confirmed', occurrence(1));
      const rewritten = resultRow('adjusted', 'Room confirmed', occurrence(2), 'rewritten');
      const visible = await viewHistory(
        recording({
          earlierHistory: [earlier],
          history: [allowed, rewritten],
          decisions: [
            decisionRow(earlier, 'withheld'),
            decisionRow(allowed, 'unchanged'),
            decisionRow(rewritten, 'rewritten'),
          ],
          encoding,
        }),
      );
      expect(visible).toContain(TRACE_WITHHELD);
      expect(visible).toContain('Tuesday confirmed');
      expect(visible).toContain('Room confirmed');
      expect(visible).not.toContain('Earlier notice');
    },
  );

  it('uses a joined decision for an older history row without an occurrence stamp', async () => {
    const result = resultRow('legacy-schedule', 'Tuesday confirmed');
    const visible = await viewHistory(
      recording({ history: [result], decisions: [decisionRow(result, 'rewritten')] }),
    );
    expect(visible).toContain(TRACE_WITHHELD);
    expect(visible).toContain('Tuesday confirmed');
  });

  it('withholds an older result whose decision cannot be joined', async () => {
    const result = resultRow('legacy-schedule', 'Unclassified notice');
    const differentCall = resultRow('unrelated-schedule', 'Thursday confirmed');
    const visible = await viewHistory(
      recording({ history: [result], decisions: [decisionRow(differentCall, 'rewritten')] }),
    );
    expect(visible).toContain(TRACE_WITHHELD);
    expect(visible).not.toContain('Unclassified notice');
  });

  it('hides a restricted retained child without using its host summary', async () => {
    const parent = recording();
    const childResult = resultRow('child-schedule', 'Child notice', occurrence(0), 'withheld');
    const child = recording({ history: [childResult] });
    async function inspectChild(steps: number) {
      const innerRuns = innerRunStore();
      innerRuns.keep({
        toolCallId: 'schedule-child',
        toolName,
        outcome: 'ok',
        steps,
        recording: { snapshot: child.snapshot },
      });
      return callTraceTool(traceToolpack({ ...parent, innerRuns }), 'inspect_tool_run', {
        toolCallId: 'schedule-child',
      });
    }
    const first = await inspectChild(37);
    expect(first).toBe(await inspectChild(81));
    expect(first).not.toContain('Child notice');
  });
});
