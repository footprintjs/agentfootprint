import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { fnv1a, truncate } from '../../../src/core/slots/helpers.js';

interface Text {
  content: string;
}
interface ProjectedMessage {
  rawContent: string;
  contentHash: string;
  contentSummary: string;
  asRole: string;
  position: number;
}
interface Size {
  jsonBytes: number;
  jsonChars: number;
}
interface Capture {
  commitLog: {
    stage: string;
    overwrite: {
      history?: Text[];
      lastToolResult?: { result: string };
      toolResults?: { result: string }[];
      messagesInjections?: ProjectedMessage[];
      receipt?: { requestMeasurement: { slots: { messages: Size }; total: Size } };
    };
  }[];
  served: { view: { messages: { asSent: Text[] } } }[];
}

const root = new URL('./reference/', import.meta.url);
const current = new URL('step-outcomes/', root);
const read = (file: string) => readFileSync(new URL(file, root), 'utf8');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const cases = ['agent-answer-layer', 'agent-stepped-skill'] as const;
const oldStep =
  'lookup result Step 1 of 2 done. Now on step 2 of 2: refund the charge (tool: `charge`).';
const newStep = oldStep.replace('done.', 'ran; its tool declared no status.');
const oldNudge =
  "[steps unrun — Step 2 of 'refund' had not run when the answer above was given: " +
  '2: refund the charge (`charge`). This message asked for them to be run, or for the reason they were not run.]';
const newNudge = oldNudge
  .replace('had not run', 'had not been completed')
  .replace('to be run', 'to be completed')
  .replace('were not run', 'were not');

function updateProjection(message: ProjectedMessage, previous: string, next: string): void {
  const key = `${message.asRole}:${message.position}:`;
  expect(message.rawContent).toBe(previous);
  expect(message.contentHash).toBe(fnv1a(key + previous));
  expect(message.contentSummary).toBe(truncate(previous, 80));
  message.rawContent = next;
  message.contentHash = fnv1a(key + next);
  message.contentSummary = truncate(next, 80);
}

function completeExpectedCapture(capture: Capture): void {
  const at = (idx: number, stage: string) => {
    const commit = capture.commitLog[idx]!;
    expect(commit.stage).toBe(stage);
    return commit.overwrite;
  };

  const tool = at(18, 'ToolCalls');
  expect(tool.history![1]!.content).toBe(oldStep);
  expect(tool.lastToolResult!.result).toBe(oldStep);
  expect(tool.toolResults![0]!.result).toBe(oldStep);
  tool.history![1]!.content = newStep;
  tool.lastToolResult!.result = newStep;
  tool.toolResults![0]!.result = newStep;

  const nudge = at(36, 'StepNudge').history![1]!;
  expect(nudge.content).toBe(oldNudge);
  nudge.content = newNudge;
  updateProjection(at(22, 'Messages').messagesInjections![2]!, oldStep, newStep);
  updateProjection(at(40, 'Messages').messagesInjections![2]!, oldStep, newStep);
  updateProjection(at(40, 'Messages').messagesInjections![4]!, oldNudge, newNudge);

  for (const [servedIndex, commitIndex] of [
    [1, 34],
    [2, 52],
  ] as const) {
    const messages = capture.served[servedIndex]!.view.messages.asSent;
    const before = JSON.stringify(messages);
    expect(messages[2]!.content).toBe(oldStep);
    messages[2]!.content = newStep;
    if (servedIndex === 2) {
      expect(messages[4]!.content).toBe(oldNudge);
      messages[4]!.content = newNudge;
    }
    const after = JSON.stringify(messages);
    const measurement = at(commitIndex, 'CallLLM').receipt!.requestMeasurement;
    for (const size of [measurement.slots.messages, measurement.total]) {
      size.jsonBytes += Buffer.byteLength(after) - Buffer.byteLength(before);
      size.jsonChars += after.length - before.length;
    }
  }
}

it('binds just the two complete step-outcome captures to their retained originals', () => {
  expect(
    readdirSync(current)
      .filter((file) => file.endsWith('.json'))
      .sort(),
  ).toEqual(['MANIFEST.json', ...cases.map((name) => `${name}.json`)]);
  expect(JSON.parse(read('step-outcomes/MANIFEST.json'))).toEqual({
    previousCohort: 'v14-native-components',
    captures: cases.map((name) => ({
      case: name,
      previousSha256: digest(read(`v14-native-components/${name}.json`)),
      currentSha256: digest(read(`step-outcomes/${name}.json`)),
    })),
  });
});

it.each(cases)('%s changes only the step and nudge sentences and their derived values', (name) => {
  const expected = JSON.parse(read(`v14-native-components/${name}.json`)) as Capture;
  completeExpectedCapture(expected);
  expect(read(`step-outcomes/${name}.json`)).toBe(`${JSON.stringify(expected, null, 2)}\n`);
});
