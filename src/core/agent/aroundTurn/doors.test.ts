/**
 * Every top-level turn goes through the one funnel, and an agent with no
 * wrapper gets the leg itself. One test per door.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, it } from 'vitest';

import { Agent, askHuman, defineTool, isPaused } from '../../../index.js';
import { agUi } from '../../../ag-ui/adapter.js';
import { memorySessions, standingAgent, streamHandler } from '../../../hosting/index.js';
import { mock } from '../../../llm-providers.js';
import type { LLMProvider } from '../../../provider-contract/types.js';
import { RunCheckpointError } from '../../runCheckpoint.js';
import { throughAroundTurn } from './funnel.js';
import type { AgentTurn, AroundTurn } from './types.js';
import { inProcessHost } from '../../../../test/hosting/testHost.js';

function recording() {
  const turns: AgentTurn[] = [];
  const wrapper: AroundTurn = {
    name: 'watch',
    around: (turn, proceed) => {
      turns.push(turn);
      return proceed();
    },
  };
  return { turns, wrapper };
}

const ask = defineTool({
  name: 'ask',
  description: 'Ask',
  inputSchema: { type: 'object' },
  execute: () => askHuman({ question: 'Continue?' }),
});

const askingReplies = [{ toolCalls: [{ id: 'held', name: 'ask', args: {} }] }, 'answered', 'later'];

describe('the funnel with no wrapper', () => {
  it('hands back the very promise the leg made, so it adds no await', () => {
    const leg = Promise.resolve('answer');
    const turn: AgentTurn = { kind: 'run', input: 'hello', options: undefined };
    expect(
      throughAroundTurn(
        undefined,
        turn,
        () => leg,
        () => undefined,
      ),
    ).toBe(leg);
  });
});

describe('every door', () => {
  it('run', async () => {
    const { turns, wrapper } = recording();
    const agent = Agent.create({ provider: mock({ reply: 'done' }), model: 'mock' })
      .aroundTurn(wrapper)
      .build();
    expect(await agent.run('hello', { sessionId: 's' })).toBe('done');
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ kind: 'run', input: 'hello', options: { sessionId: 's' } });
  });

  it('runTyped, with the typed fallback inside the turn', async () => {
    const { turns, wrapper } = recording();
    const context = new AsyncLocalStorage<string>();
    let seenByFallback: string | undefined;
    const agent = Agent.create({ provider: mock({ reply: '{"a":1}' }), model: 'mock' })
      .aroundTurn(wrapper)
      .outputSchema({ parse: () => ({ parsed: true }) })
      .build();
    expect(await agent.runTyped('hello')).toEqual({ parsed: true });
    expect(turns.map((turn) => turn.kind)).toEqual(['run']);

    const falling = Agent.create({ provider: mock({ reply: '{"a":1}' }), model: 'mock' })
      .aroundTurn({
        name: 'held',
        around: (_turn, proceed) => context.run('held', () => proceed()),
      })
      .outputSchema({
        parse: (value: unknown) => {
          if ((value as { fallen?: boolean }).fallen === true) return value;
          throw new Error('not the shape');
        },
      })
      .outputFallback({
        fallback: () => {
          seenByFallback = context.getStore();
          return { fallen: true };
        },
      })
      .build();
    expect(await falling.runTyped('hello')).toEqual({ fallen: true });
    expect(seenByFallback).toBe('held');
  });

  it('followUp, as a run that continues the conversation', async () => {
    const { turns, wrapper } = recording();
    const agent = Agent.create({ provider: mock({ reply: 'done' }), model: 'mock' })
      .aroundTurn(wrapper)
      .build();
    await agent.run('hello');
    await agent.followUp('and then');
    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatchObject({ kind: 'run', input: { message: 'and then' } });
    expect(turns[1]).toHaveProperty('input.continueFrom.history');
  });

  it('resumeOnError, as a run', async () => {
    const { turns, wrapper } = recording();
    let failed = false;
    const provider: LLMProvider = {
      name: 'fails-once',
      async complete(request) {
        if (!failed && request.messages.some((message) => message.role === 'tool')) {
          failed = true;
          throw new Error('provider down');
        }
        if (request.messages.some((message) => message.role === 'tool'))
          return { content: 'recovered', toolCalls: [], usage: { input: 1, output: 1 } };
        return {
          content: '',
          toolCalls: [{ id: 'one', name: 'look', args: {} }],
          usage: { input: 1, output: 1 },
        };
      },
    };
    const agent = Agent.create({ provider, model: 'mock' })
      .aroundTurn(wrapper)
      .tool(
        defineTool({
          name: 'look',
          description: 'Look',
          inputSchema: { type: 'object' },
          execute: () => 'seen',
        }),
      )
      .build();
    const failure = await agent.run('hello').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RunCheckpointError);
    expect(await agent.resumeOnError((failure as RunCheckpointError).checkpoint)).toBe('recovered');
    expect(turns.map((turn) => turn.kind)).toEqual(['run', 'run']);
    expect(turns[1]).toMatchObject({ kind: 'run', input: { message: 'hello' } });
  });

  it('resume', async () => {
    const { turns, wrapper } = recording();
    const agent = Agent.create({ provider: mock({ replies: askingReplies }), model: 'mock' })
      .aroundTurn(wrapper)
      .tool(ask)
      .build();
    const pause = await agent.run('first');
    if (!isPaused(pause)) throw new Error('Expected a pause');
    expect(await agent.resume(pause.checkpoint, 'yes')).toBe('answered');
    expect(turns.map((turn) => turn.kind)).toEqual(['run', 'resume']);
    expect(turns[1]).toMatchObject({
      kind: 'resume',
      answer: 'yes',
      checkpoint: { pausedAt: pause.checkpoint.pausedAt },
    });
  });

  it('a hosted run and a hosted resume', async () => {
    const { turns, wrapper } = recording();
    const host = inProcessHost();
    const handle = await standingAgent({
      agent: Agent.create({ provider: mock({ replies: askingReplies }), model: 'mock' })
        .aroundTurn(wrapper)
        .tool(ask)
        .build(),
      sessions: memorySessions(),
      host,
    });
    const asked = await host.deliver({ input: 'first', sessionId: 's' });
    expect(asked.awaiting).toBeDefined();
    const answered = await host.deliver({ input: 'x', sessionId: 's', decision: 'yes' });
    expect(answered.output).toBe('answered');
    expect(turns.map((turn) => turn.kind)).toEqual(['run', 'resume']);
    expect(turns[0]).toMatchObject({ options: { sessionId: 's' } });
    await handle.close();
  });

  it('the stream handler', async () => {
    const { turns, wrapper } = recording();
    const handle = streamHandler({
      adapter: agUi(),
      heartbeatMs: 0,
      agent: () =>
        Agent.create({ provider: mock({ reply: 'done' }), model: 'mock' })
          .aroundTurn(wrapper)
          .build(),
    });
    const response = await handle(
      new Request('http://localhost/agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          threadId: 't',
          runId: 'r',
          messages: [{ id: 'm', role: 'user', content: 'hello' }],
          tools: [],
          context: [],
          state: {},
          forwardedProps: {},
        }),
      }),
    );
    expect(await response.text()).toContain('RUN_FINISHED');
    expect(turns.map((turn) => turn.kind)).toEqual(['run']);
  });
});

describe('what the wrapper sees', () => {
  it('the sealed handle and the signal keep their identity; plain data is a frozen copy', async () => {
    const controller = new AbortController();
    let seen: AgentTurn | undefined;
    const identity = { conversationId: 'c', principal: 'p' };
    const agent = Agent.create({ provider: mock({ reply: 'done' }), model: 'mock' })
      .aroundTurn({
        name: 'see',
        around: (turn, proceed) => {
          seen = turn;
          return proceed();
        },
      })
      .build();
    await agent.run({ message: 'hello', identity }, { env: { signal: controller.signal } });
    const turn = seen as Extract<AgentTurn, { kind: 'run' }>;
    expect(turn.options?.env?.signal).toBe(controller.signal);
    expect(turn.input).toMatchObject({ message: 'hello', identity });
    expect((turn.input as { identity: object }).identity).not.toBe(identity);
    expect(Object.isFrozen((turn.input as { identity: object }).identity)).toBe(true);
    expect(Object.isFrozen(identity)).toBe(false);
  });
});
