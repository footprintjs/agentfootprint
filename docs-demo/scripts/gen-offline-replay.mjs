import { deepStrictEqual, ok } from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Agent } from 'agentfootprint';
import { redactContent } from 'agentfootprint/observe';
import { mock } from 'agentfootprint/providers';
import { structureGraphFromSpec } from 'agentfootprint-lens/core';
import { stringifySnapshot } from 'footprintjs';
import { assertOfflineReplayTrace, recordOfflineReplay } from '../shared/recordOfflineReplay.mjs';
import { agentFootprintVersion, provenance } from './published-cohort.mjs';
import { buildWeatherAgent, weatherAnswer, weatherInput } from './quick-start-weather.mjs';
import { renderWeatherDiagram } from './render-weather-diagram.mjs';

const mode = process.argv[2];
const docsAssets = new URL('../../docs-next/public/assets/', import.meta.url);
const docsFigure = new URL('../../docs-next/lib/offline-replay-figure.json', import.meta.url);
const traceFile = new URL('offline-replay-trace.json', docsAssets);
const output = new URL('../src/generated/', import.meta.url);

const capture = () => recordOfflineReplay(buildWeatherAgent({ Agent, mock }), {
  redactContent,
  stringifySnapshot,
});

// Only the clock differs between two captures on the pinned cohort. Preserve
// the real clock in the published download and compare every other field.
function withoutWallClock({ capturedAtMs, events, ...trace }) {
  return {
    ...trace,
    events: events.map(({ ts, durationMs, ...event }) => event),
  };
}

const bytes = mode === '--write' ? (await capture()).bytes : readFileSync(traceFile, 'utf8');
const persisted = JSON.parse(bytes);
assertOfflineReplayTrace(persisted);
if (mode === '--check') {
  const { trace } = await capture();
  deepStrictEqual(withoutWallClock(persisted), withoutWallClock(trace),
    'The saved Trace differs from a fresh pinned run. Regenerate it with npm run gen:offline-replay.');
}

// Both the browser and the guide draw the chart exclusively from saved bytes.
const graph = structureGraphFromSpec(persisted.structure);
ok(graph.nodes.some(({ id }) => id === 'sf-llm-call'), 'Replay needs the LLM subflow');
ok(graph.edges.some(({ data }) => data?.kind === 'loop'), 'Replay needs the tool loop');

const meta = {
  input: weatherInput,
  result: weatherAnswer,
  events: persisted.events.length,
  redaction: persisted.redaction,
  title: 'Replayed from a persisted Trace',
};
const diagrams = ['light', 'dark'].map((theme) => ({
  theme, ...renderWeatherDiagram(graph, provenance, theme),
}));
const [{ width, height }] = diagrams;
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const docsFiles = [
  [docsFigure, json({
    ...provenance,
    agentFootprintVersion,
    figure: { asset: 'offline-replay', width, height },
    meta,
    traceSha256: createHash('sha256').update(bytes).digest('hex'),
  })],
  ...diagrams.map(({ theme, svg }) => [new URL(`offline-replay-${theme}.svg`, docsAssets), svg]),
];

if (mode === '--check') {
  for (const [file, expected] of docsFiles) {
    deepStrictEqual(readFileSync(file, 'utf8'), expected,
      `${file.pathname} differs. Run npm run gen:offline-replay and commit the output.`);
  }
  console.log('The offline Replay download, chart and metadata match the published cohort.');
} else {
  mkdirSync(output, { recursive: true });
  writeFileSync(new URL('offline-replay.json', output), json({ provenance, graph, meta }));
  if (mode === '--write') {
    writeFileSync(traceFile, bytes);
    for (const [file, content] of docsFiles) writeFileSync(file, content);
  }
}
