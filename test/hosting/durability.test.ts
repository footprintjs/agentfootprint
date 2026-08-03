/**
 * durability — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * The laws being pinned:
 *   • `'exit'` IS the default and installs NOTHING — no observer, no barrier,
 *     one write per turn, exactly as every release before 7.19.
 *   • `'sync'` bounds side-effect replay: **iteration N's tools do not run until
 *     iteration N-1's write has landed.** Observed at the TOOL boundary with a
 *     store that will not answer, not merely at the reply — a bound you can only
 *     see at the reply is not a bound on side effects.
 *   • `'async'` does NOT take that barrier: the same store that stalls `'sync'`
 *     between tools does not stall `'async'` at all.
 *   • A crash mid-run leaves the store holding everything through the last
 *     completed iteration, tool results included — so a replay does not re-issue
 *     them.
 *   • Nothing mid-STAGE is ever stored: an iteration that ran two tools stores
 *     both results or neither.
 *   • A store that refuses the run's progress fails the request. Fail-closed.
 *   • The write happens where the conversation MOVES, not on every commit.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { pendingDurableWrite } from '../../src/core/durabilityBarrier.js';
import { memorySessions, readEnvelope, standingAgent } from '../../src/hosting/index.js';
import type { CheckpointEnvelope, SessionLifecycle } from '../../src/hosting/index.js';
import type { LLMProvider, LLMResponse } from '../../src/adapters/types.js';
import { inProcessHost } from './testHost.js';

// ─── Helpers ─────────────────────────────────────────────────────────

/** A store that records every write, in order, and can be made to stall. */
function recordingSessions(): SessionLifecycle & {
  writes: () => readonly CheckpointEnvelope[];
  /** Let the first `n` writes through, then stall every one after them. */
  stallAfter: (n: number) => void;
  release: () => void;
} {
  const inner = memorySessions();
  const seen: CheckpointEnvelope[] = [];
  const waiters: (() => void)[] = [];
  let passFirst = Number.POSITIVE_INFINITY;
  return {
    hydrate: (id) => inner.hydrate(id),
    async persist(id, envelope) {
      seen.push(structuredClone(envelope) as CheckpointEnvelope);
      if (seen.length > passFirst) await new Promise<void>((resolve) => waiters.push(resolve));
      await inner.persist(id, envelope);
    },
    writes: () => seen,
    stallAfter: (n: number) => {
      passFirst = n;
    },
    release: () => {
      passFirst = Number.POSITIVE_INFINITY;
      for (const w of waiters.splice(0)) w();
    },
  };
}

/** A tool that records the order in which it actually executed. */
function recordingTool(ran: string[]): ReturnType<typeof defineTool> {
  return defineTool<{ step: string }, string>({
    name: 'act',
    description: 'do a thing with a side effect',
    inputSchema: { type: 'object', properties: { step: { type: 'string' } }, required: ['step'] },
    execute: ({ step }) => {
      ran.push(step);
      return Promise.resolve(`did ${step}`);
    },
  });
}

/** Two tool-using iterations, then an answer. */
function twoToolTurns(): LLMProvider {
  return mock({
    replies: [
      { toolCalls: [{ id: 'a', name: 'act', args: { step: 'one' } }] },
      { toolCalls: [{ id: 'b', name: 'act', args: { step: 'two' } }] },
      { content: 'both done' },
    ],
  });
}

function agentWith(provider: LLMProvider, tool: ReturnType<typeof defineTool>): Agent {
  return Agent.create({ provider, model: 'test-model', maxIterations: 5 })
    .system('terse')
    .tool(tool)
    .build();
}

