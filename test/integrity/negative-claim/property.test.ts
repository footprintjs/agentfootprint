/**
 * negative-claim — PROPERTIES over random turns (a seeded generator: this repo carries no
 * fast-check, and `mulberry32` is its precedent — reproduce a failure with the seed in its name).
 *
 *   P1 MONOTONE (typed) — appending ANY call to the sequence (another read of the cited key, a
 *      wider or narrower search, another tool, a write, a failure; a fresh result identity)
 *      never turns a withheld typed verdict into an established one.
 *   P2 MONOTONE (prose) — appending a call that would not establish the claim on its own never
 *      turns a noted prose claim into an established one: an extra reading clears no other
 *      reading's objection.
 *   P3 DETERMINISTIC — the same record judged twice, or a structured clone of it, gives equal
 *      rows and statements.
 */
import { describe, expect, it } from 'vitest';

import { judgeTypedNegatives } from '../../../src/integrity/negative-claim/judge.js';
import { judgeProseNegatives } from '../../../src/integrity/negative-claim/prose.js';
import type { CoverageGap as SearchGap } from '../../../src/semantics/coverage/composedCoverage.js';
import type { ProseClaimRow, TurnCall } from '../../../src/integrity/negative-claim/types.js';
import { CLOCK, changesCall, incidentCall, rid, turnRecord, writeCall } from './fixtures.js';

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

const GAPS: readonly (readonly SearchGap[])[] = [
  [],
  [{ kind: 'scope', what: 'incidents filed by email', bears: 'source' }],
  [{ kind: 'cap-reached', what: 'limit reached', bears: 'completeness' }],
  [{ kind: 'paged', what: 'later pages', bears: 'completeness' }],
  [{ kind: 'prose', what: 'the archive tier' }],
  [{ kind: 'scope', what: 'sev1 by phone', bears: { filter: 'severity', values: ['critical'] } }],
];

function generator(seed: number) {
  const rand = mulberry32(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;
  let next = 1;
  const randomCall = (id = `c${next++}`): TurnCall => {
    const shape = rand();
    if (shape < 0.12) {
      return writeCall(`w${next++}`, {
        outcome: pick(['ok', 'error', 'not-run'] as const),
        dispatched: rand() < 0.8,
        batch: Math.floor(rand() * 6),
      });
    }
    if (shape < 0.2) return { ...changesCall(`k${next++}`), batch: Math.floor(rand() * 6) };
    const emptiness = pick([
      'declared-absent',
      'declared-absent',
      'non-empty',
      'undeclared-empty',
      'clarify',
      'unknown',
    ] as const);
    return incidentCall({
      id,
      service: pick(['payments', 'payments', 'checkout']),
      ...(rand() < 0.5 ? {} : { severity: pick(['critical', 'minor']) }),
      ...(rand() < 0.7 ? {} : { window: '7d' }),
      outcome: pick(['ok', 'ok', 'ok', 'error', 'not-run'] as const),
      emptiness,
      rows: emptiness === 'non-empty' ? 1 + Math.floor(rand() * 4) : 0,
      ...(rand() < 0.5
        ? {}
        : {
            rowsRead: Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, i) => ({
              entity: `INC-${i}`,
              ...(rand() < 0.7 ? { severity: pick(['critical', 'minor', 'major']) } : {}),
            })),
          }),
      gaps: pick(GAPS),
      complete: rand() < 0.8,
      composed: rand() < 0.9 ? 'local' : 'remote',
      batch: Math.floor(rand() * 6),
      ...(rand() < 0.1 ? { noScope: true } : {}),
    });
  };
  return { rand, pick, randomCall };
}

const SEEDS = Array.from({ length: 150 }, (_, i) => 31_000 + i);

describe('P1 — appending any call never establishes a withheld typed claim', () => {
  it.each(SEEDS)('seed %i', (seed) => {
    const { rand, pick, randomCall } = generator(seed);
    const cited = randomCall('c900');
    const kind = pick(['none', 'complete', 'not-found'] as const);
    const negatives = [{ kind, restsOn: [rid('c900')] }];
    const before = Array.from({ length: Math.floor(rand() * 5) }, () => randomCall());
    const calls = rand() < 0.5 ? [cited, ...before] : [...before, cited];
    const verdict = (list: readonly TurnCall[]) =>
      judgeTypedNegatives({ field: 'n', negatives, record: turnRecord(list) })[0]?.row.code;
    const was = verdict(calls);
    const appended = randomCall();
    const now = verdict([...calls, appended]);
    if (was !== 'established') expect(now, `${was} → ${now}`).not.toBe('established');
  });
});

const TEXTS = [
  'There are no open incidents on payments in the last 2 hours.',
  'The incident store has no open incidents on payments in the last 2 hours.',
  'There are no critical open incidents on payments in the last 2 hours.',
  'These are all the open incidents on payments in the last 2 hours.',
];

describe('P2 — an extra reading clears no other reading’s objection (prose)', () => {
  it.each(SEEDS)('seed %i', (seed) => {
    const { rand, pick, randomCall } = generator(seed);
    const text = pick(TEXTS);
    const calls = Array.from({ length: 1 + Math.floor(rand() * 5) }, () => randomCall());
    const appended = randomCall();
    const established = (list: readonly TurnCall[]) => {
      const claims = judgeProseNegatives({ field: 's', text, record: turnRecord(list) }).filter(
        (r): r is ProseClaimRow => r.kind === 'negative-claim',
      );
      return claims.length > 0 && claims.every((c) => c.notes.length === 0);
    };
    if (!established(calls) && !established([appended])) {
      expect(established([...calls, appended])).toBe(false);
    }
  });
});

describe('P3 — deterministic', () => {
  it.each(SEEDS.slice(0, 40))('seed %i', (seed) => {
    const { rand, pick, randomCall } = generator(seed);
    const calls = Array.from({ length: 1 + Math.floor(rand() * 6) }, () => randomCall());
    const negatives = calls.map((c) => ({
      kind: pick(['none', 'complete'] as const),
      restsOn: [c.resultId],
    }));
    const text = pick(TEXTS);
    const typed = (list: readonly TurnCall[]) =>
      judgeTypedNegatives({ field: 'n', negatives, record: turnRecord(list) });
    const prose = (list: readonly TurnCall[]) =>
      judgeProseNegatives({ field: 's', text, record: turnRecord(list, { clock: CLOCK }) });
    expect(typed(calls)).toEqual(typed(calls));
    expect(typed(structuredClone(calls))).toEqual(typed(calls));
    expect(prose(structuredClone(calls))).toEqual(prose(calls));
  });
});
