/**
 * core/time/ask — the one judge of a time field's answer, the catalog's
 * reasons, and the choices a reading offers (the time design § 6, step T4).
 * End to end through real agents: ask-run.test.ts; over MCP:
 * test/lib/mcp/elicitation.test.ts.
 *
 * Test types:
 *   unit        — each refusal code on its own example (shape, no offset, not a range, out of
 *                 order, a DST gap under a known zone, not a zone); a gap wall time written in
 *                 another offset is that instant and taken; `refusalReason` fills the catalog and
 *                 joins; overrides are read or refused by name; `timeAskOf` — `10/09/26` under
 *                 `dateOrder: 'ask'` → three labelled choices, a fall-back overlap → both instants,
 *                 a zone abbreviation → a `format: 'zone'` field, a `model` reading → ONE choice
 *                 labelled as the library's reading to confirm, a settled reading → nothing;
 *   functional  — the labels render in the reader's locale with the end the person said
 *                 (`to 8:40` shows 8:40, not 8:41); every choice the ask offers passes the judge;
 *   property    — 20 000 generated instant-shaped strings: `checkTimeAnswer('instant', v)` takes
 *                 exactly what the strict profile reads (the one grammar, no second parser), and a
 *                 range is taken exactly when both ends are and `from` is before `to`;
 *   security    — a hostile answer (1 MB, control characters, `{{value}}` inside the answer) is
 *                 refused, quoted at most 64 characters, and never re-expanded as a placeholder;
 *   performance — 20 000 judgements inside a budget;
 *   integration — not applicable here (ask-run.test.ts); load — not applicable: pure functions.
 */

import { describe, expect, it } from 'vitest';

import {
  checkTimeAnswer,
  fillMessage,
  readTimeAskMessages,
  refusalReason,
  timeAskOf,
  TIME_ASK_MESSAGE_KEYS,
} from '../../../src/core/time/ask.js';
import { instantOf } from '../../../src/core/time/instant.js';
import { presentRange } from '../../../src/core/time/present.js';
import { checkReading, readerIssue, type TimeParts } from '../../../src/core/time/reader.js';
import { DEFAULT_TIME_POLICY, type TimePolicy } from '../../../src/core/time/resolve.js';
import { timeReadingRows, type TimeReadingRow } from '../../../src/core/time/rows.js';
import { defaultTimeAskMessages } from '../../../src/locales/timeAsk.js';
import { instantish, prng } from './fixtures/generate.js';

const LA = 'America/Los_Angeles';
const CLOCK = {
  now: '2026-10-09T15:40:00Z',
  nowSource: 'app' as const,
  zone: LA,
  zoneSource: 'run' as const,
};
/** Collapse ICU's narrow and thin spaces so a label compares across runtimes. */
const plain = (s: string): string => s.replace(/[\u202f\u2009\u00a0]/g, ' ');

function rowFor(
  text: string,
  quote: string,
  parts: TimeParts,
  options: {
    kind?: 'rule' | 'model';
    policy?: TimePolicy;
    locale?: string;
    clock?: typeof CLOCK;
  } = {},
): TimeReadingRow {
  const mentions = checkReading(text, { mentions: [{ quote, parses: [parts] }] }, 'fixture');
  const [row] = timeReadingRows({
    mentions,
    clock: options.clock ?? CLOCK,
    policy: options.policy ?? DEFAULT_TIME_POLICY,
    reader: {
      id: 'fixture',
      version: '1.0.0',
      kind: options.kind ?? 'rule',
      locale: options.locale ?? 'en-US',
    },
    tzdata: 'test',
    at: { turn: 1, iteration: 0 },
  });
  return row as TimeReadingRow;
}

// ─── The judge ───────────────────────────────────────────────────────────

