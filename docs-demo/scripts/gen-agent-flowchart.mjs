import { deepStrictEqual, ok } from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Agent } from 'agentfootprint';
import { mock } from 'agentfootprint/providers';
import { createTraceStructureRecorder } from 'footprint-explainable-ui/flowchart';
import { buildWeatherAgent, weatherAnswer, weatherInput } from './quick-start-weather.mjs';
import { renderWeatherDiagram } from './render-weather-diagram.mjs';

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const packages = [
  'agentfootprint',
  'agentfootprint-lens',
  'footprint-explainable-ui',
  'footprintjs',
  'foottrace',
];
// Record the immutable published source commit alongside a reviewed version bump.
const agentFootprintVersion = lock.packages['node_modules/agentfootprint'].version;
const releaseCommits = { '15.0.0': 'd966fbcd880bba639ac587f8fd59164772403a0e' };
ok(
  releaseCommits[agentFootprintVersion],
  `Record the release commit for AgentFootprint ${agentFootprintVersion}.`,
);
const provenance = {
  commit: releaseCommits[agentFootprintVersion],
  cohort: packages.map((name) => `${name}@${lock.packages[`node_modules/${name}`].version}`),
};

const trace = createTraceStructureRecorder();
const agent = buildWeatherAgent({ Agent, mock }, [trace.recorder]);
const toolResults = [];
agent.on('agentfootprint.stream.tool_end', ({ payload }) => {
  toolResults.push([payload.toolCallId, payload.result, payload.error === true]);
});
const result = await agent.run({ message: weatherInput });
deepStrictEqual(result, weatherAnswer);
deepStrictEqual(toolResults, [['call-weather-1', 'San Francisco: sunny, 72°F', false]]);
ok(agent.getLastSnapshot()?.executionTree, 'The real run must retain its execution tree.');
ok(agent.getLastNarrativeEntries().length, 'The real run must retain narrative entries.');

const graph = trace.getGraph();
ok(graph.nodes.some(({ id }) => id.includes('sf-llm-call/')));
ok(graph.edges.some(({ data }) => data?.kind === 'loop'));
const recording = { graph, input: weatherInput, result, provenance };

const mode = process.argv[2];
const generated = new URL('../src/generated/', import.meta.url);
const docsAssets = new URL('../../docs-next/public/assets/', import.meta.url);
const docsProvenance = new URL('../../docs-next/lib/quick-start-flowchart.json', import.meta.url);
const diagrams = ['light', 'dark'].map((theme) => {
  const { svg, width, height } = renderWeatherDiagram(graph, provenance, theme);
  return { theme, svg, width, height };
});
const [{ width, height }] = diagrams;
const docsFiles = [
  [docsProvenance, JSON.stringify({ ...provenance, width, height }, null, 2) + '\n'],
  ...diagrams.map(({ theme, svg }) => [
    new URL(`quick-start-flowchart-${theme}.svg`, docsAssets),
    svg,
  ]),
];

if (mode === '--check') {
  for (const [file, expected] of docsFiles) {
    ok(
      readFileSync(file, 'utf8') === expected,
      `${file.pathname} differs. Run npm run gen:flowchart in docs-demo and commit the generated files.`,
    );
  }
  console.log('The checked-in Quick Start diagrams match a fresh run on the published cohort.');
} else {
  mkdirSync(generated, { recursive: true });
  writeFileSync(new URL('weather-run.json', generated), JSON.stringify(recording, null, 2) + '\n');
  if (mode === '--write') {
    for (const [file, content] of docsFiles) writeFileSync(file, content);
  }
}

console.log(
  `Quick Start weather run: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${result}`,
);