async function settleTicks(count = 8): Promise<void> {
  for (let i = 0; i < count; i++) await new Promise((resolve) => setTimeout(resolve, 2));
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// ─── unit: the default installs nothing ──────────────────────────────

describe("durability — 'exit' is the default, spelled explicitly", () => {
  it('writes once per turn and installs no barrier', async () => {
    const ran: string[] = [];
    const agent = agentWith(twoToolTurns(), recordingTool(ran));
    const sessions = recordingSessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions, host });
    try {
      const reply = await host.deliver({ input: 'go', sessionId: 'plain' });
      expect(reply.output).toBe('both done');
      // Two iterations, ~40 commits, ONE write.
      expect(sessions.writes()).toHaveLength(1);
      // And nothing was installed inside the run.
      expect(pendingDurableWrite(agent)).toBeUndefined();
    } finally {
      await handle.close();
    }
  });

  it("spelling 'exit' explicitly is identical to leaving it out", async () => {
    const runOnce = async (durability?: 'exit'): Promise<number> => {
      const agent = agentWith(twoToolTurns(), recordingTool([]));
      const sessions = recordingSessions();
      const host = inProcessHost();
      const handle = await standingAgent({
        agent,
        sessions,
        host,
        ...(durability && { durability }),
      });
      try {
        await host.deliver({ input: 'go', sessionId: 's' });
        return sessions.writes().length;
      } finally {
        await handle.close();
      }
    };
    expect(await runOnce()).toBe(await runOnce('exit'));
  });
});

// ─── integration: the mode difference, seen at the TOOL boundary ─────

describe('durability — where the modes actually differ', () => {
  it("'sync': iteration 2's tool does NOT run until iteration 1's write lands", async () => {
    const ran: string[] = [];
    const agent = agentWith(twoToolTurns(), recordingTool(ran));
    const sessions = recordingSessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions, host, durability: 'sync' });
    try {
      // Let the FIRST write (the user's message landing) through, so what this
      // test observes is the gate between iteration 1 and iteration 2 rather
      // than the gate in front of the whole turn.
      sessions.stallAfter(1);
      const inFlight = host.deliver({ input: 'go', sessionId: 'gated' });

      // Iteration 1's tool runs: the write it waits on had already landed.
      await waitFor(() => ran.includes('one'));
      // …and then the run STOPS, because iteration 1's own write has not.
      await settleTicks();
      expect(ran).toEqual(['one']);

      sessions.release();
      const reply = await inFlight;
      expect(reply.output).toBe('both done');
      expect(ran).toEqual(['one', 'two']);
    } finally {
      sessions.release();
      await handle.close();
    }
  });

  it("'async': the same stalled store does not hold the tools up at all", async () => {
    const ran: string[] = [];
    const agent = agentWith(twoToolTurns(), recordingTool(ran));
    const sessions = recordingSessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions, host, durability: 'async' });
    try {
      sessions.stallAfter(1);
      const inFlight = host.deliver({ input: 'go', sessionId: 'ungated' });

      // BOTH tools run while every write is still stuck on the wire. That is
      // the whole of what 'async' promises, and the whole of what it costs.
      await waitFor(() => ran.length === 2);
      expect(ran).toEqual(['one', 'two']);

      sessions.release();
      expect((await inFlight).output).toBe('both done');
    } finally {
      sessions.release();
      await handle.close();
    }
  });
});

// ─── scenario: a crash mid-run ───────────────────────────────────────

