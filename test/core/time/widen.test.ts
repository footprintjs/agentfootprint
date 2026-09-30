/**
 * Widening, the clock at dispatch and the pre-dispatch refusals (time design
 * § 7.2, § 7.4, step T5b) — `core/time/convert.ts` (`convertWidened`,
 * `spansDaysForDayOnly`, `wallGapArgument`, `partlyBeyondRetention`),
 * `core/time/bind.ts` (`callWindowOf`'s `refused` and widened fills),
 * `core/time/drift.ts` (`driftAtDispatch`) and the rows they imply.
 *
 * Law: when no form holds the window exactly the library reads MORE, never
 * less, and records the difference; a call that cannot honestly run on its
 * window is refused before dispatch with the reason; the model's look-back
 * is never rewritten — only the library's own fill is redrawn after drift.
 *
 * Test types:
 *   unit        — every inexact row of § 7.2 (covering look-back, `day` wider, first exact before
 *                 first inexact, `maxRange` skips a too-wide read); every refusal (outside
 *                 `direction`, wholly beyond `retention`, over `maxRange`, a multi-day range to a
 *                 `day`-only tool, a wall DST gap); `partly-beyond-retention` dispatches; every row
 *                 of § 7.4 (within the step, redrawn, shifted — the model's look-back, a tool with
 *                 no absolute form);
 *   property    — a widened read covers the window, and window + extra = sent, for seeded past
 *                 ranges inside one day, through both inexact forms;
 *   security    — the checkpoint door refuses a forged widened / refused `call-window` row and a
 *                 forged `drift` (one test per field law);
 *   boundary    — a range ending within the tool's step of now is the exact row, not the wider;
 *                 a doubled wall hour is not a gap; drift exactly at the step changes nothing;
 *   performance — 10 000 widenings inside a budget.
 */

import { describe, expect, it } from 'vitest';

import { callWindowOf, turnWindowsOf } from '../../../src/core/time/bind.js';
import {
  convertWidened,
  partlyBeyondRetention,
  readBack,
  spansDaysForDayOnly,
  wallGapArgument,
  type PeriodForm,
} from '../../../src/core/time/convert.js';
import { driftAtDispatch } from '../../../src/core/time/drift.js';
import {
  callRow,
  callWindowRow,
  timeRowIsWellFormed,
  type ClockRow,
  type TimeReadingRow,
} from '../../../src/core/time/rows.js';

