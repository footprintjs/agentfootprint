import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

interface Capture {
  commitLog: {
    stage: string;
    overwrite: { stepPointer?: Record<string, unknown>[] };
  }[];
}

const root = new URL('./reference/', import.meta.url);
const previous = 'step-outcomes';
const current = 'step-completion-evidence';
const cases = ['agent-answer-layer', 'agent-stepped-skill'] as const;
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

it('binds the two complete captures to the retained step-outcome captures', () => {
  const json = readdirSync(new URL(`${current}/`, root)).filter((file) => file.endsWith('.json'));
  expect(json.sort()).toEqual(['MANIFEST.json', ...cases.map((name) => `${name}.json`)]);
  expect(JSON.parse(read(`${current}/MANIFEST.json`))).toEqual({
    previousCohort: previous,
    captures: cases.map((name) => ({
      case: name,
      previousSha256: digest(read(`${previous}/${name}.json`)),
      currentSha256: digest(read(`${current}/${name}.json`)),
    })),
  });
});

it.each(cases)('%s adds only the observed advance counts to the committed step pointer', (name) => {
  const expected = JSON.parse(read(`${previous}/${name}.json`)) as Capture;
  const commit = expected.commitLog[18]!;
  expect(commit.stage).toBe('ToolCalls');
  const pointer = commit.overwrite.stepPointer![0]!;
  expect(pointer).toEqual({ skillId: 'refund', skipped: [], step: 2, total: 2 });
  commit.overwrite.stepPointer![0] = {
    advanceOutcomes: { notReported: 1, succeeded: 0 },
    ...pointer,
  };
  expect(read(`${current}/${name}.json`)).toBe(`${JSON.stringify(expected, null, 2)}\n`);
});
