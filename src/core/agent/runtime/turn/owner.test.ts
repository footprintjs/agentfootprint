/**
 * `proceed` resolves only after the turn is finished: the run's finalizers
 * (the recording filed, resources closed) run inside the wrapper's context,
 * on every door, once, with the end the leg really had.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, it } from 'vitest';

import {
  Agent,
  askHuman,
  defineTool,
  inMemoryArtifacts,
  isPaused,
  type AroundTurn,
} from '../../../../index.js';
import { memorySessions, standingAgent } from '../../../../hosting/index.js';
import { mock } from '../../../../llm-providers.js';
import type { LLMProvider } from '../../../../provider-contract/types.js';
import { inProcessHost } from '../../../../../test/hosting/testHost.js';

/** A wrapper holding a context around `proceed`, and the order things happened in. */
function watched() {
  const context = new AsyncLocalStorage<string>();
  const log: string[] = [];
  const wrapper: AroundTurn = {
    name: 'context',
    around: (turn, proceed) =>
      context.run(turn.kind, async () => {
        try {
          await proceed();
          log.push(`${turn.kind}: proceed resolved`);
        } catch (error) {
          log.push(`${turn.kind}: proceed rejected`);
          throw error;
        }
      }),
  };
  const note = (what: string) => () => log.push(`${what} in ${context.getStore() ?? 'no context'}`);
  return { context, log, wrapper, note };
}

const ask = defineTool({
  name: 'ask',
  description: 'Ask',
  inputSchema: { type: 'object' },
  execute: () => askHuman({ question: 'Continue?' }),
});

/** A tool whose resource lives for the run, and closes when the run is finalized. */
function resource(log: string[], context: AsyncLocalStorage<string>) {
  return defineTool({
    name: 'open',
    description: 'Open a resource for the run',
    inputSchema: { type: 'object' },
    execute: (_args, ctx) => {
      ctx.onTeardown!(
        () => {
          log.push(`closed in ${context.getStore() ?? 'no context'}`);
        },
        { scope: 'run' },
      );
      return 'opened';
    },
  });
}

describe('the recording is filed before proceed resolves, inside the wrapper', () => {
  it('on run', async () => {
    const { log, wrapper, note } = watched();
    const agent = Agent.create({
      provider: mock({ reply: 'done' }),
      model: 'mock',
      artifacts: { store: inMemoryArtifacts(), recordings: true },
    })
      .aroundTurn(wrapper)
      .build();
    agent.on('agentfootprint.artifacts.minted', note('minted'));
    expect(await agent.run('hello')).toBe('done');
    expect(log).toEqual(['minted in run', 'run: proceed resolved']);
  });

  it('on resume', async () => {
    const { log, wrapper, note } = watched();
    const agent = Agent.create({
      provider: mock({
        replies: [{ toolCalls: [{ id: 'held', name: 'ask', args: {} }] }, 'answered'],
      }),
      model: 'mock',
      artifacts: { store: inMemoryArtifacts(), recordings: true },
    })
      .aroundTurn(wrapper)
      .tool(ask)
      .build();
    agent.on('agentfootprint.artifacts.minted', note('minted'));
    const paused = await agent.run('hello');
    if (!isPaused(paused)) throw new Error('Expected a pause');
    // A paused run files no recording; its leg files one when it completes.
    expect(log).toEqual(['run: proceed resolved']);
    expect(await agent.resume(paused.checkpoint, 'yes')).toBe('answered');
    expect(log).toEqual(['run: proceed resolved', 'minted in resume', 'resume: proceed resolved']);
  });

  it('on a hosted run and a hosted resume', async () => {
    const { log, wrapper, note } = watched();
    const agent = Agent.create({
      provider: mock({
        replies: ['done', { toolCalls: [{ id: 'held', name: 'ask', args: {} }] }, 'answered'],
      }),
      model: 'mock',
      artifacts: { store: inMemoryArtifacts(), recordings: true },
    })
      .aroundTurn(wrapper)
      .tool(ask)
      .build();
    agent.on('agentfootprint.artifacts.minted', note('minted'));
    const host = inProcessHost();
    await standingAgent({ agent, sessions: memorySessions(), host });

    expect((await host.deliver({ input: 'one', sessionId: 'a' })).output).toBe('done');
    expect(log).toEqual(['minted in run', 'run: proceed resolved']);

    log.length = 0;
    expect((await host.deliver({ input: 'two', sessionId: 'b' })).awaiting).toBeDefined();
    const answered = await host.deliver({ input: 'x', sessionId: 'b', decision: 'yes' });
    expect(answered.output).toBe('answered');
    expect(log).toEqual(['run: proceed resolved', 'minted in resume', 'resume: proceed resolved']);
  });
});

