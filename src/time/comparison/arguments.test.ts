import { describe, expect, it } from 'vitest';
import type { BindContext, CallToBind } from '../bind.js';
import type { PeriodForm } from '../periodForm.js';
import { readControlWindow, type ControlWindowInput } from '../windowEndpoint.js';
import type { TurnWindow } from '../windows.js';
import { comparisonArgumentsMatch, exactComparisonArguments } from './arguments.js';

const range = { from: '2026-11-13T10:00:00Z', to: '2026-11-13T12:00:00Z' };
const ctx = { now: '2026-11-13T20:00:00Z', zone: 'UTC', granularityMs: 1_000 } as const;
const exclusive = {
  kind: 'bounds',
  from: { argument: 'from', as: 'iso' },
  to: { argument: 'to', as: 'iso', edge: 'exclusive' },
} as const;
const inclusive = {
  kind: 'joined',
  argument: 'interval',
  as: 'iso',
  joiner: '..',
  edge: 'inclusive',
} as const;
const epoch = {
  kind: 'object',
  argument: 'period',
  keys: { from: 'start', to: 'stop' },
  as: 'epoch-s',
  edge: 'inclusive',
} as const;
const relative = { kind: 'lookback', argument: 'last', signed: false } as const;
const lastNanosecond = '2026-11-13T11:59:59.999999999Z';

function confirmed(value: ControlWindowInput = range): TurnWindow {
  const recorded = readControlWindow(value)!;
  return {
    source: 'control',
    range: { from: recorded.from, to: recorded.to },
    endpoint: recorded.endpoint,
    zone: 'UTC',
  };
}

function call(
  forms: readonly PeriodForm[],
  args: Readonly<Record<string, unknown>> = {},
  facts?: CallToBind['facts'],
): CallToBind {
  return {
    args,
    forms,
    facts,
    isMissing: (key) => !Object.hasOwn(args, key) || args[key] == null || args[key] === '',
  };
}

