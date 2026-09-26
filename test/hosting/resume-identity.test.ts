/**
 * WHO A RESUMED RUN IS FOR — `Agent.resume` takes the identity of the run it
 * resumes, never the identity of whatever the instance ran last.
 *
 * Before this fix `Agent.lastRunIdentity` (read by `checkpoint()`, by the run's
 * `EventMeta.principal`, and by `ctx.identity` inside a tool) was written by
 * `run()` only. On a shared agent (`standingAgent({ agent })`) or a pooled
 * instance rebuilt after eviction, a resumed turn therefore stored the
 * conversation under ANOTHER person's identity, or under none:
 *   • bob's resume failed with `ERR_SESSION_OWNERSHIP_CONFLICT` after his
 *     approved tool had already run;
 *   • an ownerless (open-door) session was moved under alice's principal and
 *     alice's conversation namespace;
 *   • a pooled owner whose instance was evicted was locked out of their own
 *     conversation (`ERR_SESSION_NOT_FOUND` on the next turn).
 *
 * The laws being pinned:
 *   • A resume's caller identity is the one the resuming call NAMES, else the
 *     one the PAUSED run's caller named — read off the checkpoint the resume
 *     was handed, so it survives a shared instance, an eviction and a restart.
 *   • An identity the library DERIVED for the paused run (the session rung, the
 *     per-run default) is not a caller's identity, and a resume does not
 *     promote it to one.
 *
 * Test types (Convention 3): scenario (two people, one agent) · integration
 * (through `standingAgent`) · regression (B4 · B5 · B6 of the run-scope
 * review) · security (another person's identity never reaches the stored
 * conversation or the resumed run's events) · unit (the round trip) ·
 * boundary (derived rungs stay absent).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { Agent, defineTool, ResumeIdentityConflictError } from '../../src/index.js';
import type { AgentfootprintEvent } from '../../src/events.js';
import type { FlowchartCheckpoint } from 'footprintjs';
import { mock } from '../../src/llm-providers.js';
import { askHuman } from '../../src/core/pause.js';
import type { MemoryIdentity } from '../../src/memory/identity/types.js';
import { ALICE, BOB, harness } from './turnArtifactsHarness.js';

const { served, closeAll } = harness();
afterEach(closeAll);

type Reply = {
  content?: string;
  toolCalls?: ReadonlyArray<{ id: string; name: string; args: object }>;
};

/** An agent whose one tool asks a person, answering from a scripted reply list. */
function approvingAgent(replies: readonly Reply[]): Agent {
  const approve = defineTool<{ amount: number }, string>({
    name: 'approve_refund',
    description: 'refund a customer',
    inputSchema: {
      type: 'object',
      properties: { amount: { type: 'number' } },
      required: ['amount'],
    },
    execute: ({ amount }) => askHuman({ question: `Approve $${amount}?` }),
  });
  return Agent.create({
    provider: mock({ replies: replies as never }),
    model: 'm',
    maxIterations: 3,
  })
    .system('terse')
    .tool(approve)
    .build();
}

const ASK: Reply = { toolCalls: [{ id: 't1', name: 'approve_refund', args: { amount: 10 } }] };

/** The identity a session's STORED conversation names (paused or not); throws when nothing is stored. */
async function storedIdentity(
  sessions: { hydrate(id: string): Promise<unknown> },
  sessionId: string,
): Promise<MemoryIdentity | undefined> {
  const envelope = (await sessions.hydrate(sessionId)) as
    | {
        format: string;
        data: { identity?: MemoryIdentity; conversation?: { identity?: MemoryIdentity } };
      }
    | undefined;
  if (envelope === undefined) throw new Error(`nothing stored for ${sessionId}`);
  return envelope.format === 'flowchart-v1'
    ? envelope.data.conversation?.identity
    : envelope.data.identity;
}