describe('checkTimeAnswer — unit', () => {
  it('takes an instant with its offset, strict profile', () => {
    expect(checkTimeAnswer('instant', '2026-10-09T08:00-07:00')).toBeUndefined();
    expect(checkTimeAnswer('instant', '2026-10-09T15:00:00.250Z')).toBeUndefined();
  });

  it('a date-time with no offset is refused as zone-less (`no-offset`)', () => {
    expect(checkTimeAnswer('instant', '2026-10-09T08:00')).toEqual({
      problem: 'no-offset',
      facts: { value: '2026-10-09T08:00' },
    });
    expect(checkTimeAnswer('instant', '2026-10-09 08:00:30')?.problem).toBe('no-offset');
  });

  it('anything else is not an instant — a date alone, prose, a lower-case t, a leap second', () => {
    for (const v of [
      '2026-10-09',
      'yesterday at 8',
      '2026-10-09t08:00Z',
      '2026-10-09T08:00:60Z',
      '2026-02-30T08:00Z',
    ])
      expect(checkTimeAnswer('instant', v)?.problem).toBe('not-an-instant');
  });

  it('a range: two instants joined by one slash, from before to', () => {
    expect(
      checkTimeAnswer('time-range', '2026-10-09T08:00-07:00/2026-10-09T08:41-07:00'),
    ).toBeUndefined();
    expect(checkTimeAnswer('time-range', '2026-10-09T08:00-07:00')?.problem).toBe('not-a-range');
    expect(
      checkTimeAnswer('time-range', '2026-10-09T08:00-07:00..2026-10-09T08:41-07:00')?.problem,
    ).toBe('not-a-range');
    expect(checkTimeAnswer('time-range', 'a/b/c')?.problem).toBe('not-a-range');
  });

  it('answers out of order are refused (`out-of-order`), naming both ends', () => {
    expect(checkTimeAnswer('time-range', '2026-10-09T08:41-07:00/2026-10-09T08:00-07:00')).toEqual({
      problem: 'out-of-order',
      facts: { from: '2026-10-09T08:41-07:00', to: '2026-10-09T08:00-07:00' },
    });
    // Equal ends are an empty window, not a range.
    expect(checkTimeAnswer('time-range', '2026-10-09T15:00Z/2026-10-09T08:00-07:00')?.problem).toBe(
      'out-of-order',
    );
  });

  it('a zone-less end refuses the range as zone-less', () => {
    expect(checkTimeAnswer('time-range', '2026-10-09T08:00/2026-10-09T08:40-07:00')).toEqual({
      problem: 'no-offset',
      facts: { value: '2026-10-09T08:00' },
    });
  });

  it('a wall time the clocks skip, in the zone’s own offsets, is refused under a known zone', () => {
    // 2026-03-08: Los Angeles goes 02:00 PST → 03:00 PDT.
    for (const v of ['2026-03-08T02:30-08:00', '2026-03-08T02:30-07:00']) {
      expect(checkTimeAnswer('instant', v, LA)).toEqual({
        problem: 'dst-gap',
        facts: { value: v, wall: '2026-03-08 02:30', zone: LA },
      });
      expect(checkTimeAnswer('instant', v)).toBeUndefined(); // no zone known → shape only
    }
    expect(
      checkTimeAnswer('time-range', '2026-03-08T01:30-08:00/2026-03-08T02:30-08:00', LA)?.problem,
    ).toBe('dst-gap');
  });

  it('the same wall time written in another offset is that instant — taken', () => {
    expect(checkTimeAnswer('instant', '2026-03-08T02:30-05:00', LA)).toBeUndefined();
    expect(checkTimeAnswer('instant', '2026-03-08T03:30-07:00', LA)).toBeUndefined();
    expect(checkTimeAnswer('instant', '2026-03-08T02:30-08:00', 'not a zone')).toBeUndefined();
  });

  it('a zone is an IANA name — an abbreviation or a bare offset is refused', () => {
    expect(checkTimeAnswer('zone', 'America/Los_Angeles')).toBeUndefined();
    expect(checkTimeAnswer('zone', 'UTC')).toBeUndefined();
    for (const v of ['PST', '-07:00', 'Mars/Olympus_Mons'])
      expect(checkTimeAnswer('zone', v)).toEqual({ problem: 'not-a-zone', facts: { value: v } });
  });
});