describe('choose the first exactly representable comparison form', () => {
  it('fills empty and partial bounds without inventing an original range', () => {
    for (const args of [{}, { from: range.from }, { from: range.from, to: 'not a date' }]) {
      expect(exactComparisonArguments(call([exclusive], args), confirmed(), ctx)).toEqual({
        form: 0,
        values: range,
        same: false,
      });
    }
  });

  it.each([
    { from: '2026-11-13T10:01:00Z', to: range.to },
    { from: range.from, to: '2026-11-13T11:59:00Z' },
  ])('corrects either bound and retains the readable original %#', (original) => {
    expect(exactComparisonArguments(call([exclusive], original), confirmed(), ctx)).toEqual({
      form: 0,
      values: range,
      same: false,
      original,
    });
  });

  it('preserves an exact proposed spelling and ignores unrelated arguments', () => {
    const values = { from: '2026-11-13T04:00:00-06:00', to: '2026-11-13T06:00:00.000-06:00' };
    const args = Object.freeze({ ...values, query: 'test' });
    expect(exactComparisonArguments(call([exclusive], args), confirmed(), ctx)).toEqual({
      form: 0,
      values,
      same: true,
    });
  });

  it('honors original declaration order in both arrangements', () => {
    const joined = { interval: `${range.from}..${lastNanosecond}` };
    expect(
      exactComparisonArguments(call([relative, inclusive, exclusive], range), confirmed(), ctx),
    ).toMatchObject({ form: 1, values: joined });
    expect(
      exactComparisonArguments(call([relative, exclusive, inclusive], joined), confirmed(), ctx),
    ).toMatchObject({ form: 1, values: range });
  });

  it('distinguishes an inclusive ISO point from an inclusive declared epoch tick', () => {
    const coarse = { interval: `${range.from}..2026-11-13T11:59:59Z` };
    const fine = { interval: `${range.from}..${lastNanosecond}` };
    const coarseDecision = exactComparisonArguments(call([inclusive], coarse), confirmed(), ctx);
    expect(coarseDecision).toEqual({
      form: 0,
      values: fine,
      same: false,
      original: { from: range.from, to: '2026-11-13T11:59:59.000000001Z' },
    });
    expect(exactComparisonArguments(call([inclusive], fine), confirmed(), ctx)).toEqual({
      form: 0,
      values: fine,
      same: true,
    });
    const grid = {
      period: { start: Date.parse(range.from) / 1_000, stop: Date.parse(range.to) / 1_000 - 1 },
    };
    expect(exactComparisonArguments(call([epoch], grid), confirmed(), ctx)).toEqual({
      form: 0,
      values: grid,
      same: true,
    });
    expect(comparisonArgumentsMatch(coarse, [inclusive], 0, range, ctx)).toBe(false);
    expect(comparisonArgumentsMatch(grid, [epoch], 0, range, ctx)).toBe(true);
  });

  it('preserves each bound’s declared precision on mixed ISO and epoch input', () => {
    const mixedEnd = {
      ...exclusive,
      from: { argument: 'from', as: 'epoch-ms' },
      to: { ...exclusive.to, edge: 'inclusive' },
    } as const;
    const end = confirmed({ ...range, end: 'inclusive' });
    const first = { from: Date.parse(range.from), to: range.to };
    expect(exactComparisonArguments(call([mixedEnd]), end, ctx)).toEqual({
      form: 0,
      values: first,
      same: false,
    });
    expect(comparisonArgumentsMatch(first, [mixedEnd], 0, end.range, ctx)).toBe(true);
    const mixedStart = { ...exclusive, to: { ...exclusive.to, as: 'epoch-s' } } as const;
    const start = confirmed({ ...range, from: '2026-11-13T10:00:00.000000001Z' });
    const second = { from: start.range.from, to: Date.parse(range.to) / 1_000 };
    expect(exactComparisonArguments(call([mixedStart]), start, ctx)).toEqual({
      form: 0,
      values: second,
      same: false,
    });
    expect(comparisonArgumentsMatch(second, [mixedStart], 0, start.range, ctx)).toBe(true);
  });

  it('skips a rounded epoch or widened substitute and keeps its form index', () => {
    const fractional = confirmed({ ...range, to: '2026-11-13T12:00:00.010Z' });
    expect(exactComparisonArguments(call([epoch, exclusive]), fractional, ctx)).toMatchObject({
      form: 1,
      values: fractional.range,
    });
    expect(
      exactComparisonArguments(call([epoch], {}, { filtersToAsked: true }), fractional, ctx),
    ).toBeUndefined();
    expect(exactComparisonArguments(call([relative]), confirmed(), ctx)).toBeUndefined();
    expect(exactComparisonArguments(call([]), confirmed(), ctx)).toBeUndefined();
  });

  it('uses an exact calendar day, and refuses widened days and ambiguous wall times', () => {
    const zoneContext = { ...ctx, appZone: 'America/Chicago' } satisfies BindContext;
    const day = { kind: 'day', argument: 'day' } as const;
    const fallBack = { from: '2026-11-01T05:00:00Z', to: '2026-11-02T06:00:00Z' };
    expect(exactComparisonArguments(call([day]), confirmed(fallBack), zoneContext)).toMatchObject({
      form: 0,
      values: { day: '2026-11-01' },
    });
    expect(exactComparisonArguments(call([day]), confirmed(range), zoneContext)).toBeUndefined();
    const wall = { kind: 'joined', argument: 'wall', as: 'wall', joiner: '..' } as const;
    const doubledHour = { from: '2026-11-01T06:30:00Z', to: '2026-11-01T08:30:00Z' };
    expect(
      exactComparisonArguments(call([wall]), confirmed(doubledHour), zoneContext),
    ).toBeUndefined();
  });

  it('enforces per-form limits, direction and full retention refusal', () => {
    const forms = [
      { ...inclusive, maxRange: '1h' },
      { ...exclusive, maxRange: '3h' },
    ] as const;
    expect(
      exactComparisonArguments(call(forms, {}, { maxRange: '1h' }), confirmed(), ctx),
    ).toMatchObject({ form: 1, values: range });
    expect(
      exactComparisonArguments(call([exclusive], range, { maxRange: '1h' }), confirmed(), ctx),
    ).toBeUndefined();
    expect(
      exactComparisonArguments(call([exclusive], range, { direction: 'future' }), confirmed(), ctx),
    ).toBeUndefined();
    expect(
      exactComparisonArguments(call([exclusive], range, { retention: '8h' }), confirmed(), ctx),
    ).toBeUndefined();
    expect(
      exactComparisonArguments(call([exclusive], range, { retention: '9h' }), confirmed(), ctx),
    ).toMatchObject({ form: 0, same: true });
    expect(
      exactComparisonArguments(call([exclusive], {}, { maxRange: '2h' }), confirmed(), ctx),
    ).toBeDefined();
    expect(
      exactComparisonArguments(
        call([exclusive], {}, { maxRange: '2h' }),
        confirmed({ ...range, to: '2026-11-13T12:00:00.000000001Z' }),
        ctx,
      ),
    ).toBeUndefined();
  });

  it('keeps an anchored look-back absolute and does not re-anchor it at dispatch', () => {
    const frozen = { ...confirmed(), lookback: '2h' } as const;
    expect(
      exactComparisonArguments(call([relative, exclusive], { last: '2h' }), frozen, ctx),
    ).toMatchObject({ form: 1, values: range });
    expect(exactComparisonArguments(call([relative], { last: '2h' }), frozen, ctx)).toBeUndefined();
  });

  it('bounds form processing before looking at any arguments', () => {
    const seven = Array.from({ length: 7 }, (_, index) => ({
      ...relative,
      argument: `last${index}`,
    }));
    const eight = [...seven, exclusive];
    expect(exactComparisonArguments(call(eight), confirmed(), ctx)).toMatchObject({
      form: 7,
      values: range,
    });
    expect(comparisonArgumentsMatch(range, eight, 7, range, ctx)).toBe(true);
    const nine = [...eight, relative];
    const guarded = {
      ...call(nine),
      isMissing: () => {
        throw new Error('read arguments before the cap');
      },
    };
    expect(exactComparisonArguments(guarded, confirmed(), ctx)).toBeUndefined();
    expect(comparisonArgumentsMatch(range, nine, 7, range, ctx)).toBe(false);
  });
});

