/**
 * `.configure()` — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Three laws carry this feature, and each has its own block below:
 *   1. resolution happens ONCE per run;
 *   2. the committed record carries what was resolved (and the LLM call
 *      uses that committed value, not a second copy);
 *   3. absent option = byte-identical behavior.
 */

import { describe, expect, it, vi } from 'vitest';
import { commitValueAt } from 'footprintjs/trace';

import { Agent } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import type { LLMRequest, LLMResponse } from '../../src/adapters/types.js';

// ─── Helpers ──────────────────────────────────────────────────────

/** A mock provider that records every request it is handed. */
function spyProvider(replies: (string | Partial<LLMResponse>)[] = ['ok']) {
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

/** Every key any commit bundle touched, across the whole run. */
function committedKeys(agent: Agent): string[] {
  const log = agent.getLastSnapshot()?.commitLog ?? [];
  const keys = new Set<string>();
  for (const bundle of log) {
    for (const key of Object.keys(bundle.overwrite ?? {})) keys.add(key);
    for (const key of Object.keys(bundle.updates ?? {})) keys.add(key);
  }
  return [...keys].sort();
}

// ─── Unit — the builder surface ───────────────────────────────────

describe('.configure() — unit', () => {
  it('is fluent and returns the builder', () => {
    const builder = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' });
    expect(builder.configure(() => ({}))).toBe(builder);
  });

  it('throws when set twice — a silently-overridden resolver is a config that lies', () => {
    const builder = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).configure(
      () => ({}),
    );
    expect(() => builder.configure(() => ({}))).toThrow(/already set/);
  });

  it('throws when handed something that is not a function', () => {
    const builder = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' });
    expect(() => builder.configure('big-model' as never)).toThrow(/expected a function/);
  });

  it('gives the resolver the message, the runId and the build-time defaults', async () => {
    const seen: unknown[] = [];
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'built-model' })
      .system('BUILT INSTRUCTIONS')
      .configure((ctx) => {
        seen.push(ctx);
        return {};
      })
      .build();

    await agent.run({ message: 'hello there' });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      message: 'hello there',
      defaults: { model: 'built-model', instructions: 'BUILT INSTRUCTIONS' },
    });
    expect((seen[0] as { runId: string }).runId).toMatch(/\S/);
  });

  it('passes run({ identity }) through to the resolver', async () => {
    let tenant: string | undefined;
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' })
      .configure((ctx) => {
        tenant = ctx.identity?.tenant;
        return {};
      })
      .build();

    await agent.run({ message: 'hi', identity: { tenant: 'acme', conversationId: 'c1' } });

    expect(tenant).toBe('acme');
  });
});

// ─── Scenario — what it changes ───────────────────────────────────

describe('.configure() — scenario', () => {
  it('a resolved model is the one the provider is actually called with', async () => {
    const { provider, requests } = spyProvider(['ok']);
    const agent = Agent.create({ provider, model: 'small-model' })
      .configure(({ message }) => (message.length > 20 ? { model: 'big-model' } : {}))
      .build();

    await agent.run({ message: 'a'.repeat(50) });

    expect(requests[0]?.model).toBe('big-model');
  });

  it('a short message keeps the built-in model', async () => {
    const { provider, requests } = spyProvider(['ok']);
    const agent = Agent.create({ provider, model: 'small-model' })
      .configure(({ message }) => (message.length > 20 ? { model: 'big-model' } : {}))
      .build();

    await agent.run({ message: 'short' });

    expect(requests[0]?.model).toBe('small-model');
  });

  it('resolved instructions REPLACE the .system() prompt for that run', async () => {
    const { provider, requests } = spyProvider(['ok']);
    const agent = Agent.create({ provider, model: 'm' })
      .system('BUILT INSTRUCTIONS')
      .configure(({ defaults }) => ({ instructions: `${defaults.instructions}\nTENANT RULE` }))
      .build();

    await agent.run({ message: 'hi' });

    expect(requests[0]?.systemPrompt).toContain('BUILT INSTRUCTIONS');
    expect(requests[0]?.systemPrompt).toContain('TENANT RULE');
  });

  it('returning nothing at all keeps both defaults', async () => {
    const { provider, requests } = spyProvider(['ok']);
    const agent = Agent.create({ provider, model: 'built-model' })
      .system('BUILT')
      .configure(() => undefined)
      .build();

    await agent.run({ message: 'hi' });

    expect(requests[0]?.model).toBe('built-model');
    expect(requests[0]?.systemPrompt).toContain('BUILT');
  });

  it('the context record names Agent.configure() when it supplied the prompt', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' })
      .system('BUILT')
      .configure(() => ({ instructions: 'PER RUN' }))
      .build();

    const reasons: string[] = [];
    agent.on('agentfootprint.context.injected', (e) => {
      const reason = (e.payload as { reason?: string }).reason;
      if (reason) reasons.push(reason);
    });
    await agent.run({ message: 'hi' });

    expect(reasons).toContain('Agent.configure()');
  });
});

