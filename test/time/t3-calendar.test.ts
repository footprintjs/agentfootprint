import { describe, expect, it } from 'vitest';

import { completeClock, draftClock, readRunTime } from '../../src/time/clock.js';
import { convertForTool } from '../../src/time/convert.js';
import { toUtc } from '../../src/time/instant.js';
import { checkReading } from '../../src/time/reader.js';
import { englishTimeReader, readEnglishTime } from '../../src/time/readers/english.js';
import { timeAnswerRow } from '../../src/time/rows.js';
import { timeReadingRows } from '../../src/time/rowsBuild.js';
import { turnWindowsOf, windowToConvert } from '../../src/time/windows.js';
import { int, prng } from './fixtures/generate.js';
import { rulerBounds, rulerRows } from './fixtures/rulerTool.js';

const PACIFIC = 'America/Los_Angeles';
const NOW = '2026-11-13T20:00:00Z';
const AT = { turn: 1, iteration: 0 };
const policy = {
  dateOrder: 'MDY',
  year: 'ask',
  abbreviations: { PST: { zone: PACIFIC, offset: '-08:00' } },
} as const;
const reader = englishTimeReader();
const epochBounds = {
  ...rulerBounds,
  from: { ...rulerBounds.from, as: 'epoch-ms' },
  to: { ...rulerBounds.to, as: 'epoch-ms' },
} as const;

function readWindow(phrase: string, now: string) {
  const run = readRunTime({ now });
  if ('problem' in run) throw new Error(run.problem);
  const clock = completeClock(draftClock(run.value, { zone: PACIFIC }), 0);
  const mentions = checkReading(phrase, readEnglishTime(phrase), reader.id);
  const rows = timeReadingRows({
    mentions,
    clock,
    policy,
    reader,
    tzdata: process.versions.tz ?? 'unknown',
    at: AT,
  });
  const [row] = rows;
  if (rows.length !== 1 || row === undefined)
    throw new Error(`Expected one mention for "${phrase}".`);
  return { clock, row };
}

function utcIso(value: number): string {
  return new Date(value).toISOString().replace('.000Z', 'Z');
}

function rulerResult(phrase: string, now: string, form: typeof rulerBounds | typeof epochBounds) {
  const { clock, row } = readWindow(phrase, now);
  expect(turnWindowsOf([row], undefined).windows).toEqual([]);
  expect(row.choice).toMatchObject({ by: 'open', open: ['confirm'] });
  if (row.choice?.by !== 'open' || row.mention === undefined) throw new Error('Expected an offer');
  const candidate = row.candidates?.[row.choice.remaining[0]!];
  if (candidate === undefined) throw new Error('Expected a candidate to confirm');
  const answer = timeAnswerRow(
    {
      mention: row.mention,
      range: candidate.range,
      zone: candidate.zone,
      how: 'confirmed',
      ...(candidate.endpoint !== undefined && { endpoint: candidate.endpoint }),
    },
    AT,
  );
  const [window] = turnWindowsOf([row], undefined, [answer]).windows;
  if (window === undefined) throw new Error('Expected an admitted window');
  const conversion = convertForTool(windowToConvert(window), [form], undefined, {
    now: clock.now,
    zone: window.zone,
    appZone: clock.zone,
    granularityMs: 60_000,
  });
  if ('refused' in conversion) throw new Error(`Ruler bounds refused: ${conversion.refused}`);
  const { from, to } = conversion.conversion.values;
  const range = {
    from: typeof from === 'number' ? utcIso(from) : from,
    to: typeof to === 'number' ? utcIso(to) : to,
  };
  const names = rulerRows(range);
  return { sent: { from, to }, names: [names[0], names.at(-1)] };
}

