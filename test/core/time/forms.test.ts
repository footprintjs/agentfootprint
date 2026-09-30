/**
 * `core/time/forms.ts` · `timeFormsOf` — the one owner of which spellings of
 * a time are the person's (`said`) and which the library derived from a
 * reading (`derived`) (time design § 9.5, step T7).
 *
 * Test types:
 *   unit        — the field window: "8 AM" at grain hour → `8:00`/`08:00` said; the end-of-grain
 *                 `08:41`, `-07:00`, `PDT` for a said `PST`, UTC and epoch spellings → derived; an
 *                 implied year → derived; a `model` reading → nothing said; a window the person
 *                 typed or set in a UI → every part said; the two lists never share a spelling;
 *   property    — the text rule equals the retired gate table (`normalize.ts` ·
 *                 `dateAndClockForms`, kept below as the oracle) over seeded time-like texts;
 *   boundary    — a DST end (`01:30` twice) spells each instant in its own offset; a record the
 *                 resolver cannot read names no part as said;
 *   integration — `stages/route.ts` · `timeLineageOf` over a ledger: the turn's confirmed window,
 *                 the values the library filled from it and the served time line are derived, and
 *                 `answeredValuesOf` no longer exempts a window's converted values;
 *   security    — a `time-derived` row the library would never file is refused at the checkpoint
 *                 door (`rows.ts` · `timeRowIsWellFormed`);
 *   byte identity — a ledger with no `time-answer` row: `answeredValuesOf` reads what it always did.
 *                 (Functional through real agents: lineage-run.test.ts.)
 */

import { describe, expect, it } from 'vitest';

import { timeFormsOf, turnFormsWindowsOf, type FormsWindow } from '../../../src/core/time/forms.js';
import { timeDerivedRow, timeRowIsWellFormed } from '../../../src/core/time/rows.js';
import { normalizeToken, tokenize } from '../../../src/core/agent/evidence/normalize.js';
import { answeredValuesOf } from '../../../src/core/agent/stages/route.js';
import { timeLineageOf } from '../../../src/core/agent/stages/timeLineage.js';
import { assessAnswer } from '../../../src/core/agent/assessment/assess.js';

const LA = 'America/Los_Angeles';

