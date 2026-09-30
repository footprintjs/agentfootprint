/**
 * core/time/instant — the ONE instant parser, two profiles.
 *
 * Test types (the honesty checklist's seven):
 *   unit        — the profile table, row by row;
 *   functional  — `toUtc` / `spellInstant` spell what was parsed;
 *   integration — `coverage/period.ts` · `periodVerdict` reads through the lenient profile, byte-identical;
 *   property    — over 20 000 generated instant-shaped strings: the lenient profile accepts EXACTLY what
 *                 the pre-T1 parser accepted, naming the same instant; every strict instant is lenient;
 *                 `spellInstant` ∘ `instantOf` is the identity on instants; `periodVerdict` equals the
 *                 pre-T1 verdict on 5 000 generated periods;
 *   security    — no catastrophic backtracking on a 1 MB near-match; non-strings are refused, never thrown on;
 *   performance — 100 000 parses stay well inside a generous budget;
 *   load        — not applicable: a pure function with no shared state.
 */

import { describe, expect, it } from 'vitest';

import {
  compareInstants,
  instantOf,
  shiftInstant,
  spellInstant,
  toUtc,
  type Instant,
} from '../../../src/core/time/instant.js';
import { periodVerdict } from '../../../src/core/agent/coverage/period.js';
import { instantOfBefore, periodVerdictBefore, type InstantBefore } from './fixtures/before.js';
import { instantish, int, pick, prng } from './fixtures/generate.js';

const nsOf = (i: Instant | InstantBefore): bigint => BigInt(i.ms) * 1_000_000n + BigInt(i.nanos);

describe('the two profiles — unit', () => {
  it.each([
    ['2026-10-09T08:00Z', true, true],
    ['2026-10-09T08:00:00Z', true, true],
    ['2026-10-09T08:00:00.123456789-07:00', true, true],
    ['2026-10-09t08:00z', true, false], // lower case: RFC 3339, lenient only
    ['2026-10-09T08:00z', true, false],
    ['2026-12-31T23:59:60Z', true, false], // the leap second: lenient only
    ['2026-02-30T08:00Z', false, false], // no such day, either profile
    ['2024-02-29T08:00Z', true, true], // a leap day
    ['2100-02-29T08:00Z', false, false], // not a leap year
    ['2026-10-09T24:00Z', false, false], // hour 24, either profile
    ['2026-10-09T08:00', false, false], // no zone
    ['2026-10-09', false, false], // a date alone
    ['2026-10-09T08:00+24:00', false, false],
    ['2026-10-09T08:00:00.1234567890Z', false, false], // ten fraction digits
    ['yesterday', false, false],
  ] as const)('%s → lenient %s, strict %s', (text, lenient, strict) => {
    expect(instantOf(text, 'lenient') !== undefined).toBe(lenient);
    expect(instantOf(text, 'strict') !== undefined).toBe(strict);
  });

  it('records the written offset and precision', () => {
    expect(instantOf('2026-10-09T08:00-07:00', 'strict')).toMatchObject({
      offsetMinutes: -420,
      precision: 'minute',
    });
    expect(instantOf('2026-10-09T08:00:05+05:30', 'strict')).toMatchObject({
      offsetMinutes: 330,
      precision: 'second',
    });
    expect(instantOf('2026-10-09T08:00:05.5Z', 'strict')).toMatchObject({
      offsetMinutes: 0,
      precision: 'fraction',
    });
    expect(Object.is(instantOf('2026-10-09T08:00-00:00', 'strict')?.offsetMinutes, -0)).toBe(false);
  });

  it('the leap second compares as the next minute', () => {
    const leap = instantOf('2026-12-31T23:59:60Z', 'lenient') as Instant;
    const next = instantOf('2027-01-01T00:00:00Z', 'strict') as Instant;
    expect(compareInstants(leap, next)).toBe(0);
  });

  it('keeps nine fraction digits exactly', () => {
    const a = instantOf('2026-10-09T08:00:00.000000001Z', 'strict') as Instant;
    const b = instantOf('2026-10-09T08:00:00.000000002Z', 'strict') as Instant;
    expect(compareInstants(a, b)).toBe(-1);
    expect(a.nanos).toBe(1);
  });

  it('reads years 0–99 as themselves', () => {
    expect(toUtc('0099-01-01T00:00Z', 'strict')).toBe('0099-01-01T00:00:00Z');
  });
});

describe('spelling — functional', () => {
  it('toUtc spells the same instant in Z', () => {
    expect(toUtc('2026-10-09T08:00-07:00', 'strict')).toBe('2026-10-09T15:00:00Z');
    expect(toUtc('2026-10-09T08:00:00.120-07:00', 'strict')).toBe('2026-10-09T15:00:00.12Z');
    expect(toUtc('2026-10-09t08:00z', 'lenient')).toBe('2026-10-09T08:00:00Z');
    expect(toUtc('2026-10-09t08:00z', 'strict')).toBeUndefined();
  });

  it('spellInstant writes an offset, and refuses what it cannot spell', () => {
    const i = instantOf('2026-10-09T15:00Z', 'strict') as Instant;
    expect(spellInstant(i, -420)).toBe('2026-10-09T08:00:00-07:00');
    expect(spellInstant(i, 345)).toBe('2026-10-09T20:45:00+05:45');
    expect(spellInstant(i, 0.5)).toBeUndefined();
    expect(spellInstant(i, 24 * 60)).toBeUndefined();
    expect(spellInstant(instantOf('0000-01-01T00:00Z', 'strict') as Instant, -60)).toBeUndefined();
  });

  it('shiftInstant moves by whole milliseconds only', () => {
    const i = instantOf('2026-10-09T15:00:00.000000500Z', 'strict') as Instant;
    expect(spellInstant(shiftInstant(i, -1), 0)).toBe('2026-10-09T14:59:59.9990005Z');
    expect(() => shiftInstant(i, 0.5)).toThrow(TypeError);
  });
});

