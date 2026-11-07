import { expect, it } from 'vitest';
import { englishTimeReader, readEnglishTime } from '../readers/english.js';
import { chooseReading, DEFAULT_TIME_POLICY, resolveMention } from '../resolve.js';
import type { TimeReadingRow } from '../rows.js';
import { timeReplyOf } from '../reply.js';

const clock = { now: '2026-11-06T18:01:00Z', zone: 'America/Los_Angeles' };
function rowOf(text: string): TimeReadingRow {
  const mention = readEnglishTime(text).mentions[0]!;
  const reader = englishTimeReader();
  const resolved = resolveMention(mention.parses, clock, reader, true, DEFAULT_TIME_POLICY);
  return {
    kind: 'time-reading',
    turn: 1,
    iteration: 0,
    mention: 0,
    mentions: 1,
    reader: { id: reader.id, version: reader.version, kind: reader.kind, locale: reader.locale },
    tzdata: 'test',
    ...mention,
    candidates: resolved.candidates,
    choice: chooseReading(resolved, DEFAULT_TIME_POLICY, reader.kind, undefined, true),
  };
}
it('a replacement time word keeps the stated pending zone instead of the caller clock zone', () => {
  const row = rowOf('yesterday in London time');
  const result = timeReplyOf({ row, clock, policy: DEFAULT_TIME_POLICY, correction: 'today' });
  expect(result.kind).toBe('reask');
  if (result.kind !== 'reask') throw new Error('Expected the new proposal');
  expect(result.row.parses?.[0].zoneToken).toBe('London time');
  expect(result.row.candidates?.[0].zone).toBe('Europe/London');
  expect(result.row.candidates?.[0].range.from).toBe('2026-11-06T00:00:00Z');
  const explicit = timeReplyOf({
    row,
    clock,
    policy: DEFAULT_TIME_POLICY,
    correction: 'today in Asia/Kolkata',
  });
  expect(explicit).toMatchObject({
    kind: 'reask',
    row: { parses: [{ zoneToken: 'Asia/Kolkata' }] },
  });
});
it('receiving a zone for an unreadable time does not ask the person for another zone', () => {
  const row = {
    ...rowOf('yesterday'),
    parses: [],
    candidates: [],
    choice: { by: 'none' as const },
  };
  const result = timeReplyOf({ row, clock, policy: DEFAULT_TIME_POLICY, correction: 'EST' });
  expect(result).toMatchObject({ kind: 'hold', rule: 'unresolved-correction' });
  if (result.kind !== 'hold') throw new Error('Expected the missing time question');
  expect(result.reason).not.toMatch(/give a time zone/i);
  expect(result.reason).toMatch(/time words|which time/i);
});
