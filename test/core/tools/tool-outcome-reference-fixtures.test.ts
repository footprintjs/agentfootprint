import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

interface Capture {
  commitLog: {
    stage: string;
    overwrite: { history?: { role: string; toolCallId?: string; outcome?: string }[] };
  }[];
}

const root = new URL('./reference/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const file = 'agent-scoped-provider.json';

it('binds the complete captures and adds only the refused outcome to the committed tool message', () => {
  const prior = read(`v14-native-components/${file}`);
  const current = read(`tool-outcome-marker/${file}`);
  expect(JSON.parse(read('tool-outcome-marker/MANIFEST.json'))).toEqual({
    case: 'agent-scoped-provider',
    previousCohort: 'v14-native-components',
    previousSha256: digest(prior),
    currentSha256: digest(current),
  });

  const expected = JSON.parse(prior) as Capture;
  const commit = expected.commitLog[18]!;
  expect(commit.stage).toBe('ToolCalls');
  const message = commit.overwrite.history![1]!;
  expect(message).toMatchObject({ role: 'tool', toolCallId: 'c1' });
  expect(message).not.toHaveProperty('outcome');
  message.outcome = 'refused';
  expect(JSON.parse(current)).toEqual(expected);
});
