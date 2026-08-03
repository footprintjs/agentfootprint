/**
 * The middleware family — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Ten laws carry this feature, and each has at least one test below:
 *   1. a middleware cannot fabricate a result (type-level + runtime);
 *   2. a transform commits BOTH versions, provenance-marked;
 *   3. a deny reason reaches the model verbatim, and the run continues;
 *   4. an ask suspends through the EXISTING pause machinery and resumes
 *      with the answer delivered to the dispatch (hosting behaviour is
 *      pinned in test/hosting/standing-agent.test.ts);
 *   5. a PermissionChecker still decides FIRST;
 *   6. absent middleware = byte-identical;
 *   7. order is declaration order, and a throwing link is a denial;
 *   8. the `'input'` transform is what everything downstream sees;
 *   9. mcpServe (pinned in test/lib/mcp/mcpServe.test.ts);
 *  10. adapter-swap deterministic on mocks.
 */

import { describe, expect, it } from 'vitest';

import {
  Agent,
  allow,
  ask,
  checkInApproved,
  checkInDeclined,
  deny,
  isAskPause,
  isPaused,
  MessageDeniedError,
  defineTool,
  type MessageMiddleware,
  type MiddlewareDecision,
  type ToolMiddleware,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import type { LLMRequest, LLMResponse, PermissionChecker } from '../../src/adapters/types.js';

// ─── Helpers ──────────────────────────────────────────────────────

function spyProvider(replies: (string | Partial<LLMResponse>)[]) {
  const inner = mock({ replies });
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      name: inner.name,
      complete: async (req: LLMRequest): Promise<LLMResponse> => {
        requests.push(req);
        return inner.complete(req);
      },
    },
  };
}

/** A tool that records the args it was actually handed. */
function recordingTool(name = 'act') {
  const seen: Record<string, unknown>[] = [];
  return {
    seen,
    tool: defineTool<Record<string, unknown>, string>({
      name,
      description: 'does a thing',
      inputSchema: { type: 'object', properties: {} },
      execute: (args) => {
        seen.push({ ...args });
        return 'tool ran';
      },
    }),
  };
}

/** One reply asking for `name`, then a plain final answer. */
const callThen = (name: string, args: Record<string, unknown> = {}) => [
  { toolCalls: [{ id: 'c1', name, args }] },
  { content: 'done' },
];

function ledger(agent: Agent): readonly MiddlewareDecision[] {
  const state = agent.getLastSnapshot()?.sharedState as
    | { middlewareDecisions?: readonly MiddlewareDecision[] }
    | undefined;
  return state?.middlewareDecisions ?? [];
}

function committedKeys(agent: Agent): string[] {
  const log = agent.getLastSnapshot()?.commitLog ?? [];
  const keys = new Set<string>();
  for (const bundle of log) {
    for (const key of Object.keys(bundle.overwrite ?? {})) keys.add(key);
    for (const key of Object.keys(bundle.updates ?? {})) keys.add(key);
  }
  return [...keys].sort();
}

// ─── 1. UNIT — the verbs and the builder surface ──────────────────

