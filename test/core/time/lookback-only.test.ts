/**
 * A past window on a look-back-only tool (packet "lookback"): the one answer
 * to "can this tool read this window, and how" — `core/time/convert.ts` ·
 * `convertForTool` — the fill and the open-reading refusal that ask it
 * (`core/time/bind.ts` · `callWindowOf`), the refused row the checkpoint door
 * reads (`core/time/rows.ts` · `timeRowIsWellFormed`), the refused windows the
 * served line reads (`core/time/windows.ts` · `readerWindowsOf`) and the
 * served line's refused half (`agent/arguments/serve.ts` · `timeWindowsLine`).
 *
 * Law: a person's window reaches a tool exactly, else WIDER with what the
 * wider read adds, else it is REFUSED with a named reason — never silently
 * replaced by the tool's own default (an assumed `1h` reads a time nobody
 * asked about). A refused window is the served line's conclusion, not a
 * pending window to ask about again.
 *
 * Test types:
 *   unit        — `convertForTool`'s rows in order: a fact, exact, wider, `multi-day`,
 *                 `no-form-holds` (a covering look-back over `maxRange`, a window still running);
 *                 the fill refuses where it used to fall back to the tool's rule; an open reading
 *                 the tool can read in NO reading is refused (no range), in SOME reading asked;
 *                 `readerWindowsOf` names each refused person's window once, never a model's;
 *   property    — for seeded past ranges and a look-back-only tool with a seeded `maxRange`, the
 *                 answer is a covering read (sent ⊇ window, window + extra = sent) exactly when
 *                 the covering look-back fits `maxRange`, else `no-form-holds` — never undefined;
 *   security    — the checkpoint door takes the open-reading refusal (no range, no form, no
 *                 person) and still refuses a forged one (a form with no range);
 *   byte identity — `timeWindowsLine` with nothing refused serves the bytes it served before;
 *   boundary    — a look-back exactly `maxRange` long is read; one minute longer is refused;
 *   performance — 10 000 answers inside a budget.
 * Through real agents: lookback-only-run.test.ts.
 */

import { describe, expect, it } from 'vitest';

import { defineTool } from '../../../src/index.js';
import { callWindowOf, readerWindowsOf, turnWindowsOf } from '../../../src/core/time/bind.js';
import { convertForTool, type PeriodForm } from '../../../src/core/time/convert.js';
import {
  timeRowIsWellFormed,
  type ClockRow,
  type TimeReadingRow,
} from '../../../src/core/time/rows.js';
import { callWindowRow } from '../../../src/core/time/rowsBuild.js';
import { timeRefusal, timeWindowsLine } from '../../../src/core/agent/arguments/serve.js';

const LA = 'America/Los_Angeles';
const NOW = '2026-10-09T15:40:00Z';
const CTX = { now: NOW, zone: LA, granularityMs: 60_000 };
const YESTERDAY = { from: '2026-10-08T00:00:00-07:00', to: '2026-10-09T00:00:00-07:00' };
const TODAY = { from: '2026-10-09T00:00:00-07:00', to: '2026-10-10T00:00:00-07:00' };
const LOOKBACK: PeriodForm = { kind: 'lookback', argument: 'window', signed: false };
const DAY: PeriodForm = { kind: 'day', argument: 'date', zone: { argument: 'tz' } };
const EPOCH: PeriodForm = {
  kind: 'bounds',
  from: { argument: 'start', as: 'epoch-ms' },
  to: { argument: 'end', as: 'epoch-ms', edge: 'exclusive' },
};

const ms = (text: string): number => Date.parse(text);

function reading(
  ranges: readonly { from: string; to: string }[],
  quote = 'yesterday',
): TimeReadingRow {
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
    candidates: ranges.map((range, i) => ({
      window: { kind: 'range', range },
      range,
      zone: LA,
      grain: 'day',
      said: [],
      implied: [],
      anchor: 'message',
      reader: { id: 'fixture/rule', kind: 'rule' },
      notes: [],
      reading: {},
      parse: i,
    })),
    choice: { by: 'open', remaining: ranges.map((_, i) => i), open: ['confirm'] },
  } as TimeReadingRow;
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

