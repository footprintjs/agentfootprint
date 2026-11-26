import { expect, it, vi } from 'vitest';
import { toSSE } from '../../../hosting/stream.js';
import { conversationRedaction } from '../../../doors/security.js';
import { getAgentRuntime } from '../runtime/native/host.js';
import type { AgentfootprintEvent } from '../../../events/registry.js';
import { inMemoryArtifacts } from '../../../artifacts/inMemoryArtifacts.js';
import { Agent, allow, RunInFlightError } from '../../../index.js';
import { mock } from '../../../llm-providers.js';
import { defineMemory, InMemoryStore } from '../../../memory/index.js';

it('keeps a host delivery settled when the store aborts after saving it', async () => {
  const identity = { conversationId: 'host-delivery-cancel-review' };
  const controller = new AbortController();
  const store = new InMemoryStore();
  const putMany = store.putMany.bind(store);
  const put = store.put.bind(store);
  const didStoreReply = () => controller.abort();
  const afterBatch = vi.spyOn(store, 'putMany').mockImplementation(async (...args) => {
    await putMany(...args);
    didStoreReply();
  });
  const afterSingle = vi.spyOn(store, 'put').mockImplementation(async (...args) => {
    await put(...args);
    didStoreReply();
  });
  const agent = Agent.create({
    hostEndedTurns: true,
    model: 'mock',
    provider: mock({ reply: 'unused provider response' }),
  })
    .memory(
      defineMemory({
        id: 'history',
        type: 'episodic',
        strategy: { kind: 'window', size: 4 },
        store,
      }),
    )
    .build();
  const tokens: string[] = [];
  agent.on('agentfootprint.stream.token', ({ payload }) => tokens.push(payload.content));
  try {
    await expect(
      agent.endTurn(
        { reply: 'Host notice', reason: 'host-cap' },
        { identity, options: { signal: controller.signal } },
      ),
    ).resolves.toBe('Host notice');
    expect(controller.signal.aborted).toBe(true);
    expect(afterBatch.mock.calls.length + afterSingle.mock.calls.length).toBeGreaterThan(0);
    expect(tokens).toEqual(['Host notice']);
    const checkpoint = agent.checkpoint()!;
    expect(checkpoint.history).toEqual([
      {
        role: 'assistant',
        content: 'Host notice',
        replyOrigin: { kind: 'host', runId: checkpoint.runId },
      },
    ]);
    const rows = (await store.list(identity)).entries.map((entry) => entry.value);
    expect(rows).toEqual(checkpoint.history);
  } finally {
    await agent.shutdown();
  }
});

function windowMemory(id: string, store: InMemoryStore) {
  return defineMemory({ id, type: 'episodic', strategy: { kind: 'window', size: 4 }, store });
}

it.each(['cancel', 'integrity veto'] as const)(
  'a final %s preserves prior entries and publishes no reply',
  async (stop) => {
    const identity = { conversationId: 'cancel-after-admission' };
    const controller = new AbortController();
    const store = new InMemoryStore();
    const agent = Agent.create({
      hostEndedTurns: true,
      model: 'mock',
      provider: mock({ reply: 'earlier' }),
    })
      .memory(windowMemory('history', store))
      .build();
    await agent.run({ message: 'first', identity });
    const previous = agent.checkpoint()!;
    const rows = (await store.list(identity)).entries;
    const put = vi.spyOn(store, 'putMany');
    const delivered = vi.fn();
    agent.on('agentfootprint.stream.token', delivered);
    agent.on('agentfootprint.agent.turn_end', delivered);
    const runtime = getAgentRuntime(agent);
    const check = runtime.assertIntegrityAlive.bind(runtime);
    vi.spyOn(runtime, 'assertIntegrityAlive').mockImplementation((run) => {
      check(run);
      if (stop === 'integrity veto') throw new Error('terminal veto');
      controller.abort();
    });
    await expect(
      agent.endTurn(
        { reply: 'withheld candidate', reason: 'host-cap' },
        {
          continueFrom: previous,
          options: { signal: controller.signal },
        },
      ),
    ).rejects.toThrow();
    expect(delivered).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(agent.checkpoint()?.history).toEqual(previous.history);
    expect((await store.list(identity)).entries).toEqual(rows);
    expect(JSON.stringify(agent.getLastSnapshot())).not.toContain('withheld candidate');
  },
);

