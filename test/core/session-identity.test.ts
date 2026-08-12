/**
 * A SESSION IS A CONVERSATION (9.10.0) — the memory identity a run gets when
 * the caller named none.
 *
 * The laws being pinned:
 *   • A run with `sessionId` and no `identity` is namespaced
 *     `{ conversationId: sessionId }`, so two turns of one session share a
 *     namespace and a registered `.memory()` recalls the first turn in the
 *     second. Before this, every turn got `{ conversationId: '<runId>' }` — a
 *     fresh namespace per turn — and the recall was silently empty.
 *   • AN EXPLICIT IDENTITY ALWAYS WINS, including over a session.
 *   • NO SESSION AND NO IDENTITY IS UNCHANGED, to the committed key: the
 *     per-run default, and no `runIdentitySource` at all.
 *   • THE DERIVATION IS VISIBLE BUT NOT CLAIMED AS THE CALLER'S. It is recorded
 *     as `runIdentitySource: 'session'`, and it still does NOT reach
 *     `tool.execute` as `ctx.identity` — "absent" keeps meaning "nobody named
 *     one".
 *
 * Test types (Convention 3): unit · scenario (two turns, real recall) ·
 * integration (through `standingAgent`) · regression (the per-turn namespace) ·
 * security (a synthesized identity is never published to a tool) · property
 * (explicit always wins, whichever door it came through) · boundary (no
 * session, no identity).
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { defineMemory, MEMORY_STRATEGIES, MEMORY_TYPES } from '../../src/memory/index.js';
import { InMemoryStore } from '../../src/memory/store/index.js';
import { memorySessions, standingAgent } from '../../src/hosting/index.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../src/adapters/types.js';
import { inProcessHost } from '../hosting/testHost.js';

/** A provider that answers once per call and keeps every request it was handed. */
function capturingProvider(reply: string): { provider: LLMProvider; requests: LLMRequest[] } {
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      name: 'capture',
      complete(req: LLMRequest): Promise<LLMResponse> {
        requests.push(req);
        return Promise.resolve({ content: reply, toolCalls: [], usage: { input: 1, output: 1 } });
      },
    },
  };
}

/** What the run committed as its identity, and where it says that came from. */
function identityOf(agent: Agent): {
  conversationId?: string;
  source?: string;
} {
  const state = agent.getLastSnapshot()?.sharedState as
    | { runIdentity?: { conversationId?: string }; runIdentitySource?: string }
    | undefined;
  return {
    ...(state?.runIdentity?.conversationId !== undefined && {
      conversationId: state.runIdentity.conversationId,
    }),
    ...(state?.runIdentitySource !== undefined && { source: state.runIdentitySource }),
  };
}

// ─── unit: the three rungs of the ladder ─────────────────────────────

describe('run identity — where it comes from', () => {
  it('a session and no identity ⇒ the session IS the conversation', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).build();
    await agent.run({ message: 'hello' }, { sessionId: 'sess-42' });
    expect(identityOf(agent)).toEqual({ conversationId: 'sess-42', source: 'session' });
  });

  it('an explicit identity wins over the session, and is NOT marked derived', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).build();
    await agent.run(
      { message: 'hello', identity: { tenant: 'acme', conversationId: 'chosen' } },
      { sessionId: 'sess-42' },
    );
    expect(identityOf(agent)).toEqual({ conversationId: 'chosen' });
  });

  it('an identity on the OPTIONS bag wins too — whichever door it came through', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).build();
    await agent.run(
      { message: 'hello' },
      { sessionId: 'sess-42', identity: { conversationId: 'from-options' } },
    );
    expect(identityOf(agent)).toEqual({ conversationId: 'from-options' });
  });

  it('BOUNDARY — no session and no identity is exactly what it always was', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).build();
    await agent.run({ message: 'hello' });
    const seen = identityOf(agent);
    // The per-run default, unchanged since 1.x…
    expect(seen.conversationId).toMatch(/^run-/);
    // …and NOTHING extra committed. A key that appeared on every run would
    // change the commit log of every agent that never asked for any of this.
    expect(seen.source).toBeUndefined();
    const state = agent.getLastSnapshot()?.sharedState as Record<string, unknown>;
    expect('runIdentitySource' in state).toBe(false);
  });

  it('two runs of ONE session land in ONE namespace — the regression, stated', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).build();
    await agent.run({ message: 'one' }, { sessionId: 'sess-7' });
    const first = identityOf(agent).conversationId;
    await agent.run({ message: 'two' }, { sessionId: 'sess-7' });
    const second = identityOf(agent).conversationId;
    expect(first).toBe('sess-7');
    expect(second).toBe('sess-7');
  });
});

// ─── scenario: the thing it was actually for ─────────────────────────

