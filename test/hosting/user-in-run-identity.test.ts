/**
 * `HostRequest.userId` → the run's identity principal (9.12.0) — the last link
 * in the per-user chain.
 *
 * The pieces existed separately. AgentCore Runtime forwards the end user in
 * `X-Amzn-Bedrock-AgentCore-Runtime-User-Id`; 9.10.0 made a hosting session the
 * conversation; 9.11.0 put `EventMeta.principal` on every event of a run whose
 * caller NAMED an identity. What was missing is the wire between them: a served
 * run had no way to name anybody, so the actor half of every audit trail
 * `standingAgent` produced was empty by construction.
 *
 * This file pins the join, and the four rules that keep it honest:
 *
 *   1. present  → the principal is on the run's identity, on every event's
 *                 meta, and in `ctx.identity` inside a tool
 *   2. absent   → absent. No session id wearing a person's name, nothing
 *                 invented to fill the gap
 *   3. the conversation's own facts survive — its namespace and its tenant are
 *      never moved by a header appearing
 *   4. turn TWO of the same session reports turn two's caller. A session pinned
 *      to whoever spoke first is the audit trail that looks complete and names
 *      the wrong party
 *
 * Mock provider throughout; nothing here reaches a network.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import { memorySessions, standingAgent } from '../../src/hosting/index.js';
import type { SessionLifecycle } from '../../src/hosting/index.js';
import type { LLMProvider, LLMResponse } from '../../src/adapters/types.js';
import { inProcessHost, type InProcessHost } from './testHost.js';

function provider(): LLMProvider {
  return {
    name: 'mock',
    complete: async (): Promise<LLMResponse> => ({
      content: 'answered',
      toolCalls: [],
      usage: { input: 1, output: 1 },
    }),
  };
}

interface Served {
  readonly host: InProcessHost;
  readonly agent: Agent;
  /** The actor stamped on every event, `null` where the key was absent. */
  readonly actors: () => (string | null)[];
  readonly tenants: () => (string | null)[];
  close(): Promise<void>;
}

async function serve(sessions: SessionLifecycle = memorySessions()): Promise<Served> {
  const agent = Agent.create({ provider: provider(), model: 'test-model', maxIterations: 3 })
    .system('You are terse.')
    .build();
  const seen: { principal?: string; tenant?: string }[] = [];
  agent.on('*', (e) => seen.push((e as { meta: { principal?: string; tenant?: string } }).meta));
  const host = inProcessHost();
  const handle = await standingAgent({ agent, host, sessions });
  return {
    host,
    agent,
    actors: () => seen.map((m) => m.principal ?? null),
    tenants: () => seen.map((m) => m.tenant ?? null),
    close: () => handle.close(),
  };
}

/**
 * A stored conversation somebody ELSE scoped — a tenant and a namespace no
 * transport header could have supplied. Written out in full because a
 * conversation envelope is validated at the door it comes in: a partial one is
 * refused, which would make the assertions below pass for the wrong reason.
 */
function storedConversation() {
  return {
    format: 'conversation-v1' as const,
    savedAt: Date.now(),
    data: {
      version: 1 as const,
      runId: 'run-earlier',
      history: [
        { role: 'user' as const, content: 'earlier' },
        { role: 'assistant' as const, content: 'earlier answer' },
      ],
      lastCompletedIteration: 1,
      originalInput: { message: 'earlier' },
      checkpointedAt: Date.now(),
      identity: { tenant: 'acme', principal: 'alice@acme.test', conversationId: 'chosen-ns' },
    },
  };
}

// ── unit — present, and absent ───────────────────────────────────────