/** The principals every event of the agent's runs named, per run id. */
function principalsByRun(agent: Agent): () => Map<string, Set<string | undefined>> {
  const seen = new Map<string, Set<string | undefined>>();
  agent.on('*', (event: AgentfootprintEvent) => {
    const runId = event.meta.runId;
    if (runId === 'consumer-scope') return;
    const set = seen.get(runId) ?? new Set<string | undefined>();
    set.add(event.meta.principal);
    seen.set(runId, set);
  });
  return () => seen;
}

describe('B4 — two signed-in people on ONE shared agent, each pausing and resuming', () => {
  it('both resumes succeed and every stored conversation names its own owner', async () => {
    const agent = approvingAgent([
      ASK,
      ASK,
      { content: 'bob refunded' },
      { content: 'alice refunded' },
    ]);
    const { host, sessions } = await served(agent, { verify: true });

    expect(
      (await host.deliver({ sessionId: 'sB', input: 'refund me', headers: BOB })).awaiting,
    ).toBeDefined();
    expect(
      (await host.deliver({ sessionId: 'sA', input: 'refund me', headers: ALICE })).awaiting,
    ).toBeDefined();

    const bob = await host.deliver({ sessionId: 'sB', decision: 'yes', headers: BOB });
    expect(bob.code).toBeUndefined();
    expect(bob.output).toBe('bob refunded');
    expect(await storedIdentity(sessions, 'sB')).toEqual({
      conversationId: 'sB',
      principal: 'bob',
    });

    const alice = await host.deliver({ sessionId: 'sA', decision: 'yes', headers: ALICE });
    expect(alice.code).toBeUndefined();
    expect(alice.output).toBe('alice refunded');
    expect(await storedIdentity(sessions, 'sA')).toEqual({
      conversationId: 'sA',
      principal: 'alice',
    });
  });

  it('a resumed run names the person who resumed it on every event — never the last person served', async () => {
    const agent = approvingAgent([ASK, { content: 'hello alice' }, { content: 'bob refunded' }]);
    const principals = principalsByRun(agent);
    const { host } = await served(agent, { verify: true });

    await host.deliver({ sessionId: 'sB', input: 'refund me', headers: BOB });
    await host.deliver({ sessionId: 'sA', input: 'hi', headers: ALICE });
    const before = new Set(principals().keys());
    await host.deliver({ sessionId: 'sB', decision: 'yes', headers: BOB });

    const resumedRuns = [...principals().entries()].filter(([runId]) => !before.has(runId));
    expect(resumedRuns).toHaveLength(1);
    expect([...(resumedRuns[0]?.[1] ?? [])]).toEqual(['bob']);
  });
});