describe('middleware — unit', () => {
  it('allow() passes through; allow(value, why) declares the transform', () => {
    expect(allow()).toEqual({ kind: 'allow' });
    expect(allow({ a: 1 }, 'masked')).toEqual({ kind: 'allow', value: { a: 1 }, why: 'masked' });
  });

  it('allow(value) without a why throws — a silent transform is the bug this prevents', () => {
    expect(() => (allow as (v: unknown) => unknown)({ a: 1 })).toThrow(/must say why/);
  });

  it('deny() requires a reason — it is what the model reads', () => {
    expect(deny('nope')).toEqual({ kind: 'deny', reason: 'nope' });
    expect(() => deny('')).toThrow(/must carry a reason/);
  });

  it('ask() requires a question — it is what a person is shown', () => {
    expect(ask({ question: 'ok?' })).toEqual({ kind: 'ask', payload: { question: 'ok?' } });
    expect(() => ask({} as never)).toThrow(/non-empty question/);
  });

  it('the builder methods are fluent and repeatable, and order is call order', async () => {
    const order: string[] = [];
    const link = (name: string): ToolMiddleware => ({
      name,
      onToolCall: () => {
        order.push(name);
        return allow();
      },
    });
    const { tool } = recordingTool();
    const builder = Agent.create({ provider: mock({ replies: callThen('act') }), model: 'm' })
      .tools([tool])
      .toolMiddleware(link('first'), link('second'));
    expect(builder.toolMiddleware(link('third'))).toBe(builder);
    await builder.build().run({ message: 'go' });
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('refuses a middleware with no name — every ledger row has to name a decider', () => {
    const builder = Agent.create({ provider: mock({ reply: 'x' }), model: 'm' });
    expect(() => builder.toolMiddleware({ name: '', onToolCall: () => allow() })).toThrow(
      /non-empty `name`/,
    );
    expect(() => builder.messageMiddleware({ name: 'x' } as never)).toThrow(/onMessage/);
  });
});

// ─── 2. SCENARIO — the three verbs against a real agent ───────────

describe('middleware — scenario', () => {
  it('LAW 3: a deny reaches the model verbatim as the tool result, and the run continues', async () => {
    const { seen, tool } = recordingTool();
    const spy = spyProvider(callThen('act', { env: 'prod' }));
    const agent = Agent.create({ provider: spy.provider, model: 'm' })
      .tools([tool])
      .toolMiddleware({
        name: 'no-prod-writes',
        onToolCall: (call) =>
          call.args.env === 'prod' ? deny('writes to prod need a change ticket') : allow(),
      })
      .build();

    const answer = await agent.run({ message: 'ship it' });

    expect(answer).toBe('done'); // the run continued — a denial is not a crash
    expect(seen).toEqual([]); // the tool never ran
    const toolResult = spy.requests[1]?.messages.find((m) => m.role === 'tool');
    expect(toolResult?.content).toBe('writes to prod need a change ticket');
  });

  it('LAW 2: a transform commits BOTH versions, provenance-marked', async () => {
    const { seen, tool } = recordingTool();
    const agent = Agent.create({
      provider: mock({ replies: callThen('act', { note: 'card 4111111111111111' }) }),
      model: 'm',
    })
      .tools([tool])
      .toolMiddleware({
        name: 'mask-cards',
        onToolCall: (call) => {
          const note = String(call.args.note ?? '');
          const clean = note.replace(/\b\d{16}\b/g, '[card]');
          return clean === note ? allow() : allow({ ...call.args, note: clean }, 'masked a PAN');
        },
      })
      .build();

    await agent.run({ message: 'save this' });

    expect(seen[0]?.note).toBe('card [card]'); // the tool got the scrubbed value
    const row = ledger(agent).find((r) => r.middleware === 'mask-cards');
    expect(row).toMatchObject({ at: 'tool', outcome: 'allow', changed: true, why: 'masked a PAN' });
    expect((row?.before as Record<string, unknown>).note).toBe('card 4111111111111111');
    expect((row?.after as Record<string, unknown>).note).toBe('card [card]');
  });

  it('LAW 1: the union has no result arm — the answer is the real tool output', async () => {
    const { tool } = recordingTool();
    const spy = spyProvider(callThen('act'));
    const agent = Agent.create({ provider: spy.provider, model: 'm' })
      .tools([tool])
      .toolMiddleware({ name: 'watcher', onToolCall: () => allow() })
      .build();

    await agent.run({ message: 'go' });

    const toolResult = spy.requests[1]?.messages.find((m) => m.role === 'tool');
    expect(toolResult?.content).toBe('tool ran');
  });

  it('LAW 7: the first non-allow answer wins — later links do not run', async () => {
    const ran: string[] = [];
    const { tool } = recordingTool();
    const agent = Agent.create({ provider: mock({ replies: callThen('act') }), model: 'm' })
      .tools([tool])
      .toolMiddleware(
        {
          name: 'refuser',
          onToolCall: () => {
            ran.push('refuser');
            return deny('no');
          },
        },
        {
          name: 'never',
          onToolCall: () => {
            ran.push('never');
            return allow();
          },
        },
      )
      .build();

    await agent.run({ message: 'go' });
    expect(ran).toEqual(['refuser']);
  });

  it('LAW 7: a throwing middleware is a denial carrying the error, never a silent allow', async () => {
    const { seen, tool } = recordingTool();
    const spy = spyProvider(callThen('act'));
    const agent = Agent.create({ provider: spy.provider, model: 'm' })
      .tools([tool])
      .toolMiddleware({
        name: 'broken',
        onToolCall: () => {
          throw new Error('policy service unreachable');
        },
      })
      .build();

    const answer = await agent.run({ message: 'go' });

    expect(answer).toBe('done');
    expect(seen).toEqual([]);
    const toolResult = spy.requests[1]?.messages.find((m) => m.role === 'tool');
    expect(toolResult?.content).toContain("middleware 'broken' threw: policy service unreachable");
  });

  it('LAW 7: each link sees the previous link’s output', async () => {
    const { seen, tool } = recordingTool();
    const step = (name: string, add: string): ToolMiddleware => ({
      name,
      onToolCall: (call) =>
        allow({ ...call.args, trail: `${String(call.args.trail ?? '')}${add}` }, `added ${add}`),
    });
    const agent = Agent.create({ provider: mock({ replies: callThen('act') }), model: 'm' })
      .tools([tool])
      .toolMiddleware(step('a', 'A'), step('b', 'B'))
      .build();

    await agent.run({ message: 'go' });
    expect(seen[0]?.trail).toBe('AB');
  });
});

// ─── 3. INTEGRATION — the pause wire and the message boundary ─────

describe('middleware — integration', () => {
  it('LAW 4: ask suspends on the shipped pause machinery and surfaces via isAskPause', async () => {
    const { seen, tool } = recordingTool();
    const agent = Agent.create({
      provider: mock({ replies: callThen('act', { amount: 5000 }) }),
      model: 'm',
    })
      .tools([tool])
      .toolMiddleware({
        name: 'big-spend',
        onToolCall: (call) =>
          Number(call.args.amount) > 1000
            ? ask({ question: `approve $${String(call.args.amount)}?` })
            : allow(),
      })
      .build();

    const paused = await agent.run({ message: 'refund it' });

    expect(isPaused(paused)).toBe(true);
    expect(isAskPause(paused)).toBe(true);
    if (!isAskPause(paused)) throw new Error('unreachable');
    expect(paused.ask).toEqual({ question: 'approve $5000?', middleware: 'big-spend' });
    expect(seen).toEqual([]); // consent comes BEFORE execute
    expect(JSON.parse(JSON.stringify(paused.checkpoint))).toBeTruthy(); // JSON-safe
  });

  it('LAW 4: approving resumes the chain and the REAL tool runs', async () => {
    const { seen, tool } = recordingTool();
    const spy = spyProvider(callThen('act', { amount: 5000 }));
    const agent = Agent.create({ provider: spy.provider, model: 'm' })
      .tools([tool])
      .toolMiddleware({
        name: 'big-spend',
        onToolCall: () => ask({ question: 'approve?' }),
      })
      .build();

    const paused = await agent.run({ message: 'refund it' });
    if (!isAskPause(paused)) throw new Error('expected a pause');
    const answer = await agent.resume(paused.checkpoint, checkInApproved({ by: 'alice' }));

    expect(answer).toBe('done');
    expect(seen).toEqual([{ amount: 5000 }]);
    const toolResult = spy.requests[1]?.messages.find((m) => m.role === 'tool');
    expect(toolResult?.content).toBe('tool ran'); // the tool's own output, not the human's
  });

  it('LAW 4: declining is a denial the model reads — the tool never runs', async () => {
    const { seen, tool } = recordingTool();
    const spy = spyProvider(callThen('act'));
    const agent = Agent.create({ provider: spy.provider, model: 'm' })
      .tools([tool])
      .toolMiddleware({ name: 'gate', onToolCall: () => ask({ question: 'approve?' }) })
      .build();

    const paused = await agent.run({ message: 'go' });
    if (!isAskPause(paused)) throw new Error('expected a pause');
    const answer = await agent.resume(
      paused.checkpoint,
      checkInDeclined({ by: 'alice', note: 'not this one' }),
    );

    expect(answer).toBe('done');
    expect(seen).toEqual([]);
    const toolResult = spy.requests[1]?.messages.find((m) => m.role === 'tool');
    expect(toolResult?.content).toBe('declined by human: not this one');
  });

  it('a malformed resume DECLINES — a governed call never runs off a bad message', async () => {
    const { seen, tool } = recordingTool();
    const agent = Agent.create({ provider: mock({ replies: callThen('act') }), model: 'm' })
      .tools([tool])
      .toolMiddleware({ name: 'gate', onToolCall: () => ask({ question: 'approve?' }) })
      .build();

    const paused = await agent.run({ message: 'go' });
    if (!isAskPause(paused)) throw new Error('expected a pause');
    await agent.resume(paused.checkpoint, 'yes please');

    expect(seen).toEqual([]);
  });

  it('the transformed args — not the model’s originals — are what a person approved', async () => {
    const { seen, tool } = recordingTool();
    const agent = Agent.create({
      provider: mock({ replies: callThen('act', { amount: 5000 }) }),
      model: 'm',
    })
      .tools([tool])
      .toolMiddleware(
        {
          name: 'cap',
          onToolCall: (call) => allow({ ...call.args, amount: 1000 }, 'capped at the policy limit'),
        },
        { name: 'gate', onToolCall: () => ask({ question: 'approve?' }) },
      )
      .build();

    const paused = await agent.run({ message: 'go' });
    if (!isAskPause(paused)) throw new Error('expected a pause');
    await agent.resume(paused.checkpoint, checkInApproved({ by: 'alice' }));

    expect(seen).toEqual([{ amount: 1000 }]);
  });

  it('resume continues the chain from the link AFTER the one that asked', async () => {
    const ran: string[] = [];
    const { seen, tool } = recordingTool();
    const agent = Agent.create({ provider: mock({ replies: callThen('act') }), model: 'm' })
      .tools([tool])
      .toolMiddleware(
        {
          name: 'gate',
          onToolCall: () => {
            ran.push('gate');
            return ask({ question: 'approve?' });
          },
        },
        {
          name: 'after',
          onToolCall: (call) => {
            ran.push('after');
            return allow({ ...call.args, tagged: true }, 'tagged post-approval');
          },
        },
      )
      .build();

    const paused = await agent.run({ message: 'go' });
    if (!isAskPause(paused)) throw new Error('expected a pause');
    await agent.resume(paused.checkpoint, checkInApproved({ by: 'alice' }));

    expect(ran).toEqual(['gate', 'after']); // 'gate' asked once, not twice
    expect(seen).toEqual([{ tagged: true }]);
  });

  it('a SECOND ask during a resume refuses by name — one human question per resume', async () => {
    const { seen, tool } = recordingTool();
    const spy = spyProvider(callThen('act'));
    const agent = Agent.create({ provider: spy.provider, model: 'm' })
      .tools([tool])
      .toolMiddleware(
        { name: 'first-gate', onToolCall: () => ask({ question: 'approve once?' }) },
        { name: 'second-gate', onToolCall: () => ask({ question: 'approve twice?' }) },
      )
      .build();

    const paused = await agent.run({ message: 'go' });
    if (!isAskPause(paused)) throw new Error('expected a pause');
    await agent.resume(paused.checkpoint, checkInApproved({ by: 'alice' }));

    expect(seen).toEqual([]); // never executed ungoverned
    const toolResult = spy.requests[1]?.messages.find((m) => m.role === 'tool');
    expect(toolResult?.content).toContain("middleware 'second-gate' asked a person to decide");
  });

  it('an approved ask on a tool that ALSO declares checkIn refuses rather than skipping consent', async () => {
    const seen: unknown[] = [];
    const tool = defineTool<Record<string, unknown>, string>({
      name: 'act',
      description: 'x',
      inputSchema: { type: 'object', properties: {} },
      checkIn: 'always',
      execute: (args) => {
        seen.push(args);
        return 'ran';
      },
    });
    const spy = spyProvider(callThen('act'));
    const agent = Agent.create({ provider: spy.provider, model: 'm' })
      .tools([tool])
      .toolMiddleware({ name: 'gate', onToolCall: () => ask({ question: 'approve?' }) })
      .build();

    const paused = await agent.run({ message: 'go' });
    if (!isAskPause(paused)) throw new Error('expected a pause');
    await agent.resume(paused.checkpoint, checkInApproved({ by: 'alice' }));

    expect(seen).toEqual([]);
    const toolResult = spy.requests[1]?.messages.find((m) => m.role === 'tool');
    expect(toolResult?.content).toContain('also declares checkIn');
  });

  it('LAW 8: an input transform is what the model, the history and the ledger all see', async () => {
    const spy = spyProvider(['answered']);
    const agent = Agent.create({ provider: spy.provider, model: 'm' })
      .messageMiddleware({
        name: 'scrub-ssn',
        onMessage: (msg) => {
          const clean = msg.content.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]');
          return clean === msg.content ? allow() : allow(clean, 'masked a US SSN');
        },
      })
      .build();

    await agent.run({ message: 'my ssn is 123-45-6789' });

    // What went on the wire.
    const userMsg = spy.requests[0]?.messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toBe('my ssn is [ssn]');
    // What the run committed — the same string, so no component disagrees.
    const state = agent.getLastSnapshot()?.sharedState as { userMessage: string };
    expect(state.userMessage).toBe('my ssn is [ssn]');
    // And the ledger says it happened.
    const row = ledger(agent)[0];
    expect(row).toMatchObject({
      at: 'message',
      phase: 'input',
      changed: true,
      why: 'masked a US SSN',
      before: 'my ssn is 123-45-6789',
      after: 'my ssn is [ssn]',
    });
  });

  it('an output transform is what BOTH the caller and the record receive', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'call me at 555-1234' }), model: 'm' })
      .messageMiddleware({
        name: 'strip-phones',
        onMessage: (msg) =>
          msg.phase === 'output'
            ? allow(msg.content.replace(/\d{3}-\d{4}/g, '[phone]'), 'removed a phone number')
            : allow(),
      })
      .build();

    const answer = await agent.run({ message: 'hi' });

    expect(answer).toBe('call me at [phone]');
    // …and the run's own record says the same thing. `llmLatestContent` is the
    // committed value PrepareFinal copies into `finalContent`, so a reader of
    // the trace and the caller cannot disagree about what the answer was.
    const state = agent.getLastSnapshot()?.sharedState as { llmLatestContent: string };
    expect(state.llmLatestContent).toBe('call me at [phone]');
  });

  it('deny at input raises MessageDeniedError and never calls the model', async () => {
    const spy = spyProvider(['unreachable']);
    const agent = Agent.create({ provider: spy.provider, model: 'm' })
      .messageMiddleware({ name: 'no-secrets', onMessage: () => deny('contains a secret') })
      .build();

    await expect(agent.run({ message: 'sk-live-abc' })).rejects.toThrow(MessageDeniedError);
    expect(spy.requests).toEqual([]);
  });

  it('deny at output raises rather than handing the caller the refusal as an answer', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'the secret is 42' }), model: 'm' })
      .messageMiddleware({
        name: 'no-leaks',
        onMessage: (msg) => (msg.phase === 'output' ? deny('answer leaked a secret') : allow()),
      })
      .build();

    const error = await agent.run({ message: 'tell me' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MessageDeniedError);
    const denied = error as MessageDeniedError;
    expect(denied.phase).toBe('output');
    expect(denied.middleware).toBe('no-leaks');
    expect(denied.reason).toBe('answer leaked a secret');
    // The refused content never rides out on the error.
    expect(JSON.stringify({ ...denied, message: denied.message })).not.toContain('42');
  });

  it('emits one agentfootprint.middleware.decision per row', async () => {
    const seenEvents: { middleware: string; outcome: string }[] = [];
    const { tool } = recordingTool();
    const agent = Agent.create({ provider: mock({ replies: callThen('act') }), model: 'm' })
      .tools([tool])
      .toolMiddleware({ name: 'watcher', onToolCall: () => allow() })
      .build();
    agent.on('agentfootprint.middleware.decision', (e) =>
      seenEvents.push({ middleware: e.payload.middleware, outcome: e.payload.outcome }),
    );

    await agent.run({ message: 'go' });
    expect(seenEvents).toEqual([{ middleware: 'watcher', outcome: 'allow' }]);
  });
});