/** A turn whose one window the person CONFIRMED in the time ask. */
function confirmed(range: { from: string; to: string }) {
  return turnWindowsOf([reading([range])], clock, [
    {
      kind: 'time-answer',
      turn: 1,
      iteration: 1,
      mention: 0,
      from: range.from,
      to: range.to,
      zone: LA,
      how: 'confirmed',
    },
  ]);
}

const callOf = (forms: readonly PeriodForm[], facts?: Record<string, unknown>) => ({
  args: {},
  forms,
  isMissing: () => true,
  ...(facts !== undefined && { facts }),
});

// ─── unit ────────────────────────────────────────────────────────────

describe('convertForTool — one answer per (window, tool): exact, wider, or the reason', () => {
  it('asks the facts first, then exact, then wider, then multi-day, then no-form-holds', () => {
    expect(convertForTool({ range: YESTERDAY }, [LOOKBACK], { direction: 'future' }, CTX)).toEqual({
      refused: 'time-past',
    });
    expect(convertForTool({ range: YESTERDAY }, [EPOCH, LOOKBACK], {}, CTX)).toMatchObject({
      conversion: { form: 0 },
    });
    const wider = convertForTool({ range: YESTERDAY }, [LOOKBACK], {}, CTX);
    expect(wider).toMatchObject({
      conversion: {
        form: 0,
        values: { window: '1960m' },
        sent: { from: '2026-10-08T07:00:00Z', to: '2026-10-09T15:40:00.001Z' },
        extra: [{ from: '2026-10-09T07:00:00Z', to: '2026-10-09T15:40:00.001Z' }],
      },
    });
    const twoDays = { from: YESTERDAY.from, to: TODAY.to };
    expect(convertForTool({ range: twoDays }, [DAY], {}, CTX)).toEqual({ refused: 'multi-day' });
    // A covering look-back longer than the tool reads at once.
    expect(convertForTool({ range: YESTERDAY }, [LOOKBACK], { maxRange: '24h' }, CTX)).toEqual({
      refused: 'no-form-holds',
    });
    // A window still running: a look-back ends at now.
    expect(convertForTool({ range: TODAY }, [LOOKBACK], {}, CTX)).toEqual({
      refused: 'no-form-holds',
    });
  });

  it('marks a window partly older than retention, and still converts it', () => {
    const read = convertForTool({ range: YESTERDAY }, [LOOKBACK], { retention: '30h' }, CTX);
    expect(read).toMatchObject({ partlyBeyondRetention: true, conversion: { form: 0 } });
  });

  it('boundary — a covering look-back exactly maxRange long is read; one minute longer is not', () => {
    // From now (15:40Z) back 24h exactly: 2026-10-08T15:40Z.
    const exactly = { from: '2026-10-08T15:40:00Z', to: '2026-10-08T16:40:00Z' };
    expect(convertForTool({ range: exactly }, [LOOKBACK], { maxRange: '24h' }, CTX)).toMatchObject({
      conversion: { values: { window: '1d' } },
    });
    const longer = { from: '2026-10-08T15:39:00Z', to: '2026-10-08T16:40:00Z' };
    expect(convertForTool({ range: longer }, [LOOKBACK], { maxRange: '24h' }, CTX)).toEqual({
      refused: 'no-form-holds',
    });
  });
});

