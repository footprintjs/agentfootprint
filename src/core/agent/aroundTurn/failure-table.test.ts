/**
 * The failure table of `.aroundTurn()`: whatever a wrapper does, the library
 * keeps how the turn ended. One test per row.
 */

import { describe, expect, it, vi } from 'vitest';

import { Agent, AroundTurnError, askHuman, defineTool, isPaused } from '../../../index.js';
import type { AroundTurn } from './types.js';
import { mock } from '../../../llm-providers.js';
import type { LLMProvider } from '../../../provider-contract/types.js';

const AROUND_TURN_FAILED = 'agentfootprint.agent.around_turn_failed' as const;

function counted(replies: readonly string[] = ['done', 'next', 'again']) {
  const calls: unknown[] = [];
  let at = 0;
  const provider: LLMProvider = {
    name: 'counted',
    async complete(request) {
      calls.push(request);
      return {
        content: replies[Math.min(at++, replies.length - 1)]!,
        toolCalls: [],
        usage: { input: 1, output: 1 },
      };
    },
  };
  return { provider, calls };
}

function built(around: AroundTurn['around'], provider: LLMProvider = counted().provider) {
  return Agent.create({ provider, model: 'mock' }).aroundTurn({ name: 'wrap', around }).build();
}

function asking(around: AroundTurn['around']) {
  return Agent.create({
    provider: mock({
      replies: [{ toolCalls: [{ id: 'held', name: 'ask', args: {} }] }, 'answered', 'later'],
    }),
    model: 'mock',
  })
    .aroundTurn({ name: 'wrap', around })
    .tool(
      defineTool({
        name: 'ask',
        description: 'Ask',
        inputSchema: { type: 'object' },
        execute: () => askHuman({ question: 'Continue?' }),
      }),
    )
    .build();
}

function failuresOf(agent: Agent): unknown[] {
  const seen: unknown[] = [];
  agent.on(AROUND_TURN_FAILED, (event) => seen.push(event.payload));
  return seen;
}

describe('throws before proceed', () => {
  it('the turn rejects with that error and no run starts', async () => {
    const { provider, calls } = counted();
    const boom = new RangeError('not today');
    const agent = built(() => Promise.reject(boom), provider);
    const events: unknown[] = [];
    agent.on('*', (event) => events.push(event.type));
    await expect(agent.run('hello')).rejects.toBe(boom);
    expect(calls).toEqual([]);
    expect(events).toEqual([]);
    expect(agent.getLastSnapshot()).toBeUndefined();
  });

  it('a pending question stays pending, and the same answer resumes it', async () => {
    let refuse = false;
    const agent = asking(async (_turn, proceed) => {
      if (refuse) throw new Error('prepare failed');
      await proceed();
    });
    const pause = await agent.run('first');
    if (!isPaused(pause)) throw new Error('Expected a pause');

    refuse = true;
    await expect(agent.resume(pause.checkpoint, 'yes')).rejects.toThrow('prepare failed');
    refuse = false;
    await expect(agent.run('other')).rejects.toMatchObject({ code: 'ERR_PENDING_QUESTION' });
    expect(await agent.resume(pause.checkpoint, 'yes')).toBe('answered');
  });

  it('leaves a resumeOnError history for nobody: the next run starts fresh', async () => {
    const provider = counted(['fresh']);
    let refuse = true;
    const agent = built(async (_turn, proceed) => {
      if (refuse) throw new Error('prepare failed');
      await proceed();
    }, provider.provider);
    const stored = {
      version: 1,
      history: [{ role: 'user', content: 'held message' }],
      originalInput: { message: 'held message' },
      lastCompletedIteration: 1,
      runId: 'run-a',
      failurePoint: { iteration: 1, phase: 'llm' },
    };
    await expect(
      agent.resumeOnError(stored).catch((error: unknown) => error),
    ).resolves.toBeInstanceOf(Error);
    refuse = false;
    expect(await agent.run('new topic')).toBe('fresh');
    const request = provider.calls[0] as { messages: { content: unknown }[] };
    expect(JSON.stringify(request.messages)).not.toContain('held message');
  });
});

