import { expect, it } from 'vitest';
import {
  Agent,
  askHuman,
  defineTool,
  isPaused,
  checkInApproved,
  type DecisionLedger,
} from '../../index.js';
import { runnerLive } from '../runnerLive.js';
import { mock } from '../../llm-providers.js';
import type { LLMRequest } from '../../provider-contract/types.js';

function asking(closed: string[] = []) {
  return Agent.create({
    provider: mock({
      replies: [{ toolCalls: [{ id: 'held', name: 'ask', args: {} }] }, 'done', 'next'],
    }),
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'ask',
        description: 'Ask',
        inputSchema: { type: 'object' },
        execute: (_args, ctx) => {
          for (const scope of ['call', 'run'] as const)
            ctx.onTeardown!(
              () => {
                closed.push(scope);
              },
              { scope },
            );
          return askHuman({ question: 'Continue?' });
        },
      }),
    )
    .build();
}

it.each(['malformed', 'missing'] as const)(
  'a %s owner refusal preserves the question and its resources',
  async (shape) => {
    const closed: string[] = [];
    const agent = asking(closed);
    const pause = await agent.run('first');
    if (!isPaused(pause)) throw new Error('Expected pause');
    const dispositions: unknown[] = [];
    agent.on('agentfootprint.tools.resource_restore', (event) => dispositions.push(event.payload));
    const bad = structuredClone(pause.checkpoint);
    if (shape === 'missing') delete bad.sharedState.toolResourceOwner;
    else bad.sharedState.toolResourceOwner = { version: 99 };
    await expect(agent.resume(bad, 'yes')).rejects.toBeInstanceOf(Error);
    expect(dispositions).toEqual([{ local: 'unconfirmed', remote: 'unknown' }]);
    expect(closed).toEqual([]);
    await expect(agent.run('other')).rejects.toMatchObject({ code: 'ERR_PENDING_QUESTION' });
    expect(await agent.resume(pause.checkpoint, 'yes')).toBe('done');
    expect([...closed].sort()).toEqual(['call', 'run']);
  },
);

it('a refused foreign carrier cannot replace the selected conversation', async () => {
  const bob = asking();
  const pause = await bob.run({
    message: 'private-B',
    identity: { conversationId: 'B', principal: 'bob' },
  });
  if (!isPaused(pause)) throw new Error('Expected pause');
  const bad = structuredClone(pause.checkpoint);
  bad.sharedState.toolResourceOwner = { version: 99 };
  const alice = Agent.create({ provider: mock({ replies: ['answer-A'] }), model: 'mock' }).build();
  await alice.run({ message: 'private-A', identity: { conversationId: 'A', principal: 'alice' } });
  const before = alice.checkpoint();
  await expect(alice.resume(bad, 'yes')).rejects.toBeInstanceOf(Error);
  expect(alice.checkpoint()?.history).toEqual(before?.history);
  expect(alice.checkpoint()?.identity).toEqual(before?.identity);
  expect(JSON.stringify(alice.getLastSnapshot())).not.toContain('private-B');
});

it('abandon with no locally pending question does not close a transferred stored pause', async () => {
  const closed: string[] = [];
  const agent = asking(closed);
  const pause = await agent.run('first');
  if (!isPaused(pause)) throw new Error('Expected pause');
  const ownership = runnerLive(agent)?.pause?.capture(pause);
  expect(ownership).toBeDefined();
  ownership!.release();
  expect(await agent.abandonPause()).toBeUndefined();
  expect(closed).toEqual([]);
  expect(await agent.resume(pause.checkpoint, 'yes')).toBe('done');
  expect([...closed].sort()).toEqual(['call', 'run']);
});

