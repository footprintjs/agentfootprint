/**
 * T1b · the covering look-back for a length-only source — the pure pieces:
 * `time/convert/covering.ts` (`sourceClockLookback`, `coveringLookback`),
 * `time/drift.ts` · `coverAtDispatch`, `time/frozenDispatch.ts` ·
 * `coveringDispatchMatches`, the row arms (`rows.ts` · `timeRowIsWellFormed`),
 * the result check's read (`check.ts` · `periodTimeCheck`) and the note's
 * inputs (`arguments/resolve.ts` · `widerOf`, `arguments/dispatch.ts` ·
 * `fillsThatRan`).
 *
 * Law: a confirmed look-back is never read shorter because a click took time.
 * The value sent at dispatch is the smallest length in the form's units that
 * still reaches the window's start from the dispatch moment; a window still
 * running, or a length past the form's cap, is refused, never shortened.
 *
 * Test types:
 *   unit      — each step's table rows; the read source `sent` for a covered call; the note labels;
 *   boundary  — a cutoff equal to the dispatch moment is closed, one millisecond later is running;
 *               the exact cap runs, one unit past it does not; sub-millisecond bounds;
 *   property  — for seeded starts, lengths and drifts the read covers the window and is minimal;
 *   security  — forged `covered` drift and `coversAtDispatch` rows are refused; final arguments a
 *               middleware rewrote, or that gained another period argument, do not match.
 */

import { describe, expect, it } from 'vitest';

import { fillsThatRan } from '../../src/core/agent/arguments/dispatch.js';
import { widerOf, type ArgumentResolution } from '../../src/core/agent/arguments/resolve.js';
import { periodTimeCheck } from '../../src/time/check.js';
import { coveringLookback, sourceClockLookback } from '../../src/time/convert/covering.js';
import { coverAtDispatch } from '../../src/time/drift.js';
import { coveringDispatchMatches } from '../../src/time/frozenDispatch.js';
import type { PeriodForm } from '../../src/time/periodForm.js';
import type { CallWindowRow } from '../../src/time/rows.js';
import { timeRowIsWellFormed } from '../../src/time/rows.js';

const NOW = '2026-11-13T20:00:00Z';
const NOW_MS = Date.parse(NOW);
const iso = (ms: number): string => new Date(ms).toISOString();
const ASKED = { from: '2026-11-13T18:00:00Z', to: NOW };
const minutes = { kind: 'lookback', argument: 'window', signed: false, units: 'm' } as const;
const hours = { kind: 'lookback', argument: 'window', signed: false, units: 'h' } as const;
const signed = { kind: 'lookback', argument: 'window', signed: true } as const;
const bounds = {
  kind: 'bounds',
  from: { argument: 'from', as: 'iso' },
  to: { argument: 'to', as: 'iso', edge: 'exclusive' },
} as const satisfies PeriodForm;
const ms = (text: string): number => Date.parse(text);

// ─── unit ────────────────────────────────────────────────────────────

describe('unit — the value before dispatch', () => {
  it('is the window’s own length in the form’s units', () => {
    expect(sourceClockLookback(ASKED, minutes, NOW)).toEqual({
      values: { window: '120m' },
      rounded: false,
    });
    expect(sourceClockLookback(ASKED, hours, NOW)).toEqual({
      values: { window: '2h' },
      rounded: false,
    });
    expect(sourceClockLookback(ASKED, signed, NOW)).toEqual({
      values: { window: '-2h' },
      rounded: false,
    });
  });

  it('reaches a closed past range from the frozen clock', () => {
    const past = { from: '2026-11-13T17:00:00Z', to: '2026-11-13T18:00:00Z' };
    expect(sourceClockLookback(past, minutes, NOW)).toEqual({
      values: { window: '180m' },
      rounded: false,
    });
  });

  it('rounds up to the finest unit and says so', () => {
    const ninety = { from: '2026-11-13T18:30:00Z', to: NOW };
    expect(sourceClockLookback(ninety, hours, NOW)).toEqual({
      values: { window: '2h' },
      rounded: true,
    });
  });

  it('is nothing for an empty, inverted or still-running range, or a length past the cap', () => {
    expect(sourceClockLookback({ from: NOW, to: NOW }, minutes, NOW)).toBeUndefined();
    expect(sourceClockLookback({ from: NOW, to: ASKED.from }, minutes, NOW)).toBeUndefined();
    expect(sourceClockLookback(ASKED, minutes, iso(NOW_MS - 1))).toBeUndefined();
    expect(sourceClockLookback(ASKED, minutes, NOW, 2 * 3_600_000)).toBeDefined();
    expect(sourceClockLookback(ASKED, minutes, NOW, 2 * 3_600_000 - 1)).toBeUndefined();
  });
});

