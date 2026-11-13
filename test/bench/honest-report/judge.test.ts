/**
 * The judge step and the check of the judge (RULE.md § 4–5; `judge.mjs`, `judge/sample.mjs`,
 * `score.mjs` · `judgeAgreement` / `secondReading`).
 *
 * Test types:
 *   - UNIT     — one judge call: a readable reply is a claim; an unreadable one is asked once
 *                more and recorded; two unreadable replies or failed calls are `judge-unreadable`;
 *                the request carries no sampling parameter; the second judge's sample and the
 *                primary runs; κ and recall; the bars;
 *   - SCENARIO — the judge loop never loses paid work: every line is appended as it is made, a
 *                restart skips what is judged, the ceiling stops the loop with every line kept;
 *                below the bars the primary is read from the second judge, or is not measurable.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { JUDGE_MAX_TOKENS, judgeLoop, judgeOne } from '../../../bench/honest-report/judge.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import {
  personSheet,
  primaryRuns,
  secondSample,
} from '../../../bench/honest-report/judge/sample.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { judgeAgreement, secondReading } from '../../../bench/honest-report/score.mjs';

const CLAIM = {
  status: 'done',
  mentionsProblem: false,
  asksQuestion: false,
  actions: [],
  statedValues: [],
};
const reply = (text: string) => ({
  model: 'served',
  stop_reason: 'end_turn',
  content: [
    { type: 'thinking', thinking: '' },
    { type: 'text', text },
  ],
  usage: { input_tokens: 500, output_tokens: 100 },
});

describe('UNIT — one judge call', () => {
  it('a readable reply is the claim; the request sends no sampling parameter and room for thinking', async () => {
    const seen: any[] = [];
    const r = await judgeOne({
      ask: async (req: any) => (seen.push(req), reply(JSON.stringify(CLAIM))),
      model: 'claude-haiku-5-5',
      input: 'x',
    });
    expect(r.claim).toEqual(CLAIM);
    expect(r.tries).toHaveLength(1);
    expect(seen[0]).not.toHaveProperty('temperature');
    expect(seen[0].max_tokens).toBe(JUDGE_MAX_TOKENS);
    expect(r.usd).toBeCloseTo((500 * 0.1 + 100 * 0.5) / 1e6, 12);
  });

  it('an unreadable reply is asked once more, and the re-ask is recorded', async () => {
    let n = 0;
    const r = await judgeOne({
      ask: async () => reply(++n === 1 ? 'no json here' : JSON.stringify(CLAIM)),
      model: 'claude-haiku-5-5',
      input: 'x',
    });
    expect(r.claim).toEqual(CLAIM);
    expect(r.tries).toHaveLength(2);
    expect(r.tries[0].unreadable).toBe('no json here');
    expect(r.usd).toBeCloseTo((2 * (500 * 0.1 + 100 * 0.5)) / 1e6, 12);
  });

  it('two unreadable replies, or two failed calls, are judge-unreadable: paid work recorded, never thrown away', async () => {
    expect(
      (await judgeOne({ ask: async () => reply('?'), model: 'claude-haiku-5-5', input: 'x' }))
        .unreadable,
    ).toBe('judge-unreadable');
    const failed = await judgeOne({
      ask: async () => {
        throw Object.assign(new Error('overloaded'), { status: 529 });
      },
      model: 'claude-haiku-5-5',
      input: 'x',
    });
    expect(failed).toMatchObject({ unreadable: 'judge-unreadable', usd: 0 });
    expect(failed.tries.map((t: any) => t.error)).toEqual(['overloaded', 'overloaded']);
  });
});

describe('SCENARIO — the judge loop never loses paid work', () => {
  const raws = ['r1', 'r2', 'r3', 'r4'].map((k, i) => ({
    runKey: k,
    instanceId: `i${i}`,
    arm: 'free-default',
    modelText: 'Done.',
  }));
  const keys = new Map(raws.map((r) => [r.instanceId, { role: 'trap', message: 'Please.' }]));
  const byKey = new Map(raws.map((r) => [r.runKey, r]));
  const order = raws.map((r) => r.runKey);
  const ledgerAt = () => {
    let total = 0;
    return { total: () => total, pay: ({ usd }: any) => (total += usd) };
  };

  it('appends each line as it is made; a restart skips every run already judged', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'hr-judge-')), 'judged.jsonl');
    let calls = 0;
    const flaky = async () => {
      calls += 1;
      if (calls === 3) throw new Error('the process dies here');
      return reply(JSON.stringify(CLAIM));
    };
    const judge = { kind: 'model', model: 'claude-haiku-5-5' };
    await expect(
      judgeLoop({
        order,
        byKey,
        keys,
        file,
        judge,
        model: 'claude-haiku-5-5',
        ask: async (req: any) => {
          const r = await flaky();
          return r;
        },
        ledger: ledgerAt(),
        maxUsd: 1,
      }),
    ).resolves.toMatchObject({ written: 4 });
    // the 3rd call failed and was asked again (judgeOne's re-ask), so every run has a line
    const lines = readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines.map((l) => l.runKey)).toEqual(order);
    const again = await judgeLoop({
      order,
      byKey,
      keys,
      file,
      judge,
      model: 'claude-haiku-5-5',
      ask: async () => {
        throw new Error('must not be asked');
      },
      ledger: ledgerAt(),
      maxUsd: 1,
    });
    expect(again).toEqual({ written: 0, skipped: 4, stopped: false });
  });

  it('the ceiling stops the loop, with every line made so far kept', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'hr-judge-')), 'judged.jsonl');
    const ledger = ledgerAt();
    const r = await judgeLoop({
      order,
      byKey,
      keys,
      file,
      judge: {},
      model: 'claude-haiku-5-5',
      ask: async () => reply(JSON.stringify(CLAIM)),
      ledger,
      maxUsd: 0.00075,
    });
    // each call costs $0.0001; the next call is projected at the floor of 1,000 in / 1,000 out
    // ($0.0006 on Haiku 5.5's row): after two calls, 0.0002 + 0.0006 is over 0.00075
    expect(r).toMatchObject({ stopped: true, written: 2 });
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('a rehearsal (no ask) uses the scripted judge, $0', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'hr-judge-')), 'judged.jsonl');
    const r = await judgeLoop({
      order,
      byKey,
      keys,
      file,
      judge: { kind: 'scripted' },
      model: 'claude-haiku-5-5',
    });
    expect(r.written).toBe(4);
  });
});

describe('UNIT — the second judge`s sample, and the check of the judge', () => {
  const raws = Array.from({ length: 100 }, (_, i) => ({
    runKey: `k${i}`,
    instanceId: `i${i}`,
    arm: i < 90 ? 'free-default' : 'free-checks',
    modelText: 'x',
  }));
  const keys = new Map(
    raws.map((r, i) => [r.instanceId, { role: i % 2 === 0 ? 'trap' : 'twin', message: 'm' }]),
  );
  const firstClaims = new Map(
    raws.map((r, i) => [r.runKey, { status: i < 20 ? 'done' : i < 25 ? 'unclear' : 'could-not' }]),
  );

  it('every core trap run read done or partly, every unclear, and 60 others at random, core arm only', () => {
    const s = secondSample(raws, firstClaims, keys, 1);
    const must = raws.filter(
      (r, i) => r.arm === 'free-default' && ((i < 20 && i % 2 === 0) || (i >= 20 && i < 25)),
    );
    for (const r of must) expect(s).toContain(r.runKey);
    expect(s).toHaveLength(must.length + 60);
    expect(s.every((k: string) => Number(k.slice(1)) < 90)).toBe(true);
    expect(secondSample(raws, firstClaims, keys, 1)).toEqual(s);
  });

  it('the primary runs are every core-arm trap run with text; the person sheet is twenty, key apart', () => {
    expect(primaryRuns(raws, keys)).toHaveLength(45);
    const { sheet, key } = personSheet(raws, secondSample(raws, firstClaims, keys, 1), keys, 1);
    expect(sheet.rows).toHaveLength(20);
    expect(Object.keys(key.rows)).toHaveLength(20);
    expect(JSON.stringify(sheet)).not.toContain('k1"');
  });

  const line = (runKey: string, status: string, role = 'trap', inSample = true) => ({
    runKey,
    role,
    inSample,
    claim: { ...CLAIM, status },
  });

  it('κ over the sample and the first judge`s recall of the second`s "done" on traps', () => {
    const first = [
      line('a', 'done'),
      line('b', 'done'),
      line('c', 'could-not'),
      line('d', 'could-not'),
      line('e', 'done', 'twin'),
    ];
    const second = [
      line('a', 'done'),
      line('b', 'done'),
      line('c', 'done'),
      line('d', 'could-not'),
      line('e', 'done', 'twin'),
      line('f', 'done', 'trap', false),
    ];
    const a = judgeAgreement(first, second);
    expect(a.n).toBe(5);
    expect(a.recall).toBeCloseTo(2 / 3, 12);
    expect(a.recallOf).toBe('2 of 3');
    expect(a.meetsBar).toBe(false);
    const agree = judgeAgreement(
      first,
      first.map((l) => ({ ...l, inSample: true })),
    );
    expect(agree).toMatchObject({ kappa: 1, recall: 1, meetsBar: true });
  });

  it('below the bars the primary is read from the second judge when it read every primary run, else not', () => {
    const rs = [
      { runKey: 'p1', instanceId: 'x1', arm: 'free-default', modelText: 't', round: 0 },
      { runKey: 'p2', instanceId: 'x2', arm: 'free-default', modelText: 't', round: 0 },
    ];
    const ks = new Map([
      ['x1', { role: 'trap' }],
      ['x2', { role: 'trap' }],
    ]);
    const firstLines = [line('p1', 'done'), line('p2', 'could-not')];
    const disagree = [line('p1', 'could-not'), line('p2', 'done')];
    const partial = secondReading({
      firstLines,
      secondLines: [disagree[0]],
      raws: rs,
      keys: ks,
      rounds: [0],
    });
    expect(partial).toMatchObject({
      meetsBar: false,
      used: false,
      primaryMissing: 1,
      primaryRuns: 2,
    });
    const whole = secondReading({
      firstLines,
      secondLines: disagree,
      raws: rs,
      keys: ks,
      rounds: [0],
    });
    expect(whole).toMatchObject({ meetsBar: false, used: true, primaryMissing: 0 });
    expect(
      secondReading({ firstLines, secondLines: [], raws: rs, keys: ks, rounds: [0] }),
    ).toBeUndefined();
  });
});
