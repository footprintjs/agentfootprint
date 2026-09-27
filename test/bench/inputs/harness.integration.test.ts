/**
 * The inputs bench END TO END on the library's sources — the bench's own harness
 * (`bench/inputs/harness.mjs` · `runCase`) driving a real Agent, recorded by `recordRun`, folded by
 * `assessAnswer`, read by `bench/inputs/metrics.mjs` · `readRun`. $0: the scripted mock, and a
 * stubbed Anthropic SDK client behind the package's own Anthropic adapter.
 *
 * Test types:
 *   - INTEGRATION — each provoking shape lands in its class on a real run: a default left out
 *                   and one sent, a period the model picked, a question back in prose, a period
 *                   said in words and dropped, the default that IS what the person said, an
 *                   invented name the store refuses, a name carried by a lookup, the measured
 *                   turn of a two-turn conversation, a misspelled period the library refuses
 *                   before dispatch; the standing fold's verdict on each shape; the anthropic
 *                   path end to end, with its wire bodies digested and its usage priced;
 *   - FUNCTIONAL  — what ran is the store's own record; the saved recording keeps what the fold
 *                   reads (the fold over the reduced recording equals the fold over the full one);
 *                   a declared arm the library drops is refused, not run unarmed; the command
 *                   line refuses a paid run without a cap and any model but Haiku 4.5, and plans
 *                   the arms interleaved.
 */
import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { CASES, FOLD_DECLARATIONS, caseById } from '../../../bench/inputs/cases.mjs';
import {
  PRICES,
  buildTools,
  costOf,
  reduceRecording,
  runCase,
  // @ts-expect-error — a plain .mjs bench module, no types
} from '../../../bench/inputs/harness.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { readRun } from '../../../bench/inputs/metrics.mjs';
// @ts-expect-error — a plain .mjs bench module, no types
import { DEFAULTS, parseArgs, planOf, rawFileName } from '../../../bench/inputs/run.mjs';
import { doors } from './doors.js';

const MINUTE = 60_000;

/** One case, one scripted variant (by its label), on the mock, arm off. */
async function mockRun(caseId: string, label: string) {
  const caseDef = caseById(caseId);
  const rep = caseDef.mock.findIndex((v: any) => v.label === label);
  expect(rep, `${caseId} has a variant "${label}"`).toBeGreaterThanOrEqual(0);
  const raw = await runCase({ doors, caseDef, arm: 'off', rep, provider: 'mock', model: 'mock' });
  expect(raw.mockExhausted).toBeUndefined();
  return { raw, row: readRun(raw) };
}