it.each(['full', 'delta'] as const)(
  'replays committed delivery and independent store outcomes from a saved %s recording',
  async (commitValues) => {
    const artifacts = inMemoryArtifacts();
    const identity = { conversationId: 'project-multiple' };
    const first = new InMemoryStore(),
      second = new InMemoryStore(),
      third = new InMemoryStore();
    const agent = Agent.create({
      hostEndedTurns: true,
      commitValues,
      model: 'mock',
      provider: mock({ reply: 'prior answer' }),
      artifacts: { store: artifacts, recordings: true },
    })
      .memory(windowMemory('first', first))
      .memory(windowMemory('second', second))
      .memory(windowMemory('third', third))
      .messageMiddleware({
        name: 'policy',
        onMessage: ({ content }) =>
          content === 'raw candidate' ? allow('admitted reply', 'public wording') : allow(),
      })
      .build();
    await agent.run({ message: 'earlier', identity });
    const previous = agent.checkpoint()!;
    const before = (await first.list(identity)).entries.map((entry) => entry.value);
    const order: string[] = [];
    agent.on('agentfootprint.stream.token', ({ payload }) => order.push(payload.content));
    agent.on('agentfootprint.agent.turn_end', () => order.push('settled'));
    const outcomes: unknown[] = [];
    agent.on('agentfootprint.memory.write_outcome', ({ meta, payload }) => {
      order.push(payload.memoryId);
      outcomes.push({ runId: meta.runId, ...payload });
    });
    let beforeWrite: ReturnType<typeof agent.checkpoint>;
    let releaseWriter!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    let began!: () => void;
    const writing = new Promise<void>((resolve) => {
      began = resolve;
    });
    const save = first.putMany.bind(first);
    vi.spyOn(first, 'putMany').mockImplementation(async (...args) => {
      beforeWrite = agent.checkpoint();
      began();
      await blocked;
      await save(...args);
      throw new Error('private store diagnostic');
    });
    vi.spyOn(second, 'putMany').mockRejectedValue(new Error('private store diagnostic'));
    const result = agent.endTurn(
      { reply: 'raw candidate', reason: 'host-cap' },
      { continueFrom: previous },
    );
    await Promise.race([
      writing,
      result.then(() => {
        throw new Error('Host delivery returned before the declared writers');
      }),
    ]);
    try {
      await expect(agent.endTurn({ reply: 'overlap', reason: 'host-cap' })).rejects.toThrow(
        RunInFlightError,
      );
    } finally {
      releaseWriter();
    }
    await expect(result).resolves.toBe('admitted reply');
    const checkpoint = agent.checkpoint()!;
    const assistant = {
      role: 'assistant',
      content: 'admitted reply',
      replyOrigin: { kind: 'host', runId: checkpoint.runId },
    };
    expect(beforeWrite?.history).toEqual([...previous.history, assistant]);
    expect(checkpoint.history).toEqual(beforeWrite?.history);
    expect((await first.list(identity)).entries.map((e) => e.value)).toEqual([
      assistant,
      ...before,
    ]);
    expect((await second.list(identity)).entries.map((e) => e.value)).toEqual(before);
    expect((await third.list(identity)).entries.map((e) => e.value)).toEqual([
      assistant,
      ...before,
    ]);
    expect(order).toEqual(['admitted reply', 'settled', 'first', 'second', 'third']);
    expect(outcomes).toEqual(
      ['first', 'second', 'third'].map((memoryId, i) => ({
        runId: checkpoint.runId,
        memoryId,
        outcome: i === 2 ? 'acknowledged' : 'unknown',
      })),
    );
    const meta = (await artifacts.list(identity)).artifacts.find(
      (row) => row.origin?.runId === checkpoint.runId && row.kind === 'recording/run',
    )!;
    const saved = JSON.parse((await artifacts.get(identity, meta.ref))!.data as string) as {
      events: AgentfootprintEvent[];
    };
    const ends = saved.events.filter((e) => e.type === 'agentfootprint.agent.turn_end');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({
      meta: { runId: checkpoint.runId, rootTurn: true },
      payload: { finalContent: assistant.content, replyAuthor: 'host' },
    });
    expect(
      saved.events
        .filter((e) => e.type === 'agentfootprint.memory.write_outcome')
        .map((e) => ({ runId: e.meta.runId, ...e.payload })),
    ).toEqual(outcomes);
    expect(JSON.stringify(saved)).not.toMatch(/raw candidate|private store diagnostic/);
  },
);

