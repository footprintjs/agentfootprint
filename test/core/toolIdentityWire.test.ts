/**
 * THE IDENTITY WIRE — what `tool.execute` is told about the run it is in (9.7.0).
 *
 * Before this, `ToolExecutionContext` was six fields and none of them said WHO
 * or WHICH RUN. Everything a tool would need to isolate a held session lived one
 * object-hop away and never crossed it. The bug that closes is not exotic: a
 * standing agent, one module-level session map, and person B gets person A's
 * sandbox.
 *
 * What this file pins is mostly ABSENCE. Every one of these fields is optional,
 * and the whole design rests on absent being distinguishable from invented — so
 * the tests that matter most are the ones asserting a field is NOT there.
 *
 * 7-pattern matrix:
 *   unit        — the fields on the main dispatch path
 *   scenario    — two runs of one agent see two different runIds
 *   integration — the check-in RESUME path (the second execute site) carries the
 *                 same wire; teardown fires at the right terminal
 *   property    — every door's `teardownScopes` is exactly what it can honour
 *   security    — an unnamed identity is ABSENT, never the synthesized default;
 *                 an unsupported scope is refused by name
 *   regression  — a pause does NOT tear down (the shape that would fail quietly
 *                 as "the resumed run just re-ran everything")
 *   performance — an agent whose tools register nothing allocates no tier
 */

import { describe, expect, it, vi } from 'vitest';

import { Agent, defineTool, isPaused } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { pauseHere } from '../../src/core/pause.js';
import type { ToolExecutionContext } from '../../src/core/tools.js';

/** Capture the ctx a tool was handed, and answer trivially. */
function spyTool(name = 'probe') {
  const seen: ToolExecutionContext[] = [];
  const tool = defineTool<Record<string, never>, string>({
    name,
    description: 'records the context it was handed',
    execute: (_args, ctx) => {
      seen.push(ctx);
      return 'ok';
    },
  });
  return { tool, seen };
}

const callThen = (name: string, reply = 'done') =>
  mock({
    replies: [{ toolCalls: [{ id: 'tc-1', name, args: {} }] }, { content: reply }],
  });

describe('the identity wire — what a tool is told', () => {
  it('carries the runId of the run it is in', async () => {
    const { tool, seen } = spyTool();
    const agent = Agent.create({ provider: callThen('probe'), model: 'm' })
      .tool(tool)
      .build();

    await agent.run({ message: 'go' });

    expect(seen).toHaveLength(1);
    expect(typeof seen[0]?.runId).toBe('string');
    expect(seen[0]?.runId).toMatch(/^run-/);
  });

  it('SCENARIO — two runs of ONE agent are told two different runIds', async () => {
    const { tool, seen } = spyTool();
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'a', name: 'probe', args: {} }] },
          { content: 'one' },
          { toolCalls: [{ id: 'b', name: 'probe', args: {} }] },
          { content: 'two' },
        ],
      }),
      model: 'm',
    })
      .tool(tool)
      .build();

    await agent.run({ message: 'first' });
    await agent.run({ message: 'second' });

    // The chart is built ONCE. A captured value here would be run #1's forever
    // — which is why the dep is an accessor, following `awaitDurable`.
    expect(seen[0]?.runId).not.toBe(seen[1]?.runId);
  });

  it('carries the hosting sessionId when the run is bound to one', async () => {
    const { tool, seen } = spyTool();
    const agent = Agent.create({ provider: callThen('probe'), model: 'm' })
      .tool(tool)
      .build();

    await agent.run({ message: 'go' }, { sessionId: 'sess-42' });

    expect(seen[0]?.sessionId).toBe('sess-42');
  });

  it('does NOT carry a sessionId when the run is not session-bound', async () => {
    const { tool, seen } = spyTool();
    const agent = Agent.create({ provider: callThen('probe'), model: 'm' })
      .tool(tool)
      .build();

    await agent.run({ message: 'go' });

    // Absent, not `''` and not the runId. A tool keying a sandbox on a
    // fabricated session id would share it with everybody who got the same one.
    expect(seen[0]).not.toHaveProperty('sessionId');
  });

  it('carries the identity the CALLER passed', async () => {
    const { tool, seen } = spyTool();
    const agent = Agent.create({ provider: callThen('probe'), model: 'm' })
      .tool(tool)
      .build();

    await agent.run({
      message: 'go',
      identity: { tenant: 'acme', principal: 'ada', conversationId: 'c-1' },
    });

    expect(seen[0]?.identity).toEqual({
      tenant: 'acme',
      principal: 'ada',
      conversationId: 'c-1',
    });
  });

  it('SECURITY — an unnamed identity is ABSENT, never the synthesized default', async () => {
    const { tool, seen } = spyTool();
    const agent = Agent.create({ provider: callThen('probe'), model: 'm' })
      .tool(tool)
      .build();

    await agent.run({ message: 'go' });

    // `scope.runIdentity` is ALWAYS populated — it defaults to
    // `{ conversationId: '<runId>' }`. Handing that to a tool as "the identity"
    // would publish a synthesized conversation as if somebody had named one,
    // and would make "the caller told us nothing" unrepresentable at the exact
    // layer that has to decide how widely to isolate.
    expect(seen[0]).not.toHaveProperty('identity');
  });

  it('declares the four scopes an Agent run can actually honour', async () => {
    const { tool, seen } = spyTool();
    const agent = Agent.create({ provider: callThen('probe'), model: 'm' })
      .tool(tool)
      .build();

    await agent.run({ message: 'go' });

    expect(seen[0]?.teardownScopes).toEqual(['call', 'run', 'session', 'shutdown']);
    expect(typeof seen[0]?.onTeardown).toBe('function');
  });

  it('SECURITY — an unsupported scope is refused BY NAME, not accepted and dropped', async () => {
    let refusal: string | undefined;
    const tool = defineTool<Record<string, never>, string>({
      name: 'probe',
      description: 'asks for a scope that does not exist',
      execute: (_args, ctx) => {
        try {
          (ctx.onTeardown as (c: () => void, o: { scope: string }) => void)(() => {}, {
            scope: 'forever',
          });
        } catch (err) {
          refusal = (err as Error).message;
        }
        return 'ok';
      },
    });
    const agent = Agent.create({ provider: callThen('probe'), model: 'm' })
      .tool(tool)
      .build();

    await agent.run({ message: 'go' });

    // A registration that can never fire is a leaked resource wearing the shape
    // of a tidy one.
    expect(refusal).toMatch(/scope 'forever' is not honoured here/);
    expect(refusal).toMatch(/call, run, session, shutdown/);
  });
});

