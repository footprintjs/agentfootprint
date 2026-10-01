/**
 * `agentfootprint/time` — the time layer's conversions for an app OUTSIDE a run
 * (`src/doors/time.ts`): THE answer `convertForTool`, the tool's declaration read the run's way
 * (`sugarForms`, `granularityMsOf`, `widestMsOf`), and the parts (`convertExact`,
 * `convertWidened`, `periodFactProblem`).
 *
 *   unit        — each documented example answers what the docs say it answers
 *                 (the door header, docs-next build/time.mdx, src/core/time/README.md); a tool's
 *                 `maxRange`, a `day`-only tool's `multi-day` and a partly-retained window reach
 *                 the app through `convertForTool` — the parts alone cannot see them;
 *   integration — the door's answer IS the run's: examples/features/85-time-widen-and-refuse.ts
 *                 asks `convertForTool` over each tool's own `period` and checks it against an
 *                 armed agent — the values handed and the read filed for a confirmed "yesterday",
 *                 and the `no-form-holds` refusal filed for a one-day (`maxRange: '24h'`) tool;
 *   property    — the run's order, over 600 seeded windows × single- and multi-form lists: an
 *                 exact form, when one exists, is the answer; a single form never answers both
 *                 exactly and widened; a widened read contains the window and stays within
 *                 `maxRange`;
 *   byte identity — the door adds no names beyond its list (pinned in
 *                 test/api-conformance/subpath-exports.test.ts) and nothing to the root graph
 *                 (test/lib/trace-toolpack/browserGraph.test.ts).
 */

import { describe, expect, it } from 'vitest';

import {
  convertExact,
  convertForTool,
  convertWidened,
  granularityMsOf,
  isZoneName,
  periodFactProblem,
  presentRange,
  sugarForms,
  widestMsOf,
  type ConvertContext,
  type WindowToConvert,
} from '../../../src/doors/time.js';
import type {
  PeriodForm,
  SourceClockRow,
  TimeAnswerRow,
  TimeDerivedRow,
} from '../../../src/index.js';

const clock: ConvertContext = {
  now: '2026-10-09T15:40:00Z',
  zone: 'America/Los_Angeles',
  granularityMs: 60_000,
};
const yesterday = { from: '2026-10-08T00:00:00-07:00', to: '2026-10-09T00:00:00-07:00' };
const lookback: readonly PeriodForm[] = [{ kind: 'lookback', argument: 'w', signed: false }];
const epochBounds: readonly PeriodForm[] = [
  {
    kind: 'bounds',
    from: { argument: 'start', as: 'epoch-ms' },
    to: { argument: 'end', as: 'epoch-ms', edge: 'exclusive' },
  },
];
const day: readonly PeriodForm[] = [{ kind: 'day', argument: 'd', zone: { argument: 'tz' } }];