it.each([true, false])(
  'reports each writer when only part of the first batch may be saved (partial=%s)',
  async (partial) => {
    const identity = { conversationId: 'batched-writes' };
    const one = new InMemoryStore(),
      two = new InMemoryStore();
    if (partial) {
      const save = one.putMany.bind(one);
      vi.spyOn(one, 'putMany').mockImplementation(async (where, entries, options) => {
        await save(where, entries.slice(0, 1), options);
        throw new Error('connection closed');
      });
    }
    const agent = Agent.create({
      hostEndedTurns: true,
      model: 'mock',
      provider: mock({ reply: 'unused' }),
    })
      .memory(windowMemory('one', one))
      .memory(windowMemory('two', two))
      .build();
    const outcomes: unknown[] = [];
    agent.on('agentfootprint.memory.write_outcome', (e) => outcomes.push(e.payload));
    await expect(
      agent.endTurn({ reply: 'notice', reason: 'host-cap' }, { message: 'inbound', identity }),
    ).resolves.toBe('notice');
    const messages = agent.checkpoint()!.history;
    expect(messages.map((row) => row.content)).toEqual(['inbound', 'notice']);
    expect((await one.list(identity)).entries.map((e) => e.value)).toEqual(
      partial ? messages.slice(0, 1) : messages,
    );
    expect((await two.list(identity)).entries.map((e) => e.value)).toEqual(messages);
    expect(outcomes).toEqual([
      { memoryId: 'one', outcome: partial ? 'unknown' : 'acknowledged' },
      { memoryId: 'two', outcome: 'acknowledged' },
    ]);
  },
);

it('serves the admitted text to its caller and redacts observers when a token listener cancels', async () => {
  const control = new AbortController();
  const identity = { conversationId: 'stream-host-delivery' };
  const store = new InMemoryStore();
  const agent = Agent.create({
    hostEndedTurns: true,
    model: 'mock',
    provider: mock({ reply: 'unused' }),
    redact: conversationRedaction(),
  })
    .memory(windowMemory('history', store))
    .build();
  const events: AgentfootprintEvent[] = [];
  agent.on('*', (event) => events.push(event));
  agent.on('agentfootprint.stream.token', () => control.abort());
  const chunks: string[] = [];
  let returned: string | undefined;
  for await (const chunk of toSSE(agent, {
    format: 'text',
    start: async () => {
      returned = await agent.endTurn(
        { reply: 'private delivered notice', reason: 'host-cap' },
        { identity, options: { signal: control.signal } },
      );
    },
  }))
    chunks.push(chunk);
  expect(chunks.join('')).toBe('private delivered notice');
  expect(control.signal.aborted).toBe(true);
  expect(returned).toBe('private delivered notice');
  expect(JSON.stringify(events)).not.toContain('private delivered notice');
  expect(agent.checkpoint()!.history.at(-1)?.content).toBe(returned);
  expect((await store.list(identity)).entries).toHaveLength(1);
});
