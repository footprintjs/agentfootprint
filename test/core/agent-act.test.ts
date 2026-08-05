/**
 * `.act()` — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Six laws carry this door, and each has at least one test below:
 *
 *   1. PURE SUGAR — every key builds byte-for-byte the agent the individual
 *      door builds. Pinned per key, against the hand-written spelling.
 *   2. THE COMPLETENESS LOCK — the bundle's keys ARE the moments. The type
 *      half is in `test/type-regressions/ActOptions.completeness.test.ts`;
 *      the runtime half is here, derived from `LOOP_MOMENTS` rather than
 *      typed out beside it.
 *   3. ONE POSTURE BLOCK — a second `.act()` throws; the individual doors
 *      stay open for incremental composition.
 *   4. THE BUCKETS ARE FOR READING, THE HOOKS DECIDE — an object named under
 *      both keys is attached once, and a bucket that names a hook the object
 *      does not have is refused at build time rather than silently ignored.
 *   5. A BAD BUNDLE LEAVES THE BUILDER UNTOUCHED — validation happens before
 *      anything is attached.
 *   6. THE WHOLE WHEEL — one agent using all five moments records all five.
 */

import { describe, expect, it } from 'vitest';

import {
  ACT_KEYS,
  Agent,
  LOOP_MOMENTS,
  actKeyFor,
  allow,
  defineTool,
  deny,
  slidingWindow,
  type ActOptions,
  type LoopMoment,
  type MessageMiddleware,
  type MiddlewareDecision,
  type ToolMiddleware,
  type WindowRecord,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import type { LLMRequest, LLMResponse } from '../../src/adapters/types.js';

// ─── Helpers ──────────────────────────────────────────────────────

function spyProvider(replies: (string | Partial<LLMResponse>)[]) {
  const inner = mock({ replies });
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      name: inner.name,
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        requests.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
        return inner.complete(req);
      },
    },
  };
}

const act = defineTool<Record<string, unknown>, unknown>({
  name: 'act',
  description: 'does a thing',
  inputSchema: { type: 'object', properties: {} },
  execute: (args) => ({ ran: true, with: { ...args } }),
});

/** One reply asking for `act`, then a plain final answer. */
const callThenDone = () => [
  { toolCalls: [{ id: 'c1', name: 'act', args: { amount: 500 } }] },
  { content: 'done' },
];

function ledger(agent: Agent): readonly MiddlewareDecision[] {
  const state = agent.getLastSnapshot()?.sharedState as
    | { middlewareDecisions?: readonly MiddlewareDecision[] }
    | undefined;
  return state?.middlewareDecisions ?? [];
}

function records(agent: Agent): readonly WindowRecord[] {
  const state = agent.getLastSnapshot()?.sharedState as
    | { compactions?: readonly WindowRecord[] }
    | undefined;
  return state?.compactions ?? [];
}

/**
 * Run the same scenario twice — once through `.act()`, once through the
 * individual doors — and assert the two runs are indistinguishable.
 *
 * This is the `.compaction()` precedent: same requests on the wire, same
 * records in the run. Anything a consumer could observe has to match.
 */
