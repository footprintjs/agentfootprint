/**
 * THE WINDOW DIFFERENTIAL — the ledger's instant validator is a subset of the time layer's one
 * grammar (case table 5.4; conflict 8, "a second time parser").
 *
 * `src/time/README.md` says no other file parses an instant. `src/llm-ledger/` is a closed leaf
 * and cannot import `src/time/`, so its parser is generated from that source. This test pins
 * the stored window wrapper's intentionally narrower grammar: every string the ledger accepts, `time/instant.ts` · `instantOf`
 * accepts in its `strict` profile, with the same epoch milliseconds. And the other way: every
 * string `strict` accepts and the ledger refuses is refused for one of the two named reasons —
 * no seconds, or more than three fraction digits.
 *
 * Inputs: seeded (the same strings on every run), built field by field around the edges of each
 * rule, plus free text from the pieces that matter.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { instantMs, readWindow } from '../../src/llm-ledger/window.js';
import { instantOf } from '../../src/time/instant.js';
import { seeded, seededTexts } from '../helpers/seededText.js';

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/**
 * One candidate instant: every field valid, then — half the time — ONE field replaced by a value
 * at or past its rule's edge, so both sides of every rule are reached often.
 */
function candidate(next: () => number): string {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const field = {
    year: pad(pick([int(0, 99), int(1900, 2100), int(0, 9999), 2000, 2024, 1900]), 4),
    month: pad(int(1, 12), 2),
    day: pad(int(1, 28), 2),
    t: 'T',
    hour: pad(int(0, 23), 2),
    minute: pad(int(0, 59), 2),
    second: `:${pad(int(0, 59), 2)}`,
    fraction: pick(['', '', '.5', '.05', '.123', `.${pad(int(0, 999), 3)}`]),
    zone: pick([
      'Z',
      `${pick(['+', '-'])}${pad(int(0, 23), 2)}:${pad(int(0, 59), 2)}`,
      '-00:00',
      '+23:59',
    ]),
  };
  // Days at the end of a month: 29, 30, 31 are valid in some months and years only.
  if (next() < 0.3) field.day = pad(pick([29, 30, 31]), 2);
  if (next() < 0.5) {
    const edges: Record<keyof typeof field, readonly string[]> = {
      year: ['12026', '202', '2O26'],
      month: ['00', '13', '1'],
      day: ['00', '32', '1'],
      t: ['t', ' ', ''],
      hour: ['24', '25', '1'],
      minute: ['60', '61', '5'],
      second: ['', ':60', ':61', ':5'],
      fraction: ['.', '.1234', '.123456789', '.12a'],
      zone: ['z', '', '+0100', '+24:00', '-01:60', '+1:00', 'UTC', 'Z '],
    };
    const name = pick(Object.keys(edges) as Array<keyof typeof field>);
    field[name] = pick(edges[name]);
  }
  const { year, month, day, t, hour, minute, second, fraction, zone } = field;
  const seconds = second === '' ? '' : `${second}${fraction}`;
  return `${year}-${month}-${day}${t}${hour}:${minute}${seconds}${zone}`;
}

const FIELDWISE = (() => {
  const next = seeded(20_261_125);
  return Array.from({ length: 40_000 }, () => candidate(next));
})();
const FREE = seededTexts(
  1_125,
  [
    '2026',
    '-',
    '11',
    '25',
    'T',
    't',
    '10',
    ':',
    '00',
    '.',
    '5',
    'Z',
    'z',
    '+',
    '01',
    '60',
    '24',
    ' ',
  ],
  20_000,
  14,
);

it('ships the time layer’s canonical parser inside the closed ledger', () => {
  const generator = fileURLToPath(new URL('../../scripts/gen-ledger-instant.mjs', import.meta.url));
  expect(() => execFileSync(process.execPath, [generator, '--check'])).not.toThrow();
});

describe('the ledger validator against the time layer’s strict profile', () => {
  it('every string the ledger accepts, strict accepts, at the same epoch milliseconds', () => {
    let accepted = 0;
    for (const text of [...FIELDWISE, ...FREE]) {
      const ms = instantMs(text);
      if (ms === undefined) continue;
      accepted++;
      const strict = instantOf(text, 'strict');
      expect(strict, text).toBeDefined();
      expect(strict!.ms, text).toBe(ms);
      expect(strict!.nanos, text).toBe(0);
    }
    // A differential over nothing proves nothing: the generator reaches the accepting side often.
    expect(accepted).toBeGreaterThan(4_000);
  });

  it('what strict accepts and the ledger refuses lacks seconds or has more than 3 fraction digits — nothing else', () => {
    let narrower = 0;
    for (const text of [...FIELDWISE, ...FREE]) {
      if (instantOf(text, 'strict') === undefined || instantMs(text) !== undefined) continue;
      narrower++;
      const parsed = instantOf(text, 'strict')!;
      const named = parsed.precision === 'minute' || /\.\d{4,}/.test(text);
      expect(named, text).toBe(true);
    }
    expect(narrower).toBeGreaterThan(100);
  });

  it('nothing the lenient profile alone accepts gets through', () => {
    for (const text of FIELDWISE) {
      if (instantOf(text, 'strict') === undefined) expect(instantMs(text), text).toBeUndefined();
    }
  });
});

describe('the window on it', () => {
  it('a window is accepted exactly when both ends are and from is strictly before to', () => {
    const next = seeded(7);
    let windows = 0;
    for (let i = 0; i < 20_000; i++) {
      const from = FIELDWISE[Math.floor(next() * FIELDWISE.length)]!;
      const to = next() < 0.2 ? from : FIELDWISE[Math.floor(next() * FIELDWISE.length)]!;
      const a = instantMs(from);
      const b = instantMs(to);
      const expected =
        a !== undefined &&
        b !== undefined &&
        instantOf(from, 'strict')!.ms < instantOf(to, 'strict')!.ms;
      expect(readWindow({ from, to }) !== undefined, `${from} → ${to}`).toBe(expected);
      if (expected) windows++;
    }
    expect(windows).toBeGreaterThan(500);
  });
});