// ─── 4. PROPERTY — invariants over generated chains ───────────────

describe('middleware — property', () => {
  it('over any chain of pass-through links, the args reach the tool unchanged', async () => {
    for (const size of [0, 1, 2, 5, 12]) {
      const { seen, tool } = recordingTool();
      const chain: ToolMiddleware[] = Array.from({ length: size }, (_, i) => ({
        name: `noop-${i}`,
        onToolCall: () => allow(),
      }));
      const agent = Agent.create({
        provider: mock({ replies: callThen('act', { a: 1, b: 'two' }) }),
        model: 'm',
      })
        .tools([tool])
        .toolMiddleware(...chain)
        .build();

      await agent.run({ message: 'go' });
      expect(seen).toEqual([{ a: 1, b: 'two' }]);
      expect(ledger(agent)).toHaveLength(size);
    }
  });

  it('a deny at position k runs exactly k+1 links, whatever k is', async () => {
    for (const k of [0, 1, 3, 6]) {
      const ran: string[] = [];
      const { tool } = recordingTool();
      const chain: ToolMiddleware[] = Array.from({ length: 8 }, (_, i) => ({
        name: `l-${i}`,
        onToolCall: () => {
          ran.push(`l-${i}`);
          return i === k ? deny('stop') : allow();
        },
      }));
      const agent = Agent.create({ provider: mock({ replies: callThen('act') }), model: 'm' })
        .tools([tool])
        .toolMiddleware(...chain)
        .build();

      await agent.run({ message: 'go' });
      expect(ran).toHaveLength(k + 1);
    }
  });

  it('LAW 10: the same chain on two mock adapters produces identical ledgers', async () => {
    const build = () =>
      Agent.create({ provider: mock({ replies: callThen('act', { n: 7 }) }), model: 'm' })
        .tools([recordingTool().tool])
        .toolMiddleware({
          name: 'double',
          onToolCall: (call) => allow({ ...call.args, n: Number(call.args.n) * 2 }, 'doubled'),
        })
        .messageMiddleware({
          name: 'shout',
          onMessage: (m) => allow(m.content.toUpperCase(), 'up'),
        })
        .build();

    const a = build();
    const b = build();
    await a.run({ message: 'go' });
    await b.run({ message: 'go' });

    expect(ledger(a)).toEqual(ledger(b));
  });
});

