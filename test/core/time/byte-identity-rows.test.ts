/**
 * THE § 12.1 ROWS — step T1 of the time layer (`docs/design/time/README.md`) is a refactor with
 * two NAMED behaviour changes. Merging three grammars into `src/core/time/` could change five
 * behaviours; two are taken (rows a, b — a changelog line each) and three are avoided (rows c,
 * d, e — pinned here as NOT having happened).
 *
 * Test types:
 *   unit        — each row, on its own example;
 *   functional  — `convertSpelling` (the batch ask's shared field, the declared-sources check) follows;
 *   integration — `defineTool` refuses a declared `iso-range` default naming 30 February, at
 *                 definition — the same `assertAskOrAssume` that judges a declaration at dispatch and
 *                 at MCP ingest;
 *   property    — over 20 000 generated `iso-range` values: every value accepted before is accepted
 *                 after EXCEPT rows a–b, and nothing is newly accepted (row c);
 *   security    — the leaf law: `src/core/time/` imports nothing outside itself;
 *   performance — covered by the property sweep's budget;
 *   load        — not applicable.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { defineTool } from '../../../src/index.js';
import { convertSpelling, parsesUnderSpelling } from '../../../src/core/agent/arguments/declare.js';
import { daysInMonth } from '../../../src/core/time/instant.js';
import { parsesUnderSpellingBefore } from './fixtures/before.js';
import { instantish, prng } from './fixtures/generate.js';

/** Why a pre-T1 `iso-range` value is refused now: row a (a day past its month's end), row b (hour 24), or neither. */
function takenRow(value: string): 'a' | 'b' | undefined {
  for (const half of value.split('..')) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})/.exec(half);
    if (m === null) continue;
    const [year, month, day, hour] = [m[1], m[2], m[3], m[4]].map(Number) as [
      number,
      number,
      number,
      number,
    ];
    if (month >= 1 && month <= 12 && day > daysInMonth(year, month)) return 'a';
    if (hour === 24) return 'b';
  }
  return undefined;
}

describe('the five rows — unit', () => {
  it('row a (taken): a day past the month’s end is newly refused', () => {
    const value = '2026-02-30T08:00Z..2026-03-01T08:00Z';
    expect(parsesUnderSpellingBefore(value, 'iso-range')).toBe(true); // Date.parse rolled it to 2 March
    expect(parsesUnderSpelling(value, 'iso-range')).toBe(false);
    expect(parsesUnderSpelling('2026-04-31T08:00Z..2026-05-01T08:00Z', 'iso-range')).toBe(false);
  });

  it('row b (taken): hour 24 is newly refused', () => {
    const value = '2026-10-09T24:00Z..2026-10-10T08:00Z';
    expect(parsesUnderSpellingBefore(value, 'iso-range')).toBe(true); // Date.parse read the next midnight
    expect(parsesUnderSpelling(value, 'iso-range')).toBe(false);
  });

  it('row c (avoided): lower-case t/z and the leap second stay refused for an argument', () => {
    for (const value of [
      '2026-10-09t08:00Z..2026-10-09T09:00Z',
      '2026-10-09T08:00z..2026-10-09T09:00Z',
      '2026-12-31T23:59:60Z..2027-01-01T00:00:00Z',
    ]) {
      expect(parsesUnderSpellingBefore(value, 'iso-range')).toBe(false);
      expect(parsesUnderSpelling(value, 'iso-range')).toBe(false);
    }
  });

  it('row d (avoided): no digit cap — 1000000m is still a look-back', () => {
    expect(parsesUnderSpelling('1000000m', 'lookback')).toBe(true);
    expect(parsesUnderSpelling('-1000000m', 'signed-lookback')).toBe(true);
  });

  it('row e (avoided): 30s is still refused for a default look-back', () => {
    expect(parsesUnderSpelling('30s', 'lookback')).toBe(false);
    expect(parsesUnderSpelling('-30s', 'signed-lookback')).toBe(false);
  });

  it('the signed look-back keeps its one minus', () => {
    expect(parsesUnderSpelling('-24h', 'signed-lookback')).toBe(true);
    expect(parsesUnderSpelling('--24h', 'signed-lookback')).toBe(false);
    expect(parsesUnderSpelling('24h', 'signed-lookback')).toBe(false);
    expect(parsesUnderSpelling('-24h', 'lookback')).toBe(false);
  });
});

