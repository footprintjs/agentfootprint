/**
 * core/time/axis — the declared time axis on the time layer's grammar, and the
 * read-side view `normaliseInstants` (the time design § 8, step T2).
 *
 * Test types:
 *   unit        — each unit's values (epoch-s, epoch-ms, ISO with offsets, naive, wall), the
 *                 one precision, the counts; the judge on the one grammar (no digit cap, IANA
 *                 names only);
 *   functional  — the fall-back rule on real zones: two `01:30` rows resolve by row order, a lone
 *                 one is `dst-ambiguous`, a column out of order places none, a spring-forward
 *                 wall time is `dst-gap`; `naive: 'refuse'`;
 *   integration — the mint and a store round-trip (`test/artifacts/timeAxis.test.ts`);
 *   property    — over 3 000 generated columns: epoch-s / epoch-ms / mixed offsets normalise to
 *                 UTC whose TEXT order is time order and whose instants are the values'; a
 *                 naive value is never among the points; the rows are unchanged (frozen input);
 *   security    — hostile values (1 MB strings, NaN, 1e21, objects, `__proto__`) are counted,
 *                 never thrown on; a malformed axis or option is a named caller error;
 *   performance — 100 000 epoch rows and 20 000 zoned wall rows inside a budget;
 *   load        — not applicable: a pure function with no shared state.
 */

import { describe, expect, it } from 'vitest';

import {
  normaliseInstants,
  timeAxisIssues,
  type DatasetTimeAxis,
  type NormalisedAxis,
} from '../../../src/core/time/axis.js';
import { instantOf, spellInstant } from '../../../src/core/time/instant.js';
import { int, pick, prng } from './fixtures/generate.js';

const EPOCH_S: DatasetTimeAxis = { column: 'ts', unit: 'epoch-s' };
const EPOCH_MS: DatasetTimeAxis = { column: 'ts', unit: 'epoch-ms' };
const ISO: DatasetTimeAxis = { column: 't', unit: 'iso' };
const LA: DatasetTimeAxis = { column: 't', unit: 'iso', zone: 'America/Los_Angeles' };
const LONDON: DatasetTimeAxis = { column: 't', unit: 'iso', zone: 'Europe/London' };

const at = (view: NormalisedAxis): string[] =>
  view.status === 'refused' ? [] : view.points.map((p) => p.at);
const rowsOf = (view: NormalisedAxis): number[] =>
  view.status === 'refused' ? [] : view.points.map((p) => p.row);
const t = (...values: unknown[]): { t: unknown }[] => values.map((v) => ({ t: v }));

describe('the judge speaks the one grammar — unit', () => {
  it('an interval has no digit cap any more (the axis cap went with the merge, § 12.1 row d)', () => {
    expect(
      timeAxisIssues({ column: 't', unit: 'iso', interval: '1000000m', aggregate: 'raw' }),
    ).toEqual([]);
    expect(
      timeAxisIssues({ column: 't', unit: 'iso', interval: '05m', aggregate: 'raw' }).join(' '),
    ).toMatch(/interval must be/);
  });

  it.each(['PST', 'EST', '+05:30', 'utc', 'EST5EDT'])(
    'a zone %s that Intl would take is refused — an IANA name only',
    (zone) => {
      expect(timeAxisIssues({ column: 't', unit: 'iso', zone }).join(' ')).toMatch(
        /IANA zone .*abbreviation/,
      );
    },
  );

  it.each(['UTC', 'Europe/London', 'America/Los_Angeles', 'Etc/GMT+5'])('%s is a zone', (zone) => {
    expect(timeAxisIssues({ column: 't', unit: 'iso', zone })).toEqual([]);
  });
});

