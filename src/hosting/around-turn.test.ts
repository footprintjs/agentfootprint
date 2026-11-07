/**
 * `.aroundTurn()` behind a host, and the guard against a replaced door.
 *
 * Pinned:
 *   - a refused request never enters the wrapper: identity, admission, session
 *     ownership;
 *   - a wrapper's context cannot cross sessions on a shared instance;
 *   - a stored question survives a wrapper that throws before `proceed`;
 *   - `standingAgent` refuses a replaced `run` or `resume`, by name, when it
 *     accepts the agent and on every turn after.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { afterEach, describe, expect, it } from 'vitest';

import { Agent, askHuman, checkInApproved, defineTool } from '../index.js';
import { mock } from '../llm-providers.js';
import type { LLMProvider } from '../provider-contract/types.js';
import { inProcessHost } from '../../test/hosting/testHost.js';
import { ReplacedRunnerMethodError } from './errors.js';
import { memorySessions, standingAgent, turnsPerHour } from './index.js';
import type { CheckpointEnvelope } from './types.js';

const plain = () => Agent.create({ provider: mock({ reply: 'done' }), model: 'mock' }).build();

describe('a refused request never enters the wrapper', () => {
  const entered: unknown[] = [];
  const watched = () =>
    Agent.create({ provider: mock({ reply: 'done' }), model: 'mock' })
      .aroundTurn({
        name: 'watch',
        around: (turn, proceed) => {
          entered.push(turn.kind);
          return proceed();
        },
      })
      .build();
  const verify = async (token: string) => {
    if (token === 'ann-token') return { userId: 'ann', claims: {} };
    if (token === 'bob-token') return { userId: 'bob', claims: {} };
    throw new Error('bad token');
  };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  afterEach(() => {
    entered.length = 0;
  });

  it('by identity', async () => {
    const host = inProcessHost();
    await standingAgent({
      agent: watched(),
      sessions: memorySessions(),
      host,
      identity: { verify },
    });
    const refused = await host.deliver({ input: 'hi', headers: bearer('forged') });
    expect(refused.error).toBeDefined();
    expect(entered).toEqual([]);
    const admitted = await host.deliver({ input: 'hi', headers: bearer('ann-token') });
    expect(admitted.output).toBe('done');
    expect(entered).toEqual(['run']);
  });

  it('by admission', async () => {
    const host = inProcessHost();
    await standingAgent({
      agent: watched(),
      sessions: memorySessions(),
      host,
      admission: turnsPerHour({ limit: 1 }),
    });
    expect((await host.deliver({ input: 'one', sessionId: 'a', userId: 'ann' })).output).toBe(
      'done',
    );
    const refused = await host.deliver({ input: 'two', sessionId: 'a', userId: 'ann' });
    expect(refused.code).toBe('ERR_ADMISSION_REFUSED');
    expect(entered).toEqual(['run']);
  });

  it('by session ownership', async () => {
    const host = inProcessHost();
    await standingAgent({
      agent: watched(),
      sessions: memorySessions(),
      host,
      identity: { verify },
    });
    const headers = bearer('ann-token');
    expect((await host.deliver({ input: 'one', sessionId: 'ann-s', headers })).output).toBe('done');
    expect(entered).toEqual(['run']);
    const refused = await host.deliver({
      input: 'two',
      sessionId: 'ann-s',
      headers: bearer('bob-token'),
    });
    expect(refused.code).toBe('ERR_SESSION_NOT_FOUND');
    expect(entered).toEqual(['run']);
  });
});

describe('a shared instance', () => {
  it("keeps one session's wrapper context out of another's", async () => {
    const context = new AsyncLocalStorage<string>();
    const seen: { session: string | undefined; tool: unknown; provider: unknown }[] = [];
    let providerSaw: unknown;
    let step = 0;
    const provider: LLMProvider = {
      name: 'context',
      async complete() {
        providerSaw = context.getStore();
        step += 1;
        return step % 2 === 1
          ? {
              content: '',
              toolCalls: [{ id: `call-${step}`, name: 'look', args: {} }],
              usage: { input: 1, output: 1 },
            }
          : { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } };
      },
    };
    const agent = Agent.create({ provider, model: 'mock' })
      .aroundTurn({
        name: 'context',
        around: (turn, proceed) => context.run(`for ${turn.options?.sessionId}`, () => proceed()),
      })
      .tool(
        defineTool({
          name: 'look',
          description: 'Look',
          inputSchema: { type: 'object' },
          execute: async (_args, ctx) => {
            await new Promise((resolve) => setTimeout(resolve, 2));
            seen.push({ session: ctx.sessionId, tool: context.getStore(), provider: providerSaw });
            return 'seen';
          },
        }),
      )
      .build();
    const host = inProcessHost();
    await standingAgent({ agent, sessions: memorySessions(), host });
    await Promise.all(['a', 'b', 'c'].map((sessionId) => host.deliver({ input: 'hi', sessionId })));
    expect(seen).toHaveLength(3);
    for (const row of seen) {
      expect(row.tool).toBe(`for ${row.session}`);
      expect(row.provider).toBe(`for ${row.session}`);
    }
    expect(context.getStore()).toBeUndefined();
  });
});

describe('a stored question', () => {
  it('stays answerable after a wrapper throws before proceed', async () => {
    let refuse = false;
    const sessions = memorySessions();
    const host = inProcessHost();
    await standingAgent({
      agent: Agent.create({
        provider: mock({
          replies: [{ toolCalls: [{ id: 'held', name: 'ask', args: {} }] }, 'answered'],
        }),
        model: 'mock',
      })
        .aroundTurn({
          name: 'prepare',
          around: async (_turn, proceed) => {
            if (refuse) throw new RangeError('prepare failed');
            await proceed();
          },
        })
        .tool(
          defineTool({
            name: 'ask',
            description: 'Ask',
            inputSchema: { type: 'object' },
            execute: () => askHuman({ question: 'Continue?' }),
          }),
        )
        .build(),
      sessions,
      host,
    });
    expect((await host.deliver({ input: 'first', sessionId: 's' })).awaiting).toBeDefined();
    const before: CheckpointEnvelope | undefined = await sessions.hydrate('s');

    refuse = true;
    const failed = await host.deliver({ input: 'x', sessionId: 's', decision: 'yes' });
    expect(failed.error).toContain('prepare failed');
    expect(await sessions.hydrate('s')).toEqual(before);

    refuse = false;
    const answered = await host.deliver({ input: 'x', sessionId: 's', decision: 'yes' });
    expect(answered.output).toBe('answered');
  });
});

describe('a consent decision', () => {
  it('is not used up by a wrapper that throws before proceed', async () => {
    let refuse = false;
    const ran: string[] = [];
    const provider: LLMProvider = {
      name: 'scripted',
      async complete(request) {
        return request.messages.some((message) => message.role === 'tool')
          ? { content: 'acted', toolCalls: [], usage: { input: 1, output: 1 } }
          : {
              content: '',
              toolCalls: [{ id: 'held', name: 'act', args: {} }],
              usage: { input: 1, output: 1 },
            };
      },
    };
    const sessions = memorySessions();
    const host = inProcessHost();
    await standingAgent({
      agent: Agent.create({ provider, model: 'mock' })
        .aroundTurn({
          name: 'prepare',
          around: async (_turn, proceed) => {
            if (refuse) throw new RangeError('prepare failed');
            await proceed();
          },
        })
        .tool(
          defineTool({
            name: 'act',
            description: 'Act after approval',
            inputSchema: { type: 'object' },
            checkIn: 'always',
            execute: () => {
              ran.push('ran');
              return 'done';
            },
          }),
        )
        .build(),
      sessions,
      host,
    });
    const asked = await host.deliver({ input: 'ask', sessionId: 's' });
    if (asked.awaiting?.checkIn === undefined) throw new Error('Expected an approval');
    const decision = checkInApproved({ request: asked.awaiting.checkIn, by: 'person' });
    const before = await sessions.hydrate('s');

    refuse = true;
    const failed = await host.deliver({ input: '', sessionId: 's', decision });
    expect(failed.error).toContain('prepare failed');
    expect(ran).toEqual([]);
    expect(await sessions.hydrate('s')).toEqual(before);

    refuse = false;
    const answered = await host.deliver({ input: '', sessionId: 's', decision });
    expect(answered.output).toBe('acted');
    expect(ran).toEqual(['ran']);
  });
});

describe('standingAgent refuses a replaced door', () => {
  const replacements: readonly (readonly [string, () => Agent, readonly string[]])[] = [
    [
      'an own run',
      () => {
        const agent = plain();
        const run = agent.run.bind(agent);
        agent.run = (...args) => run(...args);
        return agent;
      },
      ['run'],
    ],
    [
      'an own resume',
      () => {
        const agent = plain();
        const resume = agent.resume.bind(agent);
        agent.resume = (...args) => resume(...args);
        return agent;
      },
      ['resume'],
    ],
    [
      'both, bound',
      () => {
        const agent = plain();
        agent.run = agent.run.bind(agent);
        agent.resume = agent.resume.bind(agent);
        return agent;
      },
      ['run', 'resume'],
    ],
    [
      'a subclass override',
      () => {
        const agent = plain();
        class Overriding extends Agent {
          override run(...args: Parameters<Agent['run']>) {
            return super.run(...args);
          }
        }
        return Object.setPrototypeOf(agent, Overriding.prototype) as Agent;
      },
      ['run'],
    ],
  ];

  it.each(replacements)('%s, at construction', async (_name, build, methods) => {
    const refusal = await standingAgent({
      agent: build(),
      sessions: memorySessions(),
      host: inProcessHost(),
    }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ReplacedRunnerMethodError);
    expect(refusal).toMatchObject({ code: 'ERR_REPLACED_RUNNER_METHOD', methods });
    expect((refusal as Error).message).toContain('.aroundTurn');
  });

  it('from a factory, when it builds the lane, before anything runs', async () => {
    const host = inProcessHost();
    await standingAgent({
      agentFactory: () => {
        const agent = plain();
        agent.run = agent.run.bind(agent);
        return agent;
      },
      sessions: memorySessions(),
      host,
    });
    const refused = await host.deliver({ input: 'hi', sessionId: 's' });
    expect(refused.code).toBe('ERR_REPLACED_RUNNER_METHOD');
  });

  it('a replacement after the host accepted the agent, on the next turn', async () => {
    const calls: string[] = [];
    const agent = plain();
    const host = inProcessHost();
    await standingAgent({ agent, sessions: memorySessions(), host });
    expect((await host.deliver({ input: 'one', sessionId: 's' })).output).toBe('done');
    const run = agent.run.bind(agent);
    agent.run = (...args) => {
      calls.push('replaced');
      return run(...args);
    };
    const refused = await host.deliver({ input: 'two', sessionId: 's' });
    expect(refused.code).toBe('ERR_REPLACED_RUNNER_METHOD');
    expect(calls).toEqual([]);
  });

  it('a patch of the class prototype counts too', async () => {
    const original = Agent.prototype.run;
    Agent.prototype.run = function patched(this: Agent, ...args) {
      return original.apply(this, args);
    };
    try {
      await expect(
        standingAgent({ agent: plain(), sessions: memorySessions(), host: inProcessHost() }),
      ).rejects.toBeInstanceOf(ReplacedRunnerMethodError);
    } finally {
      Agent.prototype.run = original;
    }
  });

  it('an agent with .aroundTurn and no replaced door is served', async () => {
    const host = inProcessHost();
    await standingAgent({
      agent: Agent.create({ provider: mock({ reply: 'done' }), model: 'mock' })
        .aroundTurn({ name: 'prepare', around: (_turn, proceed) => proceed() })
        .build(),
      sessions: memorySessions(),
      host,
    });
    expect((await host.deliver({ input: 'hi', sessionId: 's' })).output).toBe('done');
  });
});