describe('the catalog — unit', () => {
  it('has one sentence per key, and one answer key per refusal code', () => {
    expect(Object.keys(defaultTimeAskMessages).sort()).toEqual([...TIME_ASK_MESSAGE_KEYS].sort());
    for (const sentence of Object.values(defaultTimeAskMessages))
      expect(sentence.trim().length).toBeGreaterThan(0);
  });

  it('refusalReason fills the sentence and joins one per refused field', () => {
    const zone = checkTimeAnswer('zone', 'PST')!;
    expect(refusalReason([zone], defaultTimeAskMessages)).toBe(
      '“PST” is not a time zone name. Name one such as America/Los_Angeles.',
    );
    const order = checkTimeAnswer('time-range', '2026-10-09T09:00Z/2026-10-09T08:00Z')!;
    expect(refusalReason([zone, order], defaultTimeAskMessages)).toBe(
      '“PST” is not a time zone name. Name one such as America/Los_Angeles. ' +
        'The start 2026-10-09T09:00Z is not before the end 2026-10-09T08:00Z.',
    );
  });

  it('an app override wins for its key; the rest keep the default', () => {
    const read = readTimeAskMessages({ 'answer.not-a-zone': '«{{value}}» n’est pas un fuseau.' });
    expect('value' in read).toBe(true);
    const messages = { ...defaultTimeAskMessages, ...(read as { value: object }).value };
    expect(refusalReason([checkTimeAnswer('zone', 'PST')!], messages)).toBe(
      '«PST» n’est pas un fuseau.',
    );
  });

  it('overrides are refused by name: an unknown key, a blank sentence, not an object', () => {
    expect(readTimeAskMessages({ 'answer.nope': 'x' })).toMatchObject({
      problem: expect.stringContaining("no key 'answer.nope'"),
    });
    expect(readTimeAskMessages({ 'ask.which': '  ' })).toMatchObject({
      problem: expect.stringContaining("messages['ask.which']"),
    });
    expect(readTimeAskMessages('words')).toHaveProperty('problem');
    expect(readTimeAskMessages(['x'])).toHaveProperty('problem');
  });

  it('fillMessage leaves a placeholder with no fact as written', () => {
    expect(fillMessage('{{a}} and {{b}}', { a: '1' })).toBe('1 and {{b}}');
  });
});

// ─── The choices a reading offers ─────────────────────────────────────────