it.each(['same', 'fresh'] as const)(
  'a catalog failure before answer consumption retains its question and supports exact abandon: %s',
  async (shape) => {
    const closed: string[] = [];
    let fail = false;
    const tool = defineTool({
      name: 'ask',
      description: 'Ask',
      inputSchema: { type: 'object' },
      execute: (_args, ctx) => {
        ctx.onTeardown!(
          () => {
            closed.push('run');
          },
          { scope: 'run' },
        );
        return askHuman({ question: 'Continue?' });
      },
    });
    const make = () =>
      Agent.create({
        provider: {
          name: 'scripted',
          complete: async (r: LLMRequest) =>
            r.messages.some((m) => m.role === 'tool')
              ? { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } }
              : {
                  content: '',
                  toolCalls: [{ id: 'held', name: 'ask', args: {} }],
                  usage: { input: 1, output: 1 },
                },
        },
        model: 'mock',
      })
        .toolProvider({
          id: 'catalog',
          list: () => {
            if (fail) throw new Error('catalog failed');
            return [tool];
          },
        })
        .build();
    const first = make(),
      pause = await first.run('first');
    if (!isPaused(pause)) throw new Error('Expected pause');
    const resumer = shape === 'same' ? first : make();
    fail = true;
    const reports: unknown[] = [];
    resumer.on('agentfootprint.tools.resource_restore', (e) => reports.push(e.payload));
    await expect(resumer.resume(pause.checkpoint, 'yes')).rejects.toThrow('catalog failed');
    expect(closed).toEqual([]);
    expect(reports).toContainEqual({
      local: shape === 'same' ? 'retained' : 'none-known-locally',
      remote: 'unknown',
    });
    if (shape === 'same')
      await expect(resumer.run('other')).rejects.toMatchObject({ code: 'ERR_PENDING_QUESTION' });
    fail = false;
    if (shape === 'same') expect(await resumer.abandonPause()).toBeDefined();
    else expect(await resumer.abandonPause()).toBeUndefined();
    // A fresh instance has no handle in its local tier; original host cleanup stays explicit.
    if (shape === 'same') expect(closed).toEqual(['run']);
    else {
      expect(closed).toEqual([]);
      await first.abandonPause();
      expect(closed).toEqual(['run']);
    }
  },
);

it('a valid answer followed by a business failure does not revive the answered question', async () => {
  let fail = false;
  const agent = Agent.create({
    provider: {
      name: 'scripted',
      complete: async (r: LLMRequest) => {
        if (fail) throw new Error('later model failure');
        return r.messages.some((m) => m.role === 'tool')
          ? { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } }
          : {
              content: '',
              toolCalls: [{ id: 'held', name: 'ask', args: {} }],
              usage: { input: 1, output: 1 },
            };
      },
    },
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'ask',
        description: 'Ask',
        inputSchema: { type: 'object' },
        execute: () => askHuman({ question: 'Continue?' }),
      }),
    )
    .build();
  const pause = await agent.run('first');
  if (!isPaused(pause)) throw new Error('Expected pause');
  fail = true;
  await expect(agent.resume(pause.checkpoint, 'yes')).rejects.toThrow('later model failure');
  fail = false;
  expect(await agent.abandonPause()).toBeUndefined();
  expect(isPaused(await agent.run('other'))).toBe(true);
});

it.each([
  'missing',
  'version',
  'owner',
  'turn',
  'duplicate',
  'party',
  'inconsistent',
  'turn-range',
  'current-null',
  'budget',
  'accessor',
] as const)('served-party checkpoint %s is refused before origin or effects', async (shape) => {
  const closed: string[] = [],
    agent = asking(closed);
  const pause = await agent.run('first');
  if (!isPaused(pause)) throw new Error('Expected pause');
  const prior = agent.checkpoint(),
    bad = structuredClone(pause.checkpoint);
  const carrier = bad.sharedState.servedToolParties as {
    version: number;
    owner: { runId: string };
    turn: number;
    current: { name: string; party: unknown }[];
    last: { name: string; party: unknown }[];
  };
  let reads = 0;
  if (shape === 'missing') delete bad.sharedState.servedToolParties;
  else if (shape === 'version') carrier.version = 99;
  else if (shape === 'owner') carrier.owner.runId = 'foreign';
  else if (shape === 'turn') carrier.turn++;
  else if (shape === 'duplicate') carrier.current.push({ ...carrier.current[0]! });
  else if (shape === 'party') carrier.current[0]!.party = { channel: 'not-a-party' };
  else if (shape === 'inconsistent')
    carrier.last[0]!.party = { channel: 'provider', id: 'different' };
  else if (shape === 'turn-range') {
    carrier.turn = -1;
    bad.sharedState.turnNumber = -1;
  } else if (shape === 'current-null') carrier.current[0]!.party = null;
  else if (shape === 'budget') carrier.current[0]!.name = 'x'.repeat(131_073);
  else
    Object.defineProperty(carrier, 'current', {
      enumerable: true,
      get: () => {
        reads++;
        throw new Error('must not read');
      },
    });
  await expect(agent.resume(bad, 'yes')).rejects.toBeInstanceOf(Error);
  expect(reads).toBe(0);
  expect(closed).toEqual([]);
  expect(agent.checkpoint()?.history).toEqual(prior?.history);
  await expect(agent.run('other')).rejects.toMatchObject({ code: 'ERR_PENDING_QUESTION' });
  await agent.abandonPause();
  expect([...closed].sort()).toEqual(['call', 'run']);
});