async function sameAgent(
  bundle: (b: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
  doors: (b: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
  replies: (string | Partial<LLMResponse>)[] = callThenDone(),
): Promise<void> {
  const viaAct = spyProvider(replies);
  const viaDoors = spyProvider(replies);
  const one = bundle(Agent.create({ provider: viaAct.provider, model: 'm' }).tools([act])).build();
  const two = doors(Agent.create({ provider: viaDoors.provider, model: 'm' }).tools([act])).build();

  const answerOne = await one.run({ message: 'go' });
  const answerTwo = await two.run({ message: 'go' });

  expect(answerOne).toEqual(answerTwo);
  expect(JSON.stringify(viaAct.requests)).toBe(JSON.stringify(viaDoors.requests));
  expect(JSON.stringify(ledger(one))).toBe(JSON.stringify(ledger(two)));
  expect(JSON.stringify(records(one))).toBe(JSON.stringify(records(two)));
}

// ─── 1. UNIT — the lock, and the shape of the bundle ──────────────

describe('act — unit', () => {
  it('LAW 2: the accepted keys ARE the moments, derived from the one list', () => {
    expect(ACT_KEYS).toEqual(['input', 'beforeTool', 'afterTool', 'window', 'output']);
    expect(LOOP_MOMENTS.map(actKeyFor)).toEqual(ACT_KEYS);
    expect(LOOP_MOMENTS).toEqual(['input', 'before-tool', 'after-tool', 'window', 'output']);
  });

  it('LAW 2: every moment has a key `.act()` accepts, and nothing else is accepted', () => {
    const builder = () => Agent.create({ provider: mock({ reply: 'x' }), model: 'm' });
    // Every key from the list is accepted (empty lists / a real strategy).
    for (const moment of LOOP_MOMENTS) {
      const key = actKeyFor(moment);
      const value = key === 'window' ? slidingWindow({ keepRecentTurns: 4 }) : [];
      expect(() => builder().act({ [key]: value } as ActOptions)).not.toThrow();
    }
    // And a key that is not a moment is refused by name.
    expect(() => builder().act({ beforeToolCall: [] } as unknown as ActOptions)).toThrow(
      /unknown key 'beforeToolCall'/,
    );
  });

  it('actKeyFor maps kebab to camel, mechanically', () => {
    expect(actKeyFor('before-tool')).toBe('beforeTool');
    expect(actKeyFor('after-tool')).toBe('afterTool');
    expect(actKeyFor('input')).toBe('input');
  });

  it('refuses a bundle that is not an options object', () => {
    const builder = Agent.create({ provider: mock({ reply: 'x' }), model: 'm' });
    expect(() => builder.act([] as unknown as ActOptions)).toThrow(/expected an options object/);
    expect(() => builder.act(null as unknown as ActOptions)).toThrow(/expected an options object/);
  });

  it('refuses a list where a list is expected', () => {
    const builder = Agent.create({ provider: mock({ reply: 'x' }), model: 'm' });
    expect(() =>
      builder.act({
        beforeTool: { name: 'x', onToolCall: () => allow() },
      } as unknown as ActOptions),
    ).toThrow(/expects an array of middleware/);
  });

  it('LAW 4: a bucket that names a hook the rule does not have is refused, not ignored', () => {
    const builder = () => Agent.create({ provider: mock({ reply: 'x' }), model: 'm' });
    const afterOnly: ToolMiddleware = { name: 'after-only', onToolResult: () => allow() };
    const callOnly: ToolMiddleware = { name: 'call-only', onToolCall: () => allow() };

    expect(() => builder().act({ beforeTool: [afterOnly] })).toThrow(/belongs under 'afterTool'/);
    expect(() => builder().act({ afterTool: [callOnly] })).toThrow(/belongs under 'beforeTool'/);
  });

  it('LAW 3: a second .act() throws and names the incremental doors', () => {
    const builder = Agent.create({ provider: mock({ reply: 'x' }), model: 'm' }).act({});
    expect(() => builder.act({})).toThrow(/already called/);
    expect(() => builder.act({})).toThrow(/toolMiddleware/);
  });

  it('LAW 5: a bundle with a bad key leaves the builder exactly as it found it', async () => {
    const spy = spyProvider(callThenDone());
    const builder = Agent.create({ provider: spy.provider, model: 'm' }).tools([act]);
    expect(() =>
      builder.act({
        beforeTool: [{ name: 'good', onToolCall: () => deny('no') }],
        nonsense: [],
      } as unknown as ActOptions),
    ).toThrow(/unknown key/);

    // Nothing was attached: the denial above never governs this run.
    const agent = builder.build();
    await agent.run({ message: 'go' });
    expect(ledger(agent)).toEqual([]);
  });

  it('LAW 3: .act() is fluent and the individual doors still compose after it', async () => {
    const order: string[] = [];
    const link = (name: string): ToolMiddleware => ({
      name,
      onToolCall: () => {
        order.push(name);
        return allow();
      },
    });
    const agent = Agent.create({ provider: mock({ replies: callThenDone() }), model: 'm' })
      .tools([act])
      .act({ beforeTool: [link('from-act')] })
      .toolMiddleware(link('from-the-door'))
      .build();

    await agent.run({ message: 'go' });

    expect(order).toEqual(['from-act', 'from-the-door']);
  });
});

// ─── 2. SCENARIO — byte-equivalence, per key ──────────────────────

describe('act — scenario: LAW 1, byte-equivalent per key', () => {
  const scrub: MessageMiddleware = {
    name: 'scrub',
    onMessage: (msg) => {
      const clean = msg.content.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]');
      return clean === msg.content ? allow() : allow(clean, 'masked a US SSN');
    },
  };
  const cap: ToolMiddleware = {
    name: 'cap',
    onToolCall: (call) =>
      Number(call.args.amount) > 100 ? allow({ ...call.args, amount: 100 }, 'capped') : allow(),
  };
  const stamp: ToolMiddleware = {
    name: 'stamp',
    onToolResult: (call) => allow({ ...(call.result as object), stamped: true }, 'stamped'),
  };

  it('input ≡ .messageMiddleware(<the same rule, guarded to input>)', async () => {
    await sameAgent(
      (b) => b.act({ input: [scrub] }),
      (b) =>
        b.messageMiddleware({
          name: scrub.name,
          onMessage: (msg) => (msg.phase === 'input' ? scrub.onMessage(msg) : allow()),
        }),
    );
  });

  it('output ≡ .messageMiddleware(<the same rule, guarded to output>)', async () => {
    const shout: MessageMiddleware = {
      name: 'shout',
      onMessage: (msg) => allow(msg.content.toUpperCase(), 'shouted'),
    };
    await sameAgent(
      (b) => b.act({ output: [shout] }),
      (b) =>
        b.messageMiddleware({
          name: shout.name,
          onMessage: (msg) => (msg.phase === 'output' ? shout.onMessage(msg) : allow()),
        }),
    );
  });

  it('a rule named at BOTH phases ≡ the plain .messageMiddleware(rule)', async () => {
    await sameAgent(
      (b) => b.act({ input: [scrub], output: [scrub] }),
      (b) => b.messageMiddleware(scrub),
    );
  });

  it('beforeTool ≡ .toolMiddleware(...)', async () => {
    await sameAgent(
      (b) => b.act({ beforeTool: [cap] }),
      (b) => b.toolMiddleware(cap),
    );
  });

  it('afterTool ≡ .toolMiddleware(<the same after-only rule>)', async () => {
    await sameAgent(
      (b) => b.act({ afterTool: [stamp] }),
      (b) => b.toolMiddleware(stamp),
    );
  });

  it('window ≡ .window(strategy)', async () => {
    await sameAgent(
      (b) => b.act({ window: slidingWindow({ keepRecentTurns: 1 }) }),
      (b) => b.window(slidingWindow({ keepRecentTurns: 1 })),
      [
        { toolCalls: [{ id: 'c1', name: 'act', args: { n: 1 } }] },
        { toolCalls: [{ id: 'c2', name: 'act', args: { n: 2 } }] },
        { content: 'done' },
      ],
    );
  });

  it('all five keys at once ≡ all five doors at once', async () => {
    await sameAgent(
      (b) =>
        b.act({
          input: [scrub],
          beforeTool: [cap],
          afterTool: [stamp],
          window: slidingWindow({ keepRecentTurns: 4 }),
          output: [scrub],
        }),
      (b) =>
        b
          .messageMiddleware(scrub)
          .toolMiddleware(cap, stamp)
          .window(slidingWindow({ keepRecentTurns: 4 })),
    );
  });
});

// ─── 3. INTEGRATION — the whole wheel on one run ──────────────────

describe('act — integration', () => {
  it('LAW 6: one agent, five moments, and the record names each of them', async () => {
    const spy = spyProvider([
      { toolCalls: [{ id: 'c1', name: 'act', args: { amount: 500 } }] },
      { toolCalls: [{ id: 'c2', name: 'act', args: { amount: 500 } }] },
      { content: 'the answer, from PROJECT-BLUEJAY' },
    ]);
    const agent = Agent.create({ provider: spy.provider, model: 'm' })
      .tools([act])
      .act({
        input: [
          {
            name: 'scrub-ssns',
            onMessage: (msg) => {
              const clean = msg.content.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]');
              return clean === msg.content ? allow() : allow(clean, 'masked a US SSN');
            },
          },
        ],
        beforeTool: [
          {
            name: 'refund-ceiling',
            onToolCall: (call) =>
              Number(call.args.amount) > 100
                ? allow({ ...call.args, amount: 100 }, 'capped at the desk limit')
                : allow(),
          },
        ],
        afterTool: [
          {
            name: 'annotate',
            onToolResult: (call) =>
              allow({ ...(call.result as object), reviewed: true }, 'reviewed'),
          },
        ],
        window: slidingWindow({ keepRecentTurns: 1 }),
        output: [
          {
            name: 'no-codenames',
            onMessage: (msg) =>
              msg.content.includes('BLUEJAY')
                ? allow(msg.content.replace(/PROJECT-BLUEJAY/g, 'the project'), 'internal codename')
                : allow(),
          },
        ],
      })
      .build();

    const answer = await agent.run({ message: 'refund 500 for ssn 123-45-6789' });

    const moments = ledger(agent).map((r) => r.moment);
    expect(new Set(moments)).toEqual(new Set(['input', 'before-tool', 'after-tool', 'output']));
    // The window moment files its own kind of record, in its own key.
    expect(records(agent).length).toBeGreaterThan(0);
    expect(records(agent)[0]?.strategy).toBe('sliding-window');

    // Each moment did its job, end to end.
    expect(spy.requests[0]?.messages[0]?.content).toContain('[ssn]');
    const toolMsg = spy.requests[1]?.messages.find((m) => m.role === 'tool')?.content ?? '';
    expect(toolMsg).toContain('"amount":100');
    expect(toolMsg).toContain('"reviewed":true');
    expect(answer).toBe('the answer, from the project');
  });

  it('LAW 4: a rule named under BOTH tool keys is attached once and speaks twice', async () => {
    const calls: string[] = [];
    const both: ToolMiddleware = {
      name: 'both',
      onToolCall: () => {
        calls.push('before');
        return allow();
      },
      onToolResult: () => {
        calls.push('after');
        return allow();
      },
    };
    const agent = Agent.create({ provider: mock({ replies: callThenDone() }), model: 'm' })
      .tools([act])
      .act({ beforeTool: [both], afterTool: [both] })
      .build();

    await agent.run({ message: 'go' });

    expect(calls).toEqual(['before', 'after']);
    expect(ledger(agent).map((r) => `${r.moment}:${r.middleware}`)).toEqual([
      'before-tool:both',
      'after-tool:both',
    ]);
  });

  it('LAW 4: hooks decide — a both-hook rule listed only under beforeTool still speaks at after', async () => {
    const calls: string[] = [];
    const both: ToolMiddleware = {
      name: 'both',
      onToolCall: () => {
        calls.push('before');
        return allow();
      },
      onToolResult: () => {
        calls.push('after');
        return allow();
      },
    };
    const agent = Agent.create({ provider: mock({ replies: callThenDone() }), model: 'm' })
      .tools([act])
      .act({ beforeTool: [both] })
      .build();

    await agent.run({ message: 'go' });

    // A governance rule that silently did not run because it was written in
    // the other bucket is the failure this door exists to prevent.
    expect(calls).toEqual(['before', 'after']);
  });

  it('a window in the bundle collides with .window() the way two .window() calls do', () => {
    expect(() =>
      Agent.create({ provider: mock({ reply: 'x' }), model: 'm' })
        .window(slidingWindow({ keepRecentTurns: 4 }))
        .act({ window: slidingWindow({ keepRecentTurns: 8 }) }),
    ).toThrow(/already has a window strategy/);

    expect(() =>
      Agent.create({ provider: mock({ reply: 'x' }), model: 'm' })
        .act({ window: slidingWindow({ keepRecentTurns: 8 }) })
        .compaction({ thresholdTokens: 100, summarizer: mock({ reply: 's' }), model: 'm' }),
    ).toThrow(/already set/);
  });
});

