import { describe, expect, it } from 'vitest';
import { convertForTool, readBack, type PeriodForm } from '../convert.js';
import { readControlWindow, type ControlWindowInput } from '../windowEndpoint.js';

const from = '2026-11-13T18:00:00Z';
const to = '2026-11-13T18:45:00Z';
const context = { now: '2026-11-13T20:00:00Z', zone: 'UTC', granularityMs: 1_000 };
const precise = { ...context, precise: true } as const;
const iso = {
  kind: 'bounds',
  from: { argument: 'from', as: 'iso' },
  to: { argument: 'to', as: 'iso', edge: 'inclusive' },
} as const satisfies PeriodForm;
const msAndIso = { ...iso, from: { ...iso.from, as: 'epoch-ms' } } as const;
const isoAndMs = { ...iso, to: { ...iso.to, as: 'epoch-ms' } } as const;
const seconds = {
  ...iso,
  from: { ...iso.from, as: 'epoch-s' },
  to: { ...iso.to, as: 'epoch-s', edge: 'exclusive' },
} as const;

function confirmed(control: ControlWindowInput) {
  const { from, to, endpoint } = readControlWindow(control)!;
  return { range: { from, to }, endpoint };
}

describe('confirmed conversion honors the declared encoding of each bound', () => {
  it('writes and reads a mixed inclusive ISO point while retaining the legacy read-back', () => {
    const window = confirmed({ from, to, end: 'inclusive', precision: 'minute' });
    const values = { from: Date.parse(from), to };
    expect(convertForTool(window, [iso], undefined, context)).toEqual({
      conversion: { form: 0, values: { from, to } },
    });
    expect(convertForTool(window, [msAndIso], undefined, context)).toEqual({
      conversion: { form: 0, values },
    });
    // An inclusive ISO end is read on the grid it was written at, confirmed or not: a tool
    // handed `18:45:00Z` reads through that second.
    expect(readBack(values, msAndIso, precise)).toEqual({ from, to: '2026-11-13T18:45:01Z' });
    expect(readBack(values, msAndIso, context)).toEqual({ from, to: '2026-11-13T18:45:01Z' });
    expect(convertForTool(window, [isoAndMs], undefined, context)).toEqual({
      refused: 'no-form-holds',
    });
  });

  it('preserves a fractional ISO start alongside the epoch end’s declared tick', () => {
    const from = '2026-11-13T18:00:00.000000001Z';
    const window = confirmed({ from, to });
    const values = { from, to: Date.parse(to) - 1 };
    expect(convertForTool(window, [isoAndMs], undefined, context)).toEqual({
      conversion: { form: 0, values },
    });
    expect(readBack(values, isoAndMs, precise)).toEqual(window.range);
    expect(readBack(values, isoAndMs, context)).toBeUndefined();
  });
});

describe('confirmed conversion records the actual range sent on a coarse grid', () => {
  const asked = { from: '2026-11-13T18:00:00.25Z', to: '2026-11-13T18:45:00.75Z' };
  const window = confirmed(asked);
  const sent = { from, to: '2026-11-13T18:45:01Z' };
  const values = { from: Date.parse(sent.from) / 1_000, to: Date.parse(sent.to) / 1_000 };

  it('records both extra intervals while keeping the legacy conversion shape', () => {
    expect(convertForTool(window, [seconds], undefined, context)).toEqual({
      conversion: {
        form: 0,
        values,
        rounded: true,
        sent,
        extra: [
          { from: sent.from, to: asked.from },
          { from: asked.to, to: sent.to },
        ],
      },
    });
    expect(convertForTool({ range: asked }, [seconds], undefined, context)).toEqual({
      conversion: { form: 0, values, rounded: true },
    });
  });

  it('chooses a later exact form before widening and refuses widening beyond caps', () => {
    expect(convertForTool(window, [seconds, iso], undefined, context)).toMatchObject({
      conversion: { form: 1 },
    });
    expect(convertForTool(window, [seconds], { maxRange: '45m' }, context)).toEqual({
      refused: 'over-max-range',
    });
    const withinCap = confirmed({
      from: '2026-11-13T18:00:00.75Z',
      to: '2026-11-13T18:45:00.25Z',
    });
    expect(convertForTool(withinCap, [seconds], { maxRange: '45m' }, context)).toEqual({
      refused: 'no-form-holds',
    });
    expect(convertForTool(withinCap, [{ ...seconds, maxRange: '45m' }], {}, context)).toEqual({
      refused: 'no-form-holds',
    });
  });

  it('keeps the fractional upper cutoff when only the epoch-second lower bound rounds', () => {
    const window = confirmed({ from: asked.from, to: '2026-11-13T18:45:00.000000001Z' });
    const form = { ...iso, from: { ...iso.from, as: 'epoch-s' } } as const;
    expect(convertForTool(window, [form], undefined, context)).toEqual({
      conversion: {
        form: 0,
        values: { from: Date.parse(from) / 1_000, to },
        rounded: true,
        sent: { from, to: '2026-11-13T18:45:01Z' },
        extra: [
          { from, to: asked.from },
          { from: window.range.to, to: '2026-11-13T18:45:01Z' },
        ],
      },
    });
  });

  it.each(['form', 'tool'] as const)(
    'checks the actual widened bounds against the %s cap',
    (cap) => {
      const form = {
        ...seconds,
        to: { ...seconds.to, as: 'iso' },
        ...(cap === 'form' && { maxRange: '45m' }),
      } as const;
      const facts = cap === 'tool' ? { maxRange: '45m' as const } : undefined;
      expect(
        convertForTool(confirmed({ from: asked.from, to }), [form], facts, context),
      ).toMatchObject({
        conversion: { sent: { from, to }, rounded: true },
      });
      for (const cutoff of ['2026-11-13T18:45:00.0005Z', '2026-11-13T18:45:00.000000001Z']) {
        expect(
          convertForTool(confirmed({ from: asked.from, to: cutoff }), [form], facts, context),
        ).toEqual({ refused: 'no-form-holds' });
      }
    },
  );
});