describe('timeAskOf — unit', () => {
  const text = 'errors 10/09/26 8 AM to 8:40 AM';
  const range: TimeParts = {
    rangeOf: [
      { date: { kind: 'numeric', fields: [10, 9, 26] }, wall: { h: 8, meridiem: 'am' } },
      { wall: { h: 8, m: 40, meridiem: 'am' } },
    ],
  };

  it('`10/09/26` under dateOrder: ask → the readings as labelled choices', () => {
    const ask = timeAskOf(rowFor(text, '10/09/26 8 AM to 8:40 AM', range), defaultTimeAskMessages);
    expect(ask?.question).toBe('Which time did you mean by “10/09/26 8 AM to 8:40 AM”?');
    expect(ask?.field).toMatchObject({
      id: 'time',
      type: 'string',
      required: true,
      format: 'time-range',
    });
    expect(ask?.field.enum).toEqual([
      '2026-10-09T08:00:00-07:00/2026-10-09T08:41:00-07:00', // MDY
      '2026-09-10T08:00:00-07:00/2026-09-10T08:41:00-07:00', // DMY
      '2010-09-26T08:00:00-07:00/2010-09-26T08:41:00-07:00', // YMD
    ]);
    expect(ask?.field.labels?.map(plain)).toEqual([
      'Fri, Oct 9, 2026, 8:00 – 8:40 AM PDT',
      'Thu, Sep 10, 2026, 8:00 – 8:40 AM PDT',
      'Sun, Sep 26, 2010, 8:00 – 8:40 AM PDT',
    ]);
  });

  it('a label is rendered in the reader’s locale — the end the person said, never 8:41', () => {
    const ask = timeAskOf(
      rowFor(text, '10/09/26 8 AM to 8:40 AM', range, { locale: 'en-GB' }),
      defaultTimeAskMessages,
    );
    expect(plain(ask?.field.labels?.[0] ?? '')).toBe('Fri, 9 Oct 2026, 08:00–08:40 GMT-7');
  });

  it('a settled reading asks nothing (`only`, `policy`)', () => {
    expect(
      timeAskOf(
        rowFor(text, '10/09/26 8 AM to 8:40 AM', range, {
          policy: { dateOrder: 'MDY', year: 'ask' },
        }),
        defaultTimeAskMessages,
      ),
    ).toBeUndefined();
    expect(
      timeAskOf(
        rowFor('on 2026-10-09', '2026-10-09', {
          date: { kind: 'fixed', year: 2026, month: 10, day: 9 },
        }),
        defaultTimeAskMessages,
      ),
    ).toBeUndefined();
  });

  it('a point time is not a window: its one reading is offered to confirm (`rows.ts` · `confirmNeededOf`)', () => {
    const row = rowFor('at 2026-10-09 20:40', '2026-10-09 20:40', {
      date: { kind: 'fixed', year: 2026, month: 10, day: 9 },
      wall: { h: 20, m: 40 },
    });
    expect(row.confirmNeeded).toEqual({ point: true });
    const ask = timeAskOf(row, defaultTimeAskMessages);
    expect(ask?.question).toBe('Is this the time you meant by “2026-10-09 20:40”?');
    expect(ask?.field.enum).toEqual(['2026-10-09T20:40:00-07:00/2026-10-09T20:41:00-07:00']);
    expect(plain(ask?.field.labels?.[0] ?? '')).toBe(
      'I read “2026-10-09 20:40” as Fri, Oct 9, 2026, 8:40 PM PDT in America/Los_Angeles — is that right?',
    );
  });

  it('a wall time the clocks go back through → both instants as choices', () => {
    const ask = timeAskOf(
      rowFor('at 2026-11-01 01:30', '2026-11-01 01:30', {
        date: { kind: 'fixed', year: 2026, month: 11, day: 1 },
        wall: { h: 1, m: 30, meridiem: 'am' },
      }),
      defaultTimeAskMessages,
    );
    expect(ask?.field.enum).toEqual([
      '2026-11-01T01:30:00-07:00/2026-11-01T01:31:00-07:00',
      '2026-11-01T01:30:00-08:00/2026-11-01T01:31:00-08:00',
    ]);
    // A point time: each instant is offered to confirm, with its zone — never as the person's window.
    expect(ask?.field.labels?.map(plain)).toEqual([
      'I read “2026-11-01 01:30” as Sun, Nov 1, 2026, 1:30 AM PDT in America/Los_Angeles — is that right?',
      'I read “2026-11-01 01:30” as Sun, Nov 1, 2026, 1:30 AM PST in America/Los_Angeles — is that right?',
    ]);
  });

  it('a zone abbreviation → the zone is asked, `format: zone`', () => {
    const ask = timeAskOf(
      rowFor('at 8 AM PST', '8 AM PST', { wall: { h: 8, meridiem: 'am' }, zoneToken: 'PST' }),
      defaultTimeAskMessages,
      'zone',
    );
    expect(ask).toEqual({
      question: 'Which time zone did you mean by “PST” in “8 AM PST”?',
      field: { id: 'zone', type: 'string', required: true, format: 'zone' },
    });
  });

  it('a `model` reading is offered as the library’s reading, to confirm', () => {
    const ask = timeAskOf(
      rowFor(
        'what failed yesterday',
        'yesterday',
        { relative: { unit: 'day', offset: -1 } },
        { kind: 'model' },
      ),
      defaultTimeAskMessages,
    );
    expect(ask?.question).toBe('Is this the time you meant by “yesterday”?');
    expect(ask?.field.enum).toEqual(['2026-10-08T00:00:00-07:00/2026-10-09T00:00:00-07:00']);
    expect(ask?.field.labels?.map(plain)).toEqual([
      'I read “yesterday” as Thu, Oct 8, 2026, PDT in America/Los_Angeles — is that right?',
    ]);
  });

  it('a refused mention, a reading with no candidate and a `mentions: 0` row ask nothing', () => {
    const refused = timeReadingRows({
      mentions: checkReading(
        'hello',
        { mentions: [{ quote: 'yesterday', parses: [{}] }] },
        'fixture',
      ),
      clock: CLOCK,
      policy: DEFAULT_TIME_POLICY,
      reader: { id: 'fixture', version: '1', kind: 'rule', locale: 'en-US' },
      tzdata: 'test',
      at: { turn: 1, iteration: 0 },
    })[0]!;
    expect(timeAskOf(refused, defaultTimeAskMessages)).toBeUndefined();
    const none = timeReadingRows({
      mentions: [],
      clock: CLOCK,
      policy: DEFAULT_TIME_POLICY,
      reader: { id: 'fixture', version: '1', kind: 'rule', locale: 'en-US' },
      tzdata: 'test',
      at: { turn: 1, iteration: 0 },
    })[0]!;
    expect(timeAskOf(none, defaultTimeAskMessages)).toBeUndefined();
  });

  it('every choice the ask offers passes the judge under the clock’s zone — functional', () => {
    const rows = [
      rowFor(text, '10/09/26 8 AM to 8:40 AM', range),
      rowFor('at 2026-11-01 01:30', '2026-11-01 01:30', {
        date: { kind: 'fixed', year: 2026, month: 11, day: 1 },
        wall: { h: 1, m: 30 },
      }),
      rowFor('at 2026-03-08 02:30', '2026-03-08 02:30', {
        date: { kind: 'fixed', year: 2026, month: 3, day: 8 },
        wall: { h: 2, m: 30 },
      }),
    ];
    for (const row of rows) {
      const ask = timeAskOf(row, defaultTimeAskMessages)!;
      expect(ask.field.enum?.length).toBeGreaterThan(0);
      for (const value of ask.field.enum ?? [])
        expect(checkTimeAnswer('time-range', value, LA)).toBeUndefined();
    }
  });
});

