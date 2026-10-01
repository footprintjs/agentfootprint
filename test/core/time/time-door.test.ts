/**
 * `agentfootprint/time` — the time layer's conversions for an app OUTSIDE a run
 * (`src/doors/time.ts`): `convertExact`, `convertWidened`, `periodFactProblem`.
 *
 *   unit        — each documented example answers what the docs say it answers
 *                 (the door header, docs-next build/time.mdx, src/core/time/README.md);
 *   integration — the door's answer IS the run's: examples/features/85-time-widen-and-refuse.ts
 *                 checks that an armed agent's confirmed "yesterday" sent to a look-back tool
 *                 hands the tool the values, and files the read (`sent`), that `convertWidened`
 *                 gives for the same window and clock;
 *   property    — the fill's order, stated over 600 seeded windows × 3 form lists: `convertExact` and
 *                 `convertWidened` never both answer (an exact form ends the search), and a
 *                 widened read always contains the window;
 *   byte identity — the door adds no names beyond the three (pinned in
 *                 test/api-conformance/subpath-exports.test.ts) and nothing to the root graph
 *                 (test/lib/trace-toolpack/browserGraph.test.ts).
 */

import { describe, expect, it } from 'vitest';

import {
  convertExact,
  convertWidened,
  periodFactProblem,
  type ConvertContext,
  type WindowToConvert,
} from '../../../src/doors/time.js';
import type { PeriodForm } from '../../../src/index.js';

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

describe('the fill’s order, over seeded windows', () => {
  const nowMs = Date.parse(clock.now);
  const minute = 60_000;

  it('an exact answer and a widened one never both exist; a widened read contains the window', () => {
    const rand = seeded(20261009);
    for (let i = 0; i < 600; i++) {
      // Whole-minute windows inside the last three days, at least one minute long.
      const from = nowMs - (1 + Math.floor(rand() * 3 * 24 * 60)) * minute;
      const to = Math.min(from + (1 + Math.floor(rand() * 24 * 60)) * minute, nowMs);
      const window: WindowToConvert = {
        range: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
      };
      for (const forms of [lookback, day, epochBounds]) {
        const exact = convertExact(window, forms, clock);
        const widened = convertWidened(window, forms, clock);
        if (exact !== undefined) expect(widened).toBeUndefined();
        if (widened !== undefined) {
          expect(Date.parse(widened.sent.from)).toBeLessThanOrEqual(from);
          expect(Date.parse(widened.sent.to)).toBeGreaterThanOrEqual(to);
          expect(widened.extra.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
