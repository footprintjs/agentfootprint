import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { assessAnswer } from '../../../../src/observe.js';

type Verdict = { standing: string; reasons: string[] };
type LegacyRecording = {
  verdict: Verdict;
  recording: Parameters<typeof assessAnswer>[0];
};

// Ten recordings made at f51d3003bcfe, with that version's own verdicts.
// Their slices preserve the complete assessment on both readers.
const path = new URL('./fixtures/recordings-made-before-call-occurrence.json', import.meta.url);
const recordings = JSON.parse(readFileSync(path, 'utf8')) as Record<string, LegacyRecording>;
const reasonChanges: Readonly<Record<string, string>> = {
  'an assumed argument, the same id twice': 'check-unreachable',
  'the result is kept out, ground not covered': 'result-withheld',
};

it.each(Object.entries(recordings))('reads the pre-occurrence recording for %s', (name, row) => {
  const assessed = assessAnswer(row.recording);
  const replacement = reasonChanges[name];
  const expected =
    replacement === undefined ? row.verdict : { ...row.verdict, reasons: [replacement] };
  const reasons = assessed.reasons.map(({ reason }) => reason).sort();
  expect({ standing: assessed.standing, reasons }).toEqual(expected);
  if (replacement === 'result-withheld') {
    expect(assessed.reasons).toMatchObject([
      { reason: 'result-withheld', source: { kind: 'run' }, witness: [] },
    ]);
  }
});