describe('every end finalizes once, inside the wrapper, with the end the leg had', () => {
  it('a failed turn closes its resources before proceed rejects', async () => {
    const { context, log, wrapper } = watched();
    let step = 0;
    const provider: LLMProvider = {
      name: 'failing',
      async complete() {
        step += 1;
        if (step > 1) throw new Error('provider down');
        return {
          content: '',
          toolCalls: [{ id: 'open', name: 'open', args: {} }],
          usage: { input: 1, output: 1 },
        };
      },
    };
    const agent = Agent.create({ provider, model: 'mock' })
      .aroundTurn(wrapper)
      .tool(resource(log, context))
      .build();
    await expect(agent.run('hello')).rejects.toThrow(/provider down/);
    expect(log).toEqual(['closed in run', 'run: proceed rejected']);
  });

  it('a cancelled turn closes its resources before proceed rejects', async () => {
    const { context, log, wrapper } = watched();
    const controller = new AbortController();
    let step = 0;
    const provider: LLMProvider = {
      name: 'cancelled',
      async complete() {
        step += 1;
        if (step > 1) {
          controller.abort(new Error('caller cancelled'));
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { content: 'too late', toolCalls: [], usage: { input: 1, output: 1 } };
        }
        return {
          content: '',
          toolCalls: [{ id: 'open', name: 'open', args: {} }],
          usage: { input: 1, output: 1 },
        };
      },
    };
    const agent = Agent.create({ provider, model: 'mock' })
      .aroundTurn(wrapper)
      .tool(resource(log, context))
      .build();
    await expect(agent.run('hello', { signal: controller.signal })).rejects.toThrow();
    expect(log).toEqual(['closed in run', 'run: proceed rejected']);
  });

  it('a paused turn keeps its resources for the answer, and its resume closes them once', async () => {
    const { context, log, wrapper } = watched();
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'open', name: 'open', args: {} }] },
          { toolCalls: [{ id: 'held', name: 'ask', args: {} }] },
          'answered',
        ],
      }),
      model: 'mock',
    })
      .aroundTurn(wrapper)
      .tool(resource(log, context))
      .tool(ask)
      .build();
    const paused = await agent.run('hello');
    if (!isPaused(paused)) throw new Error('Expected a pause');
    expect(log).toEqual(['run: proceed resolved']);
    expect(await agent.resume(paused.checkpoint, 'yes')).toBe('answered');
    expect(log).toEqual(['run: proceed resolved', 'closed in resume', 'resume: proceed resolved']);
  });

  it('a leg that fails in its own work after a paused run is still finalized as failed', async () => {
    // runTyped refuses a pause after the run paused: the run's own end says
    // paused, the turn failed. Its resources must close, not wait for an answer.
    const { context, log, wrapper } = watched();
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'open', name: 'open', args: {} }] },
          { toolCalls: [{ id: 'held', name: 'ask', args: {} }] },
        ],
      }),
      model: 'mock',
    })
      .aroundTurn(wrapper)
      .outputSchema({ parse: (value: unknown) => value })
      .tool(resource(log, context))
      .tool(ask)
      .build();
    await expect(agent.runTyped('hello')).rejects.toThrow(/typed mode does not support pauses/);
    // Closed when the lease ends the failed run, after the wrapper, never kept.
    expect(log).toEqual(['run: proceed rejected', 'closed in no context']);
  });
});

describe('an agent with no wrapper', () => {
  it('files its recording after the run, as before', async () => {
    const log: string[] = [];
    const agent = Agent.create({
      provider: mock({ reply: 'done' }),
      model: 'mock',
      artifacts: { store: inMemoryArtifacts(), recordings: true },
    }).build();
    agent.on('agentfootprint.artifacts.minted', () => log.push('minted'));
    const turn = agent.run('hello').then((out) => {
      log.push('run resolved');
      return out;
    });
    expect(await turn).toBe('done');
    expect(log).toEqual(['minted', 'run resolved']);
  });
});
