import { expect, it } from 'vitest';
import { z } from 'zod';
import { Agent } from '../../../Agent.js';
import { mock } from '../../../../adapters/llm/MockProvider.js';

it('native admission precedes an input getter that re-enters the same agent', async () => {
  const agent = Agent.create({ provider: mock({ reply: 'answer' }), model: 'mock' }).build();
  let nested: Promise<unknown> | undefined;
  const input = {
    get message(): string {
      nested ??= agent.run('nested').then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      return 'outer';
    },
  };
  const outer = await agent.run(input).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  const second = (await nested) as { error?: { code?: string }; value?: unknown };
  expect.soft(outer).toEqual({ value: 'answer' });
  expect.soft(second.error?.code).toBe('ERR_RUN_IN_FLIGHT');
  expect.soft(second.value).toBeUndefined();
  await expect(agent.run('after')).resolves.toBe('answer');
});

it('typed answer postprocessing retains native admission until fallback settles', async () => {
  let entered!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const agent = Agent.create({ provider: mock({ reply: 'not JSON' }), model: 'mock' })
    .outputSchema(z.object({ answer: z.string() }))
    .outputFallback({
      fallback: async () => {
        entered();
        await held;
        return { answer: 'recovered' };
      },
    })
    .build();
  const first = agent.runTyped('first');
  const observed = first.catch((error: unknown) => ({ error }));
  try {
    await reached;
    const second = (await agent.run('second').then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    )) as { error?: { code?: string }; value?: unknown };
    expect.soft(second.error?.code).toBe('ERR_RUN_IN_FLIGHT');
    expect.soft(second.value).toBeUndefined();
  } finally {
    release();
    await observed;
  }
  await expect(first).resolves.toEqual({ answer: 'recovered' });
  await expect(agent.run('after')).resolves.toBe('not JSON');
});