describe('unit — the covering value at dispatch', () => {
  it('reaches the window start from the dispatch moment and names what it adds', () => {
    const cover = coveringLookback(ASKED, minutes, iso(NOW_MS + 61_000));
    if ('uncoverable' in cover) throw new Error(cover.uncoverable);
    expect(cover.values).toEqual({ window: '122m' });
    expect([ms(cover.sent.from), ms(cover.sent.to)]).toEqual([
      NOW_MS + 61_000 - 122 * 60_000,
      NOW_MS + 61_000 + 1,
    ]);
    expect(cover.extra.map((part) => [ms(part.from), ms(part.to)])).toEqual([
      [NOW_MS + 61_000 - 122 * 60_000, ms(ASKED.from)],
      [NOW_MS, NOW_MS + 61_000 + 1],
    ]);
  });

  it('keeps the sign and the units the form declares', () => {
    const cover = coveringLookback(ASKED, signed, iso(NOW_MS + 61_000));
    expect('values' in cover && cover.values).toEqual({ window: '-122m' });
    const coarse = coveringLookback(ASKED, hours, iso(NOW_MS + 61_000));
    expect('values' in coarse && coarse.values).toEqual({ window: '3h' });
  });

  it('is decided per call from its `call-window` row, and only for a covering fill', () => {
    const clock = { now: NOW, dispatchedAt: iso(NOW_MS + 61_000) };
    const row = { how: 'filled', form: 0, asked: ASKED, coversAtDispatch: true } as const;
    expect(coverAtDispatch(row, [minutes], clock)).toMatchObject({
      byMs: 61_000,
      outcome: 'covered',
      form: 0,
      values: { window: '122m' },
    });
    expect(coverAtDispatch({ ...row, coversAtDispatch: undefined }, [minutes], clock)).toBe(
      undefined,
    );
    expect(coverAtDispatch({ ...row, how: 'model-chosen' }, [minutes], clock)).toBe(undefined);
    // The row names a form that is not a look-back: nothing can be lengthened.
    expect(coverAtDispatch(row, [bounds], clock)).toEqual({
      outcome: 'uncoverable',
      why: 'still-running',
    });
  });

  it('holds the look-back to the form’s own cap, else the tool’s', () => {
    const clock = { now: NOW, dispatchedAt: iso(NOW_MS + 61_000) };
    const row = { how: 'filled', form: 0, asked: ASKED, coversAtDispatch: true } as const;
    const over = { outcome: 'uncoverable', why: 'max-range' };
    expect(coverAtDispatch(row, [{ ...minutes, maxRange: '2h' }], clock)).toEqual(over);
    expect(coverAtDispatch(row, [minutes], clock, { maxRange: '2h' })).toEqual(over);
    expect(
      coverAtDispatch(row, [{ ...minutes, maxRange: '3h' }], clock, { maxRange: '2h' }),
    ).toMatchObject({ outcome: 'covered' });
  });
});