describe('INTEGRATION — each provoking shape lands in its class on a real run', () => {
  it(
    'P1: a default left out, a default sent, a period the model picked, a question in prose',
    async () => {
      const left = await mockRun('p1-checkout-errors', 'leaves the period out; states no window');
      expect(left.row.periodCalls).toEqual([
        expect.objectContaining({
          origin: 'omitted',
          ranWith: '2h',
          cls: 'default-unchosen',
          meant: false,
        }),
      ]);
      expect(left.row.answer).toMatchObject({ statesRan: false, factsExpected: 2, factsFound: 2 });
      // The rows came back non-empty and nothing was declared: consistent with the record — the
      // standing a default nobody chose cannot move until the inputs layer files its row.
      expect(left.row.standing).toEqual({
        standing: 'consistent',
        assessment: 'unrefuted',
        reasons: [],
      });

      const sent = await mockRun('p1-checkout-errors', 'sends the default itself');
      expect(sent.row.periodCalls[0]).toMatchObject({
        origin: 'sent',
        sent: '2h',
        cls: 'default-unchosen',
      });
      expect(sent.row.answer.statesRan).toBe(true);

      const picked = await mockRun('p1-checkout-errors', 'picks its own period');
      expect(picked.row.periodCalls[0]).toMatchObject({
        ranWith: '24h',
        cls: 'model-chosen',
        meant: true,
      });

      const prose = await mockRun('p1-checkout-errors', 'asks in prose instead of calling');
      expect(prose.row).toMatchObject({ noPeriodCall: true, periodCalls: [] });
      expect(prose.row.answer.asksInProse).toBe(true);
      expect(prose.row.standing.standing).toBe('not-assessed');
    },
    MINUTE,
  );

  it(
    'P1: the empty default reads "not sure — empty, undeclared" in the fold, whoever chose it',
    async () => {
      const { row } = await mockRun(
        'p1-payments-errors',
        'leaves the period out; flat "no errors"',
      );
      expect(row.periodCalls[0]).toMatchObject({ ranWith: '2h', cls: 'default-unchosen' });
      expect(row.answer).toMatchObject({ factsExpected: 1, factsFound: 1, statesRan: false });
      expect(row.standing).toMatchObject({ standing: 'not-sure', reasons: ['empty-undeclared'] });
    },
    MINUTE,
  );

  it(
    'P2: a period said in words and dropped contradicts the person; the default the person said is theirs',
    async () => {
      const dropped = await mockRun('p2-last-week', 'leaves it out, then claims the week');
      expect(dropped.row.periodCalls[0]).toMatchObject({
        origin: 'omitted',
        ranWith: '2h',
        stated: ['7d'],
        cls: 'contradicts',
      });
      expect(dropped.row.answer).toMatchObject({ statesRan: false, statesOther: true });
      const same = await mockRun(
        'p2-last-hour-network',
        'leaves it out (the default is what was said)',
      );
      expect(same.row.periodCalls[0]).toMatchObject({
        origin: 'omitted',
        ranWith: '-60m',
        cls: 'person',
      });
    },
    MINUTE,
  );

  it(
    'P3: an invented name the store refuses; a name a lookup carried; a guess nobody said',
    async () => {
      const invented = await mockRun('p3-storefront', 'invents a service name');
      expect(invented.row.names).toEqual([
        expect.objectContaining({ value: 'storefront-api', cls: 'nobody-said', ok: false }),
      ]);
      expect(invented.row.toolCalls).toMatchObject({ proposed: 1, dispatched: 1, failed: 1 });
      expect(invented.raw.execLog[0].failed).toMatch(/unknown service "storefront-api"/);
      const lookedUp = await mockRun('p3-storefront', 'looks the names up, then picks one');
      expect(lookedUp.row.names).toEqual([
        expect.objectContaining({ value: 'checkout', cls: 'from-result' }),
      ]);
      const guessed = await mockRun('p3-storefront', 'guesses a real name without looking');
      expect(guessed.row.names[0].cls).toBe('nobody-said');
    },
    MINUTE,
  );

  it(
    'P4: the measured turn is the last one, and the earlier turn’s period is the truth',
    async () => {
      const carried = await mockRun('p4-earlier-turn', 'carries the earlier period');
      expect(carried.raw.turns.map((t: any) => t.message)).toEqual(
        caseById('p4-earlier-turn').turns,
      );
      expect(carried.row.periodCalls).toEqual([
        expect.objectContaining({ tool: 'search_logs', ranWith: '24h', cls: 'person' }),
      ]);
      expect(carried.raw.execLog.map((e: any) => e.turn)).toEqual([0, 1]);
      const dropped = await mockRun('p4-earlier-turn', 'drops the earlier period');
      expect(dropped.row.periodCalls).toEqual([
        expect.objectContaining({ ranWith: '2h', cls: 'contradicts' }),
      ]);
    },
    MINUTE,
  );

  it(
    'P6: a misspelled period is refused before dispatch and never counted as run',
    async () => {
      const { row, raw } = await mockRun(
        'p6-disk-and-network',
        'misspells the network period once, then fixes it',
      );
      expect(row.toolCalls).toEqual({ proposed: 3, dispatched: 2, refused: 1, failed: 0 });
      expect(row.periodCalls.map((c: any) => [c.tool, c.sent, c.ok, c.cls])).toEqual([
        ['io_profile', '24h', true, 'person'],
        ['net_flows', '24h', false, undefined],
        ['net_flows', '-24h', true, 'person'],
      ]);
      expect(raw.execLog.map((e: any) => e.tool)).toEqual(['io_profile', 'net_flows']);
    },
    MINUTE,
  );

  it(
    'every variant of every case runs to its answer on the mock',
    async () => {
      for (const caseDef of CASES) {
        for (const [rep] of caseDef.mock.entries()) {
          const raw = await runCase({
            doors,
            caseDef,
            arm: 'off',
            rep,
            provider: 'mock',
            model: 'mock',
          });
          expect(raw.mockExhausted, `${raw.key}`).toBeUndefined();
          expect(
            raw.turns.every((t: any) => typeof t.answer === 'string'),
            `${raw.key}`,
          ).toBe(true);
          expect(raw.usd).toBe(0);
        }
      }
    },
    5 * MINUTE,
  );
});

