/**
 * standingAgent `{ agentFactory }` — the per-session pool (9.10.0).
 *
 * The laws being pinned:
 *   • TWO SESSIONS RUN AT THE SAME TIME. Both are inside the model call before
 *     either returns, and their intervals OVERLAP by wall clock. The shared
 *     `{ agent }` shape is asserted alongside it as the control: there, the
 *     second run has not started when the first is still parked.
 *   • ONE SESSION STILL SERIALIZES — on its own instance, so the Agent's own
 *     `RunInFlightError` can never reach a caller. 'enqueue' queues it;
 *     'reject' refuses it with the composer's own named refusal, exactly as in
 *     the shared shape.
 *   • EVICTION IS INVISIBLE. The instance goes; the conversation is in the
 *     store, so the next turn re-hydrates onto a fresh Agent and still carries
 *     what was said. What the evicted instance was HOLDING is closed, under the
 *     `'evicted'` reason the tool-teardown vocabulary already had.
 *   • A RUNNING SESSION IS NEVER EVICTED — the pool grows past its bound rather
 *     than ending somebody's turn.
 *   • THE TWO REFUSALS. Both spellings at once, and a factory that hands back an
 *     instance it already handed back — the one mistake that would silently
 *     put two people in one conversation.
 *   • ANONYMOUS REQUESTS SHARE ONE INSTANCE, and never refuse each other.
 *
 * 7 patterns: unit · scenario · integration · property · security · performance
 * · ROI.
 */

import { describe, expect, it, vi } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { memorySessions, standingAgent } from '../../src/hosting/index.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../src/adapters/types.js';
import { inProcessHost } from './testHost.js';

// ─── Helpers ─────────────────────────────────────────────────────────

/** One model call, as it really happened. */
interface Call {
  readonly input: string;
  startedAt: number;
  endedAt?: number;
}

/**
 * A provider whose every call PARKS until the test releases it, recording when
 * each call started and ended.
 *
 * Parking is what makes the parallelism claim checkable rather than hopeful: a
 * fast provider could finish two sessions sequentially and still look
 * concurrent. Here, a second call can only start while the first is parked.
 */
function parkingProvider(reply: string): {
  provider: LLMProvider;
  calls: Call[];
  release: () => void;
} {
  const calls: Call[] = [];
  const waiters: (() => void)[] = [];
  const provider: LLMProvider = {
    name: 'parking',
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const last = [...req.messages].reverse().find((m) => m.role === 'user');
      const call: Call = { input: String(last?.content ?? ''), startedAt: Date.now() };
      calls.push(call);
      await new Promise<void>((resolve) => waiters.push(resolve));
      call.endedAt = Date.now();
      return { content: reply, toolCalls: [], usage: { input: 1, output: 1 } };
    },
  };
  return { provider, calls, release: () => waiters.splice(0).forEach((w) => w()) };
}

/** A provider that answers immediately, echoing which turn it is on. */
function countingProvider(): { provider: LLMProvider; requests: LLMRequest[] } {
  const requests: LLMRequest[] = [];
  let n = 0;
  return {
    requests,
    provider: {
      name: 'counting',
      complete(req: LLMRequest): Promise<LLMResponse> {
        requests.push(req);
        return Promise.resolve({
          content: `reply-${++n}`,
          toolCalls: [],
          usage: { input: 1, output: 1 },
        });
      },
    },
  };
}

/** Wait until `check()` is true, or fail loudly rather than hang the suite. */
async function until(check: () => boolean, what: string, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 1));
  }
}

function buildAgent(provider: LLMProvider): Agent {
  return Agent.create({ provider, model: 'test-model', maxIterations: 3 })
    .system('You are terse.')
    .build();
}

// ─── unit + performance: sessions really do run at the same time ─────