it('a host-transferred question is never manufactured by a failed resume', async () => {
  let fail = false;
  const tool = defineTool({
    name: 'hold',
    description: 'Ask',
    inputSchema: { type: 'object' },
    execute: () => askHuman({ question: 'PRIVATE QUESTION' }),
  });
  const agent = Agent.create({
    provider: mock({ replies: [{ toolCalls: [{ id: 'held', name: 'hold', args: {} }] }, 'bob'] }),
    model: 'mock',
  })
    .toolProvider({
      id: 'catalog',
      list: () => {
        if (fail) throw new Error('catalog failed');
        return [tool];
      },
    })
    .build();
  const pause = await agent.run('alice');
  if (!isPaused(pause)) throw new Error('Expected pause');
  const owned = runnerLive(agent)?.pause?.capture(pause);
  expect(owned).toBeDefined();
  owned!.release();
  fail = true;
  await expect(agent.resume(pause.checkpoint, 'answer')).rejects.toThrow('catalog failed');
  expect(await agent.abandonPause()).toBeUndefined();
  fail = false;
  await expect(agent.run('bob')).resolves.toBe('bob');
});

it.each(['plain', 'replay'] as const)(
  '%s refusal preserves every selected reader and followUp',
  async (door) => {
    const tool = defineTool({
      name: 'hold',
      description: 'Ask',
      inputSchema: { type: 'object' },
      ...(door === 'replay' && { checkIn: 'always' as const }),
      execute: () => (door === 'plain' ? askHuman({ question: 'Question' }) : 'ran'),
    });
    const provider = {
      name: 'rule',
      complete: async (request: LLMRequest) => {
        const first = request.messages.find((m) => m.role === 'user')?.content;
        return String(first).startsWith('BOB') && !request.messages.some((m) => m.role === 'tool')
          ? {
              content: '',
              toolCalls: [{ id: 'call', name: 'hold', args: {} }],
              usage: { input: 1, output: 1 },
            }
          : { content: `answer:${String(first)}`, toolCalls: [], usage: { input: 1, output: 1 } };
      },
    };
    const make = () => Agent.create({ provider, model: 'mock' }).tool(tool).build();
    const bob = make(),
      pause = await bob.run({
        message: 'BOB-PRIVATE',
        identity: { conversationId: 'b', principal: 'bob' },
      });
    if (!isPaused(pause)) throw new Error('Expected pause');
    const answer =
      door === 'replay' ? checkInApproved({ request: pause.checkIn!, by: 'bob' }) : undefined;
    if (door === 'replay') await bob.resume(pause.checkpoint, answer);
    const alice = make();
    await alice.run({ message: 'ALICE', identity: { conversationId: 'a', principal: 'alice' } });
    const before = alice.checkpoint();
    await expect(alice.resume(pause.checkpoint, answer)).rejects.toBeInstanceOf(Error);
    // checkpointedAt is the capture clock; all stored conversation fields remain exact.
    expect(alice.checkpoint()).toEqual({ ...before, checkpointedAt: expect.any(Number) });
    expect(JSON.stringify(alice.getLastSnapshot())).not.toContain('BOB-PRIVATE');
    expect(JSON.stringify(alice.getLastNarrativeEntries())).not.toContain('BOB-PRIVATE');
    expect(await alice.abandonPause()).toBeUndefined();
    expect(await alice.followUp('next')).toBe('answer:ALICE');
  },
);