describe('when teardown fires — and when it must not', () => {
  it("'run' teardown fires once the run answers", async () => {
    const cleanup = vi.fn();
    const tool = defineTool<Record<string, never>, string>({
      name: 'holder',
      description: 'holds something for the turn',
      execute: (_args, ctx) => {
        ctx.onTeardown?.(cleanup, { scope: 'run', key: 'k' });
        return 'held';
      },
    });
    const agent = Agent.create({ provider: callThen('holder'), model: 'm' })
      .tool(tool)
      .build();

    await agent.run({ message: 'go' });

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("'call' teardown fires as soon as the tool settles — before the turn ends", async () => {
    const order: string[] = [];
    const tool = defineTool<Record<string, never>, string>({
      name: 'holder',
      description: 'holds something for one call',
      execute: (_args, ctx) => {
        ctx.onTeardown?.(() => void order.push('closed'), { scope: 'call', key: 'k' });
        order.push('executed');
        return 'held';
      },
    });
    const agent = Agent.create({ provider: callThen('holder'), model: 'm' })
      .tool(tool)
      .build();

    await agent.run({ message: 'go' });

    expect(order).toEqual(['executed', 'closed']);
  });

  it('a tool that THREW still gets its call-scoped cleanup — it may have opened something', async () => {
    const cleanup = vi.fn();
    const tool = defineTool<Record<string, never>, string>({
      name: 'breaker',
      description: 'opens then fails',
      execute: (_args, ctx) => {
        ctx.onTeardown?.(cleanup, { scope: 'call', key: 'k' });
        throw new Error('half-done');
      },
    });
    const agent = Agent.create({ provider: callThen('breaker'), model: 'm' })
      .tool(tool)
      .build();

    await agent.run({ message: 'go' });

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('REGRESSION — a PAUSE does not tear down; the resume needs what it opened', async () => {
    const cleanup = vi.fn();
    const tool = defineTool<Record<string, never>, string>({
      name: 'asker',
      description: 'opens a session, then asks a person',
      execute: (_args, ctx) => {
        ctx.onTeardown?.(cleanup, { scope: 'run', key: 'k' });
        pauseHere({ question: 'may I?' });
        return 'unreachable';
      },
    });
    const agent = Agent.create({
      provider: mock({
        replies: [{ toolCalls: [{ id: 'tc-1', name: 'asker', args: {} }] }, { content: 'done' }],
      }),
      model: 'm',
    })
      .tool(tool)
      .build();

    const paused = await agent.run({ message: 'go' });

    // A pause is not a terminal. Tearing the sandbox down here destroys the
    // exact state the resume needs — and it fails QUIETLY, as a resumed run
    // that "just re-ran everything".
    expect(isPaused(paused)).toBe(true);
    expect(cleanup).not.toHaveBeenCalled();

    if (isPaused(paused)) await agent.resume(paused.checkpoint, 'yes');
    // ...and once the resume really ends the run, it goes.
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('an ERROR is a terminal — a crashed run does not keep its sandbox', async () => {
    const cleanup = vi.fn();
    const tool = defineTool<Record<string, never>, string>({
      name: 'holder',
      description: 'holds something',
      execute: (_args, ctx) => {
        ctx.onTeardown?.(cleanup, { scope: 'run', key: 'k' });
        return 'held';
      },
    });
    const provider = mock({
      replies: [{ toolCalls: [{ id: 'tc-1', name: 'holder', args: {} }] }],
    });
    const agent = Agent.create({ provider, model: 'm' }).tool(tool).build();

    // `replies` is exhausted after the tool call, so the second LLM turn throws.
    await expect(agent.run({ message: 'go' })).rejects.toThrow();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("'session' teardown waits for the composition root to say when", async () => {
    const cleanup = vi.fn();
    const tool = defineTool<Record<string, never>, string>({
      name: 'holder',
      description: 'holds something for the conversation',
      execute: (_args, ctx) => {
        ctx.onTeardown?.(cleanup, { scope: 'session', key: 'k' });
        return 'held';
      },
    });
    const agent = Agent.create({ provider: callThen('holder'), model: 'm' })
      .tool(tool)
      .build();

    await agent.run({ message: 'go' }, { sessionId: 'sess-1' });
    // The run ended and the session did NOT: one session is many turns.
    expect(cleanup).not.toHaveBeenCalled();

    await expect(agent.closeToolSessions({ sessionId: 'other' })).resolves.toBe(0);
    expect(cleanup).not.toHaveBeenCalled();

    await expect(agent.closeToolSessions({ sessionId: 'sess-1' })).resolves.toBe(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('shutdown({ stop: false }) STILL closes tool sessions — a sandbox is not borrowed', async () => {
    const cleanup = vi.fn();
    const tool = defineTool<Record<string, never>, string>({
      name: 'holder',
      description: 'holds something for the conversation',
      execute: (_args, ctx) => {
        ctx.onTeardown?.(cleanup, { scope: 'session', key: 'k' });
        return 'held';
      },
    });
    const agent = Agent.create({ provider: callThen('holder'), model: 'm' })
      .tool(tool)
      .build();
    await agent.run({ message: 'go' }, { sessionId: 'sess-1' });

    // `stop` governs BORROWED strategies. A tool session is not borrowed: this
    // runtime opened it and nobody else holds a handle to close it. Draining
    // without closing would leak a sandbox on `standingAgent`'s DEFAULT path.
    await agent.shutdown({ stop: false });

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('PERFORMANCE — an agent whose tools register nothing allocates no tier', async () => {
    const { tool } = spyTool();
    const agent = Agent.create({ provider: callThen('probe'), model: 'm' })
      .tool(tool)
      .build();

    await agent.run({ message: 'go' });

    // The tier is lazy; the terminals are one `undefined` check for everybody
    // who never asked for a teardown.
    await expect(agent.closeToolSessions()).resolves.toBe(0);
  });
});

describe('the four events a session leaves behind', () => {
  it('started → closed, joined to the run that opened it', async () => {
    const rows: Array<{ type: string; runId: string; stage: string; payload: unknown }> = [];
    const tool = defineTool<Record<string, never>, string>({
      name: 'holder',
      description: 'holds something',
      execute: (_args, ctx) => {
        ctx.onTeardown?.(() => {}, { scope: 'run', key: 'k', runnerId: 'fake-runner' });
        return 'held';
      },
    });
    const agent = Agent.create({ provider: callThen('holder'), model: 'm' })
      .tool(tool)
      .build();
    agent.on('agentfootprint.tools.*', (e) => {
      if (!e.type.includes('session_')) return;
      rows.push({
        type: e.type,
        runId: e.meta.runId,
        stage: e.meta.runtimeStageId,
        payload: e.payload,
      });
    });

    await agent.run({ message: 'go' });

    expect(rows.map((r) => r.type)).toEqual([
      'agentfootprint.tools.session_started',
      'agentfootprint.tools.session_closed',
    ]);
    // The close fires OUTSIDE any stage. `minimalMeta()` would stamp it
    // `runId: 'consumer-scope'` — unjoinable to the run that opened the
    // session, which is the exact unjoinability 9.4.0 fixed for credentials.
    const closed = rows[1];
    expect(closed?.runId).toMatch(/^run-/);
    expect(closed?.runId).toBe(rows[0]?.runId);
    expect(closed?.stage).toBe('tool-teardown#0');
    expect(closed?.payload).toMatchObject({
      tool: 'holder',
      scope: 'run',
      runnerId: 'fake-runner',
      reason: 'run-end',
    });
  });

  it('SECURITY — the payload carries the key DIGEST, never the key', async () => {
    const payloads: Array<Record<string, unknown>> = [];
    const tool = defineTool<Record<string, never>, string>({
      name: 'holder',
      description: 'holds something',
      execute: (_args, ctx) => {
        ctx.onTeardown?.(() => {}, { scope: 'run', key: 't=acme/p=ada@example.com/r=r1' });
        return 'held';
      },
    });
    const agent = Agent.create({ provider: callThen('holder'), model: 'm' })
      .tool(tool)
      .build();
    agent.on('agentfootprint.tools.*', (e) => {
      if (e.type.includes('session_')) payloads.push(e.payload as Record<string, unknown>);
    });

    await agent.run({ message: 'go' });

    expect(payloads.length).toBeGreaterThan(0);
    for (const payload of payloads) {
      expect(JSON.stringify(payload)).not.toContain('ada@example.com');
      expect(typeof payload.keyHash).toBe('string');
    }
  });
});