describe('check the entire declared period surface', () => {
  const sharingFrom = { ...exclusive, to: { ...exclusive.to, argument: 'until' } } as const;
  const forms = [exclusive, sharingFrom, relative];

  it('keeps shared and unrelated keys but refuses even an incomplete restored competitor', () => {
    expect(comparisonArgumentsMatch({ ...range, details: 'changed' }, forms, 0, range, ctx)).toBe(
      true,
    );
    for (const stray of [{ last: '2h' }, { last: undefined }, { until: 'bad date' }]) {
      const args = { ...range, ...stray };
      expect(comparisonArgumentsMatch(args, forms, 0, range, ctx)).toBe(false);
      expect(exactComparisonArguments(call(forms, args), confirmed(), ctx)).toMatchObject({
        form: 0,
        values: range,
        same: false,
      });
    }
  });

  it('keeps no original interval when alternatives conflict or a period key is unread', () => {
    const two = { ...range, until: '2026-11-13T11:00:00Z' };
    const malformed = { ...range, last: 'n/a' };
    for (const args of [two, malformed]) {
      expect(exactComparisonArguments(call(forms, args), confirmed(), ctx)).toEqual({
        form: 0,
        values: range,
        same: false,
      });
    }
  });

  it('refuses conflicting interpretations on the very same argument names', () => {
    const shared = { ...exclusive, to: { ...exclusive.to, edge: 'inclusive' } } as const;
    expect(comparisonArgumentsMatch(range, [exclusive, shared], 0, range, ctx)).toBe(false);
    expect(exactComparisonArguments(call([exclusive, shared]), confirmed(), ctx)).toBeUndefined();
  });

  it('admits a shared object argument but clears competing bound keys within it', () => {
    const sibling = { ...epoch, keys: { from: 'start', to: 'until' } } as const;
    const alternates = [epoch, sibling];
    const values = {
      period: {
        start: Date.parse(range.from) / 1_000,
        stop: Date.parse(range.to) / 1_000 - 1,
        details: 'preserved',
      },
    };
    expect(comparisonArgumentsMatch(values, alternates, 0, range, ctx)).toBe(true);
    for (const stop of [values.period.stop, values.period.stop - 600]) {
      const args = { period: { ...values.period, stop, until: null } };
      expect(comparisonArgumentsMatch(args, alternates, 0, range, ctx)).toBe(false);
      expect(exactComparisonArguments(call(alternates, args), confirmed(), ctx)).toEqual({
        form: 0,
        values,
        same: false,
      });
    }
  });

  it('rejects a final period change to either end and accepts an equivalent redraw', () => {
    expect(
      comparisonArgumentsMatch(
        { ...range, from: '2026-11-13T10:00:00.000000001Z' },
        forms,
        0,
        range,
        ctx,
      ),
    ).toBe(false);
    expect(
      comparisonArgumentsMatch(
        { ...range, to: '2026-11-13T12:00:00.000000001Z' },
        forms,
        0,
        range,
        ctx,
      ),
    ).toBe(false);
    expect(
      comparisonArgumentsMatch({ ...range, to: '2026-11-13T06:00:00-06:00' }, forms, 0, range, ctx),
    ).toBe(true);
    expect(comparisonArgumentsMatch({ last: '2h' }, forms, 2, range, ctx)).toBe(false);
  });
});
