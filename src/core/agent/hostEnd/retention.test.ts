import { expect, it, vi } from 'vitest';
import { Agent, slidingWindow } from '../../../index.js';
import { mock } from '../../../llm-providers.js';

it.each(['full', 'delta'] as const)(
  'evicts one of two identical answers without transferring its origin (%s)',
  async (commitValues) => {
    const options = {
      hostEndedTurns: true,
      model: 'mock',
      commitValues,
      provider: mock({ reply: 'same' }),
    };
    const first = Agent.create(options).build();
    // Keeping a host assistant at the front requires a shorter user-role drop notice.
    await first.run('Earlier conversation context. '.repeat(30));
    const a = JSON.parse(JSON.stringify(first.checkpoint()));
    const host = Agent.create(options).build();
    await host.endTurn({ reply: 'same', reason: 'host-cap' }, { continueFrom: a });
    const b = JSON.parse(JSON.stringify(host.checkpoint()));
    const next = Agent.create(options)
      .window(slidingWindow({ keepRecentTurns: 2 }))
      .build();
    const evicted: unknown[] = [];
    next.on('agentfootprint.context.evicted', (event) => evicted.push(event.payload));
    await next.run({ message: 'follow up', continueFrom: b });
    const c = JSON.parse(JSON.stringify(next.checkpoint()));
    expect(evicted).toHaveLength(2);
    const marked = c.history.flatMap((row: { content: string; replyOrigin?: unknown }) =>
      row.replyOrigin ? [[row.content, row.replyOrigin]] : [],
    );
    expect(marked).toEqual([
      ['same', { kind: 'host', runId: b.runId }],
      ['same', { kind: 'model', runId: c.runId }],
    ]);
    expect(c.history).not.toContainEqual(a.history.at(-1));
  },
);

it.each(['full', 'delta'] as const)(
  'leaves a local recovery unattributed after a successful model turn (%s)',
  async (commitValues) => {
    const respond = vi
      .fn()
      .mockReturnValueOnce('same')
      .mockImplementation(() => {
        throw new Error('unavailable');
      });
    const fallback = vi.fn(async () => ({
      content: 'same',
      toolCalls: [],
      usage: { input: 0, output: 0 },
      stopReason: 'end_turn',
    }));
    const fresh = () =>
      Agent.create({
        hostEndedTurns: true,
        model: 'mock',
        commitValues,
        provider: mock({ respond }),
      })
        .reliability({
          postDecide: [{ when: (s) => s.error !== undefined, then: 'fallback', kind: 'local' }],
          fallback,
        })
        .build();
    const before = fresh();
    await before.run('first');
    const a = JSON.parse(JSON.stringify(before.checkpoint()));
    const after = fresh();
    await expect(after.run({ message: 'next', continueFrom: a })).resolves.toBe('same');
    expect(respond).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledTimes(1);
    const b = JSON.parse(JSON.stringify(after.checkpoint()));
    expect(b.history.filter((row: { role: string }) => row.role === 'assistant')).toEqual([
      { role: 'assistant', content: 'same', replyOrigin: { kind: 'model', runId: a.runId } },
      { role: 'assistant', content: 'same' },
    ]);
  },
);