// ─── 4. PROPERTY — the ordering the bundle promises ───────────────

describe('act — property', () => {
  it('for any split of N rules across the two tool keys, dispatch order is the written order', async () => {
    for (const split of [0, 1, 2, 3]) {
      const order: string[] = [];
      const link = (name: string): ToolMiddleware => ({
        name,
        onToolCall: () => {
          order.push(name);
          return allow();
        },
        onToolResult: () => allow(),
      });
      const all = ['a', 'b', 'c'].map(link);
      const agent = Agent.create({ provider: mock({ replies: callThenDone() }), model: 'm' })
        .tools([act])
        .act({ beforeTool: all.slice(0, split), afterTool: all.slice(split) })
        .build();

      await agent.run({ message: 'go' });

      // Every rule ran exactly once, and the before-order is the order they
      // appear across the two lists.
      expect(order).toEqual(['a', 'b', 'c']);
    }
  });

  it('an empty bundle is an agent nobody governed', async () => {
    const spy = spyProvider(callThenDone());
    const governed = Agent.create({ provider: spy.provider, model: 'm' })
      .tools([act])
      .act({})
      .build();
    await governed.run({ message: 'go' });

    const bare = spyProvider(callThenDone());
    const plain = Agent.create({ provider: bare.provider, model: 'm' }).tools([act]).build();
    await plain.run({ message: 'go' });

    expect(JSON.stringify(spy.requests)).toBe(JSON.stringify(bare.requests));
    expect(ledger(governed)).toEqual([]);
  });
});