describe('run identity — a served session remembers', () => {
  it('turn 2 of a session recalls turn 1, with no identity configured anywhere', async () => {
    const { provider, requests } = capturingProvider('ok');
    const agent = Agent.create({ provider, model: 'm', maxIterations: 1 })
      .system('You remember the user.')
      .memory(
        defineMemory({
          id: 'chat',
          type: MEMORY_TYPES.EPISODIC,
          strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
          store: new InMemoryStore(),
        }),
      )
      .build();

    await agent.run({ message: 'My favourite colour is vermilion.' }, { sessionId: 'sess-9' });
    requests.length = 0;
    await agent.run({ message: 'What is my favourite colour?' }, { sessionId: 'sess-9' });

    // THE PAYOFF: the first turn is in the second turn's system prompt,
    // recalled out of the store under the session's own namespace.
    const systemPrompt = requests[0]?.systemPrompt ?? '';
    expect(systemPrompt).toContain('vermilion');
  });

  it('two DIFFERENT sessions never recall each other', async () => {
    const { provider, requests } = capturingProvider('ok');
    const agent = Agent.create({ provider, model: 'm', maxIterations: 1 })
      .system('You remember the user.')
      .memory(
        defineMemory({
          id: 'chat',
          type: MEMORY_TYPES.EPISODIC,
          strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
          store: new InMemoryStore(),
        }),
      )
      .build();

    await agent.run({ message: 'My name is Ada.' }, { sessionId: 'sess-a' });
    requests.length = 0;
    await agent.run({ message: 'Who am I?' }, { sessionId: 'sess-b' });

    expect(requests[0]?.systemPrompt ?? '').not.toContain('Ada');
  });
});

// ─── security: a synthesized namespace is never published as identity ─

describe('run identity — what a tool is told', () => {
  it('a DERIVED identity does not reach ctx.identity — absent still means "nobody named one"', async () => {
    const seen: Array<{ identity?: unknown; sessionId?: string }> = [];
    const tool = defineTool<Record<string, never>, string>({
      name: 'probe',
      description: 'reports what it was told',
      execute: (_args, ctx) => {
        seen.push({
          ...(ctx.identity !== undefined && { identity: ctx.identity }),
          ...(ctx.sessionId !== undefined && { sessionId: ctx.sessionId }),
        });
        return 'noted';
      },
    });
    const agent = Agent.create({
      provider: mock({
        replies: [{ toolCalls: [{ id: 'tc-1', name: 'probe', args: {} }] }, { content: 'done' }],
      }),
      model: 'm',
    })
      .tool(tool)
      .build();

    await agent.run({ message: 'go' }, { sessionId: 'sess-3' });

    expect(seen).toHaveLength(1);
    // The SESSION is a fact the transport delivered, so the tool gets it…
    expect(seen[0]?.sessionId).toBe('sess-3');
    // …and the namespace derived FROM it is not a fact anybody stated, so it
    // is not published as though somebody had.
    expect(seen[0]?.identity).toBeUndefined();
  });

  it('an identity the CALLER passed does reach ctx.identity, unchanged', async () => {
    const seen: unknown[] = [];
    const tool = defineTool<Record<string, never>, string>({
      name: 'probe',
      description: 'reports what it was told',
      execute: (_args, ctx) => {
        seen.push(ctx.identity);
        return 'noted';
      },
    });
    const agent = Agent.create({
      provider: mock({
        replies: [{ toolCalls: [{ id: 'tc-1', name: 'probe', args: {} }] }, { content: 'done' }],
      }),
      model: 'm',
    })
      .tool(tool)
      .build();

    await agent.run(
      { message: 'go', identity: { conversationId: 'named' } },
      { sessionId: 'sess-3' },
    );
    expect(seen[0]).toEqual({ conversationId: 'named' });
  });
});

// ─── integration: through the composer, with zero configuration ──────

describe('run identity — standingAgent gets it for free', () => {
  it('a served session is memory-scoped to itself without a line of config', async () => {
    const { provider, requests } = capturingProvider('ok');
    const host = inProcessHost();
    const agent = Agent.create({ provider, model: 'm', maxIterations: 1 })
      .system('You remember the user.')
      .memory(
        defineMemory({
          id: 'chat',
          type: MEMORY_TYPES.EPISODIC,
          strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
          store: new InMemoryStore(),
        }),
      )
      .build();
    const handle = await standingAgent({ agent, sessions: memorySessions(), host });
    try {
      await host.deliver({ input: 'I drive a red bicycle.', sessionId: 'web-1' });
      requests.length = 0;
      await host.deliver({ input: 'What do I drive?', sessionId: 'web-1' });

      expect(requests[0]?.systemPrompt ?? '').toContain('red bicycle');
      expect(identityOf(agent)).toEqual({ conversationId: 'web-1', source: 'session' });
    } finally {
      await handle.close();
    }
  });

  it('an ANONYMOUS request keeps the per-run default — there is no conversation to key on', async () => {
    const { provider } = capturingProvider('ok');
    const host = inProcessHost();
    const agent = Agent.create({ provider, model: 'm', maxIterations: 1 }).build();
    const handle = await standingAgent({ agent, sessions: memorySessions(), host });
    try {
      await host.deliver({ input: 'hello' });
      const seen = identityOf(agent);
      expect(seen.conversationId).toMatch(/^run-/);
      expect(seen.source).toBeUndefined();
    } finally {
      await handle.close();
    }
  });
});
