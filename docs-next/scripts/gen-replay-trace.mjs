/**
 * Generate the docs `<Replay>` data from a REAL agentfootprint run.
 *
 * Nothing here is hand-authored. This builds the Quick-Start weather agent (same
 * shape as examples/core/02-agent-with-tools.ts), attaches `enable.localObservability()`,
 * runs it against a deterministic mock ($0, offline), and captures the EXACT `Trace`
 * the feature produces via `getTrace({ redact: redactContent })`.
 *
 * It then proves OFFLINE replay: the Trace is round-tripped through JSON (exactly as a
 * persisted `run.trace.json` would be), and the flowchart is rebuilt FROM THAT JSON via
 * the lens's `structureGraphFromSpec(trace.structure)` — the same call `<Replay>` makes,
 * here at build time so the browser ships only the pure renderer (footprint-explainable-ui),
 * not the agent runtime. The committed output is the rebuilt graph + the Trace's metadata.
 *
 *   Run:  npm run gen:replay   (also runs in predev/prebuild)
 */
import { Agent, mock } from 'agentfootprint';
import { redactContent } from 'agentfootprint/observe';
import { structureGraphFromSpec } from 'agentfootprint-lens/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'generated', 'replay-trace.json');
const INPUT = 'Weather in San Francisco?';

const agent = Agent.create({
  provider: mock({
    replies: [
      { toolCalls: [{ id: 'call-weather-1', name: 'weather', args: { city: 'San Francisco' } }] },
      { content: 'Got it — San Francisco: sunny, 72°F.' },
    ],
  }),
  model: 'mock',
  maxIterations: 5,
  reactMode: 'dynamic-grouped',
})
  .system('You answer weather questions using the `weather` tool.')
  .tool({
    schema: {
      name: 'weather',
      description: 'Get current weather for a city.',
      inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
    },
    execute: async (args) => `${args.city}: sunny, 72°F`,
  })
  .build();

// Retain the run model live; redact at the serialize boundary (best practice for a
// trace that travels — here, into committed docs).
const dev = agent.enable.localObservability({ redact: redactContent });
const result = await agent.run({ message: INPUT });
const trace = dev.getTrace();

// Persist + reload exactly as a consumer would — the graph below is rebuilt from the
// SERIALIZED bytes, not the live object. This is the offline-replay path end to end.
const persisted = JSON.parse(JSON.stringify(trace));
const graph = structureGraphFromSpec(persisted.structure);

const data = {
  graph, // TraceGraph rebuilt from trace.structure — the offline replay
  meta: {
    input: INPUT,
    result: typeof result === 'string' ? result : '(paused)',
    events: persisted.events.length,
    redaction: persisted.redaction,
    title: 'Replayed from a persisted Trace',
  },
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(data, null, 2));

console.log(`[replay] wrote ${OUT}`);
console.log(`[replay] result: ${data.meta.result}`);
console.log(
  `[replay] rebuilt graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges · ` +
    `from ${data.meta.events} events · redaction: ${data.meta.redaction}`,
);