describe('returns without proceed', () => {
  it('is refused by name, and no run starts', async () => {
    const { provider, calls } = counted();
    const agent = built(() => undefined, provider);
    const refusal = await agent.run('hello').catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(AroundTurnError);
    expect(refusal).toMatchObject({
      code: 'ERR_AROUND_TURN',
      reason: 'not-proceeded',
      wrapper: 'wrap',
    });
    expect(calls).toEqual([]);
  });
});

describe('a second or a late proceed', () => {
  it('a second call is refused by name and the first run stands', async () => {
    const { provider, calls } = counted(['one answer']);
    let second: unknown;
    const agent = built(async (_turn, proceed) => {
      await proceed();
      second = await proceed().catch((error: unknown) => error);
    }, provider);
    expect(await agent.run('hello')).toBe('one answer');
    expect(second).toMatchObject({ code: 'ERR_AROUND_TURN', reason: 'second-proceed' });
    expect(calls).toHaveLength(1);
  });

  it('a call from inside a time getter is refused and the first run stands', async () => {
    const { provider, calls } = counted(['one answer']);
    let second: unknown;
    const agent = Agent.create({ provider, model: 'mock' })
      .time({ zone: 'UTC' })
      .aroundTurn({
        name: 'wrap',
        around: async (_turn, proceed) => {
          const changes = {
            get time() {
              second = proceed();
              return { now: '2026-11-07T00:00:00.000Z' };
            },
          };
          await proceed(changes);
          second = await (second as Promise<void>).catch((error: unknown) => error);
        },
      })
      .build();
    expect(await agent.run('hello')).toBe('one answer');
    expect(second).toMatchObject({ code: 'ERR_AROUND_TURN', reason: 'second-proceed' });
    expect(calls).toHaveLength(1);
  });

  it('a refused change leaves the wrapper free to call again', async () => {
    const { provider, calls } = counted(['one answer']);
    let refusal: unknown;
    const agent = built(async (_turn, proceed) => {
      refusal = await proceed({ nope: 1 } as never).catch((error: unknown) => error);
      await proceed();
    }, provider);
    expect(await agent.run('hello')).toBe('one answer');
    expect(refusal).toMatchObject({ code: 'ERR_AROUND_TURN', reason: 'unknown-change' });
    expect(calls).toHaveLength(1);
  });

  it.each(['ownKeys', 'getOwnPropertyDescriptor'] as const)(
    'changes whose %s trap throws start nothing and leave the wrapper free to call again',
    async (trap) => {
      const { provider, calls } = counted(['one answer']);
      const boom = new RangeError('trap');
      let caught: unknown;
      const changes = new Proxy(
        { time: {} },
        {
          [trap]() {
            throw boom;
          },
        },
      );
      const agent = built(async (_turn, proceed) => {
        caught = await proceed(changes as never).catch((error: unknown) => error);
        await proceed();
      }, provider);
      const failures = failuresOf(agent);
      expect(await agent.run('hello')).toBe('one answer');
      expect(caught).toBe(boom);
      expect(calls).toHaveLength(1);
      expect(failures).toEqual([]);
    },
  );

  it('a call after the wrapper settled is refused by name and starts nothing', async () => {
    const { provider, calls } = counted(['one answer']);
    let held: (() => Promise<void>) | undefined;
    const agent = built(async (_turn, proceed) => {
      held = proceed;
      await proceed();
    }, provider);
    expect(await agent.run('hello')).toBe('one answer');
    await expect(held!()).rejects.toMatchObject({
      code: 'ERR_AROUND_TURN',
      reason: 'late-proceed',
    });
    expect(calls).toHaveLength(1);
  });

  it('a misuse the wrapper ignored still reaches the record, once', async () => {
    const agent = built(async (_turn, proceed) => {
      await proceed();
      void proceed();
    });
    const failures = failuresOf(agent);
    expect(await agent.run('hello')).toBe('done');
    expect(failures).toEqual([{ wrapper: 'wrap', errorClass: 'AroundTurnError' }]);
  });

  it('a misuse the wrapper rethrew is reported once, not twice', async () => {
    const agent = built(async (_turn, proceed) => {
      await proceed();
      await proceed();
    });
    const failures = failuresOf(agent);
    expect(await agent.run('hello')).toBe('done');
    expect(failures).toEqual([{ wrapper: 'wrap', errorClass: 'AroundTurnError' }]);
  });
});