describe('normaliseInstants — unit', () => {
  it('epoch seconds, fractions read exactly as written, one precision for every point', () => {
    const view = normaliseInstants([{ ts: 1726304400.123 }, { ts: 1726300800 }], EPOCH_S);
    expect(view).toEqual({
      status: 'instants',
      precision: 'millisecond',
      points: [
        { row: 1, at: '2024-09-14T08:00:00.000Z' },
        { row: 0, at: '2024-09-14T09:00:00.123Z' },
      ],
      notes: [],
      counts: { naive: 0, dstAmbiguous: 0, dstGap: 0, unreadable: 0, missing: 0 },
    });
  });

  it('epoch milliseconds, whole seconds spelled without a fraction; before 1970 floors', () => {
    expect(at(normaliseInstants([{ ts: 1726300800000 }, { ts: -1000 }], EPOCH_MS))).toEqual([
      '1969-12-31T23:59:59Z',
      '2024-09-14T08:00:00Z',
    ]);
    expect(at(normaliseInstants([{ ts: -1.5 }], EPOCH_MS))).toEqual([
      '1969-12-31T23:59:59.998500000Z',
    ]);
  });

  it('ISO values in mixed offsets land in UTC, sorted', () => {
    const view = normaliseInstants(
      t('2026-09-14T10:00:00+02:00', '2026-09-14T07:30:00Z', '2026-09-14T01:00-07:00'),
      ISO,
    );
    expect(view.status).toBe('instants');
    expect(at(view)).toEqual([
      '2026-09-14T07:30:00Z',
      '2026-09-14T08:00:00Z',
      '2026-09-14T08:00:00Z',
    ]);
    expect(rowsOf(view)).toEqual([1, 0, 2]); // a tie keeps row order
  });

  it('a nine-digit fraction is kept to the nanosecond', () => {
    expect(
      at(normaliseInstants(t('2026-09-14T10:00:00.123456789Z', '2026-09-14T10:00Z'), ISO)),
    ).toEqual(['2026-09-14T10:00:00.000000000Z', '2026-09-14T10:00:00.123456789Z']);
  });

  it('an offset-less value under a zone-less axis is COUNTED, never read as UTC', () => {
    const view = normaliseInstants(
      t('2026-09-14T10:00:00Z', '2026-09-14T10:00:00', '2026-09-14', '2026-09-14T11:00'),
      ISO,
    );
    expect(view).toMatchObject({ status: 'naive-values', count: 3 });
    expect(rowsOf(view)).toEqual([0]);
    expect(view.counts.naive).toBe(3);
  });

  it('under naive: "refuse" nothing is placed', () => {
    expect(
      normaliseInstants(t('2026-09-14T10:00:00Z', '2026-09-14T10:00'), ISO, { naive: 'refuse' }),
    ).toEqual({
      status: 'refused',
      reason: 'naive-values',
      count: 1,
      counts: { naive: 1, dstAmbiguous: 0, dstGap: 0, unreadable: 0, missing: 0 },
    });
    // With nothing naive, refuse changes nothing.
    expect(normaliseInstants(t('2026-09-14T10:00Z'), ISO, { naive: 'refuse' }).status).toBe(
      'instants',
    );
  });

  it('missing and unreadable are counted apart', () => {
    const view = normaliseInstants(
      [{ t: '2026-09-14T10:00Z' }, {}, { t: null }, 7, { t: 'soon' }, { t: 1726300800 }],
      ISO,
    );
    expect(view.counts).toEqual({
      naive: 0,
      dstAmbiguous: 0,
      dstGap: 0,
      unreadable: 2,
      missing: 3,
    });
    expect(view.status).toBe('instants');
  });

  it('an epoch in a string, or a number under an iso axis, is unreadable — the unit was declared', () => {
    expect(normaliseInstants([{ ts: '1726300800' }], EPOCH_S).counts.unreadable).toBe(1);
  });

  it('a wall time in a declared zone becomes its instant', () => {
    expect(at(normaliseInstants(t('2026-10-09T08:00:00', '2026-01-09T08:00'), LA))).toEqual([
      '2026-01-09T16:00:00Z',
      '2026-10-09T15:00:00Z',
    ]);
    // A value that carries its own offset is an instant under any zone.
    expect(at(normaliseInstants(t('2026-10-09T08:00:00Z'), LA))).toEqual(['2026-10-09T08:00:00Z']);
  });
});