describe('a request that names its end user', () => {
  it('puts that person on every event of the run', async () => {
    const served = await serve();
    await served.host.deliver({ input: 'hello', sessionId: 'conv-1', userId: 'alice@acme.test' });
    const actors = served.actors();
    expect(actors.length).toBeGreaterThan(0);
    expect(new Set(actors)).toEqual(new Set(['alice@acme.test']));
    await served.close();
  });

  it('reaches a tool as `ctx.identity`, which is what a credential provider scopes on', async () => {
    // The whole point of carrying it: `agentCoreIdentity` reads
    // `identity.principal` to resolve a per-(workload, user) token. Before
    // this, a served run handed tools nothing to scope with.
    let seen: { principal?: string; conversationId?: string } | undefined;
    const tool = defineTool({
      name: 'whoami',
      description: 'report the caller',
      inputSchema: { type: 'object', properties: {} },
      execute: async (_args, ctx) => {
        seen = ctx.identity as { principal?: string; conversationId?: string };
        return 'ok';
      },
    });
    const agent = Agent.create({
      provider: {
        name: 'mock',
        complete: async (): Promise<LLMResponse> => ({
          content: seen ? 'done' : 'calling',
          toolCalls: seen ? [] : [{ id: 'c1', name: 'whoami', args: {} }],
          usage: { input: 1, output: 1 },
        }),
      },
      model: 'test-model',
      maxIterations: 3,
    })
      .tools([tool])
      .build();
    const host = inProcessHost();
    const handle = await standingAgent({ agent, host, sessions: memorySessions() });
    await host.deliver({ input: 'who am I?', sessionId: 'conv-2', userId: 'bob@acme.test' });
    expect(seen?.principal).toBe('bob@acme.test');
    // Composed, not replaced: the session is still the conversation.
    expect(seen?.conversationId).toBe('conv-2');
    await handle.close();
  });

  it('a request that names nobody stamps nobody — the session is not promoted', async () => {
    const served = await serve();
    await served.host.deliver({ input: 'hello', sessionId: 'conv-3' });
    expect(new Set(served.actors())).toEqual(new Set([null]));
    await served.close();
  });

  it('an anonymous request with no session names nobody, rather than inventing a conversation', async () => {
    // There is no conversation to hang a principal on, and fabricating one to
    // carry it would put a made-up namespace in the audit trail. AgentCore
    // always sends a session (`runtimeSessionId` is required on its invoke), so
    // this shape is a guard rather than a path anybody walks.
    const served = await serve();
    await served.host.deliver({ input: 'hello', userId: 'nobody@nowhere.test' });
    expect(new Set(served.actors())).toEqual(new Set([null]));
    await served.close();
  });
});

// ── scenario — a conversation across turns ───────────────────────────

describe('across turns of one session', () => {
  it('turn two reports turn two’s caller, not turn one’s', async () => {
    // The failure this prevents: turn one's principal is stored with the
    // conversation, and preferring the stored one would pin the whole session
    // to whoever spoke first.
    const served = await serve();
    await served.host.deliver({ input: 'first', sessionId: 'conv-4', userId: 'alice@acme.test' });
    const afterFirst = served.actors().length;
    await served.host.deliver({ input: 'second', sessionId: 'conv-4', userId: 'carol@acme.test' });
    const secondTurn = served.actors().slice(afterFirst);
    expect(secondTurn.length).toBeGreaterThan(0);
    expect(new Set(secondTurn)).toEqual(new Set(['carol@acme.test']));
    await served.close();
  });

  it('a turn that names nobody continues the conversation’s own identity', async () => {
    // Not a rule this release invented: since 9.2.0 a continued turn stays in
    // the namespace it started in, and the namespace IS the identity tuple. So
    // a second turn with no user on it belongs to the same person the
    // conversation belonged to. What this release adds is the other direction
    // — a request that DOES name somebody wins, which is the test above.
    const served = await serve();
    await served.host.deliver({ input: 'first', sessionId: 'conv-5', userId: 'alice@acme.test' });
    const afterFirst = served.actors().length;
    await served.host.deliver({ input: 'second', sessionId: 'conv-5' });
    expect(new Set(served.actors().slice(afterFirst))).toEqual(new Set(['alice@acme.test']));
    await served.close();
  });
});

// ── boundary — what the header may NOT overwrite ─────────────────────

describe('the conversation’s own facts win', () => {
  it('a stored tenant and namespace survive; only the principal comes from the request', async () => {
    // A store that hands back a conversation somebody else scoped. The header
    // supplies exactly one field, because it is the only one the transport
    // knows: an actor. Everything else belongs to the conversation.
    const sessions: SessionLifecycle = {
      hydrate: async () => storedConversation() as never,
      persist: async () => undefined,
    };
    const served = await serve(sessions);
    await served.host.deliver({ input: 'hi', sessionId: 'conv-6', userId: 'dave@acme.test' });
    // The tenant nobody in the transport could have known is intact…
    expect(new Set(served.tenants())).toEqual(new Set(['acme']));
    // …and the person calling NOW is the person reported.
    expect(new Set(served.actors())).toEqual(new Set(['dave@acme.test']));
    await served.close();
  });

  it('with no user on the request, a stored identity is left entirely alone', async () => {
    const sessions: SessionLifecycle = {
      hydrate: async () => storedConversation() as never,
      persist: async () => undefined,
    };
    const served = await serve(sessions);
    await served.host.deliver({ input: 'hi', sessionId: 'conv-7' });
    expect(new Set(served.actors())).toEqual(new Set(['alice@acme.test']));
    expect(new Set(served.tenants())).toEqual(new Set(['acme']));
    await served.close();
  });
});