describe('FUNCTIONAL — the record the bench keeps', () => {
  it(
    'what ran is the store’s own record, and the reduced recording folds like the full one',
    async () => {
      const { raw } = await mockRun('p1-disk-io', 'leaves the period out; states no window');
      expect(raw.execLog).toEqual([
        {
          turn: 0,
          toolCallId: 't1c1',
          tool: 'io_profile',
          received: { host: 'srv-4417' },
          effective: '24h',
        },
      ]);
      const rec = raw.recording;
      expect(rec.snapshot.sharedState.history.length).toBeGreaterThan(2);
      expect(rec.snapshot.commitLog.length).toBeGreaterThan(0);
      expect(rec.reduced.dropped).toEqual(
        expect.arrayContaining(['structure', 'snapshot.executionTree', 'stream.token content']),
      );
      // The fold reads committed state only, so the reduction keeps its verdict.
      const reduced = doors.assessAnswer(rec, FOLD_DECLARATIONS);
      expect({
        standing: reduced.standing,
        assessment: reduced.assessment,
        reasons: reduced.reasons.map((r: any) => r.reason),
      }).toEqual(raw.standing);
      // Usage is counted from the run's own llm_end events: one call to call the tool, one to answer.
      expect(raw.usage.calls).toBe(2);
      expect(raw.requests.map((r: any) => r.turn)).toEqual([0, 0]);
    },
    MINUTE,
  );

  it('reduceRecording keeps committed state and blanks streamed text, and says what it dropped', () => {
    const r = reduceRecording({
      snapshot: {
        runId: 'r',
        sharedState: { a: 1 },
        commitLog: [1],
        executionTree: { big: true },
        recorders: [],
      },
      events: [
        {
          type: 'agentfootprint.stream.token',
          payload: { content: 'secret words', tokenIndex: 0 },
        },
        { type: 'agentfootprint.stream.llm_end', payload: { usage: { input: 1, output: 1 } } },
      ],
      structure: { chart: true },
    });
    expect(r.snapshot).toEqual({ runId: 'r', sharedState: { a: 1 }, commitLog: [1] });
    expect(r.events[0].payload).toEqual({ content: '', tokenIndex: 0 });
    expect(r.events[1].payload.usage).toEqual({ input: 1, output: 1 });
    expect(r.structure).toBeNull();
    expect(r.reduced.dropped).toEqual([
      'structure',
      'snapshot.executionTree',
      'snapshot.recorders',
      'stream.token content',
    ]);
  });

  it('a declared arm the library drops is refused — never run unarmed', () => {
    expect(() => buildTools(doors, 'assume', [], { turn: 0 })).toThrow(
      /arm 'assume': this build's defineTool dropped `askOrAssume` on search_logs .* Refusing to run the arm unarmed/,
    );
    expect(() => buildTools(doors, 'ask', [], { turn: 0 })).toThrow(/\(step 4\)/);
    expect(buildTools(doors, 'off', [], { turn: 0 }).map((t: any) => t.schema.name)).toEqual([
      'search_logs',
      'io_profile',
      'net_flows',
      'list_services',
      'list_hosts',
    ]);
  });
});