describe('the fill — a window no form holds is refused, never left to the tool’s rule', () => {
  it('a confirmed window whose covering look-back is over maxRange → refused, with the window', () => {
    const decision = callWindowOf(callOf([LOOKBACK], { maxRange: '24h' }), confirmed(YESTERDAY), {
      ...CTX,
    });
    expect(decision).toMatchObject({
      how: 'refused',
      refused: 'no-form-holds',
      asked: YESTERDAY,
      person: { source: 'answered', mention: 0 },
    });
    const row = callWindowRow({ toolCallId: 'c1', toolName: 'search_logs' }, decision, clock);
    expect(timeRowIsWellFormed(row as never)).toBe(true);
  });

  it('an open reading the tool can read in NO reading → refused with no range; in SOME → asked', () => {
    const none = turnWindowsOf([reading([YESTERDAY, TODAY])], clock);
    const decision = callWindowOf(callOf([LOOKBACK], { maxRange: '24h' }), none, CTX);
    expect(decision).toEqual({ how: 'refused', refused: 'no-form-holds' });
    const row = callWindowRow({ toolCallId: 'c1', toolName: 'search_logs' }, decision, clock);
    expect(timeRowIsWellFormed(row as never)).toBe(true);
    // Yesterday is readable (covering look-back) and today is not: the reading is asked.
    expect(callWindowOf(callOf([LOOKBACK]), none, CTX)).toEqual({
      how: 'not-filled',
      why: 'open-reading',
    });
  });

  it('security — a refused row with a form but no range is still refused at the door', () => {
    const forged = {
      kind: 'call-window',
      turn: 1,
      iteration: 1,
      toolCallId: 'c1',
      toolName: 'search_logs',
      how: 'refused',
      refused: 'no-form-holds',
      form: 0,
    };
    expect(timeRowIsWellFormed(forged as never)).toBe(false);
    expect(timeRowIsWellFormed({ ...forged, form: undefined, refused: 'maybe' } as never)).toBe(
      false,
    );
  });
});

describe('readerWindowsOf — the person’s windows a tool refused', () => {
  const refusedRow = (extra: Record<string, unknown>) => ({
    kind: 'call-window',
    turn: 1,
    iteration: 1,
    toolCallId: 'c1',
    toolName: 'search_logs',
    how: 'refused',
    refused: 'no-form-holds',
    ...extra,
  });

  it('an open reading refused in every reading → its quote; once per (quote, tool)', () => {
    const ledger = [clock, reading([YESTERDAY]), refusedRow({}), refusedRow({ toolCallId: 'c2' })];
    expect(readerWindowsOf(ledger)).toEqual({
      now: NOW,
      windows: [],
      pending: ['yesterday'],
      refused: [{ quote: 'yesterday', toolName: 'search_logs', refused: 'no-form-holds' }],
    });
  });

  it('a window the MODEL wrote is not the person’s: not named', () => {
    const ledger = [
      clock,
      reading([YESTERDAY]),
      refusedRow({ refused: 'time-future', form: 0, asked: TODAY }),
    ];
    expect(readerWindowsOf(ledger)).not.toHaveProperty('refused');
  });
});

// ─── the served line ─────────────────────────────────────────────────

