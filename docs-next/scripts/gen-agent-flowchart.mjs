/**
 * Generate the live "what happened" flowchart data from a REAL agentfootprint run.
 *
 * Nothing here is hand-authored: this builds the Quick-Start weather agent (the same
 * shape as examples/core/02-agent-with-tools.ts), runs it against a deterministic mock
 * (a scripted tool-call → final answer, $0 + offline), and captures the footprintjs
 * snapshot + narrative the run produced. footprint-explainable-ui renders that snapshot
 * directly — it depends on neither agentfootprint nor footprintjs, so there is no
 * dependency coupling; the agent run just emits a footprintjs flowchart and the pure UI
 * draws it. Re-run to regenerate. Output is committed for fast, reviewable builds.
 *
 *   Run:  npm run gen:flowchart   (also runs in predev/prebuild)
 */
import { Agent, mock } from 'agentfootprint';
// The flowchart GRAPH (nodes+edges) comes from a build-time footprintjs StructureRecorder.
// createTraceStructureRecorder is a pure recorder from the explainable-ui flowchart entry
// (node-importable, no DOM) — so we capture the graph here and the agent stays lens-free.
import { createTraceStructureRecorder } from 'footprint-explainable-ui/flowchart';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'generated', 'agent-flowchart.json');
const INPUT = 'Weather in San Francisco?';

const trace = createTraceStructureRecorder();

const agent = Agent.create({
  // Scripted, deterministic, $0: iteration 1 calls the weather tool, iteration 2 answers.
  provider: mock({
    replies: [
      { toolCalls: [{ id: 'call-weather-1', name: 'weather', args: { city: 'San Francisco' } }] },
      { content: 'Got it — San Francisco: sunny, 72°F.' },
    ],
  }),
  model: 'mock',
  maxIterations: 5,
  // dynamic-grouped wraps each LLM turn in an sf-llm-call subflow, so the flowchart
  // shows the agent's reasoning as a foldable LLM group with its context slots inside.
  reactMode: 'dynamic-grouped',
  // capture the chart structure → TraceGraph (xyflow-ready nodes + edges)
  structureRecorders: [trace.recorder],
})
  .system('You answer weather questions using the `weather` tool.')
  .tool({
    schema: {
      name: 'weather',
      description: 'Get current weather for a city.',
      inputSchema: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
    },
    execute: async (args) => `${args.city}: sunny, 72°F`,
  })
  .build();

const result = await agent.run({ message: INPUT });

const data = {
  // captured from the real run — these are exactly the props ExplainableShell reads
  graph: trace.getGraph(), // TraceGraph: { nodes, edges } — drives the flowchart panel
  snapshot: agent.getLastSnapshot() ?? null,
  narrative: agent.getLastNarrativeEntries(),
  meta: {
    input: INPUT,
    result: typeof result === 'string' ? result : '(paused)',
    title: 'Agent + tools — a real run',
  },
};

mkdirSync(dirname(OUT), { recursive: true });
// JSON round-trip drops any non-serializable bits (functions); the snapshot is JSON-safe
// by design (it's the same shape as a checkpoint).
writeFileSync(OUT, JSON.stringify(data, null, 2));

console.log(`[flowchart] wrote ${OUT}`);
console.log(`[flowchart] result: ${data.meta.result}`);
console.log(
  `[flowchart] graph: ${data.graph.nodes.length} nodes, ${data.graph.edges.length} edges · ` +
    `narrative: ${data.narrative.length} · executionTree: ${data.snapshot?.executionTree ? 'ok' : 'MISSING'}`,
);