describe('standingAgent pool — two sessions, at the same time', () => {
  it('both sessions are inside the model call at once, and their intervals overlap', async () => {
    const { provider, calls, release } = parkingProvider('ok');
    const host = inProcessHost();
    const handle = await standingAgent({
      agentFactory: () => buildAgent(provider),
      sessions: memorySessions(),
      host,
    });
    try {
      const a = host.deliver({ input: 'from A', sessionId: 'A' });
      const b = host.deliver({ input: 'from B', sessionId: 'B' });

      // THE LAW. Neither has been released, and BOTH are in flight.
      await until(() => calls.length === 2, 'both sessions to be inside the model call');
      expect(calls.map((c) => c.input).sort()).toEqual(['from A', 'from B']);
      expect(calls.every((c) => c.endedAt === undefined)).toBe(true);

      release();
      await Promise.all([a, b]);

      // …and by wall clock, the two intervals overlap: each started before the
      // other finished. This is the assertion that fails the moment the pool
      // quietly starts sharing one lane again.
      const [first, second] = calls as [Call, Call];
      expect(first.startedAt).toBeLessThanOrEqual(second.endedAt ?? 0);
      expect(second.startedAt).toBeLessThanOrEqual(first.endedAt ?? 0);
    } finally {
      release();
      await handle.close();
    }
  });

  it('CONTROL — the shared { agent } shape does not: the second run has not started', async () => {
    const { provider, calls, release } = parkingProvider('ok');
    const host = inProcessHost();
    const handle = await standingAgent({
      agent: buildAgent(provider),
      sessions: memorySessions(),
      host,
    });
    try {
      const a = host.deliver({ input: 'from A', sessionId: 'A' });
      const b = host.deliver({ input: 'from B', sessionId: 'B' });
      await until(() => calls.length === 1, "session A's call to start");
      // Session B is waiting on the ONE instance. That is the correctness
      // requirement the shared shape keeps, unchanged.
      await new Promise((r) => setTimeout(r, 20));
      expect(calls).toHaveLength(1);

      release();
      await until(() => calls.length === 2, "session B's call to start");
      release();
      await Promise.all([a, b]);
    } finally {
      release();
      await handle.close();
    }
  });

  it('one agent per session — the factory is called once per session, never per request', async () => {
    const { provider } = countingProvider();
    const made: Agent[] = [];
    const host = inProcessHost();
    const handle = await standingAgent({
      agentFactory: () => {
        const agent = buildAgent(provider);
        made.push(agent);
        return agent;
      },
      sessions: memorySessions(),
      host,
    });
    try {
      await host.deliver({ input: '1', sessionId: 'A' });
      await host.deliver({ input: '2', sessionId: 'A' });
      await host.deliver({ input: '3', sessionId: 'B' });
      expect(made).toHaveLength(2);
      expect(made[0]).not.toBe(made[1]);
    } finally {
      await handle.close();
    }
  });
});

// ─── scenario: one session still serializes ──────────────────────────

describe('standingAgent pool — one session, two turns', () => {
  it("'enqueue' makes the second turn WAIT on that session's own instance", async () => {
    const { provider, calls, release } = parkingProvider('ok');
    const host = inProcessHost();
    const handle = await standingAgent({
      agentFactory: () => buildAgent(provider),
      sessions: memorySessions(),
      host,
      onConcurrentInvoke: 'enqueue',
    });
    try {
      const first = host.deliver({ input: 'turn one', sessionId: 'A' });
      const second = host.deliver({ input: 'turn two', sessionId: 'A' });
      await until(() => calls.length === 1, 'turn one to start');
      // The second turn of ONE conversation does not overlap the first —
      // which is also what keeps `RunInFlightError` away from the caller.
      await new Promise((r) => setTimeout(r, 20));
      expect(calls).toHaveLength(1);

      release();
      await until(() => calls.length === 2, 'turn two to start');
      release();
      const [a, b] = await Promise.all([first, second]);
      expect(a.output).toBe('ok');
      expect(b.output).toBe('ok');
      expect(b.error).toBeUndefined();
    } finally {
      release();
      await handle.close();
    }
  });

  it("'reject' (default) refuses the second with the COMPOSER's refusal, never RunInFlightError", async () => {
    const { provider, calls, release } = parkingProvider('ok');
    const host = inProcessHost();
    const handle = await standingAgent({
      agentFactory: () => buildAgent(provider),
      sessions: memorySessions(),
      host,
    });
    try {
      const first = host.deliver({ input: 'turn one', sessionId: 'A' });
      await until(() => calls.length === 1, 'turn one to start');
      const second = await host.deliver({ input: 'turn two', sessionId: 'A' });

      expect(second.code).toBe('ERR_CONCURRENT_RUN');
      expect(second.error).toContain("session 'A' already has a run in flight");
      // The Agent's own guard never fired: the queue kept the second turn off
      // the instance entirely.
      expect(second.error).not.toContain('RunInFlight');

      release();
      await first;
    } finally {
      release();
      await handle.close();
    }
  });

  it('a DIFFERENT session is never refused, and never waits', async () => {
    const { provider, calls, release } = parkingProvider('ok');
    const host = inProcessHost();
    const handle = await standingAgent({
      agentFactory: () => buildAgent(provider),
      sessions: memorySessions(),
      host,
    });
    try {
      const a = host.deliver({ input: 'from A', sessionId: 'A' });
      const b = host.deliver({ input: 'from B', sessionId: 'B' });
      await until(() => calls.length === 2, 'both to start');
      release();
      const [first, second] = await Promise.all([a, b]);
      expect(first.error).toBeUndefined();
      expect(second.error).toBeUndefined();
    } finally {
      release();
      await handle.close();
    }
  });
});