it.each(['without-reader', 'spend-race'] as const)(
  'known boundary: a %s ledger refusal after origin remains the latest execution',
  async (kind) => {
    const seen = new Set<string>();
    const ledger: DecisionLedger = {
      ...(kind === 'spend-race' && { isSpent: () => false }),
      spend: (id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      },
    };
    const make = () =>
      Agent.create({
        decisionLedger: ledger,
        provider: mock({
          replies: [{ toolCalls: [{ id: 'call', name: 'hold', args: {} }] }, 'done'],
        }),
        model: 'mock',
      })
        .tool(
          defineTool({
            name: 'hold',
            description: 'Gate',
            inputSchema: { type: 'object' },
            checkIn: 'always',
            execute: () => 'ran',
          }),
        )
        .build();
    const bob = make(),
      pause = await bob.run({
        message: 'BOB-BOUNDARY',
        identity: { conversationId: 'b', principal: 'bob' },
      });
    if (!isPaused(pause)) throw new Error('Expected pause');
    const answer = checkInApproved({ request: pause.checkIn!, by: 'bob' });
    await bob.resume(pause.checkpoint, answer);
    const shared = make();
    await expect(shared.resume(pause.checkpoint, answer)).rejects.toMatchObject({
      reason: 'already-answered',
    });
    expect(JSON.stringify(shared.getLastSnapshot())).toContain('BOB-BOUNDARY');
    await expect(
      shared.followUp('alice', { identity: { conversationId: 'a', principal: 'alice' } }),
    ).rejects.toMatchObject({ code: 'ERR_SESSION_OWNERSHIP_CONFLICT' });
  },
);

it('cancelling a pre-origin ledger read releases the instance and preserves the selected person', async () => {
  let start!: () => void, release!: (used: boolean) => void;
  const entered = new Promise<void>((done) => {
    start = done;
  });
  const read = new Promise<boolean>((done) => {
    release = done;
  });
  const ledger: DecisionLedger = {
    spend: () => true,
    isSpent: () => {
      start();
      return read;
    },
  };
  const tool = defineTool({
    name: 'hold',
    description: 'Gate',
    inputSchema: { type: 'object' },
    checkIn: 'always',
    execute: () => 'ran',
  });
  const bob = Agent.create({
    decisionLedger: ledger,
    provider: mock({ replies: [{ toolCalls: [{ id: 'held', name: 'hold', args: {} }] }] }),
    model: 'mock',
  })
    .tool(tool)
    .build();
  const pause = await bob.run({
    message: 'BOB-PRIVATE',
    identity: { conversationId: 'b', principal: 'bob' },
  });
  if (!isPaused(pause)) throw new Error('Expected pause');
  const alice = Agent.create({
    decisionLedger: ledger,
    provider: mock({ replies: ['ALICE', 'NEXT'] }),
    model: 'mock',
  })
    .tool(tool)
    .build();
  await alice.run({ message: 'ALICE', identity: { conversationId: 'a', principal: 'alice' } });
  const controller = new AbortController(),
    reason = new Error('cancelled by caller');
  let failure: unknown;
  const resumed = alice
    .resume(pause.checkpoint, checkInApproved({ request: pause.checkIn!, by: 'bob' }), {
      signal: controller.signal,
    })
    .catch((error: unknown) => {
      failure = error;
    });
  try {
    await entered;
    controller.abort(reason);
    await new Promise<void>((done) => setImmediate(done));
    expect(failure).toBe(reason);
    expect(alice.checkpoint()?.identity?.principal).toBe('alice');
    expect(await alice.followUp('next')).toBe('NEXT');
  } finally {
    release(false);
    await resumed;
  }
});