// ─── Integration — law 1 + law 2 ──────────────────────────────────

describe('.configure() — integration (the laws)', () => {
  it('LAW 1: the resolver runs exactly once per run, across many ReAct iterations', async () => {
    const resolver = vi.fn(() => ({ model: 'chosen-model' }));
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 't1', name: 'ping', args: {} }] },
          { toolCalls: [{ id: 't2', name: 'ping', args: {} }] },
          { content: 'done' },
        ],
      }),
      model: 'built-model',
    })
      .tool({
        schema: { name: 'ping', description: 'ping', inputSchema: { type: 'object' } },
        execute: () => 'pong',
      })
      .configure(resolver)
      .build();

    await agent.run({ message: 'go' });

    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('LAW 1: a second run re-resolves — once more, with that run own message', async () => {
    const seen: string[] = [];
    const agent = Agent.create({ provider: mock({ replies: ['a', 'b'] }), model: 'm' })
      .configure(({ message }) => {
        seen.push(message);
        return {};
      })
      .build();

    await agent.run({ message: 'first' });
    await agent.run({ message: 'second' });

    expect(seen).toEqual(['first', 'second']);
  });

  it('LAW 2: what was resolved is COMMITTED, and the commit log can be replayed for it', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'built-model' })
      .system('BUILT')
      .configure(() => ({ model: 'chosen-model', instructions: 'PER RUN' }))
      .build();

    await agent.run({ message: 'hi' });

    const log = agent.getLastSnapshot()?.commitLog ?? [];
    const last = log[log.length - 1];
    expect(commitValueAt(log, last!.idx, 'resolvedModel')).toBe('chosen-model');
    expect(commitValueAt(log, last!.idx, 'resolvedInstructions')).toBe('PER RUN');
  });

  it('LAW 2: the llm_start event reports the resolved model, not the built one', async () => {
    const models: string[] = [];
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'built-model' })
      .configure(() => ({ model: 'chosen-model' }))
      .build();
    agent.on('agentfootprint.stream.llm_start', (e) => {
      models.push((e.payload as { model: string }).model);
    });

    await agent.run({ message: 'hi' });

    expect(models).toEqual(['chosen-model']);
  });

  it('LAW 2: cost is priced against the resolved model', async () => {
    const priced: string[] = [];
    const agent = Agent.create({
      provider: mock({ reply: 'ok' }),
      model: 'built-model',
      pricingTable: {
        pricePerToken: (model: string) => {
          priced.push(model);
          return 0.000_001;
        },
      },
    })
      .configure(() => ({ model: 'chosen-model' }))
      .build();

    await agent.run({ message: 'hi' });

    expect(priced).toContain('chosen-model');
    expect(priced).not.toContain('built-model');
  });

  it('the resolved model holds for EVERY iteration of the loop, not just the first', async () => {
    const { provider, requests } = spyProvider([
      { toolCalls: [{ id: 't1', name: 'ping', args: {} }] },
      { content: 'done' },
    ]);
    const agent = Agent.create({ provider, model: 'built-model' })
      .tool({
        schema: { name: 'ping', description: 'ping', inputSchema: { type: 'object' } },
        execute: () => 'pong',
      })
      .configure(() => ({ model: 'chosen-model' }))
      .build();

    await agent.run({ message: 'go' });

    expect(requests.map((r) => r.model)).toEqual(['chosen-model', 'chosen-model']);
  });

  it.each(['dynamic', 'dynamic-grouped', 'classic'] as const)(
    'works in reactMode %s',
    async (reactMode) => {
      const { provider, requests } = spyProvider(['ok']);
      const agent = Agent.create({ provider, model: 'built-model', reactMode })
        .system('BUILT')
        .configure(() => ({ model: 'chosen-model', instructions: 'PER RUN' }))
        .build();

      await agent.run({ message: 'hi' });

      expect(requests[0]?.model).toBe('chosen-model');
      expect(requests[0]?.systemPrompt).toContain('PER RUN');
      expect(requests[0]?.systemPrompt).not.toContain('BUILT');
    },
  );
});

// ─── Property — law 3 ─────────────────────────────────────────────

