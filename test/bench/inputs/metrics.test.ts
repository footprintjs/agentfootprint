/**
 * The inputs bench's READER (`bench/inputs/metrics.mjs`) — every number the bench prints.
 *
 * Test types:
 *   - UNIT     — the tokenizer, the period phrases, `isMissing` (the design's rule), the four
 *                classes; `readRun` over hand-built records: a default left out and one sent, a
 *                call the library refused and one the store failed, names said / carried by an
 *                earlier result / said by nobody, the measured turn of a two-turn case, facts
 *                and periods in the answer, the argument rows steps 3–4 will file (the current
 *                row, and an ask superseded by its answer); `summarize` never reports a rate over
 *                nothing; Wilson's interval;
 *   - PROPERTY — 2,000 generated runs: every call that ran has exactly one class; the classes
 *                partition the calls; `default-unchosen` holds exactly when nobody stated a
 *                period and the default ran; the answer's words never move a class; the reader is
 *                deterministic and never mutates its input.
 */
import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { CASES, TOOLS, caseById, toolSpec } from '../../../bench/inputs/cases.mjs';
import {
  aggregate,
  classifyPeriod,
  containsTokens,
  isMissing,
  leadingJson,
  readRun,
  statedDurations,
  summarize,
  tokens,
  wilson,
  // @ts-expect-error — a plain .mjs bench module, no types
} from '../../../bench/inputs/metrics.mjs';

type Call = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** ok = the store answered; refused = the library never dispatched it; failed = the store threw. */
  run?: 'ok' | 'refused' | 'failed';
};

/**
 * A raw run as `harness.mjs` · `runCase` leaves it, built from the REAL stores: each `ok` call's
 * result and effective period come from the tool's own `run`.
 */
function rawRun(
  caseId: string,
  turns: Array<{ calls: Call[][]; answer?: string }>,
  extra: { ledger?: unknown[]; standing?: unknown } = {},
) {
  const caseDef = caseById(caseId);
  const history: any[] = [];
  const execLog: any[] = [];
  turns.forEach((turn, t) => {
    history.push({ role: 'user', content: caseDef.turns[t] });
    for (const batch of turn.calls) {
      history.push({
        role: 'assistant',
        content: '',
        toolCalls: batch.map(({ id, name, args }) => ({ id, name, args })),
      });
      for (const c of batch) {
        const how = c.run ?? 'ok';
        if (how === 'refused') {
          history.push({
            role: 'tool',
            toolCallId: c.id,
            toolName: c.name,
            content: 'Invalid arguments — the call was not executed.',
          });
          continue;
        }
        try {
          const { effective, result } = toolSpec(c.name).run(c.args);
          if (how === 'failed') throw new Error('store down');
          execLog.push({
            turn: t,
            toolCallId: c.id,
            tool: c.name,
            received: { ...c.args },
            ...(effective !== undefined && { effective }),
          });
          history.push({
            role: 'tool',
            toolCallId: c.id,
            toolName: c.name,
            content: JSON.stringify(result),
          });
        } catch (err: any) {
          execLog.push({
            turn: t,
            toolCallId: c.id,
            tool: c.name,
            received: { ...c.args },
            failed: err.message,
          });
          history.push({
            role: 'tool',
            toolCallId: c.id,
            toolName: c.name,
            content: String(err.message),
          });
        }
      }
    }
    if (turn.answer !== undefined) history.push({ role: 'assistant', content: turn.answer });
  });
  return {
    key: `off/${caseId}/r0`,
    arm: 'off',
    caseId,
    rep: 0,
    provider: 'mock',
    model: 'mock',
    turns: turns.map((t, i) => ({
      message: caseDef.turns[i],
      ...(t.answer !== undefined && { answer: t.answer }),
    })),
    execLog,
    requests: [{ turn: 0, digest: 'abc' }],
    usage: { calls: 2, input: 100, output: 20, cacheRead: 0, cacheWrite: 0 },
    usd: 0,
    standing: extra.standing ?? { standing: 'consistent', assessment: 'unrefuted', reasons: [] },
    recording: {
      snapshot: {
        sharedState: {
          history,
          ...(extra.ledger !== undefined && { findingsLedger: extra.ledger }),
        },
      },
      events: [],
    },
  };
}

