import { describe, expect, it } from 'vitest';
import type { Tool } from '../../tools/tools.js';
import { callTraceTool, traceToolpack } from '../traceToolpack.js';
import type { TraceToolpackArtifacts } from '../types.js';
import { TRACE_WITHHELD } from './marker.js';

type Delivery = 'native' | 'withheld' | 'rewritten';

const step = 'schedule#0';
const stateKey = 'turnNumber';
const questions: Readonly<Record<string, Record<string, unknown>>> = {
  attention_list: {},
  backtrack: { variable: stateKey },
  find_context_errors: {},
  find_in_trace: { query: 'Tuesday' },
  get_value: { runtimeStageId: step, key: stateKey },
  impact: { nodeId: 'example-node' },
  inspect_subflow: { mount: 'example-mount' },
  inspect_tool_call: { toolCallId: 'example-call' },
  inspect_tool_run: { toolCallId: 'example-call' },
  read_narrative: {},
  root_cause: { nodeId: 'example-node' },
  run_overview: {},
  trace_node: { runtimeStageId: step },
  trace_slice: { runtimeStageId: step },
  who_wrote: { key: stateKey },
};

function record(note: string, delivery: Delivery): TraceToolpackArtifacts {
  const history = [
    {
      role: 'tool',
      content: 'Tuesday.',
      toolName: 'schedule',
      toolCallId: 'example-call',
      callOccurrenceKey: [1, 2, 3, 4, 0],
    },
  ];
  return {
    snapshot: {
      runId: 'example-schedule',
      initialState: { turnNumber: 0 },
      sharedState: {
        turnNumber: 1,
        history,
        organizerNotes: note,
        settledToolCalls: [{ callOccurrenceKey: [1, 2, 3, 4, 0], execution: 'returned', delivery }],
        settledToolCallsComplete: true,
      },
      executionTree: {
        id: 'schedule',
        runtimeStageId: step,
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
          runtimeStageId: step,
          trace: [
            { path: stateKey, verb: 'set' },
            { path: 'history', verb: 'set' },
            { path: 'organizerNotes', verb: 'set' },
          ],
          overwrite: { turnNumber: 1, history, organizerNotes: note },
          updates: {},
          redactedPaths: [],
        },
      ],
      commitValues: 'full',
      writeProvenance: 'off',
    },
    narrative: ['The schedule is ready.'],
  };
}

async function replies(tools: Tool[]) {
  const result: Record<string, string> = {};
  for (const { schema } of tools) {
    expect(Object.hasOwn(questions, schema.name), schema.name).toBe(true);
    result[schema.name] = await callTraceTool(tools, schema.name, questions[schema.name]);
  }
  expect(Object.keys(result).sort()).toEqual(Object.keys(questions).sort());
  return result;
}

describe('admitted trace tool bindings', () => {
  it('reports omitted overview evidence as unavailable while ordinary views describe it', async () => {
    const affected = record('Orchard planning', 'withheld');
    affected.snapshot.executionTree.errors = { calendar: 'A synthetic calendar error.' };
    affected.snapshot.executionTree.subflowId = 'calendar';
    const ordinary = record('Orchard planning', 'native');
    ordinary.snapshot.executionTree.errors = affected.snapshot.executionTree.errors;
    ordinary.snapshot.executionTree.subflowId = affected.snapshot.executionTree.subflowId;

    const restricted = traceToolpack(affected);
    const overview = await callTraceTool(restricted, 'run_overview', {});
    expect(overview).toContain('status: step error details are unavailable in this view');
    expect(overview).toContain('NARRATIVE: unavailable in this view.');
    expect(overview).toContain('[subflow] nested trace details are unavailable in this view.');
    expect(overview).not.toContain('no step errors recorded');
    expect(overview).not.toContain('line(s) available via read_narrative');
    expect(overview).not.toContain('kept no own log');
    expect(await callTraceTool(restricted, 'read_narrative', {})).toBe(TRACE_WITHHELD);

    const standard = traceToolpack(ordinary);
    const host = traceToolpack(affected, { showWithheldResults: true });
    const unchanged = await callTraceTool(standard, 'run_overview', {});
    expect(unchanged).toBe(await callTraceTool(host, 'run_overview', {}));
    expect(unchanged).toContain('completed with 1 step error(s)');
    expect(unchanged).toContain('NARRATIVE: 1 line(s) available via read_narrative.');
    expect(unchanged).toContain('[subflow] steps kept no own log here');
    expect(await callTraceTool(standard, 'read_narrative', {})).toContain('The schedule is ready.');
  });

  it('gives the same search miss for unadmitted text and absent text', async () => {
    const tools = traceToolpack(record('Orchard planning', 'withheld'));
    const recorded = await callTraceTool(tools, 'find_in_trace', { query: 'Orchard planning' });
    const absent = await callTraceTool(tools, 'find_in_trace', { query: 'Seaside planning' });
    expect(recorded).toBe(absent);
    expect(recorded).toContain('no match in the admitted record');
  });

  it.each(['withheld', 'rewritten'] as const)(
    'keeps every tool reply stable when unlisted state changes in a %s record',
    async (delivery) => {
      const first = record('Orchard planning', delivery);
      const second = record('Boat repair and travel dates', delivery);
      const original = structuredClone(first);
      const defaultTools = traceToolpack(first);

      const visible = await replies(defaultTools);
      expect(visible).toEqual(await replies(traceToolpack(second)));
      for (const [name, reply] of Object.entries(visible)) {
        expect(reply, name).toContain(TRACE_WITHHELD);
      }
      expect(visible.get_value).toContain('1');
      expect(first).toEqual(original);
    },
  );

  it('preserves the ordinary tool replies when the recorded delivery is native', async () => {
    const source = record('Orchard planning', 'native');
    const common = await replies(traceToolpack(source));
    expect(common).toEqual(await replies(traceToolpack(source, { showWithheldResults: true })));
    expect(common.run_overview).not.toContain(TRACE_WITHHELD);
  });
});