describe('swallows a failed proceed', () => {
  const failing = (error: Error): LLMProvider => ({
    name: 'failing',
    async complete() {
      throw error;
    },
  });

  it("the run's original error still surfaces", async () => {
    const boom = new TypeError('provider down');
    const agent = built(async (_turn, proceed) => {
      await proceed().catch(() => undefined);
    }, failing(boom));
    await expect(agent.run('hello')).rejects.toBe(boom);
  });

  it('a wrapper that rethrows the same error is not a wrapper failure', async () => {
    const boom = new TypeError('provider down');
    const agent = built((_turn, proceed) => proceed(), failing(boom));
    const failures = failuresOf(agent);
    await expect(agent.run('hello')).rejects.toBe(boom);
    expect(failures).toEqual([]);
  });

  it("a wrapper that throws its own error loses to the run's, and is named", async () => {
    const boom = new TypeError('provider down');
    class WrapperFault extends Error {}
    const agent = built(async (_turn, proceed) => {
      await proceed().catch(() => {
        throw new WrapperFault('hidden');
      });
    }, failing(boom));
    const failures = failuresOf(agent);
    await expect(agent.run('hello')).rejects.toBe(boom);
    expect(failures).toEqual([{ wrapper: 'wrap', errorClass: 'WrapperFault' }]);
  });
});

describe('throws after a good proceed', () => {
  class CleanupFault extends Error {}
  const SECRET = 'do-not-record-this-sentence';

  it('the outcome stands; the diagnostic carries the name and the class, never the message', async () => {
    const agent = built(async (_turn, proceed) => {
      await proceed();
      throw new CleanupFault(SECRET);
    });
    const events: { type: string; payload: unknown; meta: { runId?: string } }[] = [];
    agent.on('*', (event) => events.push(event as never));
    expect(await agent.run('hello')).toBe('done');
    const failed = events.filter((event) => event.type === AROUND_TURN_FAILED);
    expect(failed.map((event) => event.payload)).toEqual([
      { wrapper: 'wrap', errorClass: 'CleanupFault' },
    ]);
    expect(failed[0]!.meta.runId).toBe(
      events.find((e) => e.type.endsWith('turn_start'))?.meta.runId,
    );
    expect(JSON.stringify(events)).not.toContain(SECRET);
    expect(JSON.stringify(agent.getLastSnapshot())).not.toContain(SECRET);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'text that is no class'],
  ])('throwing %s is noted too, as a non-error', async (_label, thrown) => {
    const agent = built(async (_turn, proceed) => {
      await proceed();
      throw thrown;
    });
    const failures = failuresOf(agent);
    expect(await agent.run('hello')).toBe('done');
    expect(failures).toEqual([{ wrapper: 'wrap', errorClass: 'non-error' }]);
  });

  it('a proceed queued before the wrapper settled counts, and the failure is noted', async () => {
    const { provider, calls } = counted(['one answer']);
    const agent = built((_turn, proceed) => {
      queueMicrotask(() => void proceed());
      return Promise.reject(new CleanupFault(SECRET));
    }, provider);
    const failures = failuresOf(agent);
    expect(await agent.run('hello')).toBe('one answer');
    expect(calls).toHaveLength(1);
    expect(failures).toEqual([{ wrapper: 'wrap', errorClass: 'CleanupFault' }]);
  });

  it('a pause is not lost, and its resume still works', async () => {
    let throwAfter = true;
    const agent = asking(async (_turn, proceed) => {
      await proceed();
      if (throwAfter) throw new CleanupFault(SECRET);
    });
    const failures = failuresOf(agent);
    const pause = await agent.run('first');
    if (!isPaused(pause)) throw new Error('Expected a pause');
    expect(failures).toEqual([{ wrapper: 'wrap', errorClass: 'CleanupFault' }]);
    await expect(agent.run('other')).rejects.toMatchObject({ code: 'ERR_PENDING_QUESTION' });
    throwAfter = false;
    expect(await agent.resume(pause.checkpoint, 'yes')).toBe('answered');
  });

  it('a value that is not an Error is named by a fixed word', async () => {
    const agent = built(async (_turn, proceed) => {
      await proceed();
      throw SECRET;
    });
    const failures = failuresOf(agent);
    expect(await agent.run('hello')).toBe('done');
    expect(failures).toEqual([{ wrapper: 'wrap', errorClass: 'non-error' }]);
  });
});

