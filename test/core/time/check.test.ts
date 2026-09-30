/**
 * The result checks (time design § 9.2, § 9.4, § 9.6, step T8) —
 * `core/time/check.ts` (`periodTimeCheck`, `rangeDifference`, `clocksDiffer`,
 * `isPeriodDiffers`), the `period` row's arm (`coverage/period.ts` ·
 * `periodRowIsWellFormed`), the `source-clock` row's (`rows.ts` ·
 * `timeRowIsWellFormed`) and the limits lines (`periodCheckLine`, `clockLines`).
 *
 * Law: what a call read is compared with what it asked — `missing` (asked, not
 * read) and `extra` (read, not asked); a closed end read as open and a drift
 * within the step are not differences; the read is the declared `queried`
 * first (read back with the tool's step), then a widened fill, then a shifted
 * look-back, else the asked range; a period's offset is never a clock.
 *
 * Test types:
 *   unit        — each read source (declared · sent · shifted · asked), `against: 'person'` for a
 *                 model-chosen window, refused and not-filled calls compared with nothing, several
 *                 declared periods, retention (refused, wholly, partly), clocks, the lines;
 *   property    — for seeded ranges, `missing` + (asked ∩ read) = asked and `extra` + (read ∩
 *                 asked) = read, every piece inside its side;
 *   security    — the row arms refuse forged `differs` / `shifted` / flags and a `source-clock`
 *                 row with an abbreviation for a zone;
 *   boundary    — a 1 ms piece is dropped, a 2 ms piece kept; a shift exactly at the step is
 *                 none, one millisecond past it is both lists; `queried.to == asked.to − step`;
 *   performance — 10 000 checks inside a budget.
 */

import { describe, expect, it } from 'vitest';

import {
  clocksDiffer,
  distinctSources,
  isPeriodDiffers,
  periodTimeCheck,
  rangeDifference,
  type PeriodCheckInput,
} from '../../../src/core/time/check.js';
import { timeRowIsWellFormed } from '../../../src/core/time/rows.js';
import {
  clockLines,
  periodCheckLine,
  periodRowIsWellFormed,
  type PeriodRow,
} from '../../../src/core/agent/coverage/period.js';

const NOW = '2026-10-09T15:40:00Z';
const NOW_MS = Date.parse(NOW);
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const HOUR = { from: '2026-10-09T14:00:00Z', to: '2026-10-09T15:00:00Z' };
const LA = 'America/Los_Angeles';

const filled = (asked = HOUR): PeriodCheckInput['window'] => ({ how: 'filled', asked });

// ─── unit ────────────────────────────────────────────────────────────

