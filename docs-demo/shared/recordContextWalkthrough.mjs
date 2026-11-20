import { deepStrictEqual, ok } from 'node:assert/strict';

// Both checks record the same synthetic run with their own AgentFootprint.
const QUESTION = 'Which selected nodes have the highest reported P95 latency?';
const SELECTION = {
  cluster: 'demo-a',
  window: '2026-09-11T14:00:00Z / 2026-09-11T15:00:00Z',
  revision: 3,
  filter: { field: 'nodes.p95_us', between: [1000, 2000] },
};
const SOURCE = {
  ref: 'nodes@v1',
  measure: 'nodes.p95_us',
  unit: 'microseconds',
  grain: 'one reported node summary per source window',
  unknown: 'excluded, never treated as zero',
};
const ROWS = [
  { node: '11', p95_us: 1500 },
  { node: '12', p95_us: 1250 },
  { node: '13', p95_us: 1500 },
  { node: '14', p95_us: null },
];
const FINDING = {
  ref: 'finding:highest-p95@3',
  sourceRef: SOURCE.ref,
  selectionRevision: SELECTION.revision,
  nodeIds: ['11', '13'],
  maximum: 1500,
  unit: SOURCE.unit,
  matchedRows: 2,
  ties: 'retained',
};

export async function recordContextWalkthrough({ Agent, mock, recordRun, stringifySnapshot }) {
  const agent = Agent.create({
    provider: mock({
      replies: [
        // The model chooses an operation: the tool, with the host's selection as its arguments.
        { toolCalls: [{ id: 'call-nodes-1', name: 'node_summaries', args: SELECTION }] },
        // The finding, typed — the answer names the result it stands on, never the rows.
        { content: JSON.stringify(FINDING) },
      ],
    }),
    model: 'mock',
    maxIterations: 4,
    reactMode: 'dynamic-grouped',
  })
    .system(
      'Answer questions about the selected nodes from the retained node summaries. ' +
        'Return a finding that names its source reference; do not explain why a node is slow.',
    )
    .tool({
      schema: {
        name: 'node_summaries',
        description: 'The retained node summaries inside a selection: a scoped data reference and its meaning.',
        inputSchema: {
          type: 'object',
          properties: {
            cluster: { type: 'string' },
            window: { type: 'string' },
            revision: { type: 'number' },
            filter: { type: 'object' },
          },
          required: ['cluster', 'window', 'revision'],
        },
      },
      execute: async (args) => ({ selection: args, source: SOURCE, rows: ROWS }),
    })
    .outputSchema({
      parse: (value) => value,
      safeParse: (value) => ({ ok: true, value }),
    })
    .answerValidation({
      id: 'finding-names-its-result',
      version: '1',
      mode: 'enforce',
      validate(candidate) {
        const c = candidate ?? {};
        const checks = [
          {
            id: 'source-ref',
            disposition: c.sourceRef === SOURCE.ref ? 'checked-pass' : 'checked-fail',
            path: 'sourceRef',
          },
          {
            id: 'maximum-is-a-retained-value',
            disposition: ROWS.some((r) => r.p95_us === c.maximum) ? 'checked-pass' : 'checked-fail',
            path: 'maximum',
          },
          {
            id: 'selection-revision',
            disposition: c.selectionRevision === SELECTION.revision ? 'checked-pass' : 'checked-fail',
            path: 'selectionRevision',
          },
        ];
        return { checks };
      },
    })
    .build();

  const tools = [];
  agent.on('agentfootprint.stream.tool_end', ({ payload }) => {
    tools.push([payload.toolCallId, payload.result, payload.error === true]);
  });
  const rec = recordRun(agent);
  try {
    const result = await agent.run({ message: QUESTION });
    deepStrictEqual(typeof result === 'string' ? JSON.parse(result) : result, FINDING);
    deepStrictEqual(tools, [
      ['call-nodes-1', { selection: SELECTION, source: SOURCE, rows: ROWS }, false],
    ]);
    const recording = JSON.parse(stringifySnapshot(rec.toRecording()));
    ok(recording.structure && recording.snapshot?.commitLog?.length, 'The mock run must retain its chart and commits');
    ok(recording.events?.length, 'The mock run must retain its events');
    deepStrictEqual(recording.snapshot.sharedState.answerValidation?.status, 'passed');
    return recording;
  } finally {
    rec.stop();
  }
}
