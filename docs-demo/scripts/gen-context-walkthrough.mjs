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

// Tie the displayed excerpts to the tool, model, validation and delivery records.
function recordedPayload(type) {
  const event = recording.events.findLast((entry) => entry.type === type);
  ok(event, `The recording must contain ${type}`);
  return event.payload;
}

const { userPrompt } = recordedPayload('agentfootprint.agent.turn_start');
const { toolCallId, toolName, args } = recordedPayload('agentfootprint.stream.tool_start');
const { result } = recordedPayload('agentfootprint.stream.tool_end');
const { iteration } = recordedPayload('agentfootprint.stream.llm_end');
const { finalContent } = recordedPayload('agentfootprint.agent.turn_end');
const { lastToolResult } = steps.reference.values;
deepStrictEqual(steps.selection.values, {
  userMessage: userPrompt,
  llmLatestToolCalls: [{ id: toolCallId, name: toolName, args }],
}, 'Route 1 must show the question and scoped operation');
deepStrictEqual({ ...lastToolResult, result: JSON.parse(lastToolResult.result) }, { toolName, result },
  'Tool call 1 must show the raw tool return');
deepStrictEqual(steps.prepare.values, { iteration, lastToolResult },
  'Iteration 2 must carry the same tool result to the next model call');
// llm_end withholds draft text. For this fixture the folded model reply is delivered verbatim.
deepStrictEqual(steps.model.values.llmLatestContent, finalContent,
  'Route 2 must show the model finding later delivered as the answer');
deepStrictEqual(steps.finding.values.answerValidation, recording.snapshot.sharedState.answerValidation,
  'Answer 1 must show the recorded validation report');
deepStrictEqual(steps.answer.values.finalContent, finalContent,
  'Run end must show the delivered answer');

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