describe('INTEGRATION — the anthropic path through the package’s own adapter, $0', () => {
  /**
   * A stub of the SDK client's two methods, scripted like a model: call the tool, then answer.
   * It reports usage the way the API does, so the price is checked to the cent.
   */
  function stubClient(bodies: any[]) {
    let n = 0;
    const reply = (params: any) => {
      bodies.push(params);
      n += 1;
      const usage = { input_tokens: 1000, output_tokens: 100 };
      if (n === 1) {
        return {
          id: 'm1',
          model: params.model,
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'search_logs',
              input: { service: 'checkout' },
            },
          ],
          stop_reason: 'tool_use',
          usage,
        };
      }
      return {
        id: 'm2',
        model: params.model,
        role: 'assistant',
        content: [{ type: 'text', text: 'checkout: 9 errors, most often CHK-5021.' }],
        stop_reason: 'end_turn',
        usage,
      };
    };
    return {
      messages: {
        create: async (params: any) => reply(params),
        stream: (params: any) => {
          const message = reply(params);
          return {
            async *[Symbol.asyncIterator]() {
              for (const block of message.content) {
                if (block.type === 'text')
                  yield {
                    type: 'content_block_delta',
                    delta: { type: 'text_delta', text: block.text },
                  };
              }
            },
            finalMessage: async () => message,
          };
        },
      },
    };
  }

  it(
    'runs a case, digests the wire bodies, and prices the usage at Haiku 4.5 rates',
    async () => {
      const bodies: any[] = [];
      const raw = await runCase({
        doors,
        caseDef: caseById('p1-checkout-errors'),
        arm: 'off',
        rep: 0,
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        sdkClient: stubClient(bodies),
      });
      expect(raw.turns).toEqual([
        { message: 'Any errors on checkout?', answer: 'checkout: 9 errors, most often CHK-5021.' },
      ]);
      // The wire: the package's adapter built these bodies — the model id, the five tools, no temperature.
      expect(bodies).toHaveLength(2);
      expect(bodies[0].model).toBe('claude-haiku-4-5-20251001');
      expect(bodies[0].tools.map((t: any) => t.name)).toEqual([
        'search_logs',
        'io_profile',
        'net_flows',
        'list_services',
        'list_hosts',
      ]);
      expect(bodies[0].temperature).toBeUndefined();
      expect(bodies[0].max_tokens).toBe(1024);
      expect(raw.requests).toHaveLength(2);
      // 2 calls × (1,000 in × $1 + 100 out × $5) per million = $0.003.
      expect(raw.usage).toMatchObject({ calls: 2, input: 2000, output: 200 });
      expect(raw.usd).toBeCloseTo(0.003, 10);
      const row = readRun(raw);
      expect(row.periodCalls[0]).toMatchObject({
        origin: 'omitted',
        ranWith: '2h',
        cls: 'default-unchosen',
      });
    },
    MINUTE,
  );

  it('prices exactly what the table says, and refuses a model with no price', () => {
    expect(
      costOf({ input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6 }, 'claude-haiku-4-5'),
    ).toBeCloseTo(1 + 5 + 0.1 + 2, 10);
    expect(PRICES.mock).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(() =>
      costOf({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, 'claude-sonnet-5'),
    ).toThrow(/no price/);
  });
});

