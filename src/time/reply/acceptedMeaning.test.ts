import { expect, it } from 'vitest';
import { timeReplyOf } from '../reply.js';
import { chooseReading, resolveMention, DEFAULT_TIME_POLICY } from '../resolve.js';
import { timeAnswerRow, timeRowIsWellFormed, type ClockRow, type TimeReadingRow } from '../rows.js';
import { turnWindowsOf } from '../windows.js';
import { turnFormsWindowsOf } from '../forms.js';

const clock: ClockRow = {
  kind: 'clock',
  turn: 1,
  iteration: 1,
  now: '2026-11-06T18:01:00Z',
  nowSource: 'app',
  zone: 'UTC',
  zoneSource: 'run',
};
const reader = { id: 'fixture', version: '1', kind: 'rule' as const, locale: 'en-US' };
const parses = [{ relative: { unit: 'hour' as const, count: 1 } }];
const resolved = resolveMention(parses, clock, reader, true, DEFAULT_TIME_POLICY);
const original: TimeReadingRow = {
  kind: 'time-reading',
  turn: 1,
  iteration: 1,
  reader,
  tzdata: 'fixture',
  mentions: 1,
  mention: 0,
  quote: 'last 1 hour',
  parses,
  candidates: resolved.candidates,
  choice: chooseReading(resolved, DEFAULT_TIME_POLICY, 'rule', undefined, true),
};
const changed = timeReplyOf({
  row: original,
  clock,
  policy: DEFAULT_TIME_POLICY,
  correction: 'last 2 hours',
});
if (changed.kind !== 'reask') throw new Error('Expected a corrected proposal');
const range = changed.row.candidates![0]!.range;
const accepted = {
  kind: 'time-answer' as const,
  turn: 1,
  iteration: 1,
  mention: 0,
  ...range,
  zone: 'UTC',
  how: 'confirmed' as const,
  corrected: { lookback: '2h' as const },
};

it('retains the corrected canonical duration after the pending proposal is gone', () => {
  const window = turnWindowsOf([original], clock, [accepted]).windows[0];
  expect(window).toMatchObject({ range, lookback: '2h', source: 'answered', answer: 'confirmed' });
  expect(window).not.toHaveProperty('quote');
});
it('the answer builder and checkpoint reader retain only the canonical corrected meaning', () => {
  expect(
    timeAnswerRow(
      { mention: 0, range, zone: 'UTC', how: 'confirmed', corrected: accepted.corrected },
      { turn: 1, iteration: 1 },
    ),
  ).toEqual(accepted);
  expect(timeRowIsWellFormed(accepted)).toBe(true);
  expect(timeRowIsWellFormed({ ...accepted, corrected: { lookback: '1h' } })).toBe(false);
  expect(timeRowIsWellFormed({ ...accepted, corrected: { quote: 'raw correction' } })).toBe(false);
});
it('an old answer without correction metadata keeps its original reading', () => {
  const { corrected: _correction, ...legacy } = { ...accepted, ...resolved.candidates[0]!.range };
  void _correction;
  const window = turnWindowsOf([original], clock, [legacy]).windows[0];
  expect(window).toMatchObject({ quote: 'last 1 hour', lookback: '1h' });
});
it('equal corrected intervals do not regain the old parse-derived attribution', () => {
  const sameRange = resolved.candidates[0]!.range;
  const corrected = { ...accepted, ...sameRange, corrected: { lookback: '1h' } };
  const forms = turnFormsWindowsOf([clock, original, corrected]);
  expect(forms[0]).toMatchObject({ range: sameRange, lookback: '1h' });
  expect(forms[0]).not.toHaveProperty('reading');
  const { corrected: _correction, ...legacy } = corrected;
  void _correction;
  expect(turnFormsWindowsOf([clock, original, legacy])[0]).toHaveProperty('reading');
});