describe('durability — a crash mid-run', () => {
  /** Answers with a tool call, then a tool call, then dies. */
  function diesOnThirdCall(): LLMProvider {
    let calls = 0;
    return {
      name: 'dies',
      complete(): Promise<LLMResponse> {
        calls++;
        if (calls >= 3) return Promise.reject(new Error('vendor went away'));
        return Promise.resolve({
          content: '',
          toolCalls: [{ id: `t${calls}`, name: 'act', args: { step: `step-${calls}` } }],
          usage: { input: 1, output: 1 },
        });
      },
    };
  }

  it("'sync': everything through the last completed iteration survives", async () => {
    const sessions = recordingSessions();
    const ran: string[] = [];
    const agent = agentWith(diesOnThirdCall(), recordingTool(ran));
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions, host, durability: 'sync' });
    let reply;
    try {
      reply = await host.deliver({ input: 'long task', sessionId: 'crashed' });
    } finally {
      await handle.close(); // the "crash" — everything but the store goes away
    }
    expect(reply.error).toContain('vendor went away');

    const stored = await sessions.hydrate('crashed');
    const conversation = readEnvelope(stored);
    // The tool results are IN the store. A replay reads them and does not
    // re-issue those calls — which is the entire point of paying the latency.
    const toolResults = conversation.history.filter((m) => m.role === 'tool');
    expect(toolResults.map((m) => m.content)).toEqual(['did step-1', 'did step-2']);
    expect(ran).toEqual(['step-1', 'step-2']);
  });

  it("'exit': the same crash loses the whole turn", async () => {
    const sessions = recordingSessions();
    const agent = agentWith(diesOnThirdCall(), recordingTool([]));
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions, host });
    try {
      await host.deliver({ input: 'long task', sessionId: 'lost' });
    } finally {
      await handle.close();
    }
    expect(await sessions.hydrate('lost')).toBeUndefined();
  });

  it('a new standing agent over the same store carries on from what survived', async () => {
    const sessions = recordingSessions();
    const first = agentWith(diesOnThirdCall(), recordingTool([]));
    const hostA = inProcessHost();
    const handleA = await standingAgent({
      agent: first,
      sessions,
      host: hostA,
      durability: 'sync',
    });
    await hostA.deliver({ input: 'long task', sessionId: 'survivor' });
    await handleA.close();

    const requests: string[][] = [];
    const second: LLMProvider = {
      name: 'recovered',
      complete(req) {
        requests.push(req.messages.filter((m) => m.role !== 'system').map((m) => m.content ?? ''));
        return Promise.resolve({
          content: 'picked up where we left off',
          toolCalls: [],
          usage: { input: 1, output: 1 },
        });
      },
    };
    const hostB = inProcessHost();
    const handleB = await standingAgent({
      agent: agentWith(second, recordingTool([])),
      sessions,
      host: hostB,
      durability: 'sync',
    });
    try {
      const reply = await hostB.deliver({ input: 'carry on', sessionId: 'survivor' });
      expect(reply.output).toBe('picked up where we left off');
      // Both tool results crossed the process boundary.
      expect(requests[0]).toContain('did step-1');
      expect(requests[0]).toContain('did step-2');
    } finally {
      await handleB.close();
    }
  });
});

// ─── property: never mid-stage, always a prefix ──────────────────────

describe('durability — what a stored state can and cannot be', () => {
  it('an iteration that ran TWO tools stores both results or neither', async () => {
    // The agent dispatches all of one iteration's tool calls inside ONE stage
    // body, and a commit is a whole stage. So there is no stored state in which
    // half of an iteration happened — which is exactly why the replay bound is
    // stated per ITERATION and not per tool.
    const ran: string[] = [];
    const agent = agentWith(
      mock({
        replies: [
          {
            toolCalls: [
              { id: 'a', name: 'act', args: { step: 'left' } },
              { id: 'b', name: 'act', args: { step: 'right' } },
            ],
          },
          { content: 'done' },
        ],
      }),
      recordingTool(ran),
    );
    const sessions = recordingSessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions, host, durability: 'sync' });
    try {
      await host.deliver({ input: 'go', sessionId: 'atomic' });
      expect(ran).toEqual(['left', 'right']);
      for (const envelope of sessions.writes()) {
        expect(envelope.format).toBe('conversation-v1');
        const results = readEnvelope(envelope).history.filter((m) => m.role === 'tool');
        expect([0, 2]).toContain(results.length); // never 1
      }
    } finally {
      await handle.close();
    }
  });

  it('every stored state is a PREFIX of the one after it — never a mixture', async () => {
    const agent = agentWith(twoToolTurns(), recordingTool([]));
    const sessions = recordingSessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions, host, durability: 'async' });
    try {
      await host.deliver({ input: 'go', sessionId: 'prefix' });
      const histories = sessions.writes().map((e) => readEnvelope(e).history);
      expect(histories.length).toBeGreaterThan(1);
      for (let i = 1; i < histories.length; i++) {
        const before = histories[i - 1]!;
        const after = histories[i]!;
        expect(after.length).toBeGreaterThanOrEqual(before.length);
        expect(after.slice(0, before.length)).toEqual(before);
      }
    } finally {
      await handle.close();
    }
  });
});

