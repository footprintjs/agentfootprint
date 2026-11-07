/**
 * Context holds around a turn, `time` takes the run's own path, and a mounted
 * agent with a wrapper is refused rather than skipped.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, it } from 'vitest';

import { FlowChartExecutor, flowChart } from 'footprintjs';

import { Agent, AroundTurnError, defineTool, Parallel, Sequence } from '../../../index.js';
import { mock } from '../../../llm-providers.js';
import type { LLMProvider } from '../../../provider-contract/types.js';
import type { RunTime } from '../../../time/clock.js';
import { readOnlyCopy } from './readOnlyCopy.js';
import { runInputWith } from './funnel.js';
import { requestContext } from '../../../identity/requestContext.js';

describe('an AsyncLocalStorage set around proceed', () => {
  it("is visible to that turn's events, tools and provider calls, and gone after", async () => {
    const context = new AsyncLocalStorage<string>();
    const seen = { provider: [] as unknown[], tool: [] as unknown[], events: [] as unknown[] };
    let step = 0;
    const provider: LLMProvider = {
      name: 'context',
      async complete() {
        seen.provider.push(context.getStore());
        step += 1;
        return step === 1
          ? {
              content: '',
              toolCalls: [{ id: 'one', name: 'look', args: {} }],
              usage: { input: 1, output: 1 },
            }
          : { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } };
      },
    };
    const agent = Agent.create({ provider, model: 'mock' })
      .aroundTurn({
        name: 'context',
        around: (_turn, proceed) => context.run('this turn', () => proceed()),
      })
      .tool(
        defineTool({
          name: 'look',
          description: 'Look',
          inputSchema: { type: 'object' },
          execute: async () => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            seen.tool.push(context.getStore());
            return 'seen';
          },
        }),
      )
      .build();
    agent.on('agentfootprint.stream.tool_end', () => seen.events.push(context.getStore()));
    agent.on('agentfootprint.agent.turn_end', () => seen.events.push(context.getStore()));
    expect(await agent.run('hello')).toBe('done');
    expect(seen.provider).toEqual(['this turn', 'this turn']);
    expect(seen.tool).toEqual(['this turn']);
    expect(seen.events).toEqual(['this turn', 'this turn']);
    expect(context.getStore()).toBeUndefined();
  });
});

describe('proceed({ time })', () => {
  const NOW = '2026-03-04T05:06:07.000Z';
  const clockRow = (agent: Agent): unknown => {
    const rows = (agent.getLastSnapshot()?.sharedState as { findingsLedger?: { kind?: string }[] })
      ?.findingsLedger;
    return rows?.find((row) => row.kind === 'clock');
  };
  const timed = (time?: RunTime) =>
    Agent.create({ provider: mock({ reply: 'done' }), model: 'mock' })
      .time({ zone: 'UTC' })
      .aroundTurn({
        name: 'clock',
        around: (_turn, proceed) => proceed(time === undefined ? undefined : { time }),
      })
      .build();

  it('files the same clock row as run({ time })', async () => {
    const direct = Agent.create({ provider: mock({ reply: 'done' }), model: 'mock' })
      .time({ zone: 'UTC' })
      .build();
    await direct.run({ message: 'hello', time: { now: NOW, zone: 'Asia/Tokyo' } });
    const wrapped = timed({ now: NOW, zone: 'Asia/Tokyo' });
    await wrapped.run('hello');
    const row = clockRow(direct);
    expect(row).toMatchObject({ kind: 'clock', nowSource: 'app', zone: 'Asia/Tokyo' });
    const { ...sameRow } = clockRow(wrapped) as object;
    expect(sameRow).toEqual(row);
  });

  it('a field the wrapper leaves out stays the caller’s; one it names wins', async () => {
    const wrapped = timed({ now: NOW });
    await wrapped.run({
      message: 'hello',
      time: { now: '2020-01-01T00:00:00.000Z', zone: 'Asia/Tokyo' },
    });
    expect(clockRow(wrapped)).toMatchObject({ zone: 'Asia/Tokyo', now: NOW });
  });

  it('with no change, input.time still beats options.time', async () => {
    const wrapped = timed();
    await wrapped.run(
      { message: 'hello', time: { zone: 'Asia/Tokyo' } },
      { time: { zone: 'Europe/Paris' } },
    );
    expect(clockRow(wrapped)).toMatchObject({ zone: 'Asia/Tokyo' });
  });

  it('an agent without the time layer refuses it the way run({ time }) does', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'done' }), model: 'mock' })
      .aroundTurn({ name: 'clock', around: (_turn, proceed) => proceed({ time: { now: NOW } }) })
      .build();
    await expect(agent.run('hello')).rejects.toThrow(/reads no clock/);
  });

  it('a malformed value reaches the run’s own reader, which refuses it', async () => {
    await expect(timed({ now: 'yesterday' }).run('hello')).rejects.toThrow(/now/);
    await expect(timed('soon' as never).run('hello')).rejects.toThrow(/time/);
  });

  it('under a redaction policy it is served exactly where run({ time }) serves it', async () => {
    const time = { now: NOW, zone: 'Asia/Tokyo' };
    const carriers = async (agent: Agent, input: Parameters<Agent['run']>[0]) => {
      const events: { type: string; payload: unknown }[] = [];
      agent.on('*', (event) => events.push(event));
      await agent.run(input);
      const state = agent.getLastSnapshot()?.sharedState as Record<string, unknown>;
      const carrying = (value: unknown) => {
        const text = String(JSON.stringify(value));
        return text.includes(NOW) || text.includes(time.zone);
      };
      return {
        keys: Object.keys(state).filter((key) => carrying(state[key])),
        events: events.filter((event) => carrying(event.payload)).map((event) => event.type),
      };
    };
    const redact = { keys: ['findingsLedger'] };
    const start = () =>
      Agent.create({ provider: mock({ reply: 'done' }), model: 'mock', redact }).time({
        zone: 'UTC',
      });
    const direct = await carriers(start().build(), { message: 'hello', time });
    const wrapped = await carriers(
      start()
        .aroundTurn({ name: 'clock', around: (_turn, proceed) => proceed({ time }) })
        .build(),
      'hello',
    );
    expect(wrapped).toEqual(direct);
    expect(wrapped.keys).not.toContain('findingsLedger');
  });

  it('input the run would refuse is left for it to refuse', () => {
    expect(runInputWith(7 as never, undefined, { time: { now: NOW } })).toBe(7);
    expect(runInputWith('hi', { time: { zone: 'UTC' } }, { time: { now: NOW } })).toEqual({
      message: 'hi',
      time: { zone: 'UTC', now: NOW },
    });
    const same = { message: 'hi' };
    expect(runInputWith(same, undefined, undefined)).toBe(same);
    expect(runInputWith(same, undefined, {})).toBe(same);
  });
});

describe('a mounted agent', () => {
  const wrapped = () =>
    Agent.create({ provider: mock({ reply: 'inner' }), model: 'mock' })
      .aroundTurn({ name: 'prepare', around: (_turn, proceed) => proceed() })
      .build();

  it('with a wrapper is refused by name, and its provider is never called', async () => {
    const calls: unknown[] = [];
    const provider: LLMProvider = {
      name: 'counted',
      async complete() {
        calls.push(1);
        return { content: 'inner', toolCalls: [], usage: { input: 1, output: 1 } };
      },
    };
    const member = Agent.create({ provider, model: 'mock' })
      .aroundTurn({ name: 'prepare', around: (_turn, proceed) => proceed() })
      .build();
    const sequence = Sequence.create({ name: 'flow' }).step('one', member).build();
    const refusal = await sequence.run({ message: 'hello' }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(AroundTurnError);
    expect(refusal).toMatchObject({ reason: 'mounted', wrapper: 'prepare' });
    expect(calls).toEqual([]);
  });

  it("in an app's own executor is refused the same way", async () => {
    const app = flowChart<{ question: string }>(
      'Ask',
      (scope) => {
        scope.question = 'hello';
      },
      'ask',
    )
      .addSubFlowChartNext('sf-agent', wrapped().getSpec(), 'Agent', {
        inputMapper: (parent) => ({
          message: String(parent.question),
          identity: { conversationId: 'app' },
        }),
      })
      .build();
    await expect(new FlowChartExecutor(app).run({ input: {} })).rejects.toMatchObject({
      code: 'ERR_AROUND_TURN',
      reason: 'mounted',
    });
  });

  it('in a parallel branch never runs the branch unwrapped', async () => {
    const calls: unknown[] = [];
    const provider: LLMProvider = {
      name: 'counted',
      async complete() {
        calls.push(1);
        return { content: 'inner', toolCalls: [], usage: { input: 1, output: 1 } };
      },
    };
    const member = Agent.create({ provider, model: 'mock' })
      .aroundTurn({ name: 'prepare', around: (_turn, proceed) => proceed() })
      .build();
    const plain = Agent.create({ provider: mock({ reply: 'plain' }), model: 'mock' }).build();
    const parallel = Parallel.create({ name: 'both' })
      .branch('a', member)
      .branch('b', plain)
      .mergeWithFn((results) => JSON.stringify(results))
      .build();
    const outcome = await parallel
      .run({ message: 'hello' })
      .catch((error: unknown) => (error as Error).message);
    expect(calls).toEqual([]);
    expect(String(outcome)).toContain('prepare');

    const tolerant = Parallel.create({ name: 'tolerant' })
      .branch('a', member)
      .branch('b', plain)
      .mergeOutcomesWithFn((outcomes) => JSON.stringify(outcomes))
      .build();
    expect(await tolerant.run({ message: 'hello' })).toContain('prepare');
    expect(calls).toEqual([]);
  });

  it('without a wrapper still runs', async () => {
    const member = Agent.create({ provider: mock({ reply: 'inner' }), model: 'mock' }).build();
    const sequence = Sequence.create({ name: 'flow' }).step('one', member).build();
    expect(await sequence.run({ message: 'hello' })).toBe('inner');
  });

  it('with a wrapper still reads its chart, and still runs on its own', async () => {
    const agent = wrapped();
    expect(agent.getSpec()).toBeDefined();
    expect(await agent.run('hello')).toBe('inner');
  });
});

describe('readOnlyCopy', () => {
  it('copies plain data, freezes the copy and leaves the original open', () => {
    const original = { a: { b: [1, { c: 2 }] } };
    const copy = readOnlyCopy(original);
    expect(copy).toEqual(original);
    expect(copy.a).not.toBe(original.a);
    expect(Object.isFrozen(copy.a.b[1])).toBe(true);
    expect(Object.isFrozen(original.a)).toBe(false);
  });

  it('keeps what is not plain data by identity', () => {
    const request = requestContext({ secrets: { token: 'sealed' } });
    const signal = new AbortController().signal;
    const at = new Date();
    const copy = readOnlyCopy({ request, signal, at, fn: readOnlyCopy });
    expect(copy.request).toBe(request);
    expect(copy.signal).toBe(signal);
    expect(copy.at).toBe(at);
    expect(copy.fn).toBe(readOnlyCopy);
  });

  it('runs no getter, keeps a __proto__ key as data, and survives cycles and depth', () => {
    let read = 0;
    const accessor = Object.defineProperty({}, 'held', {
      enumerable: true,
      get: () => (read += 1),
    });
    readOnlyCopy(accessor);
    expect(read).toBe(0);

    const parsed = readOnlyCopy(JSON.parse('{"__proto__":{"polluted":true}}') as object);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect((parsed as { polluted?: boolean }).polluted).toBeUndefined();

    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    const copied = readOnlyCopy(cycle);
    expect(copied.self).toBe(copied);

    let deep: unknown = 'bottom';
    for (let depth = 0; depth < 200_000; depth += 1) deep = [deep];
    expect(() => readOnlyCopy(deep)).not.toThrow();
  });
});