describe('the round trip, no host — pause → resume → checkpoint', () => {
  it('the conversation after a resume names the PAUSED run’s caller, even after another caller ran', async () => {
    const agent = approvingAgent([ASK, { content: 'hello yara' }, { content: 'refunded' }]);
    const xavier: MemoryIdentity = { tenant: 'acme', principal: 'xavier', conversationId: 'cx' };
    const paused = (await agent.run({ message: 'refund me', identity: xavier })) as {
      checkpoint: FlowchartCheckpoint;
    };
    agent.abandonPause();
    await agent.run({ message: 'hi', identity: { principal: 'yara', conversationId: 'cy' } });

    const principals = principalsByRun(agent);
    await agent.resume(paused.checkpoint, 'yes');
    expect(agent.checkpoint()?.identity).toEqual(xavier);
    // …and the resumed run's own events name xavier, not the caller served last.
    expect([...principals().values()].map((set) => [...set])).toEqual([['xavier']]);
  });

  it('an identity the resuming call names is honoured when it IS the paused run’s — and refused when it is not', async () => {
    const agent = approvingAgent([ASK, { content: 'refunded' }]);
    const named: MemoryIdentity = { principal: 'xavier', conversationId: 'cx' };
    const paused = (await agent.run({ message: 'refund me', identity: named })) as {
      checkpoint: FlowchartCheckpoint;
    };
    await expect(
      agent.resume(paused.checkpoint, 'yes', {
        identity: { principal: 'xavier', conversationId: 'moved' },
      }),
    ).rejects.toBeInstanceOf(ResumeIdentityConflictError);
    await agent.resume(paused.checkpoint, 'yes', { identity: { ...named } });
    expect(agent.checkpoint()?.identity).toEqual(named);
  });

  it('a DERIVED identity is never promoted to a caller’s — the per-run default and the session rung stay absent', async () => {
    const agent = approvingAgent([
      ASK,
      { content: 'hello yara' },
      { content: 'refunded' },
      ASK,
      { content: 'hello yara' },
      { content: 'refunded' },
    ]);
    const yara: MemoryIdentity = { principal: 'yara', conversationId: 'cy' };

    // Rung 3: no identity, no session → `{ conversationId: '<runId>' }`.
    const perRun = (await agent.run({ message: 'refund me' })) as {
      checkpoint: FlowchartCheckpoint;
    };
    agent.abandonPause();
    await agent.run({ message: 'hi', identity: yara });
    await agent.resume(perRun.checkpoint, 'yes');
    expect(agent.checkpoint()?.identity).toBeUndefined();

    // Rung 2: a session and no identity → `{ conversationId: sessionId }`.
    const session = (await agent.run({ message: 'refund me' }, { sessionId: 's-1' })) as {
      checkpoint: FlowchartCheckpoint;
    };
    agent.abandonPause();
    await agent.run({ message: 'hi', identity: yara });
    await agent.resume(session.checkpoint, 'yes', { sessionId: 's-1' });
    expect(agent.checkpoint()?.identity).toBeUndefined();
  });
});

describe('B5 — the ownerless session (open door)', () => {
  it('is not moved under another person’s principal or conversation by a resume', async () => {
    const agent = approvingAgent([
      ASK,
      { content: 'hello alice' },
      { content: 'refunded' },
      { content: 'next' },
    ]);
    const { host, sessions } = await served(agent);

    await host.deliver({ sessionId: 'sB', input: 'refund me' });
    await host.deliver({ sessionId: 'sA', input: 'hi', userId: 'alice' });
    const resumed = await host.deliver({ sessionId: 'sB', decision: 'yes' });
    expect(resumed.output).toBe('refunded');
    expect(await storedIdentity(sessions, 'sB')).toBeUndefined();

    await host.deliver({ sessionId: 'sB', input: 'next' });
    const state = agent.getLastSnapshot()?.sharedState as
      | { runIdentity?: MemoryIdentity }
      | undefined;
    expect(state?.runIdentity).toEqual({ conversationId: 'sB' });
  });
});

describe('B6 — a pooled owner whose instance was evicted between pause and resume', () => {
  it('keeps their conversation: the resume stores it under them, and their next turn is served', async () => {
    let built = 0;
    const { host, sessions } = await served(
      {
        agentFactory: () => {
          built += 1;
          if (built === 1) return approvingAgent([ASK]);
          if (built === 2) return approvingAgent([{ content: 'hello alice' }]);
          return approvingAgent([{ content: 'refunded' }, { content: 'bob next' }]);
        },
        maxActiveSessions: 1,
      },
      { verify: true },
    );

    expect(
      (await host.deliver({ sessionId: 'sB', input: 'refund me', headers: BOB })).awaiting,
    ).toBeDefined();
    expect((await host.deliver({ sessionId: 'sA', input: 'hi', headers: ALICE })).output).toBe(
      'hello alice',
    );
    const resumed = await host.deliver({ sessionId: 'sB', decision: 'yes', headers: BOB });
    expect(resumed.output).toBe('refunded');
    expect(await storedIdentity(sessions, 'sB')).toEqual({
      conversationId: 'sB',
      principal: 'bob',
    });

    const next = await host.deliver({ sessionId: 'sB', input: 'next', headers: BOB });
    expect(next.code).toBeUndefined();
    expect(next.output).toBe('bob next');
  });
});
