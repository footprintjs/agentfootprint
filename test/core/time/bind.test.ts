/**
 * Which window a call carries (time design § 5.6, § 7.3, step T5a) —
 * `core/time/bind.ts` and the `call-window` row it implies (`rows.ts`).
 *
 * Law: fill only when the turn has exactly one window and the model left the
 * period out; a present window is never written over — bound by quote or by
 * value, or recorded `model-chosen` and run as sent.
 *
 * Test types:
 *   unit     — the turn's windows from recorded rows (a `rule` reading is a PROPOSAL and fills
 *              nothing until the person answers it — then it is `answered`, a look-back kept a
 *              look-back; a `model` reading waiting only for confirmation is
 *              `derived-from-reading`; an open or refused mention fills nothing; the `control`
 *              window counts as a mention); every decision;
 *   security — a forged `call-window` row is refused at the checkpoint door (one test per field law);
 *   boundary — a partial period (one bound of two) is `unread`, never filled over.
 */

import { describe, expect, it } from 'vitest';

import { callWindowOf, turnWindowsOf, type TurnWindows } from '../../../src/core/time/bind.js';
import { sugarForms, type PeriodForm } from '../../../src/core/time/convert.js';
import {
  timeRowIsWellFormed,
  type ClockRow,
  type TimeAnswerRow,
  type TimeReadingRow,
} from '../../../src/core/time/rows.js';
import { callWindowRow } from '../../../src/core/time/rowsBuild.js';