describe('unit — the read, first found wins', () => {
  it('declared: `queried` read back with the tool’s step; a clamp is `missing`', () => {
    const check = periodTimeCheck({
      window: filled(),
      declared: [{ from: '2026-10-09T14:30:00Z', to: '2026-10-09T14:59:00Z' }],
      facts: { granularity: '1m' },
      now: NOW,
    });
    expect(check).toEqual({
      differs: {
        against: 'asked',
        asked: HOUR,
        read: [{ from: '2026-10-09T14:30:00Z', to: '2026-10-09T15:00:00Z' }],
        source: 'declared',
        stepMs: 60_000,
        missing: [{ from: '2026-10-09T14:00:00Z', to: '2026-10-09T14:30:00Z' }],
        extra: [],
      },
    });
  });

  it('declared beats a widened fill and a drift — the result says what it read', () => {
    const check = periodTimeCheck({
      window: {
        how: 'filled',
        asked: HOUR,
        sent: { from: '2026-10-09T07:00:00Z', to: NOW },
      },
      drift: { byMs: 30 * 60_000, outcome: 'shifted' },
      declared: [{ from: HOUR.from, to: '2026-10-09T14:59:59.999Z' }],
      now: NOW,
    });
    expect(check).toEqual({ shifted: { byMs: 30 * 60_000 } });
  });

  it('sent: a widened fill the tool does not trim is `extra`; one it trims is the asked range', () => {
    const sent = { from: '2026-10-09T07:00:00Z', to: NOW };
    expect(
      periodTimeCheck({ window: { how: 'filled', asked: HOUR, sent }, now: NOW })?.differs,
    ).toMatchObject({
      source: 'sent',
      missing: [],
      extra: [
        { from: '2026-10-09T07:00:00Z', to: HOUR.from },
        { from: HOUR.to, to: NOW },
      ],
    });
    expect(
      periodTimeCheck({
        window: { how: 'filled', asked: HOUR, sent, trimmedByTool: true },
        now: NOW,
      }),
    ).toBeUndefined();
  });

  it('shifted: a look-back that ran as sent 30 minutes late — both lists', () => {
    expect(
      periodTimeCheck({
        window: filled(),
        drift: { byMs: 30 * 60_000, outcome: 'shifted' },
        now: NOW,
      }),
    ).toEqual({
      shifted: { byMs: 30 * 60_000 },
      differs: expect.objectContaining({
        source: 'shifted',
        missing: [{ from: HOUR.from, to: '2026-10-09T14:30:00Z' }],
        extra: [{ from: HOUR.to, to: '2026-10-09T15:30:00Z' }],
      }),
    });
  });

  it('a redrawn look-back ran as the asked range — nothing', () => {
    expect(
      periodTimeCheck({
        window: filled(),
        drift: { byMs: 30 * 60_000, outcome: 'redrawn', form: 1 },
        now: NOW,
      }),
    ).toBeUndefined();
  });

  it('a window the model chose is judged against the person’s', () => {
    const check = periodTimeCheck({
      window: {
        how: 'model-chosen',
        asked: { from: '2026-10-09T14:30:00Z', to: HOUR.to },
        person: { ...HOUR, source: 'control' } as never,
      },
      now: NOW,
    });
    expect(check?.differs).toMatchObject({
      against: 'person',
      asked: HOUR,
      source: 'asked',
      missing: [{ from: HOUR.from, to: '2026-10-09T14:30:00Z' }],
    });
  });

  it('refused, not-filled and unread calls are compared with nothing', () => {
    for (const window of [
      { how: 'refused', refused: 'time-future' },
      { how: 'not-filled' },
      { how: 'unread' },
    ] as const) {
      expect(
        periodTimeCheck({
          window: window as never,
          declared: [{ from: HOUR.from, to: HOUR.to }],
          now: NOW,
        }),
      ).toBeUndefined();
    }
  });

  it('several declared periods: missing is what none read; extra is what any read beyond', () => {
    const check = periodTimeCheck({
      window: filled(),
      declared: [
        { from: '2026-10-09T13:50:00Z', to: '2026-10-09T14:19:59.999Z' },
        { from: '2026-10-09T14:40:00Z', to: '2026-10-09T14:59:59.999Z' },
      ],
      now: NOW,
    });
    expect(check?.differs).toMatchObject({
      missing: [{ from: '2026-10-09T14:20:00Z', to: '2026-10-09T14:40:00Z' }],
      extra: [{ from: '2026-10-09T13:50:00Z', to: HOUR.from }],
    });
  });
});

describe('unit — retention', () => {
  const facts = { retention: '30d' };
  const old = { from: iso(NOW_MS - 40 * 86_400_000), to: iso(NOW_MS - 35 * 86_400_000) };
  it('a refusal for retention is `beyondRetention`; any other refusal is not', () => {
    expect(
      periodTimeCheck({ window: { how: 'refused', refused: 'beyond-retention' }, now: NOW }),
    ).toEqual({ beyondRetention: true });
    expect(
      periodTimeCheck({ window: { how: 'refused', refused: 'over-max-range' }, now: NOW }),
    ).toBeUndefined();
  });
  it('a read wholly older than the source keeps; a read across its edge', () => {
    expect(periodTimeCheck({ window: filled(old), facts, now: NOW })).toEqual({
      beyondRetention: true,
    });
    const across = { from: iso(NOW_MS - 31 * 86_400_000), to: iso(NOW_MS - 29 * 86_400_000) };
    expect(periodTimeCheck({ window: filled(across), facts, now: NOW })).toEqual({
      partlyBeyondRetention: true,
    });
    expect(periodTimeCheck({ window: filled(across), now: NOW })).toBeUndefined();
  });
});