// ─── 5. SECURITY — the bundle cannot weaken a rule ────────────────

describe('act — security', () => {
  it('a rule written for one phase does not see the other phase’s content', async () => {
    const seen: string[] = [];
    const agent = Agent.create({ provider: mock({ reply: 'the final answer' }), model: 'm' })
      .act({
        input: [
          {
            name: 'input-only',
            onMessage: (msg) => {
              seen.push(msg.content);
              return allow();
            },
          },
        ],
      })
      .build();

    await agent.run({ message: 'the question' });

    expect(seen).toEqual(['the question']);
  });

  it('a denial through the bundle refuses exactly as a denial through the door', async () => {
    const refuse: ToolMiddleware = {
      name: 'refuse',
      onToolCall: () => deny('not on my watch'),
    };
    await sameAgent(
      (b) => b.act({ beforeTool: [refuse] }),
      (b) => b.toolMiddleware(refuse),
    );
  });
});

// ─── 6. PERFORMANCE — the absent-bundle pin ───────────────────────

describe('act — performance', () => {
  it('a bundle with only a window costs exactly what .window() costs', async () => {
    await sameAgent(
      (b) => b.act({ window: slidingWindow({ keepRecentTurns: 2 }) }),
      (b) => b.window(slidingWindow({ keepRecentTurns: 2 })),
      [
        { toolCalls: [{ id: 'c1', name: 'act', args: { n: 1 } }] },
        { toolCalls: [{ id: 'c2', name: 'act', args: { n: 2 } }] },
        { content: 'done' },
      ],
    );
  });
});

