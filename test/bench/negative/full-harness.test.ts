/** The benchmark must exercise the real Agent funnel without a paid provider. */
import { describe, expect, it } from 'vitest';
import * as root from '../../../src/index.js';
import * as observe from '../../../src/observe.js';
import * as memory from '../../../src/memory/index.js';
import * as negative from '../../../src/core/agent/negativeClaims/capture.js';
// @ts-expect-error The benchmark is a standalone Node ESM script.
import { runCase } from '../../../bench/negative/full/harness.mjs';

const doors = { root, observe, memory, negative };
const fixture = () => ({
  id: 'zero-cost-native-audit',
  prompt: 'Check incidents for payments.',
  clock: '2026-10-23T12:00:00.000Z',
  tools: [
    {
      name: 'read_incidents',
      description: 'Read incidents in the caller tenant.',
      inputSchema: {
        type: 'object',
        properties: { service: { type: 'string' } },
        required: ['service'],
      },
      effects: 'read',
      search: {
        source: { what: 'incident store', said: ['incident store'] },
        subject: { what: 'incidents', said: ['incident', 'incidents'] },
        arguments: [{ name: 'service', role: 'population' }],
        complete: 'within-arguments',
      },
      responses: [
        {
          kind: 'absent',
          when: { service: 'payments' },
          value: {
            what: 'incidents',
            checked: 'declared',
            resolved: [{ argument: 'service', id: 'payments', name: 'payments' }],
          },
        },
      ],
    },
  ],
  schedule: [[{ name: 'read_incidents', arguments: { service: 'payments' } }]],
});
const draft = (handle = 'r1', summary = 'There are no incidents for payments.') =>
  JSON.stringify({
    summary,
    negatives: [{ kind: 'none', about: 'payments', restsOn: [handle] }],
  });
function provider(replies: string[]) {
  const requests: root.LLMRequest[] = [];
  const value: root.LLMProvider = {
    name: 'zero-cost-audit',
    complete: async (request) => {
      requests.push(JSON.parse(JSON.stringify(request)) as root.LLMRequest);
      const content = replies[requests.length - 1];
      if (content === undefined) throw new Error('Unexpected delegated call');
      return { content, toolCalls: [], usage: { input: 13, output: 7 }, stopReason: 'stop' };
    },
  };
  return { value, requests };
}
const run = (caseDef: unknown, arm: string, replies: string[], cell = 'main') => {
  const p = provider(replies);
  return {
    p,
    result: runCase({
      doors,
      caseDef,
      arm,
      cell,
      provider: p.value,
      model: 'scripted-model',
      rep: 1,
    }),
  };
};