describe('.configure() — property (law 3: absent = unchanged)', () => {
  it('LAW 3: without .configure(), the run commits exactly the keys it always did', async () => {
    const withOut = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' })
      .system('BUILT')
      .build();
    await withOut.run({ message: 'hi' });

    expect(committedKeys(withOut)).not.toContain('resolvedModel');
    expect(committedKeys(withOut)).not.toContain('resolvedInstructions');
  });

  it('LAW 3: a resolver that changes nothing commits nothing extra either', async () => {
    const baseline = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' })
      .system('BUILT')
      .build();
    const configured = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' })
      .system('BUILT')
      .configure(() => ({}))
      .build();

    await baseline.run({ message: 'hi' });
    await configured.run({ message: 'hi' });

    expect(committedKeys(configured)).toEqual(committedKeys(baseline));
  });

  it('LAW 3: without .configure(), request bytes match a plain agent exactly', async () => {
    const a = spyProvider(['ok']);
    const b = spyProvider(['ok']);
    const plain = Agent.create({ provider: a.provider, model: 'm' }).system('BUILT').build();
    const configured = Agent.create({ provider: b.provider, model: 'm' })
      .system('BUILT')
      .configure(() => ({}))
      .build();

    await plain.run({ message: 'hi' });
    await configured.run({ message: 'hi' });

    expect(JSON.stringify(b.requests)).toBe(JSON.stringify(a.requests));
  });

  it('an empty-string instructions override really does empty the base prompt', async () => {
    const { provider, requests } = spyProvider(['ok']);
    const agent = Agent.create({ provider, model: 'm' })
      .system('BUILT')
      .configure(() => ({ instructions: '' }))
      .build();

    await agent.run({ message: 'hi' });

    expect(requests[0]?.systemPrompt ?? '').not.toContain('BUILT');
  });
});

// ─── Security — the trace cannot be talked out of the truth ───────

describe('.configure() — security', () => {
  it('a resolver that throws fails the run loudly rather than silently using defaults', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' })
      .configure(() => {
        throw new Error('config service is down');
      })
      .build();

    await expect(agent.run({ message: 'hi' })).rejects.toThrow(/config service is down/);
  });

  it('a resolver cannot reach past model/instructions into the rest of the run', async () => {
    const { provider, requests } = spyProvider(['ok']);
    const agent = Agent.create({ provider, model: 'm', temperature: 0.3, maxTokens: 111 })
      .configure(
        () =>
          ({
            model: 'chosen-model',
            temperature: 0.99,
            maxTokens: 1,
            tools: [],
          }) as never,
      )
      .build();

    await agent.run({ message: 'hi' });

    expect(requests[0]?.model).toBe('chosen-model');
    expect(requests[0]?.temperature).toBe(0.3);
    expect(requests[0]?.maxTokens).toBe(111);
  });

  it('mutating the ctx.defaults a resolver was handed does not change later runs', async () => {
    const seen: string[] = [];
    const agent = Agent.create({ provider: mock({ replies: ['a', 'b'] }), model: 'built-model' })
      .configure((ctx) => {
        seen.push(ctx.defaults.model);
        (ctx.defaults as { model: string }).model = 'tampered';
        return {};
      })
      .build();

    await agent.run({ message: 'one' });
    await agent.run({ message: 'two' });

    expect(seen).toEqual(['built-model', 'built-model']);
  });
});

// ─── Performance ──────────────────────────────────────────────────

describe('.configure() — performance', () => {
  it('the resolver is not on the per-iteration path: 1 call for a 5-iteration run', async () => {
    const resolver = vi.fn(() => ({ model: 'chosen-model' }));
    const replies = Array.from({ length: 4 }, (_, i) => ({
      toolCalls: [{ id: `t${i}`, name: 'ping', args: {} }],
    }));
    const agent = Agent.create({
      provider: mock({ replies: [...replies, { content: 'done' }] }),
      model: 'm',
    })
      .tool({
        schema: { name: 'ping', description: 'ping', inputSchema: { type: 'object' } },
        execute: () => 'pong',
      })
      .configure(resolver)
      .build();

    await agent.run({ message: 'go' });

    expect(resolver).toHaveBeenCalledTimes(1);
  });
});

// ─── ROI — what it replaces ───────────────────────────────────────

describe('.configure() — ROI', () => {
  it('one agent serves two tenants with different rules — no rebuild, and the trace says which', async () => {
    const rules: Record<string, string> = {
      acme: 'ACME never discloses pricing.',
      globex: 'GLOBEX answers in French.',
    };
    const { provider, requests } = spyProvider(['a', 'b']);
    const agent = Agent.create({ provider, model: 'm' })
      .system('You answer support questions.')
      .configure(({ identity, defaults }) => ({
        instructions: `${defaults.instructions}\n${rules[identity?.tenant ?? ''] ?? ''}`,
      }))
      .build();

    await agent.run({ message: 'hi', identity: { tenant: 'acme', conversationId: 'c1' } });
    const acmeCommitted = agent.getLastSnapshot()?.sharedState as { resolvedInstructions?: string };
    const acmeInstructions = acmeCommitted.resolvedInstructions;

    await agent.run({ message: 'hi', identity: { tenant: 'globex', conversationId: 'c2' } });
    const globexCommitted = agent.getLastSnapshot()?.sharedState as {
      resolvedInstructions?: string;
    };

    expect(requests[0]?.systemPrompt).toContain('never discloses pricing');
    expect(requests[1]?.systemPrompt).toContain('answers in French');
    // The recording of each run carries the rules THAT run actually used.
    expect(acmeInstructions).toContain('never discloses pricing');
    expect(globexCommitted.resolvedInstructions).toContain('answers in French');
  });
});