describe('byte identity with the pre-T1 parser — property', () => {
  const r = prng(20260930);
  const cases = Array.from({ length: 20_000 }, () => instantish(r));

  it('the lenient profile accepts exactly what the old parser accepted, naming the same instant', () => {
    let accepted = 0;
    for (const text of cases) {
      const before = instantOfBefore(text);
      const after = instantOf(text, 'lenient');
      expect(after === undefined, text).toBe(before === undefined);
      if (before !== undefined && after !== undefined) {
        accepted++;
        expect(nsOf(after), text).toBe(nsOf(before));
      }
    }
    // The generator must visit both sides of the rule, or the property proves nothing.
    expect(accepted).toBeGreaterThan(5_000);
    expect(accepted).toBeLessThan(cases.length - 2_000);
  });

  it('every strict instant is a lenient one, naming the same instant', () => {
    for (const text of cases) {
      const strict = instantOf(text, 'strict');
      if (strict === undefined) continue;
      const lenient = instantOf(text, 'lenient') as Instant;
      expect(lenient, text).toBeDefined();
      expect(nsOf(strict)).toBe(nsOf(lenient));
    }
  });

  it('spellInstant ∘ instantOf is the identity on instants, in the written offset and in Z', () => {
    for (const text of cases) {
      const parsed = instantOf(text, 'lenient');
      if (parsed === undefined) continue;
      for (const offset of [parsed.offsetMinutes, 0]) {
        const spelled = spellInstant(parsed, offset);
        if (spelled === undefined) continue; // the year left 0000–9999 in that offset
        const back = instantOf(spelled, 'strict') as Instant;
        expect(back, spelled).toBeDefined();
        expect(nsOf(back), `${text} → ${spelled}`).toBe(nsOf(parsed));
      }
    }
  });

  it('periodVerdict (inclusive) equals the pre-T1 verdict on 5 000 generated periods', () => {
    const pool = cases.filter((t) => instantOfBefore(t) !== undefined);
    const r2 = prng(7);
    const ordered = (): { from: string; to: string } => {
      const a = pick(r2, pool);
      const b = pick(r2, pool);
      const before = instantOfBefore(a) as InstantBefore;
      const after = instantOfBefore(b) as InstantBefore;
      return nsOf(before) <= nsOf(after) ? { from: a, to: b } : { from: b, to: a };
    };
    const seen = new Set<string>();
    for (let i = 0; i < 5_000; i++) {
      const period = {
        queried: ordered(),
        held: int(r2, 0, 9) === 0 ? ('unknown' as const) : ordered(),
      };
      const verdict = periodVerdict(period);
      expect(verdict, JSON.stringify(period)).toBe(periodVerdictBefore(period));
      seen.add(verdict);
    }
    expect([...seen].sort()).toEqual(['covered', 'not-held', 'partly-held', 'unknown']);
  });

  it('inclusive at both ends: a query ending exactly where the data starts is partly held', () => {
    expect(
      periodVerdict({
        queried: { from: '2026-09-26T01:00:00Z', to: '2026-09-26T02:00:00Z' },
        held: { from: '2026-09-26T02:00:00Z', to: '2026-09-26T05:00:00Z' },
      }),
    ).toBe('partly-held');
  });
});

describe('hostile input — security', () => {
  it('a 1 MB near-match is refused in linear time', () => {
    const long = `2026-10-09T08:00:00.${'1'.repeat(1_000_000)}Z`;
    const started = performance.now();
    expect(instantOf(long, 'lenient')).toBeUndefined();
    expect(instantOf(long, 'strict')).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(500);
  });

  it.each([null, undefined, 42, {}, [], Symbol('t'), () => '2026-10-09T08:00Z'])(
    'refuses %s without throwing',
    (value) => {
      expect(instantOf(value, 'lenient')).toBeUndefined();
      expect(toUtc(value, 'strict')).toBeUndefined();
    },
  );

  it('refuses full-width digits (\\d is ASCII only)', () => {
    expect(instantOf('２０２６-10-09T08:00Z', 'lenient')).toBeUndefined();
  });
});

describe('cost — performance', () => {
  it('100 000 parses in both profiles stay well inside a generous budget', () => {
    const r = prng(1);
    const cases = Array.from({ length: 1_000 }, () => instantish(r));
    const started = performance.now();
    for (let i = 0; i < 50; i++) {
      for (const text of cases) {
        instantOf(text, 'lenient');
        instantOf(text, 'strict');
      }
    }
    expect(performance.now() - started).toBeLessThan(3_000);
  });
});