function withProcessZone(processZone: string, expectedOffset: number, run: () => void) {
  const original = process.env.TZ;
  process.env.TZ = processZone;
  try {
    expect(new Date(NOW).getTimezoneOffset()).toBe(expectedOffset);
    run();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

const cases = [
  {
    title: 'last two hours stay anchored',
    phrase: 'last 2 hours',
    now: NOW,
    form: rulerBounds,
    from: '2026-11-13T18:00:00Z',
    to: NOW,
    names: ['R-2026-11-13T18:00Z', 'R-2026-11-13T19:59Z'],
  },
  {
    title: 'past 24 hours use an absolute window',
    phrase: 'past 24 hours',
    now: NOW,
    form: rulerBounds,
    from: '2026-11-12T20:00:00Z',
    to: NOW,
    names: ['R-2026-11-12T20:00Z', 'R-2026-11-13T19:59Z'],
  },
  {
    title: 'the named date, AM/PM and zone fix the clock range',
    phrase: '11/13/2026 8:00 AM to 9:00 AM PST',
    now: NOW,
    form: epochBounds,
    from: '2026-11-13T16:00:00Z',
    to: '2026-11-13T17:00:00Z',
    names: ['R-2026-11-13T16:00Z', 'R-2026-11-13T16:59Z'],
  },
  {
    title: 'today follows the Pacific date at 23:30',
    phrase: 'today',
    now: '2026-11-14T07:30:00Z',
    form: epochBounds,
    from: '2026-11-13T08:00:00Z',
    to: '2026-11-14T08:00:00Z',
    names: ['R-2026-11-13T08:00Z', 'R-2026-11-14T07:59Z'],
  },
  {
    title: 'yesterday steps back one Pacific calendar day',
    phrase: 'yesterday',
    now: '2026-11-14T07:30:00Z',
    form: epochBounds,
    from: '2026-11-12T08:00:00Z',
    to: '2026-11-13T08:00:00Z',
    names: ['R-2026-11-12T08:00Z', 'R-2026-11-13T07:59Z'],
  },
  {
    title: 'the Pacific year rolls over at local midnight',
    phrase: '12/31/2026 11:00 PM to 01/01/2027 1:00 AM',
    now: '2027-01-01T07:30:00Z',
    form: epochBounds,
    from: '2027-01-01T07:00:00Z',
    to: '2027-01-01T09:00:00Z',
    names: ['R-2027-01-01T07:00Z', 'R-2027-01-01T08:59Z'],
  },
] as const;

const questions = [
  { title: 'missing AM/PM', phrase: '11/13/2026 8:00 to 9:00 PST', reason: 'meridiem' },
  { title: 'the spring gap', phrase: '03/08/2026 2:30 AM', reason: 'dst' },
  { title: 'the fall repeat', phrase: '11/01/2026 1:30 AM', reason: 'dst' },
] as const;

describe.each([
  { processZone: 'UTC', offset: 0 },
  { processZone: 'America/Los_Angeles', offset: 480 },
  { processZone: 'America/New_York', offset: 300 },
  { processZone: 'Asia/Kolkata', offset: -330 },
])('Pacific app windows with process TZ=$processZone', ({ processZone, offset }) => {
  it.each(cases)('$title', ({ phrase, now, form, from, to, names }) => {
    withProcessZone(processZone, offset, () => {
      const actual = rulerResult(phrase, now, form);
      const sent =
        form.from.as === 'epoch-ms' ? { from: Date.parse(from), to: Date.parse(to) } : { from, to };
      expect(actual).toEqual({ sent, names });
    });
  });

  it.each(questions)('asks about $title before producing bounds', ({ phrase, reason }) => {
    withProcessZone(processZone, offset, () => {
      const { row } = readWindow(phrase, NOW);
      expect(row.choice).toMatchObject({ by: 'open', open: expect.arrayContaining([reason]) });
      expect(turnWindowsOf([row], undefined).windows).toEqual([]);
    });
  });

  it('keeps both fall-repeat instants distinct', () => {
    withProcessZone(processZone, offset, () => {
      const { row } = readWindow('11/01/2026 1:30 AM', NOW);
      if (row.choice?.by !== 'open') throw new Error('Expected the DST clarification');
      expect(
        row.choice.remaining.map((index) => toUtc(row.candidates?.[index]?.range.from, 'strict')),
      ).toEqual(['2026-11-01T08:30:00Z', '2026-11-01T09:30:00Z']);
    });
  });

  it('resolves generated look-back anchors against the supplied clock', () => {
    withProcessZone(processZone, offset, () => {
      const random = prng(0x7113);
      const yearStart = Date.parse('2026-01-01T00:00:00Z');
      const minute = 60_000;
      for (let i = 0; i < 12; i++) {
        const anchor = yearStart + int(random, 0, 365 * 24 * 60 - 1) * minute;
        const hours = int(random, 2, 24);
        const from = utcIso(anchor - hours * 60 * minute);
        const to = utcIso(anchor);
        const before = utcIso(anchor - minute);
        expect(rulerResult(`last ${hours} hours`, to, rulerBounds)).toEqual({
          sent: { from, to },
          names: [`R-${from.slice(0, 16)}Z`, `R-${before.slice(0, 16)}Z`],
        });
      }
    });
  });
});
