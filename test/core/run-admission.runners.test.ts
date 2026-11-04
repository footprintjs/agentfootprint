import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/core/Agent.js';
import { LLMCall } from '../../src/core/LLMCall.js';
import { Sequence } from '../../src/core-flow/Sequence.js';
import { Parallel } from '../../src/core-flow/Parallel.js';
import { Conditional } from '../../src/core-flow/Conditional.js';
import { Loop } from '../../src/core-flow/Loop.js';
import { graph } from '../../src/core-flow/Graph.js';
import { workflow } from '../../src/core-flow/Workflow.js';
import { llmRouter } from '../../src/patterns/LlmRouter.js';
import { mock } from '../../src/doors/providers.js';
import type { LLMProvider } from '../../src/provider-contract/types.js';

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function observed<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: unknown) => ({ status: 'rejected' as const, reason }),
  );
}

interface PublicRunner {
  run(input: { message: string }): Promise<unknown>;
}

const shapes: ReadonlyArray<{
  readonly name: string;
  readonly build: (provider: LLMProvider) => PublicRunner;
}> = [
  { name: 'Agent', build: (provider) => Agent.create({ provider, model: 'mock' }).build() },
  { name: 'LLMCall', build: (provider) => LLMCall.create({ provider, model: 'mock' }).build() },
  {
    name: 'Sequence',
    build: (provider) =>
      Sequence.create()
        .step('leaf', LLMCall.create({ provider, model: 'mock' }).build())
        .build(),
  },
  {
    name: 'Parallel',
    build: (provider) =>
      Parallel.create()
        .branch('leaf', LLMCall.create({ provider, model: 'mock' }).build())
        .branch(
          'other',
          LLMCall.create({ provider: mock({ reply: 'other' }), model: 'mock' }).build(),
        )
        .mergeWithFn((rows) => rows.leaf!)
        .build(),
  },
  {
    name: 'Conditional',
    build: (provider) =>
      Conditional.create()
        .when('yes', () => true, LLMCall.create({ provider, model: 'mock' }).build())
        .otherwise('no', LLMCall.create({ provider, model: 'mock' }).build())
        .build(),
  },
  {
    name: 'Loop',
    build: (provider) =>
      Loop.create()
        .repeat(LLMCall.create({ provider, model: 'mock' }).build())
        .times(1)
        .build(),
  },
  {
    name: 'Workflow',
    build: (provider) => workflow(LLMCall.create({ provider, model: 'mock' }).build()),
  },
  {
    name: 'Graph',
    build: (provider) =>
      graph({
        nodes: [{ id: 'leaf', runner: LLMCall.create({ provider, model: 'mock' }).build() }],
        edges: [],
      }),
  },
  {
    name: 'RouterStep',
    build: (provider) =>
      llmRouter({
        provider,
        model: 'mock',
        agents: [
          { id: 'a', description: 'first' },
          { id: 'b', description: 'second' },
        ],
      }).step,
  },
];

describe('every public runner owns the complete invocation', () => {
  for (const shape of shapes) {
    it(`${shape.name} refuses overlap before a second provider call, then permits reuse`, async () => {
      const gate = barrier();
      const reached = barrier();
      let calls = 0;
      const provider: LLMProvider = {
        name: 'mock',
        complete: async () => {
          calls++;
          reached.release();
          await gate.promise;
          return {
            content:
              shape.name === 'RouterStep'
                ? '{"agentId":"a","message":"routed","reason":"match"}'
                : 'ok',
            toolCalls: [],
            usage: { input: 1, output: 1 },
            stopReason: 'stop',
          };
        },
      };
      const runner = shape.build(provider);
      const first = observed(runner.run({ message: 'owner' }));
      let second: ReturnType<typeof observed<unknown>> | undefined;
      try {
        await reached.promise;
        second = observed(runner.run({ message: 'intruder' }));
        let secondResult: Awaited<typeof second> | undefined;
        void second.then((result) => {
          secondResult = result;
        });
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
        expect(secondResult).toMatchObject({
          status: 'rejected',
          reason: { name: 'RunInFlightError', code: 'ERR_RUN_IN_FLIGHT' },
        });
        expect(calls).toBe(1);
      } finally {
        gate.release();
        // Even a failing refusal assertion joins all work it started.
        await Promise.all([first, ...(second ? [second] : [])]);
      }
      expect(await first).toMatchObject({ status: 'fulfilled' });
      await expect(runner.run({ message: 'next' })).resolves.toBeDefined();
      expect(calls).toBe(2);
    });
  }
});
