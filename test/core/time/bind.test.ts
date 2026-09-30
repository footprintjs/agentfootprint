/**
 * Which window a call carries (time design § 5.6, § 7.3, step T5a) —
 * `core/time/bind.ts` and the `call-window` row it implies (`rows.ts`).
 *
 * Law: fill only when the turn has exactly one window and the model left the
 * period out; a present window is never written over — bound by quote or by
 * value, or recorded `model-chosen` and run as sent.
 *
 * Test types:
 *   unit     — the turn's windows from recorded rows (a `rule` reading is `said`, a `model`
 *              reading waiting only for confirmation is `derived-from-reading`, an open or refused
 *              mention fills nothing, the `control` window counts as a mention); every decision;
 *   security — a forged `call-window` row is refused at the checkpoint door (one test per field law);
 *   boundary — a partial period (one bound of two) is `unread`, never filled over.
 */

import { describe, expect, it } from 'vitest';

import { callWindowOf, turnWindowsOf, type TurnWindows } from '../../../src/core/time/bind.js';
import { sugarForms, type PeriodForm } from '../../../src/core/time/convert.js';
import {
  timeRowIsWellFormed,
  type ClockRow,
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
        said: kind === 'rule' ? ['hour', 'minute'] : [],
        implied: [],
        anchor: 'message',
        reader: { id: `fixture/${kind}`, kind },
        notes: [],
        reading: {},
        parse: 0,
      },
    ],
    choice:
      kind === 'rule'
        ? { by: 'only', candidate: 0 }
        : { by: 'open', remaining: [0], open: ['confirm'] },
  };
}

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
  it('a rule reading is said; a model reading waiting only for confirmation is derived; control counts', () => {
    const turn = turnWindowsOf(
      [
        reading(0, 2, 'this morning', MORNING),
        reading(1, 2, 'yesterday morning', YESTERDAY, 'model'),
      ],
      clock({ from: '2026-10-09T01:00:00Z', to: '2026-10-09T02:00:00Z' }),
    );
    expect(turn.mentions).toBe(3);
    expect(turn.windows.map((w) => [w.source, w.mention, w.quote])).toEqual([
      ['said', 0, 'this morning'],
      ['derived-from-reading', 1, 'yesterday morning'],
      ['control', undefined, undefined],
    ]);
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
    expect(turn).toEqual({ windows: [], mentions: 1 });
    expect(callWindowOf(call({}), turn, CTX)).toEqual({ how: 'not-filled', why: 'open-reading' });
  });
});

describe('one call', () => {
  const one = turnWindowsOf([reading(0, 1, '8 AM to 8:40', MORNING)], clock());
  const two = turnWindowsOf(
    [reading(0, 2, 'this morning', MORNING), reading(1, 2, 'yesterday morning', YESTERDAY)],
    clock(),
  );
  const none: TurnWindows = { windows: [], mentions: 0 };

  it('fills the one window the model left out, exactly, into the first form that holds it', () => {
    const decision = callWindowOf(call({}), one, CTX);
    expect(decision).toMatchObject({
      how: 'filled',
      window: { source: 'said', mention: 0 },
      conversion: {
        form: 0,
        values: { start_time: Date.parse(MORNING.from), end_time: Date.parse(MORNING.to) },
      },
    });
  });

  it('fills nothing with no window, with two mentions, or with no form that holds it', () => {
    expect(callWindowOf(call({}), none, CTX)).toEqual({ how: 'not-filled', why: 'no-window' });
    expect(callWindowOf(call({}), two, CTX)).toEqual({
      how: 'not-filled',
      why: 'several-mentions',
    });
    const lookbackOnly = {
      ...call({}),
      forms: [{ kind: 'lookback', argument: 'w', signed: false } as PeriodForm],
    };
    // A window still to come: no look-back reaches it, exactly or widened (step T5b widens a past one).
    const tomorrow = turnWindowsOf(
      [
        reading(0, 1, 'tomorrow 8 to 8:40', {
          from: '2026-10-10T08:00:00-07:00',
          to: '2026-10-10T08:41:00-07:00',
        }),
      ],
      clock(),
    );
    expect(callWindowOf(lookbackOnly, tomorrow, CTX)).toEqual({
      how: 'not-filled',
      why: 'no-exact-form',
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
    const lookback = turnWindowsOf(
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

describe('the call-window row and the checkpoint door', () => {
  const at = { turn: 1, iteration: 1 };
  const who = { toolCallId: 'c1', toolName: 'client_activity' };
  const one = turnWindowsOf([reading(0, 1, '8 AM to 8:40', MORNING)], clock());

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
      person: { ...MORNING, source: 'said', mention: 0 },
    });
    for (const row of rows) expect(timeRowIsWellFormed(row as never)).toBe(true);
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