// ─── integration: eviction, and why nobody notices ───────────────────

describe('standingAgent pool — eviction', () => {
  it('evicts the least recently used session, and its conversation survives intact', async () => {
    const { provider, requests } = countingProvider();
    const made: Agent[] = [];
    const host = inProcessHost();
    const handle = await standingAgent({
      agentFactory: () => {
        const agent = buildAgent(provider);
        made.push(agent);
        return agent;
      },
      sessions: memorySessions(),
      host,
      maxActiveSessions: 1,
    });
    try {
      await host.deliver({ input: 'A first', sessionId: 'A' });
      // B arrives at a full pool: A is idle, so A is retired.
      await host.deliver({ input: 'B first', sessionId: 'B' });
      // …and A comes back. A THIRD instance, and the same conversation.
      const back = await host.deliver({ input: 'A second', sessionId: 'A' });

      expect(made).toHaveLength(3);
      expect(back.error).toBeUndefined();
      // THE LAW: eviction is invisible. Turn 2 of session A went to the model
      // carrying turn 1 of session A — question, answer, question.
      const contents = requests[2]!.messages
        .filter((m) => m.role !== 'system')
        .map((m) => m.content);
      expect(contents).toEqual(['A first', 'reply-1', 'A second']);
    } finally {
      await handle.close();
    }
  });

  it("closes what the evicted session was HOLDING, with reason 'evicted'", async () => {
    const cleanup = vi.fn();
    const closed: Array<{ reason?: string }> = [];
    const tool = defineTool<Record<string, never>, string>({
      name: 'holder',
      description: 'holds something for the conversation',
      execute: (_args, ctx) => {
        ctx.onTeardown?.(cleanup, { scope: 'session', key: 'k' });
        return 'held';
      },
    });
    const host = inProcessHost();
    const handle = await standingAgent({
      agentFactory: () => {
        const agent = Agent.create({
          provider: mock({
            replies: [{ toolCalls: [{ id: 'tc-1', name: 'holder', args: {} }] }, { content: 'ok' }],
          }),
          model: 'm',
        })
          .tool(tool)
          .build();
        agent.on('agentfootprint.tools.session_closed', (event) => {
          closed.push((event as { payload?: { reason?: string } }).payload ?? {});
        });
        return agent;
      },
      sessions: memorySessions(),
      host,
      maxActiveSessions: 1,
    });
    try {
      await host.deliver({ input: 'go', sessionId: 'A' });
      // A's turn ended and A's SESSION did not — the sandbox is still held.
      expect(cleanup).not.toHaveBeenCalled();

      // B evicts A. Now it is over, and the record says which firing site
      // ended it: the pool, not a run, not a shutdown.
      await host.deliver({ input: 'go', sessionId: 'B' });
      await until(() => cleanup.mock.calls.length === 1, "A's tool session to be closed");
      expect(closed.map((c) => c.reason)).toContain('evicted');
    } finally {
      await handle.close();
    }
  });

  it('a RUNNING session is never evicted — the pool grows rather than end a turn', async () => {
    const { provider, calls, release } = parkingProvider('ok');
    const made: Agent[] = [];
    const host = inProcessHost();
    const handle = await standingAgent({
      agentFactory: () => {
        const agent = buildAgent(provider);
        made.push(agent);
        return agent;
      },
      sessions: memorySessions(),
      host,
      maxActiveSessions: 1,
    });
    try {
      const a = host.deliver({ input: 'from A', sessionId: 'A' });
      await until(() => calls.length === 1, "A's call to start");
      // B arrives at a full pool whose only member is BUSY. A's run is not
      // touched, and B gets an instance anyway.
      const b = host.deliver({ input: 'from B', sessionId: 'B' });
      await until(() => calls.length === 2, "B's call to start");

      release();
      const [first, second] = await Promise.all([a, b]);
      expect(first.output).toBe('ok');
      expect(second.output).toBe('ok');
      expect(made).toHaveLength(2);
    } finally {
      release();
      await handle.close();
    }
  });
});

// ─── security + property: the two refusals ───────────────────────────