describe('a confirmed cutoff as an inclusive ISO end stays on the grid tool parsers read', () => {
  const joined = {
    kind: 'joined',
    argument: 'window',
    as: 'iso',
    joiner: '..',
    edge: 'inclusive',
  } as const satisfies PeriodForm;
  const fractionDigits = (value: unknown): number =>
    Math.max(
      0,
      ...[...String(value).matchAll(/:\d\d\.(\d+)/g)].map((m) => (m[1] as string).length),
    );

  it('writes one second before a whole-second cutoff, never nanoseconds', () => {
    const window = confirmed({ from, to });
    const done = convertForTool(window, [joined], undefined, context);
    expect(done).toEqual({
      conversion: { form: 0, values: { window: '2026-11-13T18:00:00Z..2026-11-13T18:44:59Z' } },
    });
    if ('refused' in done) throw new Error(done.refused);
    // What the tool reads with it is the confirmed window again, to the instant.
    expect(readBack(done.conversion.values, joined, precise)).toEqual(window.range);
  });

  it('writes one millisecond before a millisecond cutoff', () => {
    const window = confirmed({ from, to: '2026-11-13T18:45:00.250Z' });
    expect(convertForTool(window, [iso], undefined, context)).toEqual({
      conversion: { form: 0, values: { from, to: '2026-11-13T18:45:00.249Z' } },
    });
  });

  it('a frozen look-back in an inclusive form is sent in UTC on the same grid', () => {
    const lookback = {
      ...confirmed({ from, to: context.now }),
      lookback: '2h',
      freezeLookback: true,
    } as const;
    expect(convertForTool(lookback, [joined], undefined, context)).toEqual({
      conversion: { form: 0, values: { window: '2026-11-13T18:00:00Z..2026-11-13T19:59:59Z' } },
    });
  });

  it('holds for seeded whole-second and millisecond windows: at most three fraction digits', () => {
    let seed = 20261125;
    const next = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const base = Date.parse(from);
    for (let i = 0; i < 300; i++) {
      const unit = next() < 0.5 ? 1_000 : 1;
      const start = base + Math.floor(next() * 3_600) * unit;
      const end = start + (1 + Math.floor(next() * 7_200)) * unit;
      const window = confirmed({
        from: new Date(start).toISOString(),
        to: new Date(end).toISOString(),
      });
      for (const form of [joined, iso]) {
        const done = convertForTool(window, [form], undefined, context);
        if ('refused' in done) throw new Error(`case ${i}: ${done.refused}`);
        for (const value of Object.values(done.conversion.values)) {
          expect(fractionDigits(value)).toBeLessThanOrEqual(3);
        }
        // The same instants (the spelling of a millisecond may differ).
        const read = readBack(done.conversion.values, form, precise);
        expect([Date.parse(read!.from), Date.parse(read!.to)]).toEqual([start, end]);
      }
    }
  });
});
