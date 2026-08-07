/**
 * A run needs a message, and a bare string IS one (8.18.0).
 *
 * Every runner in this library takes the same `{ message }` bag, and until
 * 8.18.0 not one of them looked at it. Two failure shapes came out of that,
 * and the second is the worse one:
 *
 *   • `agent.run('go')` — the spelling every chat SDK takes — reached the
 *     messages slot as `content: undefined` and threw
 *     `TypeError: Cannot read properties of undefined (reading 'length')`
 *     five frames inside the engine, naming nothing.
 *
 *   • `LLMCall.run('go')` did NOT throw. It called the model with an EMPTY
 *     conversation and returned the answer, so the mistake looked like it
 *     had worked.
 *
 * The rule that decides between adapting and refusing: `AgentInput` has one
 * required field, so a lone string has exactly one possible reading and is
 * adapted. Everything else is a caller who believes they passed a message and
 * did not, and is refused BY NAME, before the run starts.
 *
 * Seven patterns, in the house order:
 *   unit · boundary · scenario · property · security · refusal · integration
 */

import { describe, expect, it } from 'vitest';

import { Agent, InvalidRunInputError, LLMCall, Sequence } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../src/adapters/types.js';

/** A provider that records exactly what reached the wire. */
function spyProvider(reply = 'ok'): { provider: LLMProvider; requests: LLMRequest[] } {
  const requests: LLMRequest[] = [];
  const provider: LLMProvider = {
    name: 'spy',
    complete: async (req: LLMRequest): Promise<LLMResponse> => {
      requests.push(req);
      return { content: reply, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
  return { provider, requests };
}

const agent = (provider: LLMProvider): Agent => Agent.create({ provider, model: 'm' }).build();

// ─── 1. UNIT — the adaptation ─────────────────────────────────────

describe('run input — unit', () => {
  it('a bare string is the message, on Agent', async () => {
    const spy = spyProvider('hi there');
    expect(await agent(spy.provider).run('go')).toBe('hi there');
    expect(spy.requests[0]?.messages).toEqual([{ role: 'user', content: 'go' }]);
  });

  it('a bare string is the message, on LLMCall — which used to send NOTHING', async () => {
    const spy = spyProvider();
    await LLMCall.create({ provider: spy.provider, model: 'm' }).build().run('go');
    expect(spy.requests[0]?.messages).toEqual([{ role: 'user', content: 'go' }]);
  });

  it('run(string) and run({ message }) produce byte-identical requests', async () => {
    const a = spyProvider();
    const b = spyProvider();
    await agent(a.provider).run('same words');
    await agent(b.provider).run({ message: 'same words' });
    expect(JSON.stringify(b.requests)).toBe(JSON.stringify(a.requests));
  });

  it('extra fields on an object input ride through untouched', async () => {
    const spy = spyProvider();
    const a = agent(spy.provider);
    await a.run({ message: 'hello', identity: { conversationId: 'c-7' } });
    const state = a.getLastSnapshot()?.sharedState as { runIdentity?: { conversationId?: string } };
    expect(state.runIdentity?.conversationId).toBe('c-7');
  });
});

// ─── 2. BOUNDARY — the shapes that are not a message ──────────────

describe('run input — boundary', () => {
  const cases: ReadonlyArray<readonly [string, unknown, RegExp]> = [
    ['an empty object', {}, /`message` must be a string/],
    ['message: undefined', { message: undefined }, /whose `message` is undefined/],
    ['message: a number', { message: 42 }, /whose `message` is a number/],
    ['message: null', { message: null }, /whose `message` is null/],
    ['message: an object', { message: { text: 'hi' } }, /whose `message` is an object/],
    ['null', null, /received null/],
    ['undefined', undefined, /received undefined/],
    ['an array', ['hi'], /received an array of 1/],
    ['a number', 7, /received a number/],
  ];

  for (const [label, input, pattern] of cases) {
    it(`refuses ${label}`, async () => {
      await expect(agent(spyProvider().provider).run(input as never)).rejects.toThrow(pattern);
    });
  }

  it('names the door it was refused at', async () => {
    await expect(agent(spyProvider().provider).run({} as never)).rejects.toThrow(/^Agent\.run:/);
    await expect(
      LLMCall.create({ provider: spyProvider().provider, model: 'm' })
        .build()
        .run({} as never),
    ).rejects.toThrow(/^LLMCall\.run:/);
  });

  it('refuses an empty or whitespace-only message, and says how to mean it', async () => {
    // Not a shorter question. Agent used to send a `content: ''` turn (a 400 on
    // a real wire) and LLMCall used to send no turn at all — the two runners
    // disagreed about what "empty" meant, and neither answer was right.
    await expect(agent(spyProvider().provider).run('')).rejects.toThrow(/an empty message/);
    await expect(agent(spyProvider().provider).run('   \n')).rejects.toThrow(/whitespace-only/);
    await expect(agent(spyProvider().provider).run('')).rejects.toThrow(
      /To run on the system prompt alone, say so in the message/,
    );
  });
});

// ─── 3. SCENARIO + 4. PROPERTY ────────────────────────────────────

describe('run input — scenario', () => {
  it('nothing is executed when the input is refused: no run, no snapshot', async () => {
    const spy = spyProvider();
    const a = agent(spy.provider);
    await expect(a.run({} as never)).rejects.toThrow(InvalidRunInputError);
    expect(spy.requests).toHaveLength(0);
    expect(a.getLastSnapshot()).toBeUndefined();
    // …and the same instance runs normally straight afterwards.
    expect(await a.run('now a real message')).toBe('ok');
  });

  it('runTyped inherits the boundary — the schema never sees a non-run', async () => {
    const parser = { parse: (v: unknown): { ok: boolean } => v as { ok: boolean } };
    const typed = Agent.create({ provider: spyProvider().provider, model: 'm' })
      .outputSchema(parser)
      .build();
    await expect(typed.runTyped({} as never)).rejects.toThrow(InvalidRunInputError);
  });
});

describe('run input — property', () => {
  it('for every accepted spelling, the wire carries exactly one user turn', async () => {
    for (const input of ['a', { message: 'a' }, { message: 'a', identity: undefined }]) {
      const spy = spyProvider();
      await agent(spy.provider).run(input as never);
      expect(spy.requests[0]?.messages).toEqual([{ role: 'user', content: 'a' }]);
    }
  });
});

// ─── 5. SECURITY + 6. REFUSAL ─────────────────────────────────────

describe('run input — security', () => {
  it('the refusal describes the shape and never quotes the value', async () => {
    const secret = { message: undefined, apiKey: 'sk-live-DO-NOT-LOG' };
    const err = await agent(spyProvider().provider)
      .run(secret as never)
      .catch((e: unknown) => e as Error);
    expect(err.message).not.toContain('sk-live');
    expect(err.message).toContain('apiKey'); // the KEY names the shape…
    expect(err.message).toContain('whose `message` is undefined');
  });

  it('is a typed, coded error a caller can route on', async () => {
    const err = await agent(spyProvider().provider)
      .run(null as never)
      .catch((e: unknown) => e as InvalidRunInputError);
    expect(err).toBeInstanceOf(InvalidRunInputError);
    expect(err.code).toBe('ERR_INVALID_RUN_INPUT');
    expect(err.runner).toBe('Agent.run');
    expect(err.received).toBe('null');
  });
});

// ─── 7. INTEGRATION — the compositions share the door ─────────────

describe('run input — integration', () => {
  it('Sequence takes a bare string and refuses a non-message', async () => {
    const child = (name: string): Agent =>
      Agent.create({ provider: mock({ reply: name }), model: 'm' }).build();
    const seq = Sequence.create().step('one', child('first')).step('two', child('second')).build();
    expect(await seq.run('go')).toBe('second');
    await expect(seq.run({} as never)).rejects.toThrow(/^Sequence\.run:/);
  });
});
