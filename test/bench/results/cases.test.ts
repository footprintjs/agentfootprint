/**
 * The results bench's case sheet (`bench/results/cases.mjs`).
 *
 * Test types:
 *   - UNIT     — the sheet is sound (`sheetProblems` is empty); the bench's own period comparison
 *                (`expectedVerdict`) at every boundary, inclusive; each store's reads;
 *   - PROPERTY — over 1,000 seeded periods, the bench's comparison and the library's
 *                (`coverage/period.ts` · `periodVerdict`) agree — two independent readings of one
 *                rule, so the fold is checked against a reading it did not write;
 *   - SECURITY — no case, tool or prompt carries a word that tells the model about periods.
 */
import { describe, expect, it } from 'vitest';

import { periodVerdict } from '../../../src/core/agent/coverage/period.js';
import {
  CASES,
  NOW,
  SYSTEM_PROMPT,
  TOOLS,
  expectedVerdict,
  iso,
  queriedFor,
  readStore,
  sheetProblems,
  worldOf,
  // @ts-expect-error — a plain .mjs bench module, no types
} from '../../../bench/results/cases.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { prng } from '../../../bench/inputs/labels.mjs';

describe('UNIT — the sheet', () => {
  it('is sound', () => {
    expect(sheetProblems()).toEqual([]);
  });

  it('pairs R1 and R2 across off and on; R3 runs on only', () => {
    for (const c of CASES) expect(c.arms).toEqual(c.cell === 'R3' ? ['on'] : ['off', 'on']);
  });

  it('compares instants inclusively, in four verdicts', () => {
    const q = { from: '2026-09-26T09:00:00Z', to: '2026-09-26T10:00:00Z' };
    expect(expectedVerdict(q, 'unknown')).toBe('unknown');
    expect(expectedVerdict(q, { from: '2026-09-26T09:00:00Z', to: '2026-09-26T10:00:00Z' })).toBe(
      'covered',
    );
    expect(expectedVerdict(q, { from: '2026-08-27T02:00:00Z', to: '2026-09-26T02:00:00Z' })).toBe(
      'not-held',
    );
    expect(expectedVerdict(q, { from: '2026-09-26T10:00:00Z', to: '2026-09-27T00:00:00Z' })).toBe(
      'partly-held',
    );
    expect(expectedVerdict(q, { from: '2026-09-26T09:30:00Z', to: '2026-09-27T00:00:00Z' })).toBe(
      'partly-held',
    );
  });

  it('reads each store for the window asked, inside what it truly holds', () => {
    expect(queriedFor('1h')).toEqual({ from: '2026-09-26T09:00:00Z', to: NOW });
    const world = worldOf(CASES[0]);
    expect(
      readStore('search_errors', { service: 'checkout', window: '30d' }, world).rows,
    ).toHaveLength(13);
    expect(
      readStore('search_errors', { service: 'checkout', window: '7d' }, world).rows,
    ).toHaveLength(13);
    expect(
      readStore('search_errors', { service: 'checkout', window: '24h' }, world).rows,
    ).toHaveLength(9);
    expect(readStore('job_failures', { window: '6h' }, world).rows).toHaveLength(0);
    expect(readStore('job_failures', { window: '24h' }, world).rows).toHaveLength(2);
    expect(() => readStore('job_failures', { window: '2h' }, world)).toThrow(/unknown window/);
  });
});

describe('PROPERTY — the bench and the library read one rule the same way', () => {
  it('agrees with periodVerdict over 1,000 seeded periods', () => {
    const next = prng(20260928);
    const base = Date.parse(NOW);
    const instant = () => iso(base - Math.floor(next() * 40) * 3_600_000);
    const pair = () => {
      const a = instant();
      const b = instant();
      return Date.parse(a) <= Date.parse(b) ? { from: a, to: b } : { from: b, to: a };
    };
    for (let i = 0; i < 1000; i += 1) {
      const queried = pair();
      const held = next() < 0.1 ? 'unknown' : pair();
      expect(expectedVerdict(queried, held)).toBe(periodVerdict({ queried, held } as any));
    }
  });
});

describe('SECURITY — nothing served tells the model about periods', () => {
  it('the prompt and the tools never mention held data, retention or coverage', () => {
    const served = [SYSTEM_PROMPT, ...TOOLS.map((t: any) => JSON.stringify(t))]
      .join(' ')
      .toLowerCase();
    for (const word of ['retention', 'retain', 'held', 'stale', 'coverage', 'covers', 'period']) {
      expect(served).not.toContain(word);
    }
  });
});