/** "8 AM to 8:40 AM" on 10/09/26 in Los Angeles, confirmed: minute grain, read to the end of it. */
const FIELD: FormsWindow = {
  source: 'answered',
  answer: 'confirmed',
  range: { from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T08:41:00-07:00' },
  zone: LA,
  reading: {
    said: ['year', 'month', 'day', 'hour', 'minute', 'meridiem', 'zone'],
    grain: 'minute',
    notes: [{ kind: 'end-of-grain' }],
  },
};

describe('one recorded window — said at grain, the rest derived', () => {
  it('the person’s parts at grain are said; the library’s spellings are derived', () => {
    const { said, derived } = timeFormsOf({ window: FIELD });
    expect(said).toEqual([
      '2026',
      '10',
      '9',
      '2026-10-09',
      '8:00',
      '08:00',
      '8:00am',
      '8:40',
      '08:40',
      '8:40am',
    ]);
    for (const form of [
      '08:41', // the end of the said minute
      '-07:00', // the offset
      'PDT', // the abbreviation in effect — the person said PST
      'America/Los_Angeles',
      '15:00', // UTC
      '15:00Z',
      '2026-10-09T15:00:00Z',
      '2026-10-09T08:00:00-07:00',
      '1791558000000', // epoch ms, what an epoch tool ran with
      '1791558000',
    ]) {
      expect(derived, form).toContain(form);
    }
    expect(derived.filter((f) => said.includes(f))).toEqual([]);
  });

  it('an implied year is derived, never said', () => {
    const { said, derived } = timeFormsOf({
      window: {
        ...FIELD,
        reading: { ...FIELD.reading!, said: ['month', 'day', 'hour', 'minute'] },
      },
    });
    expect(said).not.toContain('2026');
    expect(said).not.toContain('2026-10-09');
    expect(derived).toEqual(expect.arrayContaining(['2026', '2026-10-09']));
  });

  it('a time said without a meridiem keeps only its 12-hour spellings past noon', () => {
    const pm: FormsWindow = {
      ...FIELD,
      range: { from: '2026-10-09T20:40:00-07:00', to: '2026-10-09T20:41:00-07:00' },
      reading: { said: ['hour', 'minute'], grain: 'minute', notes: [{ kind: 'end-of-grain' }] },
    };
    const { said, derived } = timeFormsOf({ window: pm });
    expect(said).toEqual(['8:40', '08:40']);
    expect(derived).toEqual(expect.arrayContaining(['20:40', '8:40pm']));
  });

  it('a `model` reading names nothing as said — every spelling is the library’s', () => {
    const { said, derived } = timeFormsOf({
      window: { ...FIELD, source: 'derived-from-reading', answer: undefined },
    });
    expect(said).toEqual([]);
    expect(derived).toEqual(expect.arrayContaining(['8:00', '08:40', '2026-10-09', '08:41']));
  });

  it('a confirmed window whose reading cannot be named says nothing', () => {
    const { said } = timeFormsOf({ window: { ...FIELD, reading: undefined } });
    expect(said).toEqual([]);
  });

  it('a window the person typed, or set in a UI, is theirs in every part — its end as entered', () => {
    for (const window of [
      { ...FIELD, answer: 'edited' as const, reading: undefined },
      { ...FIELD, source: 'control' as const, answer: undefined, reading: undefined },
    ]) {
      const { said, derived } = timeFormsOf({ window });
      expect(said).toEqual(expect.arrayContaining(['2026-10-09', '08:00', '08:41']));
      expect(derived).toEqual(expect.arrayContaining(['-07:00', '2026-10-09T15:00:00Z']));
    }
  });

  it('BOUNDARY: a whole day read from words is said as that day, never the next', () => {
    const { said, derived } = timeFormsOf({
      window: {
        source: 'answered',
        answer: 'confirmed',
        range: { from: '2026-09-26T00:00:00-07:00', to: '2026-09-27T00:00:00-07:00' },
        zone: LA,
        reading: {
          said: ['year', 'month', 'day'],
          grain: 'day',
          notes: [{ kind: 'end-of-grain' }],
        },
      },
    });
    expect(said).toEqual(['2026', '9', '26', '2026-09-26']);
    expect(said).not.toContain('27');
    expect(derived).toContain('2026-09-27');
  });

  it('a look-back’s duration is the library’s spelling', () => {
    const { derived } = timeFormsOf({
      window: {
        source: 'answered',
        answer: 'confirmed',
        range: { from: '2026-10-09T13:40:00Z', to: '2026-10-09T15:40:00Z' },
        zone: LA,
        lookback: '2h',
      },
    });
    expect(derived).toContain('2h');
  });

  it('BOUNDARY: across a DST end, each instant is spelled in its own offset', () => {
    const { derived } = timeFormsOf({
      window: {
        source: 'control',
        range: { from: '2026-11-01T01:30:00-07:00', to: '2026-11-01T01:30:00-08:00' },
        zone: LA,
      },
    });
    expect(derived).toEqual(
      expect.arrayContaining(['2026-11-01T01:30:00-07:00', '2026-11-01T01:30:00-08:00']),
    );
  });
});

// ─── The text rule: the retired gate table as the oracle ────────────────

/** `evidence/normalize.ts` · `dateAndClockForms` as it shipped before T7 — kept only as the oracle. */
function retiredTable(text: string): readonly string[] {
  const ISO_DATE = /(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d])/g;
  const TWELVE_HOUR = /(?<![\d:.])(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m(?![a-z])/gi;
  const clock = (h24: number, minutes: string): string[] => {
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const suffix = h24 < 12 ? 'am' : 'pm';
    return [
      `${h24}:${minutes}`,
      `${String(h24).padStart(2, '0')}:${minutes}`,
      `${h12}:${minutes}`,
      `${h12}:${minutes}${suffix}`,
    ];
  };
  const out: string[] = [];
  const push = (f: string): void => {
    if (!out.includes(f)) out.push(f);
  };
  for (const [, year = '', mm, dd] of text.matchAll(ISO_DATE)) {
    const month = Number(mm);
    const day = Number(dd);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    push(year);
    push(String(month));
    push(String(day));
  }
  for (const [, hh, mm, half = ''] of text.matchAll(TWELVE_HOUR)) {
    const hour = Number(hh);
    const minutes = mm ?? '00';
    if (hour < 1 || hour > 12 || Number(minutes) > 59) continue;
    const h24 = (hour % 12) + (half.toLowerCase() === 'p' ? 12 : 0);
    clock(h24, minutes).forEach(push);
  }
  for (const token of tokenize(text.replace(TWELVE_HOUR, ' '))) {
    const [, hh, minutes = ''] = /^(\d{1,2}):(\d{2})$/.exec(token) ?? [];
    if (hh === undefined) continue;
    const h24 = Number(hh);
    if (h24 > 23 || Number(minutes) > 59) continue;
    clock(h24, minutes).forEach(push);
  }
  return out;
}

/** A seeded PRNG (mulberry32) — the same texts every run. */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  '8',
  '08',
  '20',
  '23',
  '24',
  '12',
  ':',
  ':00',
  ':40',
  ':7',
  ' ',
  ' ',
  'am',
  'AM',
  'p.m.',
  'pm',
  'Pm',
  '2026-10-09',
  '2026-13-01',
  'T',
  '-',
  '/',
  ',',
  '.',
  '(',
  ')',
  '"',
  '`',
  '$',
  '#',
  '+',
  'at',
  'to',
  'x',
  '9',
  '41,200',
  'fc1/3',
  '!',
  '?',
  ';',
  '%',
  '\n',
];