describe('UNIT — tokens, phrases and the missing rule', () => {
  it('tokenizes codes, thousands, decimals, signed periods and compact JSON alike', () => {
    expect(tokens('CHK-5021')).toEqual(['chk', '5021']);
    expect(tokens('peak 5,310 IOPS; p95 6.3ms.')).toEqual([
      'peak',
      '5310',
      'iops',
      'p95',
      '6.3',
      'ms',
    ]);
    expect(tokens('-24h')).toEqual(['24h']);
    expect(tokens('{"total":9,"ok":true}')).toEqual(['total', '9', 'ok', 'true']);
    expect(tokens(undefined)).toEqual([]);
  });

  it('matches whole tokens in order, never a substring', () => {
    expect(containsTokens(tokens('srv-4417 is fine'), tokens('srv-4417'))).toBe(true);
    expect(containsTokens(tokens('4417'), tokens('41'))).toBe(false);
    expect(containsTokens(tokens('last 24 hours'), tokens('24 hours'))).toBe(true);
    expect(containsTokens(tokens('24 of the hours'), tokens('24 hours'))).toBe(false);
    expect(containsTokens(tokens('a'), [])).toBe(false);
  });

  it('reads the periods an answer states — and only declared phrases', () => {
    expect(statedDurations('No errors over the last 2 hours.')).toEqual(['h2']);
    expect(statedDurations('In the past day: 41 errors.')).toEqual(['d1']);
    expect(statedDurations('last 24h')).toEqual(['d1']);
    expect(statedDurations('window -60m')).toEqual(['h1']);
    expect(statedDurations('the last week, and the last hour')).toEqual(['h1', 'd7']);
    expect(statedDurations('12 hours ago; 17 days')).toEqual([]);
    expect(statedDurations('this hour, today, yesterday, this week')).toEqual([]);
  });

  it('isMissing is the design’s rule: no key, undefined, null, or a blank string', () => {
    expect(isMissing({}, 'w')).toBe(true);
    expect(isMissing({ w: undefined }, 'w')).toBe(true);
    expect(isMissing({ w: null }, 'w')).toBe(true);
    expect(isMissing({ w: '' }, 'w')).toBe(true);
    expect(isMissing({ w: '   ' }, 'w')).toBe(true);
    expect(isMissing({ w: '2h' }, 'w')).toBe(false);
    expect(isMissing({ w: 0 }, 'w')).toBe(false);
    expect(isMissing({ w: false }, 'w')).toBe(false);
    expect(isMissing(Object.create({ w: '2h' }), 'w')).toBe(true);
    expect(isMissing(undefined, 'w')).toBe(true);
  });

  it('classifies by whose value ran, against the truth the sheet declared', () => {
    expect(classifyPeriod({ ranWith: '7d', stated: ['7d'], defaultValue: '2h' })).toBe('person');
    expect(classifyPeriod({ ranWith: '2h', stated: ['7d'], defaultValue: '2h' })).toBe(
      'contradicts',
    );
    expect(classifyPeriod({ ranWith: '2h', stated: undefined, defaultValue: '2h' })).toBe(
      'default-unchosen',
    );
    expect(classifyPeriod({ ranWith: '24h', stated: undefined, defaultValue: '2h' })).toBe(
      'model-chosen',
    );
    // When the person's words ARE the default, a call that left the period out is still the person's.
    expect(classifyPeriod({ ranWith: '-60m', stated: ['-60m'], defaultValue: '-60m' })).toBe(
      'person',
    );
  });
});

describe('UNIT — a tool message is data only when it starts with JSON', () => {
  it('cuts the leading value at its own closing bracket, strings and escapes respected', () => {
    expect(leadingJson('{"a":1}')).toEqual({ a: 1 });
    expect(leadingJson('  [1,2]\nNote: this call repeats an earlier one.')).toEqual([1, 2]);
    expect(leadingJson('{"a":"}]"} and a note {x}')).toEqual({ a: '}]' });
    expect(leadingJson('{"a":"say \\"}\\""}')).toEqual({ a: 'say "}"' });
    expect(leadingJson('unknown service "x": list_services returns the names')).toBeUndefined();
    expect(leadingJson('{"a":')).toBeUndefined();
    expect(leadingJson(undefined)).toBeUndefined();
  });
});

