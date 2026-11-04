import { expect, it } from 'vitest';
import { flowChart, type FlowChart, type TypedScope } from 'footprintjs';
import { LLMCall } from '../../src/core/LLMCall.js';
import { RunnerBase } from '../../src/core/RunnerBase.js';
import { Sequence } from '../../src/core-flow/Sequence.js';
import { Parallel } from '../../src/core-flow/Parallel.js';
import { workflow } from '../../src/core-flow/Workflow.js';
import { llmRouter, type RoutingDecision } from '../../src/patterns/LlmRouter.js';
import { requireRoutingDecision } from '../../src/patterns/routing.js';
import { swarm } from '../../src/patterns/Swarm.js';
import { mock } from '../../src/doors/providers.js';
import type { LLMProvider } from '../../src/provider-contract/types.js';

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** An awaited native stage after routing: the decision itself crosses this wait. */
class WaitDecision extends RunnerBase<RoutingDecision, RoutingDecision> {
  constructor(private readonly wait: (decision: RoutingDecision) => Promise<void>) {
    super();
    this.initChart(() => this.buildChart(), {
      runnerId: 'hold-decision',
      compositionPath: ['hold-decision'],
      initialize: () => ({}),
    });
  }
  private buildChart(): FlowChart {
    return flowChart<RoutingDecision, TypedScope<Record<string, unknown>>>(
      'Hold decision',
      async (scope) => {
        const decision = scope.$getArgs<RoutingDecision>();
        await this.wait(decision);
        return decision;
      },
      'hold-decision',
    ).build();
  }
  async run(input: RoutingDecision): Promise<RoutingDecision> {
    return this.runExecution().withRun(async (invocation) =>
      requireRoutingDecision(await invocation.execute({ kind: 'run', options: { input } })),
    );
  }
  async resume(): Promise<RoutingDecision> {
    throw new Error('mounted wait stage only');
  }
}

it('a shared router never spends another parent decision for identical handoff text', async () => {
  const waiting = barrier();
  const reached = barrier();
  const provider: LLMProvider = {
    name: 'mock',
    complete: async (request) => {
      const text = request.messages.find((message) => message.role === 'user')?.content;
      return {
        content: JSON.stringify({ agentId: text === 'alpha' ? 'a' : 'b', message: 'same handoff' }),
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'stop',
      };
    },
  };
  const router = llmRouter({
    provider,
    model: 'mock',
    agents: [
      { id: 'a', description: 'first' },
      { id: 'b', description: 'second' },
    ],
  });
  const step = workflow(
    router.step,
    new WaitDecision(async (decision) => {
      if (decision.agentId === 'a') {
        reached.release();
        await waiting.promise;
      }
    }),
  );
  const desk = swarm({
    agents: [
      {
        id: 'a',
        runner: LLMCall.create({ provider: mock({ reply: 'answer a' }), model: 'mock' }).build(),
      },
      {
        id: 'b',
        runner: LLMCall.create({ provider: mock({ reply: 'answer b' }), model: 'mock' }).build(),
      },
    ],
    router: { step },
    maxHandoffs: 1,
  });
  const a = Sequence.create({ id: 'a' }).step('desk', desk).build();
  const b = Sequence.create({ id: 'b' }).step('desk', desk).build();
  const first = a.run('alpha');
  const firstObserved = first.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  try {
    await reached.promise;
    await expect(b.run('beta')).resolves.toBe('answer b');
  } finally {
    waiting.release();
    await firstObserved;
  }
  await expect(first).resolves.toBe('answer a');
});

function routingFixture(heldId: 'a' | 'b' = 'a') {
  const waiting = barrier();
  const reached = barrier();
  const otherDispatched = barrier();
  const router = llmRouter({
    provider: {
      name: 'mock',
      complete: async (request) => ({
        content: JSON.stringify({
          agentId:
            request.messages.find((message) => message.role === 'user')?.content === 'alpha'
              ? 'a'
              : 'b',
          message: 'same handoff',
          reason: 'observation only',
        }),
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'stop',
      }),
    },
    model: 'mock',
    agents: [
      { id: 'a', description: 'first' },
      { id: 'b', description: 'second' },
    ],
  });
  const step = workflow(
    router.step,
    new WaitDecision(async (decision) => {
      if (decision.agentId === heldId) {
        reached.release();
        await waiting.promise;
      }
    }),
  );
  const agents = (['a', 'b'] as const).map((id) => ({
    id,
    runner: LLMCall.create({
      model: 'mock',
      provider: {
        name: 'mock',
        complete: async () => {
          if (id !== heldId) otherDispatched.release();
          return {
            content: `answer ${id}`,
            toolCalls: [],
            usage: { input: 1, output: 1 },
            stopReason: 'stop',
          };
        },
      },
    }).build(),
  }));
  return {
    waiting,
    reached,
    otherDispatched,
    router,
    desk: swarm({ agents, router: { step }, maxHandoffs: 1 }),
  };
}

it('keeps a later parent decision while an earlier-completing parent finishes', async () => {
  const { desk, waiting, reached } = routingFixture('b');
  const first = Sequence.create({ id: 'held-b' }).step('desk', desk).build().run('beta');
  const observed = first.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  try {
    await reached.promise;
    await expect(
      Sequence.create({ id: 'other-a' }).step('desk', desk).build().run('alpha'),
    ).resolves.toBe('answer a');
  } finally {
    waiting.release();
    await observed;
  }
  await expect(first).resolves.toBe('answer b');
});

it('keeps the decision when another invocation evicts every observation while it waits', async () => {
  const { desk, router, waiting, reached } = routingFixture();
  const first = Sequence.create({ id: 'held' }).step('desk', desk).build().run('alpha');
  const observed = first.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  try {
    await reached.promise;
    // Direct admission overlaps a mounted use of the SAME router. The 80 later
    // observations replace the held decision in its bounded public history.
    for (let index = 0; index < 80; index += 1) {
      await expect(router.step.run({ message: `later-${index}` })).resolves.toMatchObject({
        agentId: 'b',
      });
    }
    const history = router.decisions();
    expect(history).toHaveLength(64);
    expect(history.every((decision) => decision.agentId === 'b')).toBe(true);
    expect(() => Reflect.set(history[0], 'agentId', 'a')).not.toThrow();
    expect(history[0].agentId).toBe('b');
    expect(router.decisionFor('same handoff')?.agentId).toBe('b');
  } finally {
    waiting.release();
    await observed;
  }
  await expect(first).resolves.toBe('answer a');
});

it('separates identical-message decisions in two sibling mounts within one native leg', async () => {
  const { desk, waiting, reached, otherDispatched } = routingFixture();
  const branch = (id: string, message: string) =>
    Sequence.create({ id })
      .step('label', LLMCall.create({ provider: mock({ reply: message }), model: 'mock' }).build())
      .step('desk', desk)
      .build();
  const parent = Parallel.create({ id: 'same-leg' })
    .branch('left', branch('left', 'alpha'))
    .branch('right', branch('right', 'beta'))
    .mergeWithFn((results) => `${results.left}|${results.right}`)
    .build();
  const result = parent.run('start');
  const observed = result.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  try {
    await reached.promise;
    await otherDispatched.promise;
  } finally {
    waiting.release();
    await observed;
  }
  await expect(result).resolves.toBe('answer a|answer b');
});