describe('the conversions follow — functional', () => {
  it('convertSpelling refuses what the spelling now refuses, and converts the rest as before', () => {
    expect(
      convertSpelling('2026-02-30T08:00Z..2026-03-01T08:00Z', 'iso-range', 'iso-range'),
    ).toBeUndefined();
    expect(convertSpelling('2026-02-28T08:00Z..2026-03-01T08:00Z', 'iso-range', 'iso-range')).toBe(
      '2026-02-28T08:00Z..2026-03-01T08:00Z',
    );
    expect(convertSpelling('24h', 'lookback', 'signed-lookback')).toBe('-24h');
    expect(convertSpelling('-24h', 'signed-lookback', 'lookback')).toBe('24h');
  });
});

describe('the door at definition — integration', () => {
  const schema = {
    type: 'object',
    required: ['range'],
    properties: { range: { type: 'string' } },
  } as const;

  it('a declared iso-range default naming 30 February is refused, naming the tool and the value', () => {
    expect(() =>
      defineTool({
        name: 'query_metrics',
        description: 'd',
        inputSchema: schema,
        askOrAssume: { range: { assume: '2026-02-30T08:00Z..2026-03-01T08:00Z' } },
        period: { argument: 'range', spelling: 'iso-range' },
        execute: () => 'ok',
      }),
    ).toThrow(
      /defineTool\('query_metrics'\): period\.spelling.*2026-02-30T08:00Z\.\.2026-03-01T08:00Z.*is not spelled 'iso-range'/,
    );
  });

  it('a well-formed one is declared as before', () => {
    const tool = defineTool({
      name: 'query_metrics',
      description: 'd',
      inputSchema: schema,
      askOrAssume: { range: { assume: '2026-02-28T08:00:00-07:00..2026-03-01T08:00:00-07:00' } },
      period: { argument: 'range', spelling: 'iso-range' },
      execute: () => 'ok',
    });
    expect(tool.period).toEqual({ argument: 'range', spelling: 'iso-range' });
  });
});

describe('every iso-range accepted before is accepted after, except rows a–b — property', () => {
  it('over 20 000 generated values', () => {
    const r = prng(9_302_026);
    let before = 0;
    const taken = { a: 0, b: 0 };
    for (let i = 0; i < 20_000; i++) {
      const value = r() < 0.97 ? `${instantish(r)}..${instantish(r)}` : instantish(r);
      const was = parsesUnderSpellingBefore(value, 'iso-range');
      const is = parsesUnderSpelling(value, 'iso-range');
      if (was) before++;
      // Row c avoided: nothing is newly accepted.
      if (is) expect(was, value).toBe(true);
      if (was && !is) {
        const row = takenRow(value);
        expect(row, value).toBeDefined();
        taken[row as 'a' | 'b']++;
      }
    }
    // The generator visits both taken rows and plenty of accepted values, or the property proves nothing.
    expect(before).toBeGreaterThan(2_000);
    expect(taken.a).toBeGreaterThan(0);
    expect(taken.b).toBeGreaterThan(0);
  });
});

describe('the leaf law — security', () => {
  it('src/core/time/ imports nothing outside itself', () => {
    const dir = join(__dirname, '..', '..', '..', 'src', 'core', 'time');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const text = readFileSync(join(dir, file), 'utf8');
      const specifiers = [
        ...text.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm),
      ].map((m) => m[1] as string);
      for (const spec of specifiers)
        expect(spec, `${file} imports ${spec}`).toMatch(/^\.\/[a-z]+\.js$/i);
    }
  });
});
