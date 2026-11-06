/** Pure corrected-window rendering: real descriptors and record readers, no Agent or model. */
import { describe, expect, it } from 'vitest';
import { timeWindowsLine } from '../../src/core/agent/arguments/serve.js';
import { SHOWN_ARGS } from '../../src/core/toolShownArgs.js';
import type { LLMToolSchema } from '../../src/provider-contract/types.js';
import {
  isRefused,
  periodFactsOf,
  periodFormsOf,
  rulesOf,
  type RuledToolLike,
} from '../../src/tools/declare.js';
import { convertForTool, granularityMsOf } from '../../src/time/convert.js';
import { readerWindowsOf, windowToConvert } from '../../src/time/windows.js';
import type { ClockRow, TimeAnswerRow, TimeReadingRow } from '../../src/time/rows.js';

const NOW = '2026-10-09T15:40:00Z';
const LA = 'America/Los_Angeles';
const NY = 'America/New_York';
const ORIGINAL_QUOTE = 'last 2 hours';
const originalRange = { from: '2026-10-09T13:40:00Z', to: '2026-10-09T15:40:00.001Z' };
const correctedRange = { from: '2026-10-09T14:40:00Z', to: '2026-10-09T15:40:00.001Z' };
const expectedBounds = { start_time: Date.parse(correctedRange.from), end_time: Date.parse(NOW) };
const schema: LLMToolSchema = {
  name: 'activity',
  description: 'Read synthetic activity over a window.',
  inputSchema: {
    type: 'object',
    properties: { start_time: { type: 'integer' }, end_time: { type: 'integer' } },
  },
};
const tool: RuledToolLike = {
  schema,
  askOrAssume: { start_time: { ask: 'From when?' }, end_time: { ask: 'Until when?' } },
  period: {
    forms: [
      {
        kind: 'bounds',
        from: { argument: 'start_time', as: 'epoch-ms' },
        to: { argument: 'end_time', as: 'epoch-ms', edge: 'exclusive' },
      },
    ],
  },
};
const clock: ClockRow = {
  kind: 'clock',
  turn: 1,
  iteration: 1,
  now: NOW,
  nowSource: 'app',
  zone: LA,
  zoneSource: 'run',
};
const reading: TimeReadingRow = {
  kind: 'time-reading',
  turn: 1,
  iteration: 1,
  mention: 0,
  mentions: 1,
  reader: { id: 'fixture/rule', kind: 'rule', version: '1', locale: 'en-US' },
  tzdata: 'unknown',
  quote: ORIGINAL_QUOTE,
  parses: [{ relative: { unit: 'hour', count: 2 } }],
  candidates: [
    {
      range: originalRange,
      zone: LA,
      window: { kind: 'lookback', duration: '2h' },
      grain: 'hour',
      said: ['duration'],
      implied: [],
      anchor: 'message',
      reader: { id: 'fixture/rule', kind: 'rule' },
      notes: [],
      reading: {},
      parse: 0,
    },
  ],
  choice: { by: 'open', remaining: [0], open: ['confirm'] },
};
const original: TimeAnswerRow = {
  kind: 'time-answer',
  turn: 1,
  iteration: 1,
  mention: 0,
  ...originalRange,
  zone: LA,
  how: 'confirmed',
};
const corrected: TimeAnswerRow = {
  ...original,
  ...correctedRange,
  zone: NY,
  corrected: { lookback: '1h' },
};
const windows = () => readerWindowsOf([clock, reading, corrected]);
const line = (winning: RuledToolLike = tool) =>
  timeWindowsLine([schema], new Map([['activity', winning]]), windows());

describe('corrected canonical windows stay on the confirmed late time line', () => {
  it('serves the corrected window without borrowing the original quote, using the fill conversion', () => {
    const current = windows();
    expect(current.windows).toHaveLength(1);
    const window = current.windows[0];
    expect(window).toMatchObject({
      source: 'answered',
      answer: 'confirmed',
      corrected: true,
      range: correctedRange,
      lookback: '1h',
      zone: NY,
    });
    expect(window).not.toHaveProperty('quote');
    const rules = rulesOf(tool);
    if (rules === undefined || isRefused(rules))
      throw new Error('Synthetic tool rules must be valid');
    const facts = periodFactsOf(rules.period);
    const converted = convertForTool(windowToConvert(window), periodFormsOf(rules.period), facts, {
      now: NOW,
      zone: window.zone,
      granularityMs: granularityMsOf(facts),
    });
    expect(converted).not.toHaveProperty('refused');
    if ('refused' in converted) throw new Error('Synthetic corrected window must be convertible');
    expect(converted.conversion.values).toEqual(expectedBounds);
    const served = line();
    expect(served).toBeDefined();
    expect(served).toContain('The corrected window');
    expect(served).toContain(NY);
    expect(served).toContain('confirmed');
    expect(served).toContain(
      `activity start_time ${expectedBounds.start_time}, end_time ${expectedBounds.end_time}`,
    );
    expect(served).not.toContain(ORIGINAL_QUOTE);
    expect(served).not.toContain('last 1 hour'); // No new quote fabricated from the duration.
    expect(served).not.toContain('not settled');
  });

  it('keeps the original quoted confirmed-window line byte-for-byte', () => {
    const old = readerWindowsOf([clock, reading, original]);
    expect(timeWindowsLine([schema], new Map([['activity', tool]]), old)).toBe(
      "The person's time words, as the library holds them: “last 2 hours” is " +
        '2026-10-09 06:40–08:40 America/Los_Angeles (UTC-07:00), ' +
        'the window the person confirmed when asked what their words meant — ' +
        `activity start_time ${Date.parse(originalRange.from)}, end_time ${Date.parse(NOW)}. ` +
        'A call may pass these values as written; an answer built on them states that window.',
    );
  });

  it('keeps hidden argument descriptors hidden without probing an invented call context', () => {
    let mapperCalls = 0;
    const hidden = {
      ...tool,
      [SHOWN_ARGS]: (args: Readonly<Record<string, unknown>>) => {
        mapperCalls++;
        return { ...args, start_time: 'REDACTED', end_time: 'REDACTED' };
      },
    };
    const served = line(hidden);
    expect(served).toBeDefined();
    expect(served).toContain("activity start_time (hidden by the tool's view)");
    expect(served).toContain("end_time (hidden by the tool's view)");
    expect(served).not.toContain(String(expectedBounds.start_time));
    expect(served).not.toContain(String(expectedBounds.end_time));
    expect(served).not.toContain(ORIGINAL_QUOTE);
    expect(served).toContain(NY);
    expect(mapperCalls).toBe(0);
  });
});
