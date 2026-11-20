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
