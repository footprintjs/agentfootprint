/**
 * Cost before the run (RULE.md § 3, § 8; `harness/cost.mjs`, `harness/smoke.mjs`).
 *
 * Test types:
 *   - UNIT     — prices from the rule's rows, the long-prompt card; the one ledger; the ceiling;
 *   - SCENARIO — the smoke step refuses a harness fault (an agent error, an HTTP 4xx, a text
 *                mismatch, a smoke not judged by both judges, another model); a plan whose first
 *                complete core repetition does not fit is refused; a plan that fits only without
 *                its side arms drops them, never a core repetition.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { PRICES } from '../../../bench/inputs/harness.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import {
  costOfReplies,
  costOfUsage,
  ledgerOf,
  maxUsdOf,
} from '../../../bench/honest-report/harness/cost.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { planOf } from '../../../bench/honest-report/harness/plan.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import {
  planWithin,
  readSmoke,
  smokeRefusal,
} from '../../../bench/honest-report/harness/smoke.mjs';

describe('UNIT — prices, the ledger and the ceiling', () => {
  it('the rule`s rows: Claude Haiku 5.5 and Claude Opus 5.5', () => {
    expect(PRICES['claude-haiku-5-5']).toEqual({
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
      cacheWrite: 0.2,
    });
    expect(PRICES['claude-opus-5-5']).toEqual({
      input: 4,
      output: 20,
      cacheRead: 0.2,
      cacheWrite: 8,
    });
  });

  it('a prompt over 100K tokens is priced at Haiku 5.5`s long card, five times the row', () => {
    const short = costOfUsage({ input: 100_000, output: 1000 }, 'claude-haiku-5-5');
    const long = costOfUsage({ input: 100_001, output: 1000 }, 'claude-haiku-5-5');
    expect(short).toBeCloseTo((100_000 * 0.1 + 1000 * 0.5) / 1e6, 12);
    expect(long).toBeCloseTo((5 * (100_001 * 0.1 + 1000 * 0.5)) / 1e6, 12);
    expect(costOfUsage({ input: 200_000, output: 0 }, 'claude-opus-5-5')).toBeCloseTo(0.8, 12);
    expect(
      costOfReplies(
        [{ usage: { input: 2000, output: 300 } }, { usage: { input: 2000, output: 300 } }],
        'claude-haiku-5-5',
      ),
    ).toBeCloseTo(0.0007, 12);
    expect(() => costOfUsage({ input: 1 }, 'no-such-model')).toThrow(/no price/);
  });

  it('one ledger: every line adds to one total', () => {
    const l = ledgerOf(mkdtempSync(join(tmpdir(), 'hr-ledger-')));
    expect(l.total()).toBe(0);
    l.pay({ who: 'run', usd: 0.25, runKey: 'k' });
    l.pay({ who: 'first judge', usd: 0.5 });
    expect(l.total()).toBe(0.75);
  });

  it('the ceiling is at most 15 dollars', () => {
    expect(maxUsdOf('15')).toBe(15);
    expect(() => maxUsdOf('16')).toThrow(/above the ceiling of 15/);
    expect(() => maxUsdOf('0')).toThrow(/positive/);
  });
});

/** A smoke folder: `plan.json`, `runs.jsonl`, both judges' lines and the ledger. */
function smokeFolder({
  lines,
  first = 20,
  second = 20,
  model = 'claude-haiku-5-5',
  judgeUsd = [0.0002, 0.01],
}: any) {
  const d = mkdtempSync(join(tmpdir(), 'hr-smoke-'));
  writeFileSync(
    join(d, 'plan.json'),
    JSON.stringify({ config: { provider: 'anthropic', model, maxUsd: 15 }, plan: [] }),
  );
  writeFileSync(join(d, 'runs.jsonl'), `${lines.map((l: any) => JSON.stringify(l)).join('\n')}\n`);
  const judged = (n: number, usd: number) =>
    Array.from({ length: n }, (_, i) =>
      JSON.stringify({
        runKey: `k${i}`,
        arm: 'free-default',
        role: i % 2 ? 'twin' : 'trap',
        claim: { status: i === 1 ? 'unclear' : 'done' },
        usd,
      }),
    ).join('\n');
  if (first > 0) writeFileSync(join(d, 'judged.jsonl'), `${judged(first, judgeUsd[0])}\n`);
  if (second > 0) writeFileSync(join(d, 'judged-second.jsonl'), `${judged(second, judgeUsd[1])}\n`);
  const ledger = ledgerOf(d);
  for (const l of lines) ledger.pay({ who: 'run', usd: l.usd ?? 0 });
  return d;
}
const ok = (usd = 0.002) =>
  Array.from({ length: 20 }, (_, i) => ({ runKey: `k${i}`, ending: 'answered', usd }));