describe('UNIT — readRun', () => {
  it('a default left out and a default sent are both "nobody chose", told apart by origin', () => {
    const left = readRun(
      rawRun('p1-checkout-errors', [
        {
          calls: [[{ id: 'a', name: 'search_logs', args: { service: 'checkout' } }]],
          answer: 'checkout: 9 errors, mostly CHK-5021.',
        },
      ]),
    );
    expect(left.periodCalls).toEqual([
      {
        toolCallId: 'a',
        tool: 'search_logs',
        argument: 'window',
        origin: 'omitted',
        dispatched: true,
        ok: true,
        ranWith: '2h',
        cls: 'default-unchosen',
        meant: false,
      },
    ]);
    expect(left.answer).toMatchObject({
      ranDurations: ['h2'],
      statedDurations: [],
      statesRan: false,
      factsExpected: 2,
      factsFound: 2,
    });
    const sent = readRun(
      rawRun('p1-checkout-errors', [
        {
          calls: [[{ id: 'a', name: 'search_logs', args: { service: 'checkout', window: '2h' } }]],
          answer: '9 errors in the last 2 hours.',
        },
      ]),
    );
    expect(sent.periodCalls[0]).toMatchObject({
      origin: 'sent',
      sent: '2h',
      cls: 'default-unchosen',
    });
    expect(sent.answer).toMatchObject({ statesRan: true, statesOther: false, factsFound: 1 });
  });

  it('a call the library refused never ran; a call the store failed ran but returned nothing', () => {
    const row = readRun(
      rawRun('p6-disk-and-network', [
        {
          calls: [
            [
              { id: 'a', name: 'io_profile', args: { host: 'srv-4417', time_range: '24h' } },
              {
                id: 'b',
                name: 'net_flows',
                args: { host: 'srv-4417', window: '24h' },
                run: 'refused',
              },
            ],
            [{ id: 'c', name: 'net_flows', args: { host: 'srv-4417', window: '-24h' } }],
          ],
          answer: 'Disk: p95 read 6.3 ms, peak 5310 IOPS; 29066 flows over the last 24 hours.',
        },
      ]),
    );
    expect(row.toolCalls).toEqual({ proposed: 3, dispatched: 2, refused: 1, failed: 0 });
    expect(row.periodCalls.map((c: any) => [c.toolCallId, c.ok, c.cls])).toEqual([
      ['a', true, 'person'],
      ['b', false, undefined],
      ['c', true, 'person'],
    ]);
    expect(row.answer).toMatchObject({ factsExpected: 3, factsFound: 3, statesRan: true });

    const failed = readRun(
      rawRun('p3-database-host', [
        {
          calls: [[{ id: 'a', name: 'io_profile', args: { host: 'db-01' } }]],
          answer: 'No host db-01.',
        },
      ]),
    );
    expect(failed.toolCalls).toEqual({ proposed: 1, dispatched: 1, refused: 0, failed: 1 });
    expect(failed.periodCalls[0]).toMatchObject({ dispatched: true, ok: false });
    expect(failed.periodCalls[0].cls).toBeUndefined();
    expect(failed.noPeriodCall).toBe(true);
  });

  it('a name is the person’s, a result’s (only one that came BEFORE the call), or nobody’s', () => {
    const lookedUp = readRun(
      rawRun('p3-storefront', [
        {
          calls: [
            [{ id: 'a', name: 'list_services', args: {} }],
            [{ id: 'b', name: 'search_logs', args: { service: 'checkout' } }],
          ],
          answer: 'checkout: 9 errors.',
        },
      ]),
    );
    expect(lookedUp.names).toEqual([
      {
        toolCallId: 'b',
        tool: 'search_logs',
        argument: 'service',
        value: 'checkout',
        cls: 'from-result',
        dispatched: true,
        ok: true,
      },
    ]);
    // The same name guessed in the SAME batch as the lookup: no result carried it yet.
    const guessed = readRun(
      rawRun('p3-storefront', [
        {
          calls: [
            [
              { id: 'a', name: 'list_services', args: {} },
              { id: 'b', name: 'search_logs', args: { service: 'checkout' } },
            ],
          ],
          answer: 'checkout: 9 errors.',
        },
      ]),
    );
    expect(guessed.names[0].cls).toBe('nobody-said');
    const invented = readRun(
      rawRun('p3-storefront', [
        {
          calls: [[{ id: 'a', name: 'search_logs', args: { service: 'storefront-api' } }]],
          answer: 'Nothing.',
        },
      ]),
    );
    expect(invented.names[0]).toMatchObject({
      value: 'storefront-api',
      cls: 'nobody-said',
      ok: false,
    });
    const said = readRun(
      rawRun('p1-disk-io', [
        { calls: [[{ id: 'a', name: 'io_profile', args: { host: 'srv-4417' } }]], answer: 'x' },
      ]),
    );
    expect(said.names[0].cls).toBe('said');
  });

  it('a bad name echoed back by the store’s error is still nobody’s when the model retries it', () => {
    const row = readRun(
      rawRun('p3-storefront', [
        {
          calls: [
            [{ id: 'a', name: 'search_logs', args: { service: 'storefront-api' } }],
            [{ id: 'b', name: 'search_logs', args: { service: 'storefront-api' } }],
          ],
          answer: 'No such service.',
        },
      ]),
    );
    expect(row.names.map((n: any) => [n.toolCallId, n.cls])).toEqual([
      ['a', 'nobody-said'],
      ['b', 'nobody-said'],
    ]);
  });

  it('facts are read from a result even when the library appended a note after it', () => {
    const raw = rawRun('c1-exact-24h', [
      {
        calls: [[{ id: 'a', name: 'search_logs', args: { service: 'checkout', window: '24h' } }]],
        answer: '41 errors, mostly CHK-4410.',
      },
    ]);
    const tool = raw.recording.snapshot.sharedState.history.find((m: any) => m.role === 'tool');
    tool.content += '\n[note] This call repeats an earlier one.';
    expect(readRun(raw).answer).toMatchObject({ factsExpected: 2, factsFound: 2 });
  });

  it('a two-turn case measures the last turn; the earlier turn’s words still count as said', () => {
    const row = readRun(
      rawRun('p4-earlier-turn', [
        {
          calls: [[{ id: 'a', name: 'search_logs', args: { service: 'checkout', window: '24h' } }]],
          answer: '41 errors in the past day.',
        },
        {
          calls: [[{ id: 'b', name: 'search_logs', args: { service: 'payments' } }]],
          answer: 'payments: no errors.',
        },
      ]),
    );
    expect(row.periodCalls.map((c: any) => c.toolCallId)).toEqual(['b']);
    expect(row.periodCalls[0]).toMatchObject({
      origin: 'omitted',
      ranWith: '2h',
      stated: ['24h'],
      cls: 'contradicts',
    });
    expect(row.answer).toMatchObject({ factsExpected: 1, factsFound: 1, statesRan: false });
    expect(row.names[0]).toMatchObject({ value: 'payments', cls: 'said' });
  });

  it('an answer that states another period than the one that ran is "other", not "ran"', () => {
    const row = readRun(
      rawRun('p2-last-week', [
        {
          calls: [[{ id: 'a', name: 'search_logs', args: { service: 'checkout' } }]],
          answer: 'Over the last week: 9 errors.',
        },
      ]),
    );
    expect(row.periodCalls[0].cls).toBe('contradicts');
    expect(row.answer).toMatchObject({
      ranDurations: ['h2'],
      statedDurations: ['d7'],
      statesRan: false,
      statesOther: true,
    });
  });

  it('no period call: a question back in prose, and a run that never answered', () => {
    const asked = readRun(
      rawRun('p1-checkout-errors', [{ calls: [], answer: 'Which period should I search?' }]),
    );
    expect(asked).toMatchObject({ noPeriodCall: true, complete: true });
    expect(asked.answer.asksInProse).toBe(true);
    const unanswered = readRun(rawRun('p1-checkout-errors', [{ calls: [] }]));
    expect(unanswered.complete).toBe(false);
    expect(unanswered.answer.present).toBe(false);
    const control = readRun(
      rawRun('c2-list-services', [
        { calls: [[{ id: 'a', name: 'list_services', args: {} }]], answer: 'Four.' },
      ]),
    );
    expect(control).toMatchObject({ periodExpected: false, noPeriodCall: false, periodCalls: [] });
  });

  it('reads the argument rows steps 3–4 file: the current row, and an ask its answer superseded', () => {
    const ledger = [
      { kind: 'basis', toolCallId: 'a' },
      {
        kind: 'argument',
        toolCallId: 'a',
        argument: 'window',
        asked: 'missing',
        turn: 1,
        toolName: 'search_logs',
        iteration: 1,
      },
      {
        kind: 'argument',
        toolCallId: 'a',
        argument: 'window',
        source: 'answered',
        value: '24h',
        turn: 1,
        toolName: 'search_logs',
        iteration: 1,
      },
      {
        kind: 'argument',
        toolCallId: 'b',
        argument: 'window',
        source: 'default',
        proposed: '2h',
        turn: 1,
        toolName: 'search_logs',
        iteration: 1,
      },
    ];
    const row = readRun(
      rawRun(
        'p1-checkout-errors',
        [
          {
            calls: [
              [
                { id: 'a', name: 'search_logs', args: { service: 'checkout', window: '24h' } },
                { id: 'b', name: 'search_logs', args: { service: 'payments', window: '2h' } },
              ],
            ],
            answer: 'x',
          },
        ],
        { ledger },
      ),
    );
    expect(row.periodCalls[0]).toMatchObject({
      row: { source: 'answered' },
      askedFor: true,
      meant: true,
    });
    expect(row.periodCalls[1]).toMatchObject({ row: { source: 'default', proposed: true } });
    expect(row.periodCalls[1].askedFor).toBeUndefined();
    expect(row.argumentRows).toEqual({
      total: 3,
      bySource: { answered: 1, default: 1 },
      byAsked: { missing: 1 },
    });
  });

  it('carries no clock and no run id, so the mock’s rows can be pinned', () => {
    const raw = rawRun('c1-exact-24h', [
      {
        calls: [[{ id: 'a', name: 'search_logs', args: { service: 'checkout', window: '24h' } }]],
        answer: 'x',
      },
    ]);
    const row = readRun({ ...raw, durationMs: 1234, runId: 'r-1' });
    expect(JSON.stringify(row)).not.toMatch(/1234|r-1|durationMs/);
    expect(() => readRun({ ...raw, caseId: 'nope' })).toThrow(/unknown case nope/);
  });
});