describe('the text rule — the retired table’s job, moved', () => {
  it('PROPERTY: equals the retired gate table over 3 000 seeded time-like texts', () => {
    const next = prng(20261009);
    for (let i = 0; i < 3000; i++) {
      const n = 1 + Math.floor(next() * 12);
      let text = '';
      for (let k = 0; k < n; k++) text += PIECES[Math.floor(next() * PIECES.length)];
      expect(timeFormsOf({ text }).said, JSON.stringify(text)).toEqual(retiredTable(text));
      expect(timeFormsOf({ text }).derived).toEqual([]);
    }
  });

  it('every spelling is already in the form the gate compares', () => {
    const { said } = timeFormsOf({ text: 'what connected 8 Am to 8:40 AM PST on 2026-10-09' });
    expect(said.map(normalizeToken)).toEqual(said);
  });
});

// ─── The gate's reader over a ledger ─────────────────────────────────────

const NOW = '2026-10-09T15:40:00Z';
const reader = {
  id: 'agentfootprint/english',
  version: '1.0.0',
  kind: 'rule' as const,
  locale: 'en-US',
};
const QUOTE = '10/09/26 8 AM to 8:40 AM PST';
const PARTS = {
  rangeOf: [
    {
      date: { kind: 'numeric', fields: [10, 9, 26], yearDigits: 2 },
      wall: { h: 8, meridiem: 'am' },
    },
    { wall: { h: 8, m: 40, meridiem: 'am' } },
  ],
  zoneToken: 'PST',
};

/** The field run's ledger after the zone answer and the confirmation (the rows `english-run` files). */
const LEDGER = [
  {
    kind: 'clock',
    turn: 1,
    iteration: 1,
    now: NOW,
    nowSource: 'app',
    zone: LA,
    zoneSource: 'builder',
  },
  {
    kind: 'time-reading',
    turn: 1,
    iteration: 1,
    reader,
    tzdata: 'unknown',
    mentions: 1,
    mention: 0,
    quote: QUOTE,
    parses: [PARTS],
    candidates: [],
    choice: { by: 'open', remaining: [], open: ['zone'] },
  },
  ...['start_time', 'end_time'].map((argument, i) => ({
    kind: 'argument',
    turn: 1,
    iteration: 1,
    toolCallId: 'c1',
    toolName: 'client_activity',
    argument,
    rule: 'ask',
    period: true,
    source: 'answered',
    value: i === 0 ? '1791558000000' : '1791560460000',
  })),
  {
    kind: 'argument',
    turn: 1,
    iteration: 1,
    toolCallId: 'c1',
    toolName: 'client_activity',
    argument: 'host',
    rule: 'ask',
    source: 'answered',
    value: 'node-11',
  },
  {
    kind: 'time-answer',
    turn: 1,
    iteration: 1,
    mention: 0,
    from: '2026-10-09T08:00:00-07:00',
    to: '2026-10-09T08:41:00-07:00',
    zone: LA,
    how: 'confirmed',
  },
];