describe('the documented examples', () => {
  it('a look-back cannot hold yesterday exactly — it ends at now', () => {
    expect(convertExact({ range: yesterday }, lookback, clock)).toBeUndefined();
  });

  it('the covering look-back reads yesterday and the gap after it', () => {
    expect(convertWidened({ range: yesterday }, lookback, clock)).toEqual({
      form: 0,
      values: { w: '1960m' },
      sent: { from: '2026-10-08T07:00:00Z', to: '2026-10-09T15:40:00.001Z' },
      extra: [{ from: '2026-10-09T07:00:00Z', to: '2026-10-09T15:40:00.001Z' }],
    });
  });

  it('two epoch-ms bounds hold an o’clock hour exactly, the end exclusive', () => {
    const hour = { from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T09:00:00-07:00' };
    expect(convertExact({ range: hour }, epochBounds, clock)).toEqual({
      form: 0,
      values: { start: 1791558000000, end: 1791561600000 },
    });
  });

  it('a range inside one day widens to that day on a day-only tool', () => {
    const morning = { from: '2026-10-08T08:00:00-07:00', to: '2026-10-08T09:00:00-07:00' };
    const widened = convertWidened({ range: morning }, day, clock);
    expect(widened?.values).toEqual({ d: '2026-10-08', tz: 'America/Los_Angeles' });
    // The whole Los Angeles day, spelled in UTC.
    expect(widened?.sent).toEqual({ from: '2026-10-08T07:00:00Z', to: '2026-10-09T07:00:00Z' });
  });

  it('the facts a range breaks, as codes', () => {
    expect(periodFactProblem(yesterday, { direction: 'future' }, clock.now)).toBe('time-past');
    expect(periodFactProblem(yesterday, { direction: 'past', maxRange: '12h' }, clock.now)).toBe(
      'over-max-range',
    );
    expect(periodFactProblem(yesterday, { direction: 'past', retention: '30d' }, clock.now)).toBe(
      undefined,
    );
  });

  it('a window wider than maxRange is skipped by the widened read', () => {
    expect(convertWidened({ range: yesterday }, lookback, clock, 24 * 3_600_000)).toBeUndefined();
  });
});

describe('convertForTool — the run’s whole question, from the tool’s own period', () => {
  const oneDay = {
    argument: 'w',
    spelling: 'lookback',
    direction: 'past',
    maxRange: '24h',
  } as const;
  const clockOf = (period: Parameters<typeof granularityMsOf>[0]): ConvertContext => ({
    ...clock,
    granularityMs: granularityMsOf(period),
  });

  it('the documented example: a look-back tool that reads at most a day refuses yesterday', () => {
    expect(
      convertForTool({ range: yesterday }, sugarForms(oneDay), oneDay, clockOf(oneDay)),
    ).toEqual({ refused: 'no-form-holds' });
    // The parts alone, without the tool's maxRange, would preview a read the run refuses.
    expect(convertWidened({ range: yesterday }, sugarForms(oneDay), clock)?.values).toEqual({
      w: '1960m',
    });
    expect(
      convertWidened({ range: yesterday }, sugarForms(oneDay), clock, widestMsOf(oneDay)),
    ).toBeUndefined();
  });

  it('the declaration read the run’s way: forms from the sugar, step and widest read from the facts', () => {
    expect(sugarForms(oneDay)).toEqual(lookback);
    expect(sugarForms({ forms: day })).toBe(day);
    expect(granularityMsOf({})).toBe(60_000);
    expect(granularityMsOf({ granularity: '5m' })).toBe(300_000);
    expect(widestMsOf({})).toBeUndefined();
    expect(widestMsOf(oneDay)).toBe(86_400_000);
  });

  it('a broken fact is the refusal, before any form is tried', () => {
    expect(convertForTool({ range: yesterday }, lookback, { direction: 'future' }, clock)).toEqual({
      refused: 'time-past',
    });
  });

  it('a window over two days on a day-only tool is refused multi-day', () => {
    const twoDays = { from: '2026-10-06T00:00:00-07:00', to: '2026-10-08T00:00:00-07:00' };
    expect(convertForTool({ range: twoDays }, day, {}, clock)).toEqual({ refused: 'multi-day' });
  });

  it('a window only partly older than retention converts, marked', () => {
    expect(convertForTool({ range: yesterday }, lookback, { retention: '1d' }, clock)).toEqual({
      conversion: convertWidened({ range: yesterday }, lookback, clock),
      partlyBeyondRetention: true,
    });
  });

  it('an exact form wins over an earlier form that only widens', () => {
    const hour = { from: '2026-10-08T08:00:00-07:00', to: '2026-10-08T09:00:00-07:00' };
    const dayThenBounds = [...day, ...epochBounds];
    const read = convertForTool({ range: hour }, dayThenBounds, {}, clock);
    expect(read).toEqual({ conversion: convertExact({ range: hour }, dayThenBounds, clock) });
    expect('conversion' in read && read.conversion.form).toBe(1);
    // `convertWidened` asked alone does not look for an exact form first: it answers form 0.
    expect(convertWidened({ range: hour }, dayThenBounds, clock)?.form).toBe(0);
  });

  it('an inverted range is read by no form — never a confident wrong look-back', () => {
    const inverted = { from: '2026-10-09T00:00:00Z', to: '2026-10-08T00:00:00Z' };
    expect(convertWidened({ range: inverted }, lookback, clock)).toBeUndefined();
    for (const forms of [lookback, day, epochBounds]) {
      expect(convertForTool({ range: inverted }, forms, {}, clock)).toEqual({
        refused: 'no-form-holds',
      });
    }
  });
});

describe('the inputs the caller must get right (what the docs say of each)', () => {
  it('a range that is not two instants breaks no fact by the fact check, and no form reads it', () => {
    const garbage = { from: 'yesterday', to: 'garbage' };
    const facts = { direction: 'past', maxRange: '1h', retention: '1d' } as const;
    expect(periodFactProblem(garbage, facts, clock.now)).toBeUndefined();
    expect(convertForTool({ range: garbage }, lookback, facts, clock)).toEqual({
      refused: 'no-form-holds',
    });
  });

  it('a now that is not an instant gives no look-back answer', () => {
    const lost = { ...clock, now: 'nope' };
    expect(convertWidened({ range: yesterday }, lookback, lost)).toBeUndefined();
    expect(convertForTool({ range: yesterday }, lookback, {}, lost)).toEqual({
      refused: 'no-form-holds',
    });
  });

  it('a day form asked with a zone that is not an IANA name throws', () => {
    const morning = { from: '2026-10-08T08:00:00-07:00', to: '2026-10-08T09:00:00-07:00' };
    expect(() => convertWidened({ range: morning }, day, { ...clock, zone: 'Mars/Base' })).toThrow(
      /IANA/,
    );
  });
});

/** A small seeded generator (mulberry32) — the same windows every run (test/core/time/check.test.ts). */
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

describe('the run’s order, over seeded windows', () => {
  const nowMs = Date.parse(clock.now);
  const minute = 60_000;
  const facts = { direction: 'past', maxRange: '30h' } as const;
  const widest = widestMsOf(facts) as number;

  it('an exact form is the answer when one exists; a widened read contains the window within maxRange', () => {
    const rand = seeded(20261009);
    const single = [lookback, day, epochBounds];
    const multi = [
      [...day, ...epochBounds],
      [...lookback, ...day],
      [...epochBounds, ...lookback],
    ];
    for (let i = 0; i < 600; i++) {
      // Whole-minute windows inside the last three days, at least one minute long.
      const from = nowMs - (1 + Math.floor(rand() * 3 * 24 * 60)) * minute;
      const to = Math.min(from + (1 + Math.floor(rand() * 24 * 60)) * minute, nowMs);
      const window: WindowToConvert = {
        range: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
      };
      // One form: it holds the window exactly or reads more, never both.
      for (const forms of single) {
        if (convertExact(window, forms, clock) !== undefined) {
          expect(convertWidened(window, forms, clock)).toBeUndefined();
        }
      }
      for (const forms of [...single, ...multi]) {
        const exact = convertExact(window, forms, clock);
        const read = convertForTool(window, forms, facts, clock);
        if (exact !== undefined) expect(read).toEqual({ conversion: exact });
        if ('conversion' in read && 'sent' in read.conversion) {
          const { sent, extra } = read.conversion;
          expect(Date.parse(sent.from)).toBeLessThanOrEqual(from);
          expect(Date.parse(sent.to)).toBeGreaterThanOrEqual(to);
          expect(extra.length).toBeGreaterThan(0);
          // A look-back's read holds both ends: its length is one millisecond short of its span.
          expect(Date.parse(sent.to) - Date.parse(sent.from) - 1).toBeLessThanOrEqual(widest);
        }
      }
    }
  });
});

// ─── G8 (time follow-ups, packet "gaps"): what an app needs outside a run ───

describe('time for a person and the zone check, from the door', () => {
  it('presentRange writes the run’s label: the end as said, the zone named', () => {
    const range = { from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T08:41:00-07:00' };
    expect(presentRange(range, { zone: 'America/Los_Angeles' }, 'minute')).toBe(
      '2026-10-09 08:00–08:40 America/Los_Angeles (UTC-07:00)',
    );
  });

  it('isZoneName is the run’s zone check: an IANA name; an abbreviation or a bare offset is refused', () => {
    expect(isZoneName('America/Los_Angeles')).toBe(true);
    expect(isZoneName('PST')).toBe(false);
    expect(isZoneName('+05:30')).toBe(false);
  });

  it('the time-answer, time-derived and source-clock row types come from the root', () => {
    const answer: TimeAnswerRow = {
      kind: 'time-answer',
      turn: 1,
      iteration: 1,
      mention: 0,
      from: '2026-10-09T08:00:00-07:00',
      to: '2026-10-09T08:41:00-07:00',
      zone: 'America/Los_Angeles' as never,
      how: 'confirmed',
    };
    const kinds: (TimeAnswerRow | TimeDerivedRow | SourceClockRow)['kind'][] = [
      answer.kind,
      'time-derived',
      'source-clock',
    ];
    expect(kinds).toEqual(['time-answer', 'time-derived', 'source-clock']);
  });
});