// ─── 7. ROI — what the block is FOR ───────────────────────────────

describe('act — ROI', () => {
  it('one block answers "what does this agent do at each moment?" without reading the run', () => {
    // The posture is readable from the bundle itself — which is the whole
    // argument for having one place to write it.
    const posture: ActOptions = {
      input: [{ name: 'scrub', onMessage: () => allow() }],
      beforeTool: [{ name: 'ceiling', onToolCall: () => allow() }],
      afterTool: [{ name: 'annotate', onToolResult: () => allow() }],
      window: slidingWindow({ keepRecentTurns: 12 }),
      output: [{ name: 'codenames', onMessage: () => allow() }],
    };

    const named: Record<string, string> = {};
    for (const moment of LOOP_MOMENTS) {
      const key = actKeyFor(moment);
      const value = posture[key as keyof ActOptions];
      named[moment] = Array.isArray(value)
        ? value.map((mw) => (mw as { name: string }).name).join(', ')
        : (value as { name: string }).name;
    }

    expect(named).toEqual({
      input: 'scrub',
      'before-tool': 'ceiling',
      'after-tool': 'annotate',
      window: 'sliding-window',
      output: 'codenames',
    });
    // Every moment is accounted for — the reader is not left guessing whether
    // a sixth one exists.
    expect(Object.keys(named).length).toBe(LOOP_MOMENTS.length);
  });

  it('a ledger row says which moment it came from, in the same words the door uses', async () => {
    const agent = Agent.create({ provider: mock({ replies: callThenDone() }), model: 'm' })
      .tools([act])
      .act({
        beforeTool: [{ name: 'ceiling', onToolCall: () => allow() }],
        afterTool: [{ name: 'annotate', onToolResult: () => allow() }],
      })
      .build();

    await agent.run({ message: 'go' });

    const moments: LoopMoment[] = ledger(agent).map((r) => r.moment);
    expect(moments).toEqual(['before-tool', 'after-tool']);
    for (const m of moments) expect(LOOP_MOMENTS).toContain(m);
  });
});