const scopeOf = (ledger: readonly unknown[], timeLine?: string) =>
  ({
    findingsLedger: ledger,
    turnNumber: 1,
    ...(timeLine !== undefined && { timeLine: { iteration: 2, text: timeLine } }),
  } as never);

describe('the turn’s lineage off the ledger — `timeLineageOf`', () => {
  it('the confirmed window’s written parts are said — re-resolved from the recorded parses', () => {
    const [window] = turnFormsWindowsOf(LEDGER);
    expect(window).toMatchObject({ source: 'answered', answer: 'confirmed', zone: LA });
    expect(window!.reading?.said).toEqual(expect.arrayContaining(['year', 'month', 'day', 'hour']));
    const { said } = timeLineageOf(scopeOf(LEDGER));
    expect(said).toEqual(expect.arrayContaining(['8:00', '08:40', '2026-10-09']));
    expect(said).not.toContain('08:41');
  });

  it('the values filed from the window and the served time line are derived — the echo is never the person’s', () => {
    const line = 'Time words in the person’s message: “10/09/26 …” → start_time 1791558000000.';
    const { derived } = timeLineageOf(scopeOf(LEDGER, line));
    expect(derived).toEqual(expect.arrayContaining(['1791558000000', '1791560460000', line]));
    // …and the exempt half no longer holds them; the person's own typed value stays.
    expect(answeredValuesOf(scopeOf(LEDGER))).toEqual(['node-11']);
  });

  it('BYTE IDENTITY: with no `time-answer` row, the answered values are what they always were', () => {
    const without = LEDGER.filter((r) => r.kind !== 'time-answer');
    expect(answeredValuesOf(scopeOf(without))).toEqual([
      '1791558000000',
      '1791560460000',
      'node-11',
    ]);
    expect(timeLineageOf(scopeOf([]))).toEqual({ said: [], derived: [] });
  });

  it('a `model` reader’s row names no written part', () => {
    const ledger = LEDGER.map((r) =>
      r.kind === 'time-reading' ? { ...r, reader: { ...reader, kind: 'model' } } : r,
    );
    expect(turnFormsWindowsOf(ledger)[0]!.reading).toBeUndefined();
  });
});

// ─── The row and the fold ───────────────────────────────────────────────

describe('the `time-derived` row', () => {
  const row = timeDerivedRow(['08:41', '-07:00'], { turn: 1, iteration: 2 });

  it('is what the checkpoint door accepts — and nothing the library would not file', () => {
    expect(row).toEqual({
      kind: 'time-derived',
      turn: 1,
      iteration: 2,
      values: ['08:41', '-07:00'],
    });
    expect(timeRowIsWellFormed(row as never)).toBe(true);
    for (const bad of [
      { ...row, values: [] },
      { ...row, values: [''] },
      { ...row, values: ['x'.repeat(65)] },
      { ...row, values: Array.from({ length: 13 }, (_, i) => String(i)) },
      { ...row, extra: true },
      { ...row, turn: -1 },
    ]) {
      expect(timeRowIsWellFormed(bad as never), JSON.stringify(bad)).toBe(false);
    }
    expect(
      timeDerivedRow(
        Array.from({ length: 20 }, (_, i) => `v${i}`),
        { turn: 1, iteration: 1 },
      ).values,
    ).toHaveLength(12);
  });

  it('fires `derived-from-reading` — "not sure" — for this turn’s row only', () => {
    const fold = (ledger: readonly unknown[], turnNumber: number) =>
      assessAnswer({ snapshot: { sharedState: { findingsLedger: ledger, turnNumber } } });
    const now = fold([row], 1);
    expect(now.standing).toBe('not-sure');
    expect(now.reasons.map((r) => r.reason)).toEqual(['derived-from-reading']);
    expect(now.reasons[0]!.witness).toEqual([
      { kind: 'state', key: 'findingsLedger', path: '/0/values' },
    ]);
    expect(fold([row], 2).reasons).toEqual([]);
  });
});