describe('SCENARIO — the smoke step refuses a harness fault', () => {
  it('a clean smoke passes', () => {
    expect(
      smokeRefusal(readSmoke(smokeFolder({ lines: ok() })), { model: 'claude-haiku-5-5' }),
    ).toBeUndefined();
  });

  it('an agent error stops the run', () => {
    const lines = [
      ...ok(),
      { runKey: 'bad', ending: 'agent-error', error: 'TypeError: x is undefined' },
    ];
    expect(smokeRefusal(readSmoke(smokeFolder({ lines })))).toMatch(
      /1 agent error\(s\) \(bad: TypeError: x is undefined\): a harness fault/,
    );
  });

  it('any answer with an HTTP 4xx stops the run, a 400 as much as a 429', () => {
    for (const httpStatus of [400, 404, 429]) {
      const lines = [
        ...ok(),
        { runKey: 'bad', ending: httpStatus === 429 ? 'service-fault' : 'agent-error', httpStatus },
      ];
      expect(smokeRefusal(readSmoke(smokeFolder({ lines })))).toMatch(
        httpStatus === 429 ? /HTTP 429/ : /agent error|HTTP/,
      );
    }
  });

  it('a text mismatch, a smoke not judged by both judges, another model', () => {
    expect(
      smokeRefusal(
        readSmoke(smokeFolder({ lines: [...ok(), { runKey: 'm', ending: 'text-mismatch' }] })),
      ),
    ).toMatch(/text mismatch/);
    expect(smokeRefusal(readSmoke(smokeFolder({ lines: ok(), second: 0 })))).toMatch(/both judges/);
    expect(
      smokeRefusal(readSmoke(smokeFolder({ lines: ok() })), { model: 'claude-haiku-4-5' }),
    ).toMatch(/ran claude-haiku-5-5/);
  });
});

describe('SCENARIO — the plan must fit under the one ceiling', () => {
  const instances = Array.from({ length: 336 }, (_, i) => ({ id: `i${i}` }));
  const isTrap = (id: string) => Number(id.slice(1)) % 4 === 0;
  const plan = planOf({
    instances,
    arms: ['free-default', 'free-checks', 'free-checks-line', 'form-default'],
    builds: ['A', 'B'],
    coreReps: 3,
    sideReps: 1,
    seed: 1,
  });

  it('a plan whose first complete core repetition does not fit is refused', () => {
    const smoke = readSmoke(smokeFolder({ lines: ok(0.02) }));
    const r = planWithin({ plan, smoke, maxUsd: 15, isTrap });
    expect(r.refusal).toMatch(/the first complete core repetition does not fit/);
  });

  it('a plan that fits only without its side arms drops them, never a core repetition', () => {
    const smoke = readSmoke(smokeFolder({ lines: ok(0.0015) }));
    const r = planWithin({ plan, smoke, maxUsd: 15, isTrap });
    expect(r.refusal).toBeUndefined();
    expect(r.droppedSide).toBe(true);
    expect(r.plan.every((p: any) => p.arm === 'free-default')).toBe(true);
    expect(new Set(r.plan.map((p: any) => p.round))).toEqual(new Set([0, 1, 2]));
  });

  it('a plan that fits whole is kept whole; the smoke`s own spend counts against the ceiling', () => {
    const smoke = readSmoke(smokeFolder({ lines: ok(0.0002), judgeUsd: [0.00005, 0.001] }));
    const r = planWithin({ plan, smoke, maxUsd: 15, isTrap });
    expect(r).toMatchObject({ droppedSide: false });
    expect(r.plan).toHaveLength(plan.length);
    expect(r.projection.total).toBeGreaterThan(smoke.spent);
  });
});