describe('UNIT — summaries', () => {
  it('never reports a rate over nothing', () => {
    const s = summarize([]);
    expect(s.runs).toBe(0);
    expect(s.rates).toEqual({
      defaultUnchosen: undefined,
      notThePersons: undefined,
      person: undefined,
    });
    expect(s.facts.mean).toBeUndefined();
    expect(s.llm.callsPerRun).toBeUndefined();
  });

  it('counts runs, calls, classes and the standing per set and per case', () => {
    const rows = [
      readRun(
        rawRun('p1-checkout-errors', [
          {
            calls: [[{ id: 'a', name: 'search_logs', args: { service: 'checkout' } }]],
            answer: '9 errors, CHK-5021',
          },
        ]),
      ),
      readRun(
        rawRun(
          'c1-exact-24h',
          [
            {
              calls: [
                [{ id: 'a', name: 'search_logs', args: { service: 'checkout', window: '24h' } }],
              ],
              answer: '41 in the last 24 hours',
            },
          ],
          { standing: { standing: 'not-sure', reasons: ['argument-assumed'] } },
        ),
      ),
    ];
    const a = aggregate(rows);
    expect(Object.keys(a)).toEqual(['off']);
    expect(a.off.sets.unstated).toMatchObject({
      runs: 1,
      periodCalls: 1,
      classes: { 'default-unchosen': 1 },
      rates: { defaultUnchosen: 1 },
    });
    expect(a.off.sets.stated).toMatchObject({
      runs: 1,
      classes: { person: 1 },
      window: { of: 1, statesRan: 1 },
      argumentReasonRuns: 1,
    });
    expect(a.off.sets.controls.runs).toBe(1);
    expect(a.off.sets.all).toMatchObject({
      runs: 2,
      standing: { consistent: 1, 'not-sure': 1 },
      reasons: { 'argument-assumed': 1 },
    });
    expect(Object.keys(a.off.cases)).toEqual(['p1-checkout-errors', 'c1-exact-24h']);
  });

  it('Wilson’s interval brackets the rate and stays inside [0, 1]', () => {
    expect(wilson(0, 0)).toEqual([0, 1]);
    const [lo, hi] = wilson(7, 10);
    expect(lo).toBeCloseTo(0.3968, 3);
    expect(hi).toBeCloseTo(0.8922, 3);
    expect(wilson(0, 10)[0]).toBe(0);
    expect(wilson(10, 10)[1]).toBe(1);
  });
});

