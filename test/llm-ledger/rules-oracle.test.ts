/**
 * RULES, GENERATED — each built-in rule against an independent oracle (case table §8.4).
 *
 * Each oracle decides with plain code, not the rule's `decide()` table: `cited` by counting cites,
 * `traceable-values` by walking token sets (the token reading itself is pinned by the plain-split
 * oracle in `tokens-property.test.ts`), `time-window` by a SORTED SWEEP over every window boundary
 * instead of the rule's merged-union subtraction. Inputs come from `seeded`.
 */
import { describe, expect, it } from 'vitest';

import { isIncomplete } from '../../src/llm-ledger/entries.js';
import { cited } from '../../src/llm-ledger/rules/cited.js';
import { runRule } from '../../src/llm-ledger/rules/port.js';
import type { LedgerRuleInput } from '../../src/llm-ledger/rules/port.js';
import { timeWindow } from '../../src/llm-ledger/rules/timeWindow.js';
import { traceableValues } from '../../src/llm-ledger/rules/traceableValues.js';
import { tokensOf } from '../../src/llm-ledger/tokens.js';
import type { LedgerReceipt, LedgerSupplied } from '../../src/llm-ledger/types.js';
import { instantMs } from '../../src/llm-ledger/window.js';
import { seeded } from '../helpers/seededText.js';

const AT = '2026-11-26T10:00:00Z';
const POOL = ['esx01a', 'vm-0042', '41200', 'fc1/3', 'id-7777', 'h-2026'];
const WORDS = ['host', 'alpha', 'up'];
const HOUR = 3_600_000;
const iso = (h: number) =>
  new Date(Date.UTC(2026, 10, 25) + h * HOUR).toISOString().replace('.000Z', 'Z');

function generated(seed: number): LedgerRuleInput {
  const next = seeded(seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)] as T;
  const receipts: LedgerReceipt[] = Array.from({ length: Math.floor(next() * 4) }, (_, i) => {
    const r: Record<string, unknown> = {
      v: 1,
      seq: i + 2,
      kind: 'receipt',
      by: 'host',
      how: next() < 0.3 ? 'reported' : 'observed',
      at: AT,
      source: 's',
      bytes: 1,
      nothingFound: false,
      tokens: POOL.filter(() => next() < 0.4),
    };
    if (next() < 0.7) {
      const from = Math.floor(next() * 10);
      r.window = { from: iso(from), to: iso(from + 1 + Math.floor(next() * 6)) };
    }
    if (next() < 0.2) r.hidden = 1;
    return r as unknown as LedgerReceipt;
  });
  const supplied: LedgerSupplied[] =
    next() < 0.3
      ? [
          {
            v: 1,
            seq: 9,
            kind: 'supplied',
            by: 'host',
            how: 'observed',
            at: AT,
            from: 'app',
            tokens: [pick(POOL)],
            bytes: 1,
            digest: `sha256:${'0'.repeat(64)}`,
          },
        ]
      : [];
  const text = Array.from({ length: Math.floor(next() * 4) }, () =>
    next() < 0.6 ? pick(POOL) : pick(WORDS),
  ).join(' ');
  const from = Math.floor(next() * 10);
  const note = {
    v: 1 as const,
    seq: 20,
    kind: 'note' as const,
    by: 'agent' as const,
    how: 'observed' as const,
    at: AT,
    noteKind: 'claim' as const,
    text,
    ...(next() < 0.7
      ? { window: { from: iso(from), to: iso(from + 1 + Math.floor(next() * 5)) } }
      : {}),
    cites: receipts.map((r) => r.seq),
  };
  return { subject: { kind: 'claim', note }, receipts, supplied };
}

/** `cited@1` by counting. */
const citedOracle = (input: LedgerRuleInput) =>
  input.subject.kind !== 'draft' && input.subject.note.cites.length > 0
    ? 'checked-pass'
    : 'checked-fail';

/** `traceable-values@1` by walking token sets. */
function traceableOracle(input: LedgerRuleInput): string {
  if (input.subject.kind === 'draft') throw new Error('notes only here');
  const stated = new Set(tokensOf(input.subject.note.text));
  if (stated.size === 0) return 'unreachable';
  const exempt = new Set(input.supplied.flatMap((s) => s.tokens));
  const checkable = [...stated].filter((t) => !exempt.has(t));
  if (checkable.length === 0) return 'unreachable';
  const held = new Set(input.receipts.flatMap((r) => r.tokens));
  const missing = checkable.filter((t) => !held.has(t)).length;
  const incomplete = input.receipts.some(isIncomplete);
  if (missing > 0) return incomplete ? 'unreachable' : 'checked-fail';
  return 'checked-pass';
}

/** Milliseconds of `[from, to)` covered by `spans`: a sweep over sorted boundaries, counting depth. */
function coveredBySweep(from: number, to: number, spans: [number, number][]): number {
  const points = [...new Set([from, to, ...spans.flat()])]
    .filter((p) => p >= from && p <= to)
    .sort((a, b) => a - b);
  let covered = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const [a, b] = [points[i] as number, points[i + 1] as number];
    if (spans.some(([s, e]) => s <= a && e >= b)) covered += b - a;
  }
  return covered;
}

/** `time-window@1` by the sweep. */
function windowOracle(input: LedgerRuleInput): string {
  if (input.subject.kind === 'draft') throw new Error('notes only here');
  const w = input.subject.note.window;
  if (w === undefined) return 'not-applicable';
  const [from, to] = [instantMs(w.from)!, instantMs(w.to)!];
  const windowed = input.receipts.filter((r) => r.window !== undefined);
  if (windowed.length === 0) return 'unreachable';
  const spans = windowed.map(
    (r) => [instantMs(r.window!.from)!, instantMs(r.window!.to)!] as [number, number],
  );
  const uncovered = to - from - coveredBySweep(from, to, spans);
  if (uncovered > 0)
    return windowed.length < input.receipts.length ? 'unreachable' : 'checked-fail';
  const cut = windowed.some((r, i) => isIncomplete(r) && spans[i]![0] < to && spans[i]![1] > from);
  return cut ? 'unreachable' : 'checked-pass';
}

describe('each built-in rule against its oracle', () => {
  it.each([
    ['cited@1', cited, citedOracle],
    ['traceable-values@1', traceableValues, traceableOracle],
    ['time-window@1', timeWindow, windowOracle],
  ] as const)('%s', async (_name, rule, oracle) => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 4_000; seed++) {
      const input = generated(seed);
      const finding = await runRule(rule, input);
      expect(finding.disposition, `seed ${seed}`).toBe(oracle(input));
      seen.add(finding.disposition);
    }
    expect(seen.size).toBeGreaterThanOrEqual(2); // the generator reaches more than one branch
  });
});