// ─── 5. SECURITY — honesty and protection meet here ───────────────

describe('middleware — security', () => {
  it('LAW 5: a PermissionChecker still decides FIRST — its denial means no middleware runs', async () => {
    const ran: string[] = [];
    const { seen, tool } = recordingTool();
    const checker: PermissionChecker = {
      name: 'always-deny',
      check: async () => ({ result: 'deny', rationale: 'policy' }),
    };
    const agent = Agent.create({
      provider: mock({ replies: callThen('act') }),
      model: 'm',
      permissionChecker: checker,
    })
      .tools([tool])
      .toolMiddleware({
        name: 'never-reached',
        onToolCall: () => {
          ran.push('mw');
          return allow();
        },
      })
      .build();

    await agent.run({ message: 'go' });

    expect(ran).toEqual([]);
    expect(seen).toEqual([]);
    expect(ledger(agent)).toEqual([]);
  });

  it('LAW 5: an existing checker behaves identically with and without a chain attached', async () => {
    const build = (withChain: boolean) => {
      const checker: PermissionChecker = {
        name: 'deny-writes',
        check: async (req) => (req.target === 'act' ? { result: 'deny' } : { result: 'allow' }),
      };
      const spy = spyProvider(callThen('act'));
      let builder = Agent.create({
        provider: spy.provider,
        model: 'm',
        permissionChecker: checker,
      }).tools([recordingTool().tool]);
      if (withChain) {
        builder = builder.toolMiddleware({ name: 'watcher', onToolCall: () => allow() });
      }
      return { agent: builder.build(), spy };
    };

    const bare = build(false);
    const chained = build(true);
    await bare.agent.run({ message: 'go' });
    await chained.agent.run({ message: 'go' });

    const toolResult = (s: ReturnType<typeof spyProvider>) =>
      s.requests[1]?.messages.find((m) => m.role === 'tool')?.content;
    expect(toolResult(chained.spy)).toBe(toolResult(bare.spy));
  });

  it('redaction over the ledger scrubs before/after while the decision row survives', async () => {
    // Honesty and protection are both laws, and this is where they meet. The
    // run must still say a scrub happened — who did it, why, and that the
    // value changed — WITHOUT the commit log holding the value that was
    // scrubbed. footprintjs redaction over the ledger key is what makes both
    // true at once, and this pins that it does.
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' })
      .messageMiddleware({
        name: 'scrub-ssn',
        onMessage: (msg) => {
          const clean = msg.content.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]');
          return clean === msg.content ? allow() : allow(clean, 'masked a US SSN');
        },
      })
      .build();

    // `redact` is a footprintjs executor policy; reach it through the same
    // internal seam the checkpoint tests use.
    const withPolicy = agent as unknown as {
      createExecutor(): {
        setRedactionPolicy(p: { keys: string[] }): void;
        run(input: unknown): Promise<unknown>;
        getSnapshot(): { sharedState: Record<string, unknown>; commitLog: readonly unknown[] };
      };
    };
    const executor = withPolicy.createExecutor();
    executor.setRedactionPolicy({ keys: ['middlewareDecisions'] });
    await executor.run({ message: 'ssn 123-45-6789' });
    const snap = executor.getSnapshot();

    // Half one — protection: the pre-scrub text is nowhere in the record.
    expect(JSON.stringify(snap.commitLog)).not.toContain('123-45-6789');

    // Half two — honesty: the run still says a scrub happened.
    const raw = JSON.stringify(snap.commitLog);
    expect(raw).toContain('middlewareDecisions');
  });

  it('the middleware.decision event never carries the values, only the fact', async () => {
    const payloads: Record<string, unknown>[] = [];
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' })
      .messageMiddleware({
        name: 'scrub',
        onMessage: (msg) =>
          msg.phase === 'input'
            ? allow(msg.content.replace(/secret/g, '[x]'), 'scrubbed')
            : allow(),
      })
      .build();
    agent.on('agentfootprint.middleware.decision', (e) =>
      payloads.push(e.payload as unknown as Record<string, unknown>),
    );

    await agent.run({ message: 'the secret is here' });

    for (const p of payloads) {
      expect(p).not.toHaveProperty('before');
      expect(p).not.toHaveProperty('after');
      expect(JSON.stringify(p)).not.toContain('secret');
    }
  });
});