describe('unit — clocks and lines', () => {
  it('clocks differ only across two declared zones; sources are named once each', () => {
    const one = [
      { toolName: 'a', zone: LA },
      { toolName: 'a', zone: LA },
    ];
    expect(distinctSources(one)).toEqual([{ toolName: 'a', zone: LA }]);
    expect(clocksDiffer(one)).toBeUndefined();
    expect(clocksDiffer([...one, { toolName: 'b', zone: 'Europe/London' }])).toEqual({
      tools: ['a', 'b'],
      zones: [LA, 'Europe/London'],
    });
    expect(clockLines([{ toolName: 'a', zone: LA }], undefined)).toEqual([
      "a's rows are wall times in America/Los_Angeles (declared) — compared as instants",
    ]);
  });

  it('the period line names the read against what was asked, in the presentation zone', () => {
    const row: PeriodRow = {
      kind: 'period',
      turn: 1,
      toolCallId: 'c1',
      toolName: 'search_logs',
      iteration: 1,
      verdict: 'undeclared',
      ...(periodTimeCheck({
        window: { how: 'filled', asked: HOUR, sent: { from: HOUR.from, to: NOW } },
        now: NOW,
      }) as object),
    };
    expect(periodCheckLine(row, { zone: LA })).toBe(
      'search_logs read more than was asked — asked: 2026-10-09 07:00:00–07:59:59 America/Los_Angeles (UTC-07:00); read: 2026-10-09 07:00:00–08:39:59 America/Los_Angeles (UTC-07:00)',
    );
    expect(
      periodCheckLine({ ...row, differs: undefined } as PeriodRow, { zone: LA }),
    ).toBeUndefined();
  });
});

// ─── property ────────────────────────────────────────────────────────

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

const length = (ranges: readonly { from: string; to: string }[]) =>
  ranges.reduce((n, r) => n + (Date.parse(r.to) - Date.parse(r.from)), 0);
const overlap = (a: { from: string; to: string }, b: { from: string; to: string }) =>
  Math.max(
    0,
    Math.min(Date.parse(a.to), Date.parse(b.to)) - Math.max(Date.parse(a.from), Date.parse(b.from)),
  );

describe('property — the two lists partition each side', () => {
  it('missing + (asked ∩ read) = asked, extra + (read ∩ asked) = read, for seeded ranges', () => {
    const rand = seeded(20261009);
    const minute = 60_000;
    for (let i = 0; i < 500; i++) {
      const aFrom = NOW_MS - Math.floor(rand() * 3000) * minute;
      const aTo = aFrom + (1 + Math.floor(rand() * 600)) * minute;
      const rFrom = aFrom + Math.floor((rand() - 0.5) * 900) * minute;
      const rTo = rFrom + (1 + Math.floor(rand() * 900)) * minute;
      const asked = { from: iso(aFrom), to: iso(aTo) };
      const read = { from: iso(rFrom), to: iso(rTo) };
      const d = rangeDifference(asked, [read])!;
      const both = overlap(asked, read);
      expect(length(d.missing) + both).toBe(aTo - aFrom);
      expect(length(d.extra) + both).toBe(rTo - rFrom);
      for (const m of d.missing)
        expect(overlap(m, asked)).toBe(Date.parse(m.to) - Date.parse(m.from));
      for (const e of d.extra) expect(overlap(e, read)).toBe(Date.parse(e.to) - Date.parse(e.from));
    }
  });
});

// ─── security ────────────────────────────────────────────────────────

