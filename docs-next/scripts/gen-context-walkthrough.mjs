// Records the run behind the "Context engineering, step by step" walkthrough.
//
// The page's seven answer-building steps are prose over the run's own
// milestone stops; the JSON view is `<ContextView>` (agentfootprint-lens)
// reading THIS recording — the fold at each stop, who wrote each key, what
// moved, what was served. Nothing on that view is hand-written: regenerate
// this file and the page follows the library.
//
// Same recipe as gen-replay-trace.mjs: the repo's own `agentfootprint`
// (file:..) on a deterministic mock provider, no network, no key. The domain
// is the page's — a person asks which selected nodes have the highest
// reported P95 latency; the host's selection (cluster, window, filter) is
// the independent authority for the request; a tool returns a scoped
// dataset reference with its meaning; the model returns a typed finding that
// names the result it stands on; a configured answer check runs before
// delivery.
import { Agent } from 'agentfootprint';
import { recordRun } from 'agentfootprint/observe';
import { mock } from 'agentfootprint/providers';
import { tagAxisPositions } from 'agentfootprint-lens/core';
import { stringifySnapshot } from 'footprintjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'generated', 'context-walkthrough.json');

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

const rec = recordRun(agent);
const result = await agent.run({ message: QUESTION });
const recording = rec.toRecording();
rec.stop();

// Written with footprintjs's own encoder (9.26.0): the same bytes as
// JSON.stringify, without its recursion limit on a long run's tree.
const persisted = JSON.parse(stringifySnapshot(recording));

// The seven steps of the page, each pinned to a milestone stop of THIS run by
// the stop's label (the library's own milestone vocabulary). A label that is
// not on the recording fails the build here — never a page quietly showing
// the wrong stop.
const AXIS = ['milestone:iteration', 'milestone:slot', 'milestone:llm-turn', 'milestone:tool-call', 'milestone:decision'];
const positions = tagAxisPositions(persisted.snapshot, AXIS, []) ?? [];
const WANT = {
  question: 'Run start', //   the person's question is the base the run starts from
  selection: 'Route 1', //    the model chose the operation with the host's selection as its arguments
  reference: 'Tool call 1', // the scoped data reference and its meaning landed
  prepare: 'Iteration 2', //   the next call's context was prepared from it
  model: 'Route 2', //         the model returned the typed finding
  finding: 'Answer 1', //      the configured check ran on it
  answer: 'Run end', //        what was delivered
};
const stops = {};
for (const [stepId, label] of Object.entries(WANT)) {
  const at = positions.findIndex((p) => p.label === label);
  if (at < 0) {
    console.error(`[gen-context-walkthrough] step '${stepId}' wants stop '${label}', not on the recording: ${positions.map((p) => p.label).join(' | ')}`);
    process.exit(1);
  }
  stops[stepId] = at;
}
const report = persisted?.snapshot?.sharedState?.answerValidation;
if (report?.status !== 'passed') {
  console.error('[gen-context-walkthrough] the answer check did not pass on the recording:', JSON.stringify(report));
  process.exit(1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, stringifySnapshot({ recording: persisted, stops }));
const commits = Array.isArray(persisted?.snapshot?.commitLog) ? persisted.snapshot.commitLog.length : 0;
console.log(`[gen-context-walkthrough] wrote ${OUT} (${commits} commits, ${positions.length} stops; result: ${String(result).slice(0, 60)})`);