describe('standingAgent pool — the refusals', () => {
  it('BOTH spellings at once is refused by name, before a socket exists', async () => {
    const { provider } = countingProvider();
    const host = inProcessHost();
    await expect(
      standingAgent({
        // Two answers to one question — deliberately mis-typed to prove the
        // RUNTIME refusal, which is what a JS caller or a config bag would hit.
        agent: buildAgent(provider),
        agentFactory: () => buildAgent(provider),
        sessions: memorySessions(),
        host,
      } as never),
    ).rejects.toThrow(/both 'agent' and 'agentFactory'/);
  });

  it('NEITHER is refused too — there is nothing to serve', async () => {
    const host = inProcessHost();
    await expect(standingAgent({ sessions: memorySessions(), host } as never)).rejects.toThrow(
      /needs something to answer with/,
    );
  });

  it('a factory that returns the SAME instance twice is refused BY NAME', async () => {
    const { provider } = countingProvider();
    // The mistake that type-checks perfectly: closing over one agent.
    const shared = buildAgent(provider);
    const host = inProcessHost();
    const handle = await standingAgent({
      agentFactory: () => shared,
      sessions: memorySessions(),
      host,
    });
    try {
      const first = await host.deliver({ input: 'hello', sessionId: 'A' });
      expect(first.output).toBe('reply-1');

      // The SECOND session is where the mistake becomes visible — and it is
      // refused rather than quietly putting two people on one instance.
      const second = await host.deliver({ input: 'hello', sessionId: 'B' });
      expect(second.error).toContain('already returned');
      expect(second.error).toContain("pass it as 'agent' instead");
    } finally {
      await handle.close();
    }
  });

  it("maxActiveSessions without a factory is refused — it names a pool that doesn't exist", async () => {
    const { provider } = countingProvider();
    const host = inProcessHost();
    await expect(
      standingAgent({
        agent: buildAgent(provider),
        sessions: memorySessions(),
        host,
        maxActiveSessions: 10,
      } as never),
    ).rejects.toThrow(/without 'agentFactory'/);
  });

  it('a pool that can hold no sessions is refused', async () => {
    const { provider } = countingProvider();
    const host = inProcessHost();
    await expect(
      standingAgent({
        agentFactory: () => buildAgent(provider),
        sessions: memorySessions(),
        host,
        maxActiveSessions: 0,
      }),
    ).rejects.toThrow(/positive integer/);
  });
});

// ─── ROI: anonymous traffic costs one instance, not one per request ──

describe('standingAgent pool — requests with no session', () => {
  it('share ONE fallback instance, and never refuse each other', async () => {
    const { provider, calls, release } = parkingProvider('ok');
    const made: Agent[] = [];
    const host = inProcessHost();
    const handle = await standingAgent({
      agentFactory: () => {
        const agent = buildAgent(provider);
        made.push(agent);
        return agent;
      },
      sessions: memorySessions(),
      host,
    });
    try {
      const one = host.deliver({ input: 'anon one' });
      const two = host.deliver({ input: 'anon two' });
      await until(() => calls.length === 1, 'the first anonymous call to start');
      // They queue on one instance — there is no conversation to isolate, and
      // an instance per anonymous request would be an instance per request.
      await new Promise((r) => setTimeout(r, 20));
      expect(calls).toHaveLength(1);
      expect(made).toHaveLength(1);

      release();
      await until(() => calls.length === 2, 'the second anonymous call to start');
      release();
      const [first, second] = await Promise.all([one, two]);
      // Neither is a "same session" collision, because neither is a session.
      expect(first.error).toBeUndefined();
      expect(second.error).toBeUndefined();
    } finally {
      release();
      await handle.close();
    }
  });
});

// ─── integration: the rest of the composer is unchanged ──────────────

describe('standingAgent pool — everything else still holds', () => {
  it('composes with durability: mid-run writes land under the right session', async () => {
    const { provider } = countingProvider();
    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({
      agentFactory: () => buildAgent(provider),
      sessions,
      host,
      durability: 'sync',
    });
    try {
      await host.deliver({ input: 'A first', sessionId: 'A' });
      await host.deliver({ input: 'B first', sessionId: 'B' });
      const a = await sessions.hydrate('A');
      const b = await sessions.hydrate('B');
      expect(JSON.stringify(a)).toContain('A first');
      expect(JSON.stringify(a)).not.toContain('B first');
      expect(JSON.stringify(b)).toContain('B first');
      expect(JSON.stringify(b)).not.toContain('A first');
    } finally {
      await handle.close();
    }
  });

  it('close() stops every pooled instance — they are the composer’s, not borrowed', async () => {
    const { provider } = countingProvider();
    const made: Agent[] = [];
    const host = inProcessHost();
    const handle = await standingAgent({
      agentFactory: () => {
        const agent = buildAgent(provider);
        made.push(agent);
        return agent;
      },
      sessions: memorySessions(),
      host,
    });
    const shutdowns = () => made.map((agent) => vi.spyOn(agent, 'shutdown'));
    await host.deliver({ input: '1', sessionId: 'A' });
    await host.deliver({ input: '2', sessionId: 'B' });
    const spies = shutdowns();
    await handle.close();
    expect(spies).toHaveLength(2);
    for (const spy of spies) expect(spy).toHaveBeenCalledWith({ stop: true });
  });
});
