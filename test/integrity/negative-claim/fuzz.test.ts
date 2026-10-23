/**
 * negative-claim — FUZZ: nothing the model writes can make the checker throw. Arbitrary text into
 * the prose door, arbitrary JSON into the typed door — over records that carry every gap shape,
 * a filter gap with no `values` included. A throw would be a silent pass (the check never filed
 * its row), so the law is: every input returns rows, fail closed.
 *
 * Seeded (`mulberry32`, the repo's precedent — no fast-check here); a failing seed is named.
 */
import { describe, expect, it } from 'vitest';

import { judgeTypedNegatives } from '../../../src/integrity/negative-claim/judge.js';
import { judgeProseNegatives } from '../../../src/integrity/negative-claim/prose.js';
import type { CoverageGap as SearchGap } from '../../../src/semantics/coverage/composedCoverage.js';
import {
  EMAIL_GAP,
  amongCall,
  changesCall,
  incidentCall,
  rid,
  turnRecord,
  writeCall,
} from './fixtures.js';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  'there are no ',
  'has no ',
  'none of ',
  'payments',
  'pay-svc',
  ' or ',
  ' and ',
  ', ',
  'checkout ',
  'open ',
  'critical ',
  'sev1 ',
  'incidents',
  ' in the last 2 hours',
  ' anywhere',
  'never had ',
  'These are all ',
  'the incident store ',
  '`',
  '```\n',
  '| ',
  ' |\n',
  '- ',
  '\n\n',
  '. ',
  '; but ',
  'no hay ',
  '没有',
  '\u{202E}',
  '\u{200B}',
  '\u{0000}',
  '\u{D800}',
  '\u{1F600}',
  'Café',
  '0 ',
  'all 3 ',
];

const GAPS: readonly SearchGap[] = [
  EMAIL_GAP,
  {
    kind: 'argument-unsent',
    what: 'severity: not sent',
    argument: 'severity',
    bears: { filter: 'severity' },
  },
  { kind: 'scope', what: 'sev1 by phone', bears: { filter: 'severity', values: ['critical'] } },
  { kind: 'prose', what: 'the archive tier' },
  { kind: 'paged', what: 'page: 2', bears: 'completeness' },
  { kind: 'partial', what: 'partial', bears: 'completeness' },
];

const record = turnRecord([
  incidentCall({ id: 'c1', gaps: GAPS }),
  incidentCall({ id: 'c2', severity: 'critical', emptiness: 'non-empty', rows: 2 }),
  incidentCall({ id: 'c3', outcome: 'error', noScope: true }),
  changesCall('k1'),
  amongCall(),
  writeCall('w1'),
]);

function randomText(rand: () => number): string {
  let out = '';
  const n = Math.floor(rand() * 40);
  for (let i = 0; i < n; i += 1) {
    out +=
      rand() < 0.8
        ? (PIECES[Math.floor(rand() * PIECES.length)] as string)
        : String.fromCodePoint(Math.floor(rand() * 0x2ffff));
  }
  return out;
}

function randomJson(rand: () => number, depth = 0): unknown {
  const r = rand();
  if (depth > 3 || r < 0.2) {
    return [
      null,
      true,
      0,
      -1,
      1e308,
      '',
      'none',
      rid('c1'),
      rid('c9'),
      'claim-result/x',
      randomText(rand),
    ][Math.floor(rand() * 11)];
  }
  if (r < 0.5)
    return Array.from({ length: Math.floor(rand() * 4) }, () => randomJson(rand, depth + 1));
  const keys = ['kind', 'restsOn', 'about', '__proto__', 'constructor', 'toString', 'x'];
  const out: Record<string, unknown> = {};
  for (const key of keys) if (rand() < 0.5) out[key] = randomJson(rand, depth + 1);
  return out;
}

const SEEDS = Array.from({ length: 300 }, (_, i) => 70_000 + i);

describe('FUZZ — no model text makes the checker throw', () => {
  it.each(SEEDS)('prose, seed %i', (seed) => {
    const rand = mulberry32(seed);
    const text = randomText(rand);
    expect(() =>
      judgeProseNegatives({ field: 's', text, record, personMessage: randomText(rand) }),
    ).not.toThrow();
  });

  it.each(SEEDS)('typed, seed %i', (seed) => {
    const rand = mulberry32(seed);
    const negatives = randomJson(rand);
    const rows = judgeTypedNegatives({ field: 'n', negatives, record });
    expect(Array.isArray(rows)).toBe(true);
    for (const { row } of rows) expect(row.code).toBeTypeOf('string');
  });
});