describe('security — the row arms refuse what the library never files', () => {
  const base = {
    kind: 'period',
    turn: 1,
    toolCallId: 'c1',
    toolName: 't',
    iteration: 1,
    verdict: 'covered',
  };
  const differs = {
    against: 'asked',
    asked: HOUR,
    read: [HOUR],
    source: 'declared',
    stepMs: 1,
    missing: [HOUR],
    extra: [],
  };
  it('a well-formed row with every check passes', () => {
    expect(
      periodRowIsWellFormed({
        ...base,
        differs,
        shifted: { byMs: 5 },
        beyondRetention: true,
        partlyBeyondRetention: true,
      }),
    ).toBe(true);
  });
  it.each([
    ['against', { ...differs, against: 'model' }],
    ['source', { ...differs, source: 'guessed' }],
    ['a backwards range', { ...differs, missing: [{ from: HOUR.to, to: HOUR.from }] }],
    ['a zone-less instant', { ...differs, asked: { from: '2026-10-09T14:00:00', to: HOUR.to } }],
    ['no read', { ...differs, read: [] }],
    ['two empty lists', { ...differs, missing: [] }],
    ['a list as a string', { ...differs, extra: 'none' }],
    ['a zero step', { ...differs, stepMs: 0 }],
    ['an array', [differs]],
  ])('forged differs: %s', (_what, forged) => {
    expect(isPeriodDiffers(forged)).toBe(false);
    expect(periodRowIsWellFormed({ ...base, differs: forged })).toBe(false);
  });
  it.each([
    ['shifted', { shifted: { byMs: 'late' } }],
    ['beyondRetention', { beyondRetention: 'yes' }],
    ['partlyBeyondRetention', { partlyBeyondRetention: false }],
  ])('forged %s', (_what, extra) => {
    expect(periodRowIsWellFormed({ ...base, ...extra })).toBe(false);
  });
  it('a source-clock row needs an IANA zone', () => {
    const row = { kind: 'source-clock', turn: 1, iteration: 1, toolCallId: 'c', toolName: 't' };
    expect(timeRowIsWellFormed({ ...row, zone: LA })).toBe(true);
    expect(timeRowIsWellFormed({ ...row, zone: 'PST' })).toBe(false);
    expect(timeRowIsWellFormed({ ...row, zone: '-07:00' })).toBe(false);
    expect(timeRowIsWellFormed({ ...row, zone: LA, toolName: 3 })).toBe(false);
  });
});

// ─── boundary ────────────────────────────────────────────────────────

describe('boundary', () => {
  it('a 1 ms piece is a closed end read as open — dropped; a 2 ms piece is kept', () => {
    const at = (ms: number) => ({ from: HOUR.from, to: iso(Date.parse(HOUR.to) + ms) });
    expect(rangeDifference(HOUR, [at(1)])).toEqual({ missing: [], extra: [] });
    expect(rangeDifference(HOUR, [at(2)])?.extra).toHaveLength(1);
  });

  it('a read shifted by exactly the step is the asked range; a millisecond more is not', () => {
    const shift = (ms: number) => ({
      from: iso(Date.parse(HOUR.from) + ms),
      to: iso(Date.parse(HOUR.to) + ms - 1),
    });
    const at = (ms: number) =>
      periodTimeCheck({ window: filled(), declared: [shift(ms)], now: NOW })?.differs;
    expect(at(60_000)).toBeUndefined();
    expect(at(60_001)).toMatchObject({ missing: [expect.anything()], extra: [expect.anything()] });
    // A declared step widens the tolerance with it.
    expect(
      periodTimeCheck({
        window: filled(),
        declared: [{ from: iso(Date.parse(HOUR.from) + 120_000), to: '2026-10-09T15:01:00Z' }],
        facts: { granularity: '1m' },
        now: NOW,
      })?.differs,
    ).toBeDefined();
  });

  it('an inclusive `queried.to == asked.to − 1 step` is exact; `== asked.to` is one step wider', () => {
    const facts = { granularity: '5m' };
    const declared = (to: string) =>
      periodTimeCheck({ window: filled(), declared: [{ from: HOUR.from, to }], facts, now: NOW });
    expect(declared('2026-10-09T14:55:00Z')).toBeUndefined();
    expect(declared(HOUR.to)?.differs?.extra).toEqual([
      { from: HOUR.to, to: '2026-10-09T15:05:00Z' },
    ]);
  });
});

// ─── performance ─────────────────────────────────────────────────────

describe('performance', () => {
  it('10 000 checks stay well inside a budget', () => {
    const started = performance.now();
    for (let i = 0; i < 10_000; i++) {
      periodTimeCheck({
        window: filled(),
        drift: { byMs: 30 * 60_000, outcome: 'shifted' },
        declared: [{ from: HOUR.from, to: '2026-10-09T14:30:00Z' }],
        facts: { retention: '30d', granularity: '1m' },
        now: NOW,
      });
    }
    expect(performance.now() - started).toBeLessThan(4_000);
  });
});