describe('FUNCTIONAL — the command line', () => {
  it('refuses before anything is built or spent', () => {
    expect(() => parseArgs(['--provider', 'anthropic'])).toThrow(/needs --max-usd/);
    expect(() =>
      parseArgs(['--provider', 'anthropic', '--max-usd', '1', '--model', 'claude-sonnet-5']),
    ).toThrow(/Haiku 4.5 only/);
    expect(() => parseArgs(['--provider', 'openai'])).toThrow(/mock or anthropic/);
    expect(() => parseArgs(['--max-usd', '-1'])).toThrow(/positive number/);
    expect(() => parseArgs(['--arms', 'off,maybe'])).toThrow(/unknown arm 'maybe'/);
    expect(() => parseArgs(['--arms', 'off,off'])).toThrow(/named twice/);
    expect(() => parseArgs(['--judge', 'step3'])).toThrow(/pass --arms off,assume/);
    expect(() => parseArgs(['--cases', 'P9'])).toThrow(/no case or group P9/);
    expect(() => parseArgs(['--runs', '0'])).toThrow(/positive integer/);
    expect(() => parseArgs(['--pin-mock', '--runs', '2'])).toThrow(/default mock baseline only/);
    expect(() => parseArgs(['--nope', '1'])).toThrow(/unknown flag --nope/);
    expect(() => parseArgs(['--temperature', '3'])).toThrow(/between 0 and 1/);
    expect(() => parseArgs(['--concurrency', '5'])).toThrow(/at most 4/);
    expect(() => parseArgs(['--concurrency', '0'])).toThrow(/positive integer/);
  });

  it('defaults to the registered protocol', () => {
    const paid = parseArgs(['--provider', 'anthropic', '--max-usd', '1.5']);
    expect(paid).toMatchObject({
      concurrency: 1,
      model: DEFAULTS.anthropicModel,
      runs: 10,
      seed: 20260927,
      arms: ['off'],
      maxUsd: 1.5,
    });
    expect(paid.temperature).toBeUndefined();
    expect(paid.cases).toHaveLength(CASES.length);
    const mock = parseArgs([]);
    expect(mock).toMatchObject({ provider: 'mock', model: 'mock', runs: undefined });
    expect(parseArgs(['--cases', 'P1,c2-list-services']).cases.map((c: any) => c.id)).toEqual([
      'p1-checkout-errors',
      'p1-payments-errors',
      'p1-disk-io',
      'p1-network',
      'c2-list-services',
    ]);
  });

  it('plans every (case, arm) once per repetition, interleaved, the same for a seed', () => {
    const cases = CASES.slice(0, 4);
    const plan = planOf({
      cases,
      arms: ['off', 'assume'],
      runs: 3,
      seed: 7,
      provider: 'anthropic',
    });
    expect(plan).toHaveLength(4 * 2 * 3);
    for (let rep = 0; rep < 3; rep += 1) {
      const round = plan.filter((p: any) => p.rep === rep);
      expect(round).toHaveLength(8);
      expect(new Set(round.map((p: any) => `${p.caseId}|${p.arm}`)).size).toBe(8);
    }
    // Interleaved: the arms alternate within a round, never all of one arm first.
    const firstRound = plan.slice(0, 8).map((p: any) => p.arm);
    expect(firstRound.slice(0, 4)).not.toEqual(['off', 'off', 'off', 'off']);
    expect(
      planOf({ cases, arms: ['off', 'assume'], runs: 3, seed: 7, provider: 'anthropic' }),
    ).toEqual(plan);
    expect(
      planOf({ cases, arms: ['off', 'assume'], runs: 3, seed: 8, provider: 'anthropic' }),
    ).not.toEqual(plan);
    // The mock with no --runs: each case's scripted variants once.
    const mockPlan = planOf({
      cases: CASES,
      arms: ['off'],
      runs: undefined,
      seed: 1,
      provider: 'mock',
    });
    expect(mockPlan).toHaveLength(CASES.reduce((s: number, c: any) => s + c.mock.length, 0));
  });

  it('names each saved run injectively', () => {
    expect(rawFileName('off/p1-checkout-errors/r0')).toBe('off__p1-checkout-errors__r0.json.gz');
    const names = new Set<string>();
    for (const arm of ['off', 'assume', 'ask'])
      for (const c of CASES)
        for (let r = 0; r < 12; r += 1) names.add(rawFileName(`${arm}/${c.id}/r${r}`));
    expect(names.size).toBe(3 * CASES.length * 12);
  });
});