// ─── 6. PERFORMANCE — the absent-chain pin ────────────────────────

describe('middleware — performance', () => {
  it('LAW 6: absent middleware writes no ledger key and sends the same request bytes', async () => {
    const bare = spyProvider(callThen('act'));
    const bareAgent = Agent.create({ provider: bare.provider, model: 'm' })
      .tools([recordingTool().tool])
      .build();
    await bareAgent.run({ message: 'go' });

    const chained = spyProvider(callThen('act'));
    const chainedAgent = Agent.create({ provider: chained.provider, model: 'm' })
      .tools([recordingTool().tool])
      .toolMiddleware({ name: 'noop', onToolCall: () => allow() })
      .build();
    await chainedAgent.run({ message: 'go' });

    // Same wire.
    expect(JSON.stringify(chained.requests)).toBe(JSON.stringify(bare.requests));
    // Different record: the bare agent never mentions the ledger key.
    expect(committedKeys(bareAgent)).not.toContain('middlewareDecisions');
    expect(committedKeys(chainedAgent)).toContain('middlewareDecisions');
    const bareState = bareAgent.getLastSnapshot()?.sharedState as Record<string, unknown>;
    expect('middlewareDecisions' in bareState).toBe(false);
  });

  it('a chain of 50 pass-through links costs one walk, not one per link per iteration', async () => {
    let calls = 0;
    const chain: ToolMiddleware[] = Array.from({ length: 50 }, (_, i) => ({
      name: `l-${i}`,
      onToolCall: () => {
        calls++;
        return allow();
      },
    }));
    const agent = Agent.create({ provider: mock({ replies: callThen('act') }), model: 'm' })
      .tools([recordingTool().tool])
      .toolMiddleware(...chain)
      .build();

    await agent.run({ message: 'go' });
    expect(calls).toBe(50); // one dispatch → exactly one walk
  });
});