describe('the reader’s locale — functional', () => {
  it('a reader whose locale Intl cannot read is refused at the builder', () => {
    const reader = { id: 'r', version: '1', kind: 'rule', read: () => ({ mentions: [] }) };
    expect(readerIssue({ ...reader, locale: 'en-US' })).toBeUndefined();
    expect(readerIssue({ ...reader, locale: 'not a tag!' })).toMatch(/language tag/);
  });

  it('without a locale the presentation stays locale-neutral (T3 byte-identical)', () => {
    expect(
      presentRange(
        { from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T08:41:00-07:00' },
        { zone: LA },
        'minute',
      ),
    ).toBe('2026-10-09 08:00–08:40 America/Los_Angeles (UTC-07:00)');
  });
});

// ─── Property, security, performance ─────────────────────────────────────

describe('checkTimeAnswer — property', () => {
  it('an instant is taken exactly when the strict profile reads it (one grammar)', () => {
    const r = prng(0x7a4);
    for (let i = 0; i < 20_000; i++) {
      const v = instantish(r);
      expect(checkTimeAnswer('instant', v) === undefined, v).toBe(
        instantOf(v, 'strict') !== undefined,
      );
    }
  });

  it('a range is taken exactly when both ends are and from is before to', () => {
    const r = prng(0x7a5);
    for (let i = 0; i < 5_000; i++) {
      const a = instantish(r);
      const b = instantish(r);
      const ia = instantOf(a, 'strict');
      const ib = instantOf(b, 'strict');
      const expected =
        ia !== undefined &&
        ib !== undefined &&
        (ia.ms < ib.ms || (ia.ms === ib.ms && ia.nanos < ib.nanos));
      expect(checkTimeAnswer('time-range', `${a}/${b}`) === undefined, `${a}/${b}`).toBe(expected);
    }
  });
});

describe('checkTimeAnswer — security', () => {
  it('a hostile answer is refused, quoted at most 64 characters, never re-expanded', () => {
    const huge = `{{value}}${'x'.repeat(1_000_000)}`;
    const refusal = checkTimeAnswer('zone', huge)!;
    expect(refusal.facts.value?.length).toBe(64);
    const reason = refusalReason([refusal], defaultTimeAskMessages);
    expect(reason.startsWith('“{{value}}xxx')).toBe(true);
    expect(reason.length).toBeLessThan(200);
    expect(checkTimeAnswer('instant', '2026-10-09T08:00Z\n')?.problem).toBe('not-an-instant');
    expect(checkTimeAnswer('time-range', '\u0000/\u0000')?.problem).toBe('not-an-instant');
  });
});

describe('checkTimeAnswer — performance', () => {
  it('20 000 judgements inside a budget', () => {
    const values = [
      '2026-10-09T08:00-07:00/2026-10-09T08:41-07:00',
      '2026-03-08T02:30-08:00',
      'America/Los_Angeles',
      '2026-10-09T08:00',
    ];
    const start = performance.now();
    for (let i = 0; i < 20_000; i++) {
      const v = values[i % values.length] as string;
      checkTimeAnswer(v.includes('/') ? 'time-range' : v.includes('T') ? 'instant' : 'zone', v, LA);
    }
    expect(performance.now() - start).toBeLessThan(3_000);
  });
});