describe('timeWindowsLine — a refused window is a conclusion, not a pending ask', () => {
  const lookbackTool = defineTool({
    name: 'search_logs',
    description: 'Error lines over a look-back window.',
    inputSchema: { type: 'object', properties: { window: { type: 'string' } } },
    askOrAssume: { window: { assume: '1h' } },
    period: { argument: 'window', spelling: 'lookback', maxRange: '24h' } as never,
    execute: () => 'ok',
  });
  const epochTool = defineTool({
    name: 'client_activity',
    description: 'Client operations over a window.',
    inputSchema: {
      type: 'object',
      properties: { start_time: { type: 'integer' }, end_time: { type: 'integer' } },
    },
    askOrAssume: { start_time: { ask: 'From when?' }, end_time: { ask: 'Until when?' } },
    period: {
      forms: [
        {
          kind: 'bounds',
          from: { argument: 'start_time', as: 'epoch-ms' },
          to: { argument: 'end_time', as: 'epoch-ms', edge: 'exclusive' },
        },
      ],
    } as never,
    execute: () => 'ok',
  });
  const both = new Map<string, unknown>([
    ['search_logs', lookbackTool],
    ['client_activity', epochTool],
  ]);
  const served = [...both.values()].map((t) => (t as { schema: unknown }).schema);
  const line = (windows: object, winning = both) =>
    timeWindowsLine(
      [...winning.values()].map((t) => (t as { schema: unknown }).schema) as never,
      winning as never,
      windows as never,
    );
  const refused = [{ quote: 'yesterday', toolName: 'search_logs', refused: 'no-form-holds' }];

  it('names the refusal with the result’s own reason, then what the answer states', () => {
    const only = new Map<string, unknown>([['search_logs', lookbackTool]]);
    const text = line({ now: NOW, windows: [], pending: ['yesterday'], refused }, only);
    expect(text).toBe(
      'search_logs was not run for “yesterday”: no period form the tool declares can read the ' +
        'window it asked for, exactly or by reading a wider one, within the most the tool declares ' +
        'it reads at once (maxRange 24h). So the answer tells the person that search_logs could ' +
        'not read that time, and claims nothing about it from search_logs.',
    );
    // The same reason the refused call's result read.
    expect(timeRefusal('search_logs', 'no-form-holds', { maxRange: '24h' })).toBe(
      'search_logs was not run on that call: no period form the tool declares can read the ' +
        'window it asked for, exactly or by reading a wider one, within the most the tool ' +
        'declares it reads at once (maxRange 24h).',
    );
  });

  it('a quote still pending for another tool keeps the pending half — naming only that tool', () => {
    const text = line({ now: NOW, windows: [], pending: ['yesterday'], refused })!;
    expect(text).toContain('search_logs was not run for “yesterday”');
    expect(text).toContain(
      'opens when client_activity is called with start_time, end_time left out',
    );
    expect(text).not.toContain('search_logs is called with window left out');
  });

  it('byte identity — nothing refused serves the bytes it served before', () => {
    expect(line({ now: NOW, windows: [], pending: ['yesterday'] })).toBe(
      "The window for “yesterday” is not settled yet: the person confirms it in the library's own " +
        'form, which shows its reading of those words with the zone and opens when search_logs is ' +
        'called with window left out, or client_activity is called with start_time, end_time left ' +
        'out (or the call is refused with the reason). So the next step is that call — not a ' +
        'question about the time in the reply, and not a window written into the call, which ' +
        'would run unconfirmed.',
    );
    expect(served.length).toBe(2);
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

describe('property — a past window on a look-back-only tool is read wider, or refused by name', () => {
  it('covering read exactly when the look-back fits maxRange, else no-form-holds', () => {
    const rand = seeded(20261009);
    const now = ms(NOW);
    for (let i = 0; i < 400; i++) {
      // A window of whole minutes ending 2 minutes to 20 days before now.
      const to = now - (2 + Math.floor(rand() * 20 * 1440)) * 60_000;
      const from = to - (1 + Math.floor(rand() * 600)) * 60_000;
      const range = { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
      const maxDays = 1 + Math.floor(rand() * 14);
      const read = convertForTool({ range }, [LOOKBACK], { maxRange: `${maxDays}d` }, CTX);
      const covering = Math.ceil((now - from) / 60_000) * 60_000;
      if (covering > maxDays * 86_400_000) {
        expect(read).toEqual({ refused: 'no-form-holds' });
        continue;
      }
      expect('conversion' in read).toBe(true);
      if (!('conversion' in read) || !('sent' in read.conversion)) throw new Error('widened');
      const sentFrom = ms(read.conversion.sent.from);
      const sentTo = ms(read.conversion.sent.to);
      expect(sentFrom).toBeLessThanOrEqual(from);
      expect(sentTo).toBeGreaterThanOrEqual(to);
      const extra = read.conversion.extra.reduce((sum, e) => sum + (ms(e.to) - ms(e.from)), 0);
      expect(extra + (to - from)).toBe(sentTo - sentFrom);
    }
  });
});

describe('performance', () => {
  it('10 000 answers stay well inside a budget', () => {
    const started = performance.now();
    for (let i = 0; i < 10_000; i++) {
      convertForTool(
        { range: i % 2 === 0 ? YESTERDAY : TODAY },
        [LOOKBACK],
        { maxRange: '7d' },
        CTX,
      );
    }
    expect(performance.now() - started).toBeLessThan(4_000);
  });
});