const LA = 'America/Los_Angeles';
const NOW = '2026-10-09T15:40:00Z';
const CTX = { now: NOW, zone: LA, granularityMs: 60_000 };
const MORNING = { from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T08:41:00-07:00' };
const YESTERDAY = { from: '2026-10-08T08:00:00-07:00', to: '2026-10-08T08:41:00-07:00' };
const TOMORROW = { from: '2026-10-10T08:00:00-07:00', to: '2026-10-10T08:41:00-07:00' };

const LOOKBACK: PeriodForm = { kind: 'lookback', argument: 'w', signed: false };
const DAY: PeriodForm = { kind: 'day', argument: 'date', zone: { argument: 'tz' } };
const EPOCH: PeriodForm = {
  kind: 'bounds',
  from: { argument: 'start', as: 'epoch-ms' },
  to: { argument: 'end', as: 'epoch-ms', edge: 'exclusive' },
};
const WALL: PeriodForm = {
  kind: 'bounds',
  from: { argument: 'start', as: 'wall' },
  to: { argument: 'end', as: 'wall', edge: 'exclusive' },
  zone: { argument: 'tz' },
};

const ms = (text: string): number => Date.parse(text);

function reading(range: { from: string; to: string }, quote = 'the window'): TimeReadingRow {
  return {
    kind: 'time-reading',
    turn: 1,
    iteration: 1,
    reader: { id: 'fixture/rule', version: '1', kind: 'rule', locale: 'en-US' },
    tzdata: 'unknown',
    mentions: 1,
    mention: 0,
    quote,
    parses: [],
    candidates: [
      {
        window: { kind: 'range', range },
        range,
        zone: LA,
        grain: 'minute',
        said: [],
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
}

const clock: ClockRow = {
  kind: 'clock',
  turn: 1,
  iteration: 1,
  now: NOW,
  nowSource: 'app',
  zone: LA,
  zoneSource: 'run',
};
/** The turn's one window: a reading the person CONFIRMED in the time ask (the owner's decision "Always confirm"). */
const turnOf = (range: { from: string; to: string }) =>
  turnWindowsOf([reading(range)], clock, [
    {
      kind: 'time-answer',
      turn: 1,
      iteration: 1,
      mention: 0,
      ...range,
      zone: LA,
      how: 'confirmed',
    },
  ]);
const noWindow = turnWindowsOf([], clock);

function call(
  args: Record<string, unknown>,
  forms: readonly PeriodForm[],
  facts?: Record<string, unknown>,
) {
  return {
    args,
    forms,
    isMissing: (a: string) => args[a] === undefined,
    ...(facts !== undefined && { facts }),
  };
}

// ─── the inexact rows of § 7.2 ────────────────────────────────────────

describe('the inexact rows of § 7.2 — the library reads MORE, never less', () => {
  it('a range ending before now → the covering look-back from now, with what it adds', () => {
    expect(convertWidened({ range: YESTERDAY }, [LOOKBACK], CTX)).toEqual({
      form: 0,
      values: { w: '1480m' },
      sent: { from: '2026-10-08T15:00:00Z', to: '2026-10-09T15:40:00.001Z' },
      extra: [{ from: '2026-10-08T15:41:00Z', to: '2026-10-09T15:40:00.001Z' }],
    });
    // The sign is added for a signed look-back, and the read is what the tool reads back.
    const signed = convertWidened(
      { range: YESTERDAY },
      [{ ...LOOKBACK, signed: true } as PeriodForm],
      CTX,
    );
    expect(signed?.values).toEqual({ w: '-1480m' });
    expect(
      readBack({ w: '-1480m' }, { ...LOOKBACK, signed: true } as PeriodForm, { now: NOW }),
    ).toEqual(signed?.sent);
    // Coarser units round the length UP to a whole unit: never shorter than asked.
    const days = convertWidened(
      { range: YESTERDAY },
      [{ ...LOOKBACK, units: 'd' } as PeriodForm],
      CTX,
    );
    expect(days?.values).toEqual({ w: '2d' });
    expect(days?.extra).toHaveLength(2);
  });

  it('a range inside one day → that day, with the parts of the day before and after', () => {
    expect(convertWidened({ range: MORNING }, [DAY], CTX)).toEqual({
      form: 0,
      values: { date: '2026-10-09', tz: LA },
      sent: { from: '2026-10-09T07:00:00Z', to: '2026-10-10T07:00:00Z' },
      extra: [
        { from: '2026-10-09T07:00:00Z', to: '2026-10-09T15:00:00Z' },
        { from: '2026-10-09T15:41:00Z', to: '2026-10-10T07:00:00Z' },
      ],
    });
  });

  it('takes the first inexact form in declared order, and skips one whose read is over `maxRange`', () => {
    expect(convertWidened({ range: YESTERDAY }, [DAY, LOOKBACK], CTX)?.form).toBe(0);
    expect(convertWidened({ range: YESTERDAY }, [LOOKBACK, DAY], CTX)?.form).toBe(0);
    // The covering look-back reads 24h40m; a tool that reads at most a day cannot take it.
    expect(convertWidened({ range: YESTERDAY }, [LOOKBACK], CTX, 86_400_000)).toBeUndefined();
    expect(convertWidened({ range: YESTERDAY }, [LOOKBACK, DAY], CTX, 86_400_000)?.form).toBe(1);
  });

  it('boundary — a range ending within the step of now is the exact row, never the wider one', () => {
    const endingNow = { from: '2026-10-09T15:00:00Z', to: '2026-10-09T15:39:30Z' };
    expect(convertWidened({ range: endingNow }, [LOOKBACK], CTX)).toBeUndefined();
    // A window still to come: no look-back reaches it, and no day holds a range across days.
    expect(convertWidened({ range: TOMORROW }, [LOOKBACK], CTX)).toBeUndefined();
    const twoDays = { from: YESTERDAY.from, to: MORNING.to };
    expect(convertWidened({ range: twoDays }, [DAY], CTX)).toBeUndefined();
  });

  it('a look-back window is not widened — its own row is exact or nothing', () => {
    expect(
      convertWidened(
        {
          range: { from: '2026-10-09T15:39:30Z', to: '2026-10-09T15:40:00.001Z' },
          lookback: '30s',
        },
        [LOOKBACK],
        CTX,
      ),
    ).toBeUndefined();
  });
});

describe('the pre-dispatch refusals — their tests', () => {
  it('a multi-day range only matters to a tool whose every form is a `day`', () => {
    const twoDays = { range: { from: YESTERDAY.from, to: MORNING.to } };
    expect(spansDaysForDayOnly(twoDays, [DAY], CTX)).toBe(true);
    expect(spansDaysForDayOnly(twoDays, [DAY, LOOKBACK], CTX)).toBe(false);
    expect(spansDaysForDayOnly({ range: MORNING }, [DAY], CTX)).toBe(false);
    // A `day` form with no zone it can read (no argument, no app zone) is never judged.
    expect(
      spansDaysForDayOnly(twoDays, [{ kind: 'day', argument: 'date' }], {
        now: NOW,
        zone: LA,
        granularityMs: 60_000,
      }),
    ).toBe(false);
  });

  it('names the argument whose wall time the zone skips — and a doubled hour is not a gap', () => {
    // 8 March 2026: Los Angeles jumps from 02:00 to 03:00.
    expect(
      wallGapArgument({ start: '2026-03-08T02:30', end: '2026-03-08T04:00', tz: LA }, WALL, {}),
    ).toBe('start');
    const joined: PeriodForm = {
      kind: 'joined',
      argument: 'w',
      as: 'wall',
      joiner: '..',
      edge: 'inclusive',
      zone: { argument: 'tz' },
    };
    expect(wallGapArgument({ w: '2026-03-08T01:00..2026-03-08T02:15', tz: LA }, joined, {})).toBe(
      'w',
    );
    // 1 November 2026: 01:30 happens twice — ambiguous, not skipped.
    expect(
      wallGapArgument({ start: '2026-11-01T01:30', end: '2026-11-01T03:00', tz: LA }, WALL, {}),
    ).toBeUndefined();
    // An `as: 'iso'` form carries offsets: no wall time to skip.
    expect(wallGapArgument({ start: 1, end: 2 }, EPOCH, {})).toBeUndefined();
    // `wallZone: 'app'` — the app's zone reads a form with no zone argument.
    const appZoned: PeriodForm = {
      kind: 'bounds',
      from: { argument: 'start', as: 'wall' },
      to: { argument: 'end', as: 'wall', edge: 'exclusive' },
    };
    expect(
      wallGapArgument({ start: '2026-03-08T02:30', end: '2026-03-08T04:00' }, appZoned, {
        appZone: LA,
      }),
    ).toBe('start');
  });

  it('partly beyond retention: starts before the oldest kept instant and ends after it', () => {
    const at = (daysAgo: number) =>
      new Date(ms(NOW) - daysAgo * 86_400_000).toISOString().replace('.000Z', 'Z');
    const facts = { retention: '30d' };
    expect(partlyBeyondRetention({ from: at(31), to: at(29) }, facts, NOW)).toBe(true);
    expect(partlyBeyondRetention({ from: at(33), to: at(31) }, facts, NOW)).toBe(false);
    expect(partlyBeyondRetention({ from: at(2), to: at(1) }, facts, NOW)).toBe(false);
    expect(partlyBeyondRetention({ from: at(31), to: at(29) }, {}, NOW)).toBe(false);
  });
});

// ─── one call's decision ──────────────────────────────────────────────

describe('one call — refused before dispatch, or dispatched and marked', () => {
  it('a future window to a `past` tool is refused — filled or sent', () => {
    expect(callWindowOf(call({}, [EPOCH], { direction: 'past' }), turnOf(TOMORROW), CTX)).toEqual({
      how: 'refused',
      refused: 'time-future',
      asked: TOMORROW,
      person: expect.objectContaining({ source: 'answered', mention: 0 }),
    });
    const sent = { start: ms(TOMORROW.from), end: ms(TOMORROW.to) };
    expect(callWindowOf(call(sent, [EPOCH], { direction: 'past' }), noWindow, CTX)).toMatchObject({
      how: 'refused',
      refused: 'time-future',
      form: 0,
    });
    // The same window to a tool that says nothing about direction runs.
    expect(callWindowOf(call(sent, [EPOCH]), noWindow, CTX).how).toBe('model');
  });

  it('a past window to a `future` tool, a window wholly beyond retention, one over maxRange', () => {
    const sent = { start: ms(YESTERDAY.from), end: ms(YESTERDAY.to) };
    expect(callWindowOf(call(sent, [EPOCH], { direction: 'future' }), noWindow, CTX)).toMatchObject(
      { how: 'refused', refused: 'time-past' },
    );
    expect(callWindowOf(call(sent, [EPOCH], { retention: '12h' }), noWindow, CTX)).toMatchObject({
      how: 'refused',
      refused: 'beyond-retention',
    });
    expect(callWindowOf(call(sent, [EPOCH], { maxRange: '30m' }), noWindow, CTX)).toMatchObject({
      how: 'refused',
      refused: 'over-max-range',
    });
  });

  it('a range half inside retention dispatches, marked partly beyond it', () => {
    const half = {
      from: new Date(ms(NOW) - 31 * 86_400_000).toISOString(),
      to: new Date(ms(NOW) - 29 * 86_400_000).toISOString(),
    };
    const sent = { start: ms(half.from), end: ms(half.to) };
    expect(callWindowOf(call(sent, [EPOCH], { retention: '30d' }), noWindow, CTX)).toMatchObject({
      how: 'model',
      partlyBeyondRetention: true,
    });
    expect(callWindowOf(call({}, [EPOCH], { retention: '30d' }), turnOf(half), CTX)).toMatchObject({
      how: 'filled',
      partlyBeyondRetention: true,
    });
  });

  it('a range across days to a `day`-only tool is refused; a day inside one is filled wider', () => {
    const twoDays = { from: YESTERDAY.from, to: MORNING.to };
    expect(callWindowOf(call({}, [DAY]), turnOf(twoDays), CTX)).toMatchObject({
      how: 'refused',
      refused: 'multi-day',
      asked: twoDays,
    });
    const filled = callWindowOf(call({}, [DAY]), turnOf(MORNING), CTX);
    expect(filled).toMatchObject({
      how: 'filled',
      conversion: { form: 0, values: { date: '2026-10-09', tz: LA } },
    });
    expect(filled).not.toHaveProperty('trimmedByTool');
  });

  it('a covering look-back to a tool that trims its rows to the asked window is marked so', () => {
    expect(
      callWindowOf(call({}, [LOOKBACK], { filtersToAsked: true }), turnOf(YESTERDAY), CTX),
    ).toMatchObject({ how: 'filled', trimmedByTool: true, conversion: { values: { w: '1480m' } } });
  });

  it('a sent wall time the zone skips is refused, naming the argument', () => {
    expect(
      callWindowOf(
        call({ start: '2026-03-08T02:30', end: '2026-03-08T04:00', tz: LA }, [WALL]),
        noWindow,
        CTX,
      ),
    ).toEqual({ how: 'refused', refused: 'dst-gap', form: 0, argument: 'start' });
    // A wall time that exists but the zone doubles is still `unread` — it runs as sent.
    expect(
      callWindowOf(
        call({ start: '2026-11-01T01:30', end: '2026-11-01T03:00', tz: LA }, [WALL]),
        noWindow,
        CTX,
      ),
    ).toEqual({ how: 'unread' });
  });
});

// ─── the rows ─────────────────────────────────────────────────────────

describe('the rows — and the checkpoint door', () => {
  const at = { turn: 1, iteration: 1 };
  const id = { toolCallId: 'c1', toolName: 'search_logs' };
  const rowOf = (
    args: Record<string, unknown>,
    forms: PeriodForm[],
    facts?: object,
    t = noWindow,
  ) =>
    callWindowRow(
      id,
      callWindowOf(call(args, forms, facts as Record<string, unknown>), t, CTX),
      at,
    );

  it('a widened fill carries `sent` and `differs.extra`, or `trimmedByTool`', () => {
    const wider = rowOf({}, [LOOKBACK], undefined, turnOf(YESTERDAY));
    expect(wider).toMatchObject({
      how: 'filled',
      sent: { from: '2026-10-08T15:00:00Z', to: '2026-10-09T15:40:00.001Z' },
      differs: { extra: [{ from: '2026-10-08T15:41:00Z', to: '2026-10-09T15:40:00.001Z' }] },
    });
    expect(timeRowIsWellFormed(wider as never)).toBe(true);
    const trimmed = rowOf({}, [LOOKBACK], { filtersToAsked: true }, turnOf(YESTERDAY));
    expect(trimmed).toMatchObject({ trimmedByTool: true });
    expect(trimmed).not.toHaveProperty('differs');
    expect(timeRowIsWellFormed(trimmed as never)).toBe(true);
    // An exact fill carries neither.
    const exact = rowOf({}, [EPOCH], undefined, turnOf(YESTERDAY));
    expect(exact).not.toHaveProperty('sent');
    expect(timeRowIsWellFormed(exact as never)).toBe(true);
  });

  it('a refused call files its reason; every refused shape crosses the door', () => {
    const future = rowOf({}, [EPOCH], { direction: 'past' }, turnOf(TOMORROW));
    expect(future).toMatchObject({ how: 'refused', refused: 'time-future', asked: TOMORROW });
    const gap = rowOf({ start: '2026-03-08T02:30', end: '2026-03-08T04:00', tz: LA }, [WALL]);
    expect(gap).toEqual({
      kind: 'call-window',
      ...at,
      ...id,
      how: 'refused',
      refused: 'dst-gap',
      form: 0,
      argument: 'start',
    });
    for (const row of [future, gap]) expect(timeRowIsWellFormed(row as never)).toBe(true);
  });

  it('security — a forged widened, refused or partly row is refused at the door', () => {
    const wider = rowOf({}, [LOOKBACK], undefined, turnOf(YESTERDAY)) as unknown as Record<
      string,
      unknown
    >;
    const forged: Record<string, unknown>[] = [
      { ...wider, trimmedByTool: true }, // both differs and trimmed
      { ...wider, sent: undefined }, // differs with no sent
      { ...wider, differs: { extra: [] } }, // an empty extra
      { ...wider, differs: { extra: [wider.sent], more: 1 } }, // an unknown key
      { ...wider, partlyBeyondRetention: false },
      { ...wider, refused: 'time-future' }, // a refusal on a filled row
    ];
    const gap = rowOf({ start: '2026-03-08T02:30', end: '2026-03-08T04:00', tz: LA }, [
      WALL,
    ]) as unknown as Record<string, unknown>;
    const future = rowOf({}, [EPOCH], { direction: 'past' }, turnOf(TOMORROW)) as unknown as Record<
      string,
      unknown
    >;
    forged.push(
      { ...gap, argument: undefined }, // a gap that names no argument
      { ...gap, asked: MORNING }, // a gap with a range
      { ...future, refused: 'too-late' }, // an unknown reason
      { ...future, asked: undefined }, // a fact refusal with no range
      { ...future, argument: 'w' }, // an argument on a fact refusal
      { ...future, sent: MORNING }, // a read on a call that never ran
    );
    for (const row of forged) expect(timeRowIsWellFormed(row as never)).toBe(false);
  });

  it('security — the `call` row’s drift: a redraw names its form, a shift names none, never zero', () => {
    const ok = [
      callRow(id, at, ms(NOW) + 1_800_000, { byMs: 1_800_000, outcome: 'redrawn', form: 1 }),
      callRow(id, at, ms(NOW) + 1_800_000, { byMs: 1_800_000, outcome: 'shifted' }),
      callRow(id, at, ms(NOW)),
    ];
    for (const row of ok) expect(timeRowIsWellFormed(row as never)).toBe(true);
    const base = callRow(id, at, ms(NOW)) as unknown as Record<string, unknown>;
    const forged = [
      { ...base, drift: { byMs: 0, outcome: 'shifted' } },
      { ...base, drift: { byMs: 5, outcome: 'redrawn' } },
      { ...base, drift: { byMs: 5, outcome: 'shifted', form: 1 } },
      { ...base, drift: { byMs: 1.5, outcome: 'shifted' } },
      { ...base, drift: { byMs: 5, outcome: 'moved' } },
      { ...base, drift: 'late' },
    ];
    for (const row of forged) expect(timeRowIsWellFormed(row as never)).toBe(false);
  });
});

// ─── § 7.4 the clock at dispatch ──────────────────────────────────────

describe('the clock at dispatch (§ 7.4)', () => {
  const asked = { from: '2026-10-09T14:40:00Z', to: '2026-10-09T15:40:00.001Z' };
  const later = (minutes: number) => new Date(ms(NOW) + minutes * 60_000).toISOString();
  const clockAt = (minutes: number) => ({
    now: NOW,
    dispatchedAt: later(minutes),
    granularityMs: 60_000,
    zone: LA,
  });

  it('within the tool’s step nothing changes — boundary: exactly one step is still within', () => {
    expect(
      driftAtDispatch({ how: 'filled', form: 0, asked }, [LOOKBACK, EPOCH], clockAt(0.5)),
    ).toBe(undefined);
    expect(driftAtDispatch({ how: 'filled', form: 0, asked }, [LOOKBACK, EPOCH], clockAt(1))).toBe(
      undefined,
    );
  });

  it('past the step, the library’s look-back fill is redrawn as the asked range in the absolute form', () => {
    expect(
      driftAtDispatch({ how: 'filled', form: 0, asked }, [LOOKBACK, EPOCH], clockAt(30)),
    ).toEqual({
      byMs: 1_800_000,
      outcome: 'redrawn',
      form: 1,
      values: { start: ms(asked.from), end: ms(asked.to) },
    });
  });

  it('with no absolute form, or for the model’s own look-back, the call runs as sent — shifted', () => {
    expect(driftAtDispatch({ how: 'filled', form: 0, asked }, [LOOKBACK], clockAt(30))).toEqual({
      byMs: 1_800_000,
      outcome: 'shifted',
    });
    for (const how of ['bound', 'model-chosen', 'model'] as const) {
      expect(driftAtDispatch({ how, form: 0, asked }, [LOOKBACK, EPOCH], clockAt(30))).toEqual({
        byMs: 1_800_000,
        outcome: 'shifted',
      });
    }
    // An app `now` AHEAD of the wall clock drifts too: the tool still reads its own clock.
    expect(driftAtDispatch({ how: 'model', form: 0, asked }, [LOOKBACK], clockAt(-30))).toEqual({
      byMs: -1_800_000,
      outcome: 'shifted',
    });
  });

  it('an absolute window, an unread call and a refused one never drift', () => {
    expect(driftAtDispatch({ how: 'model', form: 1, asked }, [LOOKBACK, EPOCH], clockAt(30))).toBe(
      undefined,
    );
    expect(driftAtDispatch({ how: 'unread' }, [LOOKBACK], clockAt(30))).toBe(undefined);
    expect(driftAtDispatch({ how: 'refused', form: 0 }, [LOOKBACK], clockAt(30))).toBe(undefined);
    expect(driftAtDispatch(undefined, [LOOKBACK], clockAt(30))).toBe(undefined);
  });
});

// ─── property and performance ─────────────────────────────────────────

/** A small seeded generator (mulberry32) — the same ranges every run. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('property — a widened read covers the window, and window + extra = sent', () => {
  it('for seeded past ranges inside one day, through both inexact forms', () => {
    const rand = seeded(20261009);
    for (let i = 0; i < 300; i++) {
      // A day 2–20 days back, a window of whole minutes inside it (Los Angeles noon ± 6h).
      const noon = ms('2026-10-09T19:00:00Z') - (2 + Math.floor(rand() * 18)) * 86_400_000;
      const from = noon - Math.floor(rand() * 360) * 60_000;
      const to = from + (1 + Math.floor(rand() * 300)) * 60_000;
      const range = { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
      for (const form of [LOOKBACK, DAY]) {
        const w = convertWidened({ range }, [form], CTX);
        expect(w).toBeDefined();
        const sentFrom = ms(w!.sent.from);
        const sentTo = ms(w!.sent.to);
        expect(sentFrom).toBeLessThanOrEqual(from);
        expect(sentTo).toBeGreaterThanOrEqual(to);
        const extra = w!.extra.reduce((sum, e) => sum + (ms(e.to) - ms(e.from)), 0);
        expect(extra + (to - from)).toBe(sentTo - sentFrom);
        // The values read back as exactly the read the row records.
        const back = readBack(w!.values, form, { now: NOW });
        expect(back && [ms(back.from), ms(back.to)]).toEqual([sentFrom, sentTo]);
      }
    }
  });
});

describe('performance', () => {
  it('10 000 widenings stay well inside a budget', () => {
    const started = performance.now();
    for (let i = 0; i < 10_000; i++) {
      convertWidened({ range: i % 2 === 0 ? YESTERDAY : MORNING }, [LOOKBACK, DAY], CTX);
    }
    expect(performance.now() - started).toBeLessThan(4_000);
  });
});