// ─── security: fail-closed on a store that will not take it ──────────

describe('durability — a store that refuses', () => {
  it("'sync': the request fails rather than answering as if the state were durable", async () => {
    const broken: SessionLifecycle = {
      hydrate: () => Promise.resolve(undefined),
      persist: () => Promise.reject(new Error('disk is full')),
    };
    const ran: string[] = [];
    const agent = agentWith(twoToolTurns(), recordingTool(ran));
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions: broken, host, durability: 'sync' });
    try {
      const reply = await host.deliver({ input: 'go', sessionId: 'doomed' });
      expect(reply.output).toBeUndefined();
      expect(reply.error).toContain('disk is full');
      // NOT ONE side effect escaped. The very first write — the user's message
      // landing — was refused, and the barrier in front of the first tool
      // dispatch would not let anything happen on the far side of it.
      expect(ran).toEqual([]);
    } finally {
      await handle.close();
    }
  });
});

// ─── performance: writes track the conversation, not the commits ─────

describe('durability — how often it actually writes', () => {
  it('writes where the conversation MOVES, not on every commit', async () => {
    // A two-iteration turn commits around forty times. Two of those commits
    // change the conversation (the seed, and each ToolCalls stage); the rest
    // would store bytes identical to the last write.
    const commits: string[] = [];
    const agent = agentWith(twoToolTurns(), recordingTool([]));
    agent.attach({ id: 'commit-counter', onCommit: (e) => commits.push(e.runtimeStageId) });
    const sessions = recordingSessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions, host, durability: 'sync' });
    try {
      await host.deliver({ input: 'go', sessionId: 'counted' });
      expect(commits.length).toBeGreaterThan(20);
      // seed + two ToolCalls + the terminal write.
      expect(sessions.writes().length).toBeLessThanOrEqual(5);
      expect(sessions.writes().length).toBeGreaterThanOrEqual(3);
    } finally {
      await handle.close();
    }
  });
});

// ─── ROI: the composition still holds together ───────────────────────

describe('durability — it is still the same standing agent', () => {
  it('the conversation round trip is unchanged under every mode', async () => {
    for (const durability of ['exit', 'async', 'sync'] as const) {
      const requests: string[][] = [];
      let turn = 0;
      const provider: LLMProvider = {
        name: 'spy',
        complete(req) {
          requests.push(
            req.messages.filter((m) => m.role !== 'system').map((m) => m.content ?? ''),
          );
          return Promise.resolve({
            content: turn++ === 0 ? 'The sky is blue.' : 'You asked about the sky.',
            toolCalls: [],
            usage: { input: 1, output: 1 },
          });
        },
      };
      const host = inProcessHost();
      const handle = await standingAgent({
        agent: Agent.create({ provider, model: 'm', maxIterations: 3 }).system('terse').build(),
        sessions: memorySessions(),
        host,
        durability,
      });
      try {
        await host.deliver({ input: 'What colour is the sky?', sessionId: 'c' });
        await host.deliver({ input: 'What did I ask?', sessionId: 'c' });
        expect(requests[1], `mode ${durability}`).toEqual([
          'What colour is the sky?',
          'The sky is blue.',
          'What did I ask?',
        ]);
      } finally {
        await handle.close();
      }
    }
  });
});