describe('unit — the record and the note', () => {
  const covered = {
    byMs: 61_000,
    outcome: 'covered',
    form: 0,
    sent: { from: iso(NOW_MS + 61_000 - 122 * 60_000), to: iso(NOW_MS + 61_001) },
  } as const;

  it('the result check reads a covered call as what was sent', () => {
    const check = periodTimeCheck({
      window: { how: 'filled', form: 0, asked: ASKED },
      drift: covered,
      forms: [minutes],
      now: NOW,
    });
    expect(check?.differs).toMatchObject({ source: 'sent', missing: [] });
    expect(check?.differs?.extra).toHaveLength(2);
    expect(check).not.toHaveProperty('shifted');
  });

  it('a declared read replaces the estimate, and a trimming tool reads the asked range', () => {
    const declared = periodTimeCheck({
      window: { how: 'filled', form: 0, asked: ASKED },
      drift: covered,
      declared: [{ from: ASKED.from, to: iso(NOW_MS + 5 * 60_000) }],
      forms: [minutes],
      now: NOW,
    });
    expect(declared?.differs).toMatchObject({ source: 'declared' });
    const trimmed = periodTimeCheck({
      window: { how: 'filled', form: 0, asked: ASKED, trimmedByTool: true },
      drift: covered,
      forms: [minutes],
      now: NOW,
    });
    expect(trimmed).toBeUndefined();
  });

  it('labels the fill for the note', () => {
    expect(widerOf({ coversAtDispatch: true }, false)).toBe('source-clock');
    expect(widerOf({ coversAtDispatch: true }, true)).toBe('source-clock-trims');
    expect(widerOf({ sent: ASKED } as never, false)).toBe('reads-more');
    expect(widerOf({ sent: ASKED } as never, true)).toBe('tool-trims');
    expect(widerOf({}, true)).toBeUndefined();
  });

  it('a lengthened fill ran with the lengthened value; any other rewritten fill did not run', () => {
    const fill = (wider?: 'reads-more' | 'source-clock' | 'source-clock-trims') =>
      ({
        fills: [
          {
            argument: 'window',
            value: '120m',
            source: 'window',
            from: 'answered',
            ...(wider !== undefined && { wider }),
          },
        ],
      } as unknown as ArgumentResolution);
    expect(fillsThatRan(fill('source-clock'), { window: '122m' })).toEqual([
      expect.objectContaining({ value: '122m', wider: 'source-clock' }),
    ]);
    expect(fillsThatRan(fill('source-clock-trims'), { window: '122m' })).toHaveLength(1);
    expect(fillsThatRan(fill('reads-more'), { window: '122m' })).toEqual([]);
    expect(fillsThatRan(fill(), { window: '122m' })).toEqual([]);
    expect(fillsThatRan(fill('source-clock'), { window: 122 })).toEqual([]);
    expect(fillsThatRan(fill('source-clock'), {})).toEqual([]);
  });
});

// ─── boundary ────────────────────────────────────────────────────────

describe('boundary — closed, running, and the cap', () => {
  it('a cutoff equal to the dispatch moment is closed; one millisecond later is still running', () => {
    const closed = coveringLookback(ASKED, minutes, iso(NOW_MS));
    expect('values' in closed && closed.values).toEqual({ window: '120m' });
    expect(coveringLookback(ASKED, minutes, iso(NOW_MS - 1))).toEqual({
      uncoverable: 'still-running',
    });
  });

  it('one millisecond of drift costs one whole unit, never a shorter read', () => {
    const cover = coveringLookback(ASKED, minutes, iso(NOW_MS + 1));
    expect('values' in cover && cover.values).toEqual({ window: '121m' });
  });

  it('runs at the exact cap and refuses one unit past it', () => {
    const cap = 2 * 3_600_000;
    expect(coveringLookback(ASKED, minutes, iso(NOW_MS), cap)).toMatchObject({
      values: { window: '120m' },
    });
    expect(coveringLookback(ASKED, minutes, iso(NOW_MS + 1), cap)).toEqual({
      uncoverable: 'max-range',
    });
  });

  it('covers a start and an end written past the millisecond', () => {
    const precise = {
      from: '2026-11-13T18:00:00.000000001Z',
      to: '2026-11-13T20:00:00.000000001Z',
    };
    // The end is past the dispatch millisecond: the window is still running then.
    expect(coveringLookback(precise, minutes, iso(NOW_MS))).toEqual({
      uncoverable: 'still-running',
    });
    const cover = coveringLookback(precise, minutes, iso(NOW_MS + 1));
    if ('uncoverable' in cover) throw new Error(cover.uncoverable);
    expect(ms(cover.sent.from)).toBeLessThanOrEqual(ms(ASKED.from));
    expect(sourceClockLookback(precise, minutes, iso(NOW_MS + 1))).toEqual({
      values: { window: '121m' },
      rounded: true,
    });
  });
});

// ─── property ────────────────────────────────────────────────────────

