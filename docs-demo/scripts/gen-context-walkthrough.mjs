import { deepStrictEqual, ok } from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Agent } from 'agentfootprint';
import { recordRun } from 'agentfootprint/observe';
import { mock } from 'agentfootprint/providers';
import { CONTEXT_MILESTONE_AXIS } from 'agentfootprint-lens/context';
import { contextAt, foldCursorOf, lensCursorFrom, observeRecording, tagAxisPositions } from 'agentfootprint-lens/core';
import { stringifySnapshot } from 'footprintjs';
import { recordContextWalkthrough } from '../shared/recordContextWalkthrough.mjs';
import { agentFootprintVersion, provenance } from './published-cohort.mjs';

// Read the same stop as ContextView. The static lesson shows selected keys
// from the mock recording and leaves the full fold to the interactive view.
const milestones = {
  question: { label: 'Run start', keys: [] },
  selection: { label: 'Route 1', keys: ['userMessage', 'llmLatestToolCalls'] },
  reference: { label: 'Tool call 1', keys: ['lastToolResult'] },
  prepare: { label: 'Iteration 2', keys: ['iteration', 'lastToolResult'] },
  model: { label: 'Route 2', keys: ['llmLatestContent'] },
  finding: { label: 'Answer 1', keys: ['answerValidation'] },
  answer: { label: 'Run end', keys: ['finalContent'] },
};

const recording = await recordContextWalkthrough({ Agent, mock, recordRun, stringifySnapshot });
const positions = tagAxisPositions(recording.snapshot, CONTEXT_MILESTONE_AXIS, []) ?? [];
const events = observeRecording(recording).recorder.getEntries();
const steps = Object.fromEntries(Object.entries(milestones).map(([id, { label, keys }]) => {
  const index = positions.findIndex((position) => position.label === label);
  ok(index >= 0, `The recording must contain the ${label} stop for ${id}`);
  const cursor = lensCursorFrom(positions, index, () => undefined);
  const context = contextAt(recording.snapshot, foldCursorOf(cursor.at), {
    previous: positions[index - 1],
    events,
  });
  ok(!context.foldError, `The context at ${label} must be readable`);
  const values = Object.fromEntries(keys.map((key) => {
    const entry = context.keys.find(({ path }) => path === key);
    ok(entry, `The recorded context at ${label} must contain ${key}`);
    return [key, entry.value];
  }));
  return [id, { label, index, values }];
}));

const mode = process.argv[2];
const docsFigure = new URL('../../docs-next/lib/context-walkthrough-figure.json', import.meta.url);
const generated = new URL('../src/generated/', import.meta.url);
const figure = JSON.stringify({ ...provenance, agentFootprintVersion, steps }, null, 2) + '\n';
if (mode === '--check') {
  deepStrictEqual(readFileSync(docsFigure, 'utf8'), figure,
    'The saved Context excerpts differ. Run npm run gen:context-walkthrough and commit the output.');
  console.log('The Context excerpts match all seven recorded stops on the published cohort.');
} else {
  const stops = Object.fromEntries(Object.entries(steps).map(([id, { index }]) => [id, index]));
  mkdirSync(generated, { recursive: true });
  writeFileSync(new URL('context-walkthrough.json', generated), stringifySnapshot({
    provenance, recording, stops,
  }));
  if (mode === '--write') writeFileSync(docsFigure, figure);
}