// ─── 7. ROI — what the feature is for ─────────────────────────────

describe('middleware — ROI', () => {
  it('one chain governs every tool, without editing a single tool', async () => {
    const tools = ['alpha', 'beta', 'gamma'].map((n) =>
      defineTool({
        name: n,
        description: n,
        inputSchema: { type: 'object', properties: {} },
        execute: () => `${n} ran`,
      }),
    );
    const governed: string[] = [];
    const agent = Agent.create({
      provider: mock({
        replies: [
          {
            toolCalls: [
              { id: 'a', name: 'alpha', args: {} },
              { id: 'b', name: 'beta', args: {} },
              { id: 'g', name: 'gamma', args: {} },
            ],
          },
          { content: 'done' },
        ],
      }),
      model: 'm',
    })
      .tools(tools)
      .toolMiddleware({
        name: 'audit',
        onToolCall: (call) => {
          governed.push(call.toolName);
          return allow();
        },
      })
      .build();

    await agent.run({ message: 'go' });
    expect(governed).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('the ledger answers "was this run scrubbed, and by whom?" without re-running anything', async () => {
    const scrub: MessageMiddleware = {
      name: 'pii-scrub',
      onMessage: (msg) => {
        const clean = msg.content.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]');
        return clean === msg.content ? allow() : allow(clean, 'masked a US SSN');
      },
    };
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' })
      .messageMiddleware(scrub)
      .build();

    await agent.run({ message: 'ssn 123-45-6789' });

    const changes = ledger(agent).filter((r) => r.changed);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.middleware).toBe('pii-scrub');
    expect(changes[0]?.why).toBe('masked a US SSN');
  });
});