describe('a wrapper that does not await proceed', () => {
  it('the run still finishes inside the lease and the answer is returned', async () => {
    const onRejection = vi.fn();
    process.on('unhandledRejection', onRejection);
    try {
      const agent = built((_turn, proceed) => {
        void proceed();
      });
      expect(await agent.run('hello')).toBe('done');
      const failing = built(
        (_turn, proceed) => {
          void proceed();
        },
        {
          name: 'failing',
          async complete() {
            throw new TypeError('provider down');
          },
        },
      );
      await expect(failing.run('hello')).rejects.toThrow('provider down');
      await new Promise((resolve) => setImmediate(resolve));
      expect(onRejection).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it('throwing while the run is still going keeps the outcome', async () => {
    const agent = built((_turn, proceed) => {
      void proceed();
      throw new RangeError('after starting');
    });
    const failures = failuresOf(agent);
    expect(await agent.run('hello')).toBe('done');
    expect(failures).toEqual([{ wrapper: 'wrap', errorClass: 'RangeError' }]);
  });
});

describe('the closed set of changes', () => {
  it('a resume refuses any change, and the turn fails with no run', async () => {
    let change = true;
    const agent = asking(async (turn, proceed) => {
      if (turn.kind === 'resume' && change) await proceed({ time: { zone: 'UTC' } });
      else await proceed();
    });
    const pause = await agent.run('first');
    if (!isPaused(pause)) throw new Error('Expected a pause');
    await expect(agent.resume(pause.checkpoint, 'yes')).rejects.toMatchObject({
      code: 'ERR_AROUND_TURN',
      reason: 'change-on-resume',
    });
    change = false;
    expect(await agent.resume(pause.checkpoint, 'yes')).toBe('answered');
  });

  it.each([[{ message: 'other' }], [{ time: {}, identity: {} }], [null], ['time'], [[]]])(
    'refuses %j by name',
    async (changes) => {
      const { provider, calls } = counted();
      const agent = built((_turn, proceed) => proceed(changes as never), provider);
      await expect(agent.run('hello')).rejects.toMatchObject({
        code: 'ERR_AROUND_TURN',
        reason: 'unknown-change',
      });
      expect(calls).toEqual([]);
    },
  );

  it('editing the turn fails loudly and cannot reach the run', async () => {
    const { provider, calls } = counted();
    const agent = built(async (turn, proceed) => {
      if (turn.kind === 'run') {
        expect(() => {
          (turn.input as { message: string }).message = 'edited';
        }).toThrow(TypeError);
        expect(() => {
          (turn as { kind: string }).kind = 'resume';
        }).toThrow(TypeError);
      }
      await proceed();
    }, provider);
    await agent.run({ message: 'original' });
    expect(JSON.stringify(calls[0])).toContain('original');
    expect(JSON.stringify(calls[0])).not.toContain('edited');
  });
});

describe('the builder', () => {
  const wrapper: AroundTurn = { name: 'one', around: (_turn, proceed) => proceed() };

  it('a second wrapper is refused by name', () => {
    const builder = Agent.create({ provider: counted().provider, model: 'mock' }).aroundTurn(
      wrapper,
    );
    expect(() => builder.aroundTurn({ ...wrapper, name: 'two' })).toThrow(AroundTurnError);
    expect(() => builder.aroundTurn(wrapper)).toThrow(/'one' is already declared/);
  });

  it.each([[undefined], [{}], [{ name: '', around: () => undefined }], [{ name: 'x' }]])(
    'a wrapper shaped %j is refused by name',
    (shape) => {
      expect(() =>
        Agent.create({ provider: counted().provider, model: 'mock' }).aroundTurn(shape as never),
      ).toThrow(AroundTurnError);
    },
  );
});