const LA = 'America/Los_Angeles';
const NOW = '2026-10-09T15:40:00Z';
const CTX = { now: NOW, zone: LA, granularityMs: 60_000 };
const MORNING = { from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T08:41:00-07:00' };
const YESTERDAY = { from: '2026-10-08T08:00:00-07:00', to: '2026-10-08T08:41:00-07:00' };

const clock = (window?: { from: string; to: string }): ClockRow => ({
  kind: 'clock',
  turn: 1,
  iteration: 1,
  now: NOW,
  nowSource: 'app',
  zone: LA,
  zoneSource: 'run',
  ...(window !== undefined && { window: { ...window, source: 'control' as const } }),
});

function reading(
  mention: number,
  mentions: number,
  quote: string,
  range: { from: string; to: string },
  kind: 'rule' | 'model' = 'rule',
): TimeReadingRow {
  return {
    kind: 'time-reading',
    turn: 1,
    iteration: 1,
    reader: { id: `fixture/${kind}`, version: '1', kind, locale: 'en-US' },
    tzdata: 'unknown',
    mentions,
    mention,
    quote,
    parses: [],
    candidates: [
      {
        window: { kind: 'range', range },
        range,
        zone: LA,
        grain: 'minute',
        // Every reading is a proposal (the owner's decision "Always confirm"): nothing said.
        said: [],
        implied: [],
        anchor: 'message',
        reader: { id: `fixture/${kind}`, kind },
        notes: [],
        reading: {},
        parse: 0,
      },
    ],
    choice: { by: 'open', remaining: [0], open: ['confirm'] },
  };
}

/** The person's answer in the time ask for one mention — the only door a `rule` reading becomes a window. */
const answer = (
  mention: number,
  range: { from: string; to: string },
  how: 'confirmed' | 'edited' = 'confirmed',
): TimeAnswerRow => ({
  kind: 'time-answer',
  turn: 1,
  iteration: 1,
  mention,
  ...range,
  zone: LA,
  how,
});

/** The turn's windows once the person CONFIRMED the offer of every `rule` reading. */
const confirmed = (readings: readonly TimeReadingRow[], c: ClockRow) =>
  turnWindowsOf(
    readings,
    c,
    readings
      .filter((r) => r.reader.kind === 'rule' && r.choice?.by === 'open')
      .map((r) => answer(r.mention as number, r.candidates![0]!.range)),
  );

const EPOCH: PeriodForm[] = [
  {
    kind: 'bounds',
    from: { argument: 'start_time', as: 'epoch-ms' },
    to: { argument: 'end_time', as: 'epoch-ms', edge: 'exclusive' },
  },
];
const call = (args: Record<string, unknown>, quotes?: string[]) => ({
  args,
  forms: EPOCH,
  isMissing: (a: string) => args[a] === undefined,
  ...(quotes !== undefined && { quotes }),
});

describe("the turn's windows, read from the record", () => {
  it('a rule reading is a proposal until answered; a model reading waiting only for confirmation is derived; control counts', () => {
    const readings = [
      reading(0, 2, 'this morning', MORNING),
      reading(1, 2, 'yesterday morning', YESTERDAY, 'model'),
    ];
    const control = clock({ from: '2026-10-09T01:00:00Z', to: '2026-10-09T02:00:00Z' });
    // Not answered: the rule reading fills nothing — it is OPEN, its offer riding along.
    const unanswered = turnWindowsOf(readings, control);
    expect(unanswered.mentions).toBe(3);
    expect(unanswered.windows.map((w) => [w.source, w.mention, w.quote])).toEqual([
      ['derived-from-reading', 1, 'yesterday morning'],
      ['control', undefined, undefined],
    ]);
    expect(unanswered.open).toEqual([[MORNING]]);
    // Answered in the time ask: the person's window, with whether they confirmed or edited it.
    const turn = turnWindowsOf(readings, control, [answer(0, MORNING)]);
    expect(turn.mentions).toBe(3);
    expect(turn.windows.map((w) => [w.source, w.mention, w.quote, w.answer])).toEqual([
      ['answered', 0, 'this morning', 'confirmed'],
      ['derived-from-reading', 1, 'yesterday morning', undefined],
      ['control', undefined, undefined, undefined],
    ]);
    const edited = turnWindowsOf(readings, control, [answer(0, YESTERDAY, 'edited')]);
    expect(edited.windows[0]).toMatchObject({
      source: 'answered',
      range: YESTERDAY,
      answer: 'edited',
    });
    // An answer for another turn's mention is not this row's: the caller hands this turn's only.
    expect(turnWindowsOf(readings, control, [answer(1, MORNING)]).windows[0]).toMatchObject({
      source: 'answered',
      mention: 1,
    });
  });

  it('an open mention counts and fills nothing; a refused one and the `mentions: 0` row do not count', () => {
    const open: TimeReadingRow = {
      ...reading(0, 2, '10/09', MORNING),
      choice: { by: 'open', remaining: [0], open: ['date-order'] },
    };
    const refused: TimeReadingRow = {
      kind: 'time-reading',
      turn: 1,
      iteration: 1,
      reader: { id: 'fixture/rule', version: '1', kind: 'rule', locale: 'en-US' },
      tzdata: 'unknown',
      mentions: 2,
      mention: 1,
      refused: 'quote-not-in-text',
    };
    const turn = turnWindowsOf([open, refused], clock());
    // The open mention's readings ride along (step T6b): a tool's facts can already rule them out.
    expect(turn).toEqual({ windows: [], mentions: 1, open: [[MORNING]] });
    expect(callWindowOf(call({}), turn, CTX)).toEqual({ how: 'not-filled', why: 'open-reading' });
  });

  it('an open mention whose EVERY reading breaks the tool’s facts → refused, nothing asked (§ 6.3, T6b)', () => {
    const open: TimeReadingRow = {
      ...reading(0, 1, '10/09', MORNING),
      choice: { by: 'open', remaining: [0], open: ['date-order'] },
    };
    const turn = turnWindowsOf([open], clock());
    // MORNING ends at 08:41 PDT, after now (08:40): not wholly past — a `future` tool may read it.
    expect(callWindowOf({ ...call({}), facts: { direction: 'future' } }, turn, CTX)).toEqual({
      how: 'not-filled',
      why: 'open-reading',
    });
    expect(callWindowOf({ ...call({}), facts: { retention: '1h' } }, turn, CTX)).toEqual({
      how: 'not-filled',
      why: 'open-reading',
    });
    const past = turnWindowsOf(
      [
        {
          ...reading(0, 1, '10/08', YESTERDAY),
          choice: { by: 'open', remaining: [0], open: ['year'] },
        },
      ],
      clock(),
    );
    expect(callWindowOf({ ...call({}), facts: { direction: 'future' } }, past, CTX)).toEqual({
      how: 'refused',
      refused: 'time-past',
    });
  });
});

describe('one call', () => {
  const one = confirmed([reading(0, 1, '8 AM to 8:40', MORNING)], clock());
  const two = confirmed(
    [reading(0, 2, 'this morning', MORNING), reading(1, 2, 'yesterday morning', YESTERDAY)],
    clock(),
  );
  const none: TurnWindows = { windows: [], mentions: 0 };

  it('fills the one window the model left out, exactly, into the first form that holds it', () => {
    const decision = callWindowOf(call({}), one, CTX);
    expect(decision).toMatchObject({
      how: 'filled',
      window: { source: 'answered', mention: 0, answer: 'confirmed' },
      conversion: {
        form: 0,
        values: { start_time: Date.parse(MORNING.from), end_time: Date.parse(MORNING.to) },
      },
    });
  });

  it('fills nothing with no window or with two mentions; refuses a window no form holds', () => {
    expect(callWindowOf(call({}), none, CTX)).toEqual({ how: 'not-filled', why: 'no-window' });
    expect(callWindowOf(call({}), two, CTX)).toEqual({
      how: 'not-filled',
      why: 'several-mentions',
    });
    const lookbackOnly = {
      ...call({}),
      forms: [{ kind: 'lookback', argument: 'w', signed: false } as PeriodForm],
    };
    // A window still to come: no look-back reaches it, exactly or widened (step T5b widens a past
    // one). Refused with the reason — the tool's own rule never stands in for the person's window.
    const tomorrow = confirmed(
      [
        reading(0, 1, 'tomorrow 8 to 8:40', {
          from: '2026-10-10T08:00:00-07:00',
          to: '2026-10-10T08:41:00-07:00',
        }),
      ],
      clock(),
    );
    expect(callWindowOf(lookbackOnly, tomorrow, CTX)).toMatchObject({
      how: 'refused',
      refused: 'no-form-holds',
      asked: { from: '2026-10-10T08:00:00-07:00', to: '2026-10-10T08:41:00-07:00' },
      person: { source: 'answered', mention: 0 },
    });
  });

  it('binds a sent window by the quote the model declared, or by value', () => {
    const sent = { start_time: Date.parse(YESTERDAY.from), end_time: Date.parse(YESTERDAY.to) };
    expect(callWindowOf(call(sent, ['yesterday morning']), two, CTX)).toMatchObject({
      how: 'bound',
      by: 'quote',
      window: { mention: 1 },
    });
    expect(callWindowOf(call(sent), two, CTX)).toMatchObject({
      how: 'bound',
      by: 'value',
      window: { mention: 1 },
    });
  });

  it("records a window that differs from the person's, and runs it — a drill-down, a quote bound elsewhere", () => {
    const drill = {
      start_time: Date.parse('2026-10-09T16:00:00Z'),
      end_time: Date.parse('2026-10-09T17:00:00Z'),
    };
    expect(callWindowOf(call(drill), one, CTX)).toMatchObject({
      how: 'model-chosen',
      person: { mention: 0 },
    });
    // Two windows and no quote: the person's window is not named.
    expect(callWindowOf(call(drill), two, CTX)).toEqual({
      how: 'model-chosen',
      form: 0,
      asked: { from: '2026-10-09T16:00:00Z', to: '2026-10-09T17:00:00Z' },
    });
    // The quote names "this morning", the value is yesterday's.
    const sent = { start_time: Date.parse(YESTERDAY.from), end_time: Date.parse(YESTERDAY.to) };
    expect(callWindowOf(call(sent, ['this morning']), two, CTX)).toMatchObject({
      how: 'model-chosen',
      person: { mention: 0 },
    });
    expect(callWindowOf(call(drill), none, CTX)).toMatchObject({ how: 'model' });
  });

  it('a partial period is unread, never filled over', () => {
    expect(callWindowOf(call({ start_time: 1 }), one, CTX)).toEqual({ how: 'unread' });
  });

  it('a look-back window sent to a bounds form as `[now − L, now)` is still the person’s', () => {
    const lookback = confirmed(
      [
        {
          ...reading(0, 1, 'last 40 minutes', {
            from: '2026-10-09T15:00:00Z',
            to: '2026-10-09T15:40:00.001Z',
          }),
          candidates: [
            {
              ...reading(0, 1, 'x', MORNING).candidates![0]!,
              window: { kind: 'lookback', duration: '40m' },
              range: { from: '2026-10-09T15:00:00Z', to: '2026-10-09T15:40:00.001Z' },
            },
          ],
        },
      ],
      clock(),
    );
    const sent = {
      start_time: Date.parse('2026-10-09T15:00:00Z'),
      end_time: Date.parse('2026-10-09T15:40:00Z'),
    };
    expect(callWindowOf(call(sent), lookback, CTX)).toMatchObject({ how: 'bound', by: 'value' });
    expect(
      callWindowOf(
        { ...call({ w: '40m' }), forms: sugarForms({ argument: 'w', spelling: 'lookback' }) },
        lookback,
        CTX,
      ),
    ).toMatchObject({ how: 'bound', by: 'value' });
  });
});

describe('the time-answer row and the checkpoint door', () => {
  it('the person’s answer crosses the door; a forged one is refused', () => {
    const row = answer(0, MORNING);
    expect(timeRowIsWellFormed(row as never)).toBe(true);
    expect(timeRowIsWellFormed(answer(0, MORNING, 'edited') as never)).toBe(true);
    for (const forged of [
      { ...row, how: 'said' },
      { ...row, how: undefined },
      { ...row, zone: 'Not/AZone' },
      { ...row, mention: -1 },
      { ...row, mention: undefined },
      { ...row, from: 'yesterday' },
      { ...row, extra: 1 },
    ]) {
      expect(timeRowIsWellFormed(forged as never), JSON.stringify(forged)).toBe(false);
    }
  });
});

describe('the call-window row and the checkpoint door', () => {
  const at = { turn: 1, iteration: 1 };
  const who = { toolCallId: 'c1', toolName: 'client_activity' };
  const one = confirmed([reading(0, 1, '8 AM to 8:40', MORNING)], clock());

  it('files each decision as a well-formed row', () => {
    const rows = [
      callWindowRow(who, callWindowOf(call({}), one, CTX), at),
      callWindowRow(who, callWindowOf(call({ start_time: 0, end_time: 1000 }), one, CTX), at),
      callWindowRow(who, { how: 'unread' }, at),
      callWindowRow(who, { how: 'not-filled', why: 'no-window' }, at),
    ];
    expect(rows[0]).toEqual({
      kind: 'call-window',
      turn: 1,
      iteration: 1,
      toolCallId: 'c1',
      toolName: 'client_activity',
      how: 'filled',
      form: 0,
      asked: MORNING,
      person: { ...MORNING, source: 'answered', mention: 0 },
    });
    for (const row of rows) expect(timeRowIsWellFormed(row as never)).toBe(true);
    // A record an earlier version filed (`said`) still crosses the door.
    expect(
      timeRowIsWellFormed({
        ...rows[0],
        person: { ...MORNING, source: 'said', mention: 0 },
      } as never),
    ).toBe(true);
  });

  it.each([
    ['an unknown how', { how: 'guessed' }],
    ['a fill with no person', { how: 'filled', form: 0, asked: MORNING }],
    [
      'a bound row with no `by`',
      { how: 'bound', form: 0, asked: MORNING, person: { ...MORNING, source: 'said', mention: 0 } },
    ],
    [
      'a control window with a mention',
      {
        how: 'filled',
        form: 0,
        asked: MORNING,
        person: { ...MORNING, source: 'control', mention: 0 },
      },
    ],
    ['a range backwards', { how: 'model', form: 0, asked: { from: MORNING.to, to: MORNING.from } }],
    ['a field another how owns', { how: 'unread', why: 'no-window' }],
    ['an unknown why', { how: 'not-filled', why: 'bored' }],
  ])('refuses %s', (_what, fields) => {
    expect(
      timeRowIsWellFormed({
        kind: 'call-window',
        turn: 1,
        iteration: 1,
        toolCallId: 'c1',
        toolName: 't',
        ...fields,
      }),
    ).toBe(false);
  });
});