describe('PROPERTY — 2,000 generated runs', () => {
  function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const next = rng(2_027_09_27);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
  const periodTools = TOOLS.filter((t: any) => t.period !== undefined);
  const nameValues: Record<string, string[]> = {
    service: ['checkout', 'payments', 'search', 'inventory', 'storefront-api', 'billing'],
    host: ['srv-4417', 'srv-2280', 'srv-9051', 'db-01'],
  };
  const words = [
    'over the last 2 hours',
    'in the past day',
    'last week',
    '9 errors',
    'CHK-5021',
    'fine',
    'the last hour',
    '6 hours',
  ];

  function generated(i: number) {
    const caseDef = pick(CASES) as any;
    const turns = caseDef.turns.map((_: string, t: number) => {
      const batches: Call[][] = [];
      const nBatches = Math.floor(next() * 3);
      for (let b = 0; b < nBatches; b += 1) {
        const batch: Call[] = [];
        const n = 1 + Math.floor(next() * 2);
        for (let k = 0; k < n; k += 1) {
          const useList = next() < 0.2;
          if (useList) {
            batch.push({
              id: `c${i}-${t}-${b}-${k}`,
              name: pick(['list_services', 'list_hosts']),
              args: {},
            });
            continue;
          }
          const spec = pick(periodTools) as any;
          const nameArg = spec.names[0];
          const args: Record<string, unknown> = { [nameArg]: pick(nameValues[nameArg]) };
          const enumValues = spec.inputSchema.properties[spec.period.argument].enum;
          const r = next();
          let run: Call['run'] = 'ok';
          if (r < 0.3) {
            /* left out */
          } else if (r < 0.45) args[spec.period.argument] = spec.period.default;
          else if (r < 0.85) args[spec.period.argument] = pick(enumValues);
          else {
            args[spec.period.argument] = 'bogus';
            run = 'refused';
          }
          if (run === 'ok' && next() < 0.05) run = 'failed';
          batch.push({ id: `c${i}-${t}-${b}-${k}`, name: spec.name, args, run });
        }
        batches.push(batch);
      }
      return { calls: batches, answer: next() < 0.9 ? `${pick(words)} ${pick(words)}` : undefined };
    });
    // A run that did not answer a turn stops there.
    const cut = turns.findIndex((t: any) => t.answer === undefined);
    return rawRun(caseDef.id, cut < 0 ? turns : turns.slice(0, cut + 1));
  }

  it('the classes partition the calls that ran, each by the rule, and prose never moves one', () => {
    let calls = 0;
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const raw = generated(i);
      const before = JSON.stringify(raw);
      const row = readRun(raw);
      // Pure: the input is untouched, and the same input gives the same row.
      expect(JSON.stringify(raw)).toBe(before);
      expect(JSON.stringify(readRun(raw))).toBe(JSON.stringify(row));
      const caseDef = caseById(raw.caseId);
      for (const c of row.periodCalls) {
        if (!c.ok) {
          expect(c.cls).toBeUndefined();
          continue;
        }
        calls += 1;
        seen.add(c.cls);
        const spec = toolSpec(c.tool);
        const stated = caseDef.stated[c.tool]?.[c.argument];
        if (stated === undefined) {
          expect(c.cls).toBe(
            c.ranWith === spec.period.default ? 'default-unchosen' : 'model-chosen',
          );
        } else {
          expect(c.cls).toBe(stated.includes(c.ranWith) ? 'person' : 'contradicts');
        }
        // What ran is the store's record: the sent value, or the default when left out.
        expect(c.ranWith).toBe(c.origin === 'omitted' ? spec.period.default : c.sent);
      }
      const s = summarize([row]);
      expect(Object.values(s.classes).reduce((a: number, b: any) => a + b, 0)).toBe(s.periodCalls);
      if (s.rates.defaultUnchosen !== undefined) {
        expect(s.rates.defaultUnchosen).toBeGreaterThanOrEqual(0);
        expect(s.rates.defaultUnchosen).toBeLessThanOrEqual(1);
      }
      if (row.answer.statesRan) {
        for (const d of row.answer.ranDurations) expect(row.answer.statedDurations).toContain(d);
      }
      // Another answer text changes the answer's columns and nothing else.
      const reworded = JSON.parse(JSON.stringify(raw));
      const last = reworded.turns[reworded.turns.length - 1];
      if (last.answer !== undefined) last.answer = 'Over the last 7 days, all fine.';
      const again = readRun(reworded);
      expect(again.periodCalls).toEqual(row.periodCalls);
      expect(again.names).toEqual(row.names);
      expect(again.toolCalls).toEqual(row.toolCalls);
    }
    expect(calls).toBeGreaterThan(1000);
    expect([...seen].sort()).toEqual(['contradicts', 'default-unchosen', 'model-chosen', 'person']);
  });
});