describe('the fall-back rule — functional', () => {
  // 1 Nov 2026, Los Angeles: 01:59:59 PDT is followed by 01:00:00 PST — [01:00, 02:00) happens twice.
  it('two 01:30 rows across the fall-back resolve by row order, and say so', () => {
    const view = normaliseInstants(
      t('2026-11-01T00:30:00', '2026-11-01T01:30:00', '2026-11-01T01:30:00', '2026-11-01T02:30:00'),
      LA,
    );
    expect(view.status).toBe('instants');
    expect(at(view)).toEqual([
      '2026-11-01T07:30:00Z',
      '2026-11-01T08:30:00Z', // 01:30 PDT
      '2026-11-01T09:30:00Z', // 01:30 PST
      '2026-11-01T10:30:00Z',
    ]);
    expect(view.status !== 'refused' && view.notes).toEqual([
      { kind: 'dst-overlap', resolvedBy: 'row-order', row: 1, which: 'earlier' },
      { kind: 'dst-overlap', resolvedBy: 'row-order', row: 2, which: 'later' },
    ]);
  });

  it('a quarter-hourly pass through the overlap splits where the wall clock steps back', () => {
    const walls = ['01:00', '01:15', '01:30', '01:45', '01:00', '01:15', '01:30', '01:45', '02:00'];
    const view = normaliseInstants(t(...walls.map((w) => `2026-11-01T${w}`)), LA);
    expect(view.status).toBe('instants');
    expect(at(view)[0]).toBe('2026-11-01T08:00:00Z');
    expect(at(view)[8]).toBe('2026-11-01T10:00:00Z');
    expect(rowsOf(view)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('a lone 01:30 is dst-ambiguous — handled like a naive value', () => {
    const view = normaliseInstants(
      t('2026-11-01T00:30:00', '2026-11-01T01:30:00', '2026-11-01T02:30:00'),
      LA,
    );
    expect(view).toMatchObject({ status: 'naive-values', count: 1 });
    expect(view.counts.dstAmbiguous).toBe(1);
    expect(rowsOf(view)).toEqual([0, 2]);
    expect(normaliseInstants(t('2026-11-01T01:30:00'), LA, { naive: 'refuse' }).status).toBe(
      'refused',
    );
  });

  it('rows not in time order cannot tell: every overlap value is left unplaced', () => {
    // Long format — two ports per time — repeats wall times outside the overlap too.
    const view = normaliseInstants(
      t('2026-11-01T00:30', '2026-11-01T00:30', '2026-11-01T01:30', '2026-11-01T01:30'),
      LA,
    );
    expect(view.counts.dstAmbiguous).toBe(2);
    expect(rowsOf(view)).toEqual([0, 1]);
  });

  it('two steps back inside one overlap cannot tell either', () => {
    const view = normaliseInstants(
      t('2026-11-01T01:30', '2026-11-01T01:30', '2026-11-01T01:30'),
      LA,
    );
    expect(view.counts.dstAmbiguous).toBe(3);
  });

  it('the rule holds in another zone (London, 25 Oct 2026, 01:00–02:00 twice)', () => {
    expect(at(normaliseInstants(t('2026-10-25T01:30', '2026-10-25T01:30'), LONDON))).toEqual([
      '2026-10-25T00:30:00Z',
      '2026-10-25T01:30:00Z',
    ]);
  });

  it('a wall time the spring-forward skips names no instant: dst-gap', () => {
    const view = normaliseInstants(
      t('2026-03-08T01:30', '2026-03-08T02:30', '2026-03-08T03:30'),
      LA,
    );
    expect(view.counts.dstGap).toBe(1);
    expect(rowsOf(view)).toEqual([0, 2]);
  });
});

describe('normalise — property', () => {
  const r = prng(20260930);
  const OFFSETS = [0, -420, -480, 60, 330, 345, 765, 840, -210];

  function assertChronological(view: NormalisedAxis): void {
    const texts = at(view);
    const sorted = [...texts].sort();
    expect(texts).toEqual(sorted);
    const ms = texts.map((x) => instantOf(x, 'strict')?.ms);
    for (let i = 1; i < ms.length; i++) expect(ms[i]! >= ms[i - 1]!).toBe(true);
    const widths = new Set(texts.map((x) => x.length));
    expect(widths.size).toBeLessThanOrEqual(1);
  }

  it('epoch-s and epoch-ms columns: text order is time order, every instant is the value', () => {
    for (let n = 0; n < 1000; n++) {
      const ms = Array.from({ length: int(r, 1, 30) }, () =>
        int(r, -2_000_000_000_000, 4_000_000_000_000),
      );
      const rows = ms.map((v) => ({ ts: v }));
      const view = normaliseInstants(rows, EPOCH_MS);
      assertChronological(view);
      expect(
        view.status === 'instants' && view.points.map((p) => instantOf(p.at, 'strict')?.ms),
      ).toEqual([...ms].sort((a, b) => a - b));
      const secs = normaliseInstants(
        ms.map((v) => ({ ts: Math.trunc(v / 1000) })),
        EPOCH_S,
      );
      assertChronological(secs);
      expect(secs.status === 'instants' && secs.precision).toBe('second');
    }
  });

  it('mixed offsets: the same instants in any spelling normalise to the same UTC text', () => {
    for (let n = 0; n < 1000; n++) {
      const instants = Array.from({ length: int(r, 1, 20) }, () => ({
        ms: int(r, 0, 4_000_000_000) * 1000,
        nanos: 0,
      }));
      const rows = instants.map((i) => ({ t: spellInstant(i, pick(r, OFFSETS)) }));
      const utc = instants.map((i) => ({ t: spellInstant(i, 0) }));
      const view = normaliseInstants(rows, ISO);
      assertChronological(view);
      expect(at(view)).toEqual(at(normaliseInstants(utc, ISO)));
    }
  });

  it('a naive value is never among the points, and the rows are never touched', () => {
    for (let n = 0; n < 1000; n++) {
      const rows = Array.from({ length: int(r, 1, 20) }, () => {
        const base = spellInstant({ ms: int(r, 0, 4_000_000_000) * 1000, nanos: 0 }, 0) as string;
        return Object.freeze({ t: r() < 0.4 ? base.slice(0, -1) : base });
      });
      Object.freeze(rows);
      const before = JSON.stringify(rows);
      const naive = rows.flatMap((row, i) => (row.t.endsWith('Z') ? [] : [i]));
      const view = normaliseInstants(rows, ISO);
      expect(JSON.stringify(rows)).toBe(before);
      expect(view.counts.naive).toBe(naive.length);
      for (const row of rowsOf(view)) expect(naive).not.toContain(row);
      expect(view.status).toBe(naive.length > 0 ? 'naive-values' : 'instants');
    }
  });
});

describe('hostile input — security', () => {
  it('hostile values are counted, never thrown on', () => {
    const rows = [
      { t: `2026-09-14T10:00:00${'0'.repeat(1_000_000)}Z` },
      { t: '..'.repeat(500_000) },
      { t: {} },
      { t: ['2026-09-14T10:00Z'] },
      { t: Symbol('x') },
    ];
    const started = performance.now();
    expect(normaliseInstants(rows, ISO).counts.unreadable).toBe(5);
    expect(performance.now() - started).toBeLessThan(500);
    expect(
      normaliseInstants(
        [{ ts: Number.NaN }, { ts: Infinity }, { ts: 1e21 }, { ts: 1e-7 }, { ts: 2n }],
        EPOCH_S,
      ).counts.unreadable,
    ).toBe(5);
    // Past year 9999 is unreadable, not a wrapped year.
    expect(normaliseInstants([{ ts: 8.64e15 }], EPOCH_MS).counts.unreadable).toBe(1);
  });

  it('a column named __proto__ reads nothing from the prototype', () => {
    const view = normaliseInstants([{}], { column: '__proto__', unit: 'epoch-s' });
    expect(view.status === 'instants' && view.points).toEqual([]);
  });

  it('a malformed axis or option is a named caller error — never repaired', () => {
    expect(() => normaliseInstants([], { column: 'ts', unit: 'seconds' } as never)).toThrow(
      /time axis is malformed .*unit must be one of/,
    );
    expect(() => normaliseInstants([], { column: 't', unit: 'iso', zone: 'PST' })).toThrow(
      TypeError,
    );
    expect(() => normaliseInstants([], ISO, { naive: 'utc' as never })).toThrow(/naive must be/);
    expect(() => normaliseInstants('rows' as never, ISO)).toThrow(/rows must be an array/);
  });
});

describe('budget — performance', () => {
  it('100 000 epoch rows', () => {
    const rows = Array.from({ length: 100_000 }, (_, i) => ({
      ts: 1_726_300_800 + ((i * 7919) % 100_000),
    }));
    const started = performance.now();
    const view = normaliseInstants(rows, EPOCH_S);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(view.status === 'instants' && view.points.length).toBe(100_000);
  });

  it('20 000 wall-clock rows in a zone', () => {
    const rows = Array.from({ length: 20_000 }, (_, i) => ({
      t: (spellInstant({ ms: 1_790_000_000_000 + i * 60_000, nanos: 0 }, 0) as string).slice(0, -1),
    }));
    const started = performance.now();
    const view = normaliseInstants(rows, LONDON);
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(view.status === 'instants' && view.points.length).toBe(20_000);
  });
});