describe('property — the read covers the window and is minimal', () => {
  it('holds for seeded starts, lengths, units and drifts', () => {
    let seed = 20261124;
    const next = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const unitMs = { m: 60_000, h: 3_600_000 } as const;
    for (let i = 0; i < 400; i++) {
      const form = next() < 0.5 ? minutes : hours;
      const finest = unitMs[form.units];
      const to = NOW_MS - Math.floor(next() * 3_600_000);
      const from = to - 1 - Math.floor(next() * 36 * 3_600_000);
      const at = to + Math.floor(next() * 7_200_000);
      const cover = coveringLookback({ from: iso(from), to: iso(to) }, form, iso(at));
      if ('uncoverable' in cover) throw new Error(`case ${i}: ${cover.uncoverable}`);
      const sentFrom = ms(cover.sent.from);
      // Covers: starts at or before the asked start, ends at or after the asked end.
      expect(sentFrom).toBeLessThanOrEqual(from);
      expect(ms(cover.sent.to)).toBeGreaterThanOrEqual(to);
      // Minimal: one unit shorter would start after the asked start.
      expect(sentFrom + finest).toBeGreaterThan(from);
      // What it adds lies outside the asked window, on the side it says.
      for (const part of cover.extra) {
        expect(ms(part.to) <= from || ms(part.from) >= to).toBe(true);
      }
    }
  });
});

// ─── security ────────────────────────────────────────────────────────

describe('security — forged rows and rewritten arguments', () => {
  const window: CallWindowRow = {
    kind: 'call-window',
    turn: 1,
    iteration: 1,
    toolCallId: 'call',
    toolName: 'ruler',
    how: 'filled',
    form: 0,
    asked: ASKED,
    person: { ...ASKED, source: 'answered', mention: 0 },
    coversAtDispatch: true,
  };
  const call = (drift: unknown) => ({
    kind: 'call',
    turn: 1,
    iteration: 1,
    toolCallId: 'call',
    toolName: 'ruler',
    dispatchedAt: iso(NOW_MS + 61_000),
    drift,
  });
  const sent = { from: iso(NOW_MS + 61_000 - 122 * 60_000), to: iso(NOW_MS + 61_001) };

  it('admits a covering row and a covered drift, zero drift included', () => {
    expect(timeRowIsWellFormed(window)).toBe(true);
    expect(timeRowIsWellFormed({ ...window, trimmedByTool: true })).toBe(true);
    expect(timeRowIsWellFormed(call({ byMs: 61_000, outcome: 'covered', form: 0, sent }))).toBe(
      true,
    );
    expect(timeRowIsWellFormed(call({ byMs: 0, outcome: 'covered', form: 0, sent }))).toBe(true);
  });

  it('refuses a forged covering row', () => {
    expect(timeRowIsWellFormed({ ...window, coversAtDispatch: 'yes' })).toBe(false);
    expect(timeRowIsWellFormed({ ...window, sent })).toBe(false);
    expect(timeRowIsWellFormed({ ...window, differs: { extra: [sent] } })).toBe(false);
    expect(timeRowIsWellFormed({ ...window, how: 'bound', by: 'value' })).toBe(false);
    expect(timeRowIsWellFormed({ ...window, how: 'model-chosen' })).toBe(false);
  });

  it('refuses a forged covered drift', () => {
    const forged = [
      { byMs: -1, outcome: 'covered', form: 0, sent },
      { byMs: 61_000, outcome: 'covered', form: 0 },
      { byMs: 61_000, outcome: 'covered', sent },
      { byMs: 61_000, outcome: 'covered', form: 0, sent: { from: 'soon', to: 'later' } },
      { byMs: 61_000, outcome: 'covered', form: 0, sent, values: { window: '9999h' } },
      { byMs: 0, outcome: 'shifted' },
    ];
    for (const drift of forged) expect(timeRowIsWellFormed(call(drift))).toBe(false);
  });

  it('matches only the library’s own look-back in the final arguments', () => {
    const forms = [minutes, bounds] as const;
    expect(coveringDispatchMatches(window, { window: '120m' }, forms, NOW)).toBe(true);
    // Another spelling of the same length is the same look-back.
    expect(coveringDispatchMatches(window, { window: '120m', limit: 5 }, forms, NOW)).toBe(true);
    // A middleware rewrote the length, removed it, or added another period argument.
    expect(coveringDispatchMatches(window, { window: '180m' }, forms, NOW)).toBe(false);
    expect(coveringDispatchMatches(window, {}, forms, NOW)).toBe(false);
    expect(
      coveringDispatchMatches(window, { window: '120m', from: ASKED.from, to: NOW }, forms, NOW),
    ).toBe(false);
    // The row names a form that is not a look-back.
    expect(coveringDispatchMatches({ ...window, form: 1 }, { window: '120m' }, forms, NOW)).toBe(
      false,
    );
  });
});