describe('PR6 genuine full-path harness', () => {
  it('observes real dispatch and serves native handles while retaining drafts and genuine artifacts', async () => {
    const { p, result } = run(fixture(), 'observe', [draft()]);
    const raw = await result;
    expect(raw.turns[0].error).toBeNull();
    expect(raw.attempts).toHaveLength(1);
    expect(raw.attempts[0].args).toEqual({ service: 'payments', benchTenant: 'benchmark-tenant' });
    expect(raw.turns[0].nativeRecord.calls).toHaveLength(1);
    expect(raw.turns[0].nativeRecord.clock).toBe('2026-10-23T12:00:00.000Z');
    expect(raw.turns[0].nativeRecord.calls[0]).toMatchObject({
      dispatched: true,
      effect: 'read',
      outcome: 'ok',
      turn: 1,
    });
    expect(JSON.stringify(p.requests[0])).toContain('r1');
    expect(
      raw.calls.filter((call: { source: string }) => call.source === 'provider')[0],
    ).toMatchObject({
      response: { usage: { input: 13, output: 7 } },
      candidate: { valid: true },
    });
    expect(raw.turns[0].recording.events.length).toBeGreaterThan(0);
    expect(raw.turns[0].droppedEvents).toBe(0);
    expect(JSON.stringify(raw.turns[0].history)).toContain('There are no incidents for payments.');
    expect(JSON.stringify(raw.turns[0].memory)).toContain('There are no incidents for payments.');
  });

  it('runs one actual tools-off correction without executing the native tool again', async () => {
    const { p, result } = run(fixture(), 'enforce', [draft('r9', 'REJECTED_DRAFT'), draft()]);
    const raw = await result;
    expect(raw.turns[0].error).toBeNull();
    expect(p.requests).toHaveLength(2);
    expect(p.requests[1].tools ?? []).toHaveLength(0);
    expect(JSON.stringify(p.requests[1])).toContain('internal citation correction');
    expect(JSON.stringify(p.requests[1])).toContain('r1');
    expect(raw.attempts).toHaveLength(1);
    expect(raw.turns[0].answerNegatives.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'established' })]),
    );
    expect(
      JSON.stringify({
        delivered: raw.turns[0].delivered,
        history: raw.turns[0].history,
        memory: raw.turns[0].memory,
      }),
    ).not.toContain('REJECTED_DRAFT');
    expect(
      raw.calls.some((call: { response?: { content: string } }) =>
        call.response?.content.includes('REJECTED_DRAFT'),
      ),
    ).toBe(true);
  });

  it('withholds a twice-invalid citation and never requests a third paid answer', async () => {
    const { p, result } = run(fixture(), 'enforce', [draft('r9'), draft('r9')]);
    const raw = await result;
    expect(p.requests).toHaveLength(2);
    expect(raw.attempts).toHaveLength(1);
    expect(raw.turns[0].error?.name).toBe('AnswerValidationError');
    expect(JSON.stringify(raw.turns[0].memory)).not.toContain(
      'There are no incidents for payments.',
    );
  });

  it('feature-off keeps the same schema and output but never fabricates a native evidence record', async () => {
    const { result } = run(fixture(), 'off', [draft()]);
    const raw = await result;
    expect(raw.turns[0].error).toBeNull();
    expect(raw.turns[0].nativeRecord).toBeNull();
    expect(raw.turns[0].answerNegatives).toBeNull();
    expect(raw.attempts).toHaveLength(1);
    expect(JSON.stringify(raw.turns[0].output)).toContain('There are no incidents for payments.');
  });

  it('long cell uses a real same-agent continuation and preserves the exact scripted padding', async () => {
    const caseDef = {
      ...fixture(),
      longContext: {
        padding: 'Synthetic prior context. '.repeat(800),
        followupPrompt: 'Does the earlier result still establish none now?',
        schedule: [],
      },
    };
    const { p, result } = run(caseDef, 'enforce', [draft(), draft()], 'long');
    const raw = await result;
    expect(raw.turns).toHaveLength(2);
    expect(raw.turns[0].error).toBeNull();
    expect(raw.attempts).toHaveLength(1);
    expect(
      raw.calls
        .filter((call: { source: string; turn: number }) => call.source === 'provider')
        .every((call: { turn: number }) => call.turn === 2),
    ).toBe(true);
    expect(JSON.stringify(p.requests[0])).toContain(caseDef.longContext.padding);
    expect(raw.turns[1].nativeRecord.turn).toBe(2);
    expect(raw.turns[1].nativeRecord.calls[0].turn).toBe(1);
    expect(
      raw.turns[1].answerNegatives.checks.some(
        (check: { code: string }) => check.code === 'stale-turn',
      ),
    ).toBe(true);
  });

  it('does not apply the long cell merely because a main-bank case carries long-context metadata', async () => {
    const { result } = run(
      { ...fixture(), longContext: { padding: 'not for the main cell', schedule: [] } },
      'observe',
      [draft()],
    );
    expect((await result).turns).toHaveLength(1);
  });

  it('retains invalid JSON as an invalid candidate instead of calling it a successful negative', async () => {
    const { result } = run(fixture(), 'observe', ['not JSON']);
    const raw = await result;
    expect(raw.calls.at(-1).candidate.valid).toBe(false);
    expect(raw.turns[0].outputContractUnmet).not.toBeNull();
  });

  it('preserves an authored partial status at the native execution boundary', async () => {
    const caseDef = fixture();
    const partial = {
      ...caseDef,
      tools: [
        {
          ...caseDef.tools[0],
          responses: [{ ...caseDef.tools[0].responses[0], status: 'partial' }],
        },
      ],
    };
    const { result } = run(partial, 'observe', [draft()]);
    const raw = await result;
    expect(raw.turns[0].error).toBeNull();
    expect(raw.attempts[0].result).toMatchObject({
      status: 'partial',
      effects: [],
      content: { af_absent: true },
    });
    expect(raw.turns[0].nativeRecord.calls[0].outcome).toBe('ok');
    expect(JSON.stringify(raw.turns[0].nativeRecord.calls[0].row)).toContain('partial');
  });

  it('provider id reuse in a native batch never becomes the evidence identity', async () => {
    const caseDef = fixture();
    caseDef.tools[0].responses.push(structuredClone(caseDef.tools[0].responses[0]));
    const duplicate = {
      ...caseDef,
      schedule: [
        [
          { name: 'read_incidents', arguments: { service: 'payments' }, id: '' },
          { name: 'read_incidents', arguments: { service: 'payments' }, id: '' },
        ],
      ],
    };
    const { result } = run(duplicate, 'observe', [draft()]);
    const raw = await result;
    expect(raw.turns[0].error).toBeNull();
    expect(raw.attempts).toHaveLength(2);
    expect(
      new Set(raw.turns[0].nativeRecord.calls.map((call: { resultId: string }) => call.resultId))
        .size,
    ).toBe(2);
  });

  it('near pair leaves a refused baseline intact and adds only a separately sourced index read', async () => {
    const caseDef = fixture();
    const refused = {
      ...caseDef,
      tools: [
        { ...caseDef.tools[0], responses: [{ kind: 'throw', value: 'Source access refused' }] },
      ],
      near: {
        tool: 'read_incidents',
        source: 'Synthetic service index',
        asked: 'paymants',
        names: ['payments'],
        count: 42,
        completeWithinIndex: true,
        measuredAt: caseDef.clock,
        scopeLimit: 'Only names in this synthetic index; never the whole estate.',
      },
    };
    const count = run(refused, 'near-count', [
      JSON.stringify({ summary: 'Please confirm the requested spelling.', negatives: [] }),
    ]);
    const list = run(refused, 'near-list', [
      JSON.stringify({ summary: 'Did you mean payments?', negatives: [] }),
    ]);
    const [a, b] = await Promise.all([count.result, list.result]);
    for (const raw of [a, b]) {
      expect(raw.turns[0].error).toBeNull();
      expect(raw.attempts).toHaveLength(2);
      expect(raw.attempts[0]).toMatchObject({
        tool: 'read_incidents',
        outcome: 'threw',
        error: { message: 'Source access refused' },
      });
      expect(raw.attempts[1]).toMatchObject({
        tool: 'bench_name_index',
        outcome: 'returned',
        result: { af_absent: true },
      });
      expect(raw.turns[0].nativeRecord.calls).toHaveLength(2);
    }
    const countRequest = JSON.stringify(count.p.requests[0]);
    const listRequest = JSON.stringify(list.p.requests[0]);
    expect(countRequest).toContain('42');
    expect(countRequest).not.toContain('source_candidates');
    expect(listRequest).toContain('source_candidates');
    expect(listRequest).toContain('Suggestions only; do not substitute another entity');
    expect(b.attempts[1].result.source_candidates.suggestions).toEqual(['"payments"']);
  });

  it('refuses an oversized or distant suggestion list before any provider request', async () => {
    for (const names of [['a', 'b', 'c', 'd'], ['entirely different name']]) {
      const p = provider([draft()]);
      await expect(
        runCase({
          doors,
          caseDef: { ...fixture(), near: { source: 'names', asked: 'payments', names } },
          arm: 'near-list',
          provider: p.value,
          model: 'scripted-model',
          rep: 1,
        }),
      ).rejects.toThrow('candidate names');
      expect(p.requests).toHaveLength(0);
    }
  });

  it('allows one chosen fresh read on the long second turn through the native funnel', async () => {
    const caseDef = fixture();
    caseDef.tools[0].responses.push(structuredClone(caseDef.tools[0].responses[0]));
    const long = {
      ...caseDef,
      longContext: {
        padding: 'Synthetic prior context. '.repeat(800),
        schedule: [],
        freshSchedule: caseDef.schedule,
        followupPrompt: 'Check again now.',
      },
    };
    let delegated = 0;
    const value: root.LLMProvider = {
      name: 'zero-cost-chosen-reread',
      complete: async () => {
        delegated++;
        return delegated === 1
          ? {
              content: '',
              toolCalls: [
                { id: 'fresh-choice', name: 'read_incidents', args: { service: 'payments' } },
              ],
              usage: { input: 1, output: 1 },
              stopReason: 'tool_use',
            }
          : {
              content: draft('r2'),
              toolCalls: [],
              usage: { input: 1, output: 1 },
              stopReason: 'stop',
            };
      },
    };
    const raw = await runCase({
      doors,
      caseDef: long,
      arm: 'enforce',
      cell: 'long',
      provider: value,
      model: 'scripted-model',
      rep: 1,
    });
    expect(raw.turns[1].error).toBeNull();
    expect(delegated).toBe(2);
    expect(raw.attempts.map((a: { turn: number }) => a.turn)).toEqual([1, 2]);
    expect(raw.turns[1].nativeRecord.calls.map((c: { turn: number }) => c.turn)).toEqual([1, 2]);
    expect(
      raw.turns[1].answerNegatives.checks.some(
        (check: { code: string }) => check.code === 'established',
      ),
    ).toBe(true);
  });

  it('an unsolicited main-cell tool proposal cannot consume a future authored response', async () => {
    const caseDef = fixture();
    caseDef.tools[0].responses.push(structuredClone(caseDef.tools[0].responses[0]));
    let delegated = 0;
    const value: root.LLMProvider = {
      name: 'zero-cost-extra-proposal',
      complete: async () => {
        delegated++;
        return {
          content: '',
          toolCalls: [{ id: 'extra', name: 'read_incidents', args: { service: 'payments' } }],
          usage: { input: 1, output: 1 },
          stopReason: 'tool_use',
        };
      },
    };
    const raw = await runCase({
      doors,
      caseDef,
      arm: 'observe',
      provider: value,
      model: 'scripted-model',
      rep: 1,
    });
    expect(delegated).toBe(1);
    expect(raw.attempts[1]).toMatchObject({
      outcome: 'threw',
      error: { message: 'unscheduled fixture execution for read_incidents' },
    });
    expect(raw.turns[0].error).not.toBeNull();
  });

  it('uses an injected stream without falling back to an uncounted complete request', async () => {
    let completions = 0;
    const value: root.LLMProvider = {
      name: 'zero-cost-stream',
      complete: async () => {
        completions++;
        throw new Error('unexpected complete');
      },
      stream: async function* () {
        yield { tokenIndex: 0, content: 'draft chunk', done: false };
        yield { tokenIndex: 1, content: '', done: true };
      },
    };
    const raw = await runCase({
      doors,
      caseDef: fixture(),
      arm: 'observe',
      provider: value,
      model: 'scripted-model',
      rep: 1,
    });
    expect(completions).toBe(0);
    expect(raw.turns[0].error.message).toContain('terminal response');
    expect(raw.calls.at(-1).chunks).toHaveLength(2);
  });
});
