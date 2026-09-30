/**
 * core/time/present — time rendered for a person in a named zone, and the
 * limits block's `Period:` line in the presentation zone (the time design
 * § 3.3, § 10.2, step T3).
 *
 * Test types:
 *   unit        — `presentInstant`, `presentSpan` (same day, two days, a DST crossing, UTC),
 *                 `presentRange` (the said end: "to 8:40" read as `[08:00, 08:41)` shows 08:40,
 *                 at every grain), the precision rule;
 *   functional  — the limits block per zone, against GOLDEN FILES
 *                 (`fixtures/limits-lines.golden.json`, regenerated only by
 *                 `AF_TIME_GOLDEN=update npx vitest run test/core/time/present.test.ts`);
 *                 without a presentation the block is byte-identical to the declared instants;
 *   property    — 3 000 generated instants × zones: the rendered wall time is the zone's
 *                 (`zone.ts` · `wallAt`) and the named offset is the zone's (`offsetAt`); a range
 *                 at minute grain shows the minute before its end;
 *   security    — a zone that is not an IANA name, a non-instant, a reversed range and an
 *                 unknown grain are refused by name; nothing is parsed back from a label;
 *   performance — 20 000 spans inside a budget;
 *   load        — not applicable: pure functions with no shared state.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { composeAnswerWithCoverage } from '../../../src/core/agent/coverage/answer.js';
import { periodLine } from '../../../src/core/agent/coverage/period.js';
import type { DeclaredCoverage } from '../../../src/core/agent/coverage/index.js';
import {
  bindPresentation,
  presentInstant,
  presentRange,
  presentSpan,
  type Grain,
} from '../../../src/core/time/present.js';
import { spellInstant } from '../../../src/core/time/instant.js';
import { offsetAt, wallAt } from '../../../src/core/time/zone.js';
import { int, pick, prng } from './fixtures/generate.js';

const LA = { zone: 'America/Los_Angeles' };

describe('presentInstant / presentSpan — the declared ends, in the zone', () => {
  it('one instant, written as finely as it needs', () => {
    expect(presentInstant('2026-10-09T15:40:00Z', LA)).toBe(
      '2026-10-09 08:40 America/Los_Angeles (UTC-07:00)',
    );
    expect(presentInstant('2026-10-09T15:40:03Z', LA)).toBe(
      '2026-10-09 08:40:03 America/Los_Angeles (UTC-07:00)',
    );
    expect(presentInstant('2026-10-09T15:40:03.25Z', LA)).toBe(
      '2026-10-09 08:40:03.250 America/Los_Angeles (UTC-07:00)',
    );
    expect(presentInstant('2026-10-09T15:40:00Z', { zone: 'UTC' })).toBe('2026-10-09 15:40 UTC');
  });

  it('a span on one day, across days, and across a DST change', () => {
    expect(presentSpan('2026-10-09T15:00:00Z', '2026-10-09T15:40:00Z', LA)).toBe(
      '2026-10-09 08:00–08:40 America/Los_Angeles (UTC-07:00)',
    );
    expect(
      presentSpan('2026-10-09T17:30:00Z', '2026-10-09T19:30:00Z', { zone: 'Asia/Kolkata' }),
    ).toBe('2026-10-09 23:00 – 2026-10-10 01:00 Asia/Kolkata (UTC+05:30)');
    // 1 Nov 2026: Los Angeles falls back at 02:00 PDT → 01:00 PST.
    expect(presentSpan('2026-11-01T08:00:00Z', '2026-11-01T09:30:00Z', LA)).toBe(
      '2026-11-01 01:00 (UTC-07:00) – 2026-11-01 01:30 (UTC-08:00) America/Los_Angeles',
    );
    expect(presentSpan('2026-10-09T15:00:00Z', '2026-10-09T15:00:00Z', LA)).toBe(
      '2026-10-09 08:00 America/Los_Angeles (UTC-07:00)',
    );
  });

  it('accepts what a result may declare (the lenient profile), shown as declared', () => {
    expect(presentSpan('2026-10-09t15:00z', '2026-10-09T08:40:00-07:00', LA)).toBe(
      '2026-10-09 08:00–08:40 America/Los_Angeles (UTC-07:00)',
    );
  });
});

describe('presentRange — the said end (§ 3.3)', () => {
  const range = { from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T08:41:00-07:00' };

  it('"to 8:40", read to the end of its grain, shows 08:40 — never 08:41', () => {
    expect(presentRange(range, LA, 'minute')).toBe(
      '2026-10-09 08:00–08:40 America/Los_Angeles (UTC-07:00)',
    );
  });

  it('an exact range shows its end as it is', () => {
    expect(presentRange(range, LA)).toBe('2026-10-09 08:00–08:41 America/Los_Angeles (UTC-07:00)');
  });

  it('every grain shows its own end', () => {
    const cases: [Grain, { from: string; to: string }, string][] = [
      [
        'second',
        { from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T08:00:31-07:00' },
        '2026-10-09 08:00:00–08:00:30 America/Los_Angeles (UTC-07:00)',
      ],
      [
        'hour',
        { from: '2026-10-09T08:00:00-07:00', to: '2026-10-09T10:00:00-07:00' },
        '2026-10-09 08:00–09:00 America/Los_Angeles (UTC-07:00)',
      ],
      [
        'day',
        { from: '2026-10-09T00:00:00-07:00', to: '2026-10-10T00:00:00-07:00' },
        '2026-10-09 America/Los_Angeles (UTC-07:00)',
      ],
      [
        'week',
        { from: '2026-10-05T00:00:00-07:00', to: '2026-10-12T00:00:00-07:00' },
        '2026-10-05 – 2026-10-11 America/Los_Angeles (UTC-07:00)',
      ],
      [
        'month',
        { from: '2026-09-01T00:00:00-07:00', to: '2026-10-01T00:00:00-07:00' },
        '2026-09 America/Los_Angeles (UTC-07:00)',
      ],
      ['year', { from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' }, '2026 UTC'],
    ];
    for (const [grain, r, text] of cases) {
      expect(presentRange(r, grain === 'year' ? { zone: 'UTC' } : LA, grain), grain).toBe(text);
    }
  });
});

// ─── The limits block, per zone, against golden files ───────────────────

const ZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/New_York',
  'America/St_Johns',
  'Europe/London',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Australia/Lord_Howe',
  'Pacific/Chatham',
  'Pacific/Kiritimati',
] as const;

const DECLARED: DeclaredCoverage[] = [
  {
    toolName: 'backup_runs',
    toolCallId: 'c1',
    iteration: 1,
    kind: 'ledger',
    checked: [{ what: 'every job in the 02:00 export' }],
    notChecked: [],
    cannotCover: [],
    period: {
      queried: { from: '2026-10-09T15:00:00Z', to: '2026-10-09T15:40:00Z' },
      held: { from: '2026-09-09T02:00:00Z', to: '2026-10-09T02:00:00Z' },
      readAt: '2026-10-09T15:40:03Z',
    },
  },
  {
    toolName: 'client_activity',
    toolCallId: 'c2',
    iteration: 1,
    kind: 'ledger',
    checked: [{ what: 'the activity index' }],
    notChecked: [],
    cannotCover: [],
    period: {
      queried: { from: '2026-11-01T08:00:00Z', to: '2026-11-01T09:30:00Z' },
      held: 'unknown',
    },
  },
];

const GOLDEN = new URL('./fixtures/limits-lines.golden.json', import.meta.url);

describe('the limits block per zone — golden files', () => {
  const observed: Record<string, string> = {};
  for (const zone of ZONES) {
    observed[zone] = composeAnswerWithCoverage(
      'Two failures.',
      DECLARED,
      '',
      '',
      bindPresentation({ zone }),
    );
  }

  it('every zone renders the block its golden file holds', () => {
    if (process.env.AF_TIME_GOLDEN === 'update') {
      writeFileSync(GOLDEN, `${JSON.stringify(observed, null, 2)}\n`);
    }
    expect(existsSync(GOLDEN), 'no golden file').toBe(true);
    expect(observed).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
  });

  it('the Los Angeles block shows "to 8:40" as 08:40, the zone named', () => {
    expect(observed['America/Los_Angeles']).toContain(
      '- backup_runs queried 2026-10-09 08:00–08:40 America/Los_Angeles (UTC-07:00); the store ' +
        'holds 2026-09-08 19:00 – 2026-10-08 19:00 America/Los_Angeles (UTC-07:00); read at ' +
        '2026-10-09 08:40:03 America/Los_Angeles (UTC-07:00)',
    );
  });

  it('without a presentation the block is the declared instants, byte for byte', () => {
    const plain = composeAnswerWithCoverage('Two failures.', DECLARED);
    expect(plain).toContain(
      '- backup_runs queried 2026-10-09T15:00:00Z to 2026-10-09T15:40:00Z; the store holds ' +
        '2026-09-09T02:00:00Z to 2026-10-09T02:00:00Z (read at 2026-10-09T15:40:03Z)',
    );
    expect(composeAnswerWithCoverage('Two failures.', DECLARED, '', '', undefined)).toBe(plain);
    const period = (DECLARED[0] as { period: never }).period;
    expect(periodLine('backup_runs', period)).toBe(periodLine('backup_runs', period, undefined));
  });
});

// ─── Property ────────────────────────────────────────────────────────────

const PROPERTY_ZONES = [...ZONES, 'Europe/Paris', 'America/Sao_Paulo', 'Asia/Tokyo'];
const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

describe('property — the label is the zone’s wall time and offset', () => {
  it('3 000 instants across 13 zones', () => {
    const r = prng(0x9e35);
    const lo = Date.UTC(1990, 0, 1);
    const hi = Date.UTC(2040, 0, 1);
    for (let i = 0; i < 3000; i++) {
      const zone = pick(r, PROPERTY_ZONES);
      const ms = lo + Math.floor((r() * (hi - lo)) / 60_000) * 60_000;
      const text = spellInstant({ ms, nanos: 0 }, pick(r, [0, -420, 330, 60]))!;
      const wall = wallAt(zone, ms);
      const label = presentInstant(text, { zone });
      const expected = `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)} ${pad(
        wall.hour,
      )}:${pad(wall.minute)}`;
      expect(label.startsWith(expected), `case ${i}: ${text} in ${zone} → ${label}`).toBe(true);
      if (zone !== 'UTC') {
        const minutes = offsetAt(zone, ms);
        const sign = minutes < 0 ? '-' : '+';
        const abs = Math.abs(Math.round(minutes));
        expect(label).toContain(
          `${zone} (UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)})`,
        );
      }
      // A range read to the end of its minute shows the minute before its end.
      const minutes = int(r, 1, 600);
      const end = spellInstant({ ms: ms + minutes * 60_000, nanos: 0 }, 0)!;
      const shown = presentRange({ from: text, to: end }, { zone }, 'minute');
      const last = spellInstant({ ms: ms + (minutes - 1) * 60_000, nanos: 0 }, 0)!;
      expect(shown, `case ${i}`).toBe(presentSpan(text, last, { zone }));
    }
  });
});

// ─── Security ────────────────────────────────────────────────────────────

describe('security — refused by name', () => {
  it('a zone that is not an IANA name', () => {
    for (const zone of ['PST', '+05:30', '', 'x'.repeat(100_000)]) {
      expect(() => presentInstant('2026-10-09T15:40:00Z', { zone })).toThrow(/IANA zone name/);
    }
    expect(() => presentInstant('2026-10-09T15:40:00Z', undefined as never)).toThrow(TypeError);
  });
  it('a value that is not an instant, a reversed range, an unknown grain', () => {
    expect(() => presentSpan('yesterday', '2026-10-09T15:40:00Z', LA)).toThrow(/not an ISO 8601/);
    expect(() =>
      presentRange({ from: '2026-10-09T15:40:00Z', to: '2026-10-09T15:00:00Z' }, LA, 'minute'),
    ).toThrow(/from must be before to/);
    expect(() =>
      presentRange(
        { from: '2026-10-09T15:00:00Z', to: '2026-10-09T15:40:00Z' },
        LA,
        'fortnight' as never,
      ),
    ).toThrow(/not a grain/);
  });
});

// ─── Performance ─────────────────────────────────────────────────────────

describe('performance', () => {
  it('20 000 spans in a zone inside 2 s', () => {
    const t0 = performance.now();
    for (let i = 0; i < 20_000; i++) {
      presentSpan('2026-10-09T15:00:00Z', '2026-10-09T15:40:00Z', LA);
    }
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
