import { expect, it } from 'vitest';
import { Agent, checkInApproved, defineTool, isPaused } from '../../index.js';
import { mock } from '../../llm-providers.js';

it('a foreign tenant shutdown row neither claims restoration nor closes during another owner resume', async () => {
  let closed = 0,
    ran = 0;
  const build = (fresh: boolean) =>
    Agent.create({
      provider: mock({
        replies: fresh
          ? [{ toolCalls: [{ id: 'a', name: 'shared', args: {} }] }, 'done', 'done']
          : [{ toolCalls: [{ id: 'b', name: 'hold', args: {} }] }],
      }),
      model: 'test',
    })
      .tool(
        defineTool({
          name: 'shared',
          description: 'shared',
          inputSchema: { type: 'object' },
          execute: (_args, context) => {
            context.onTeardown!(
              () => {
                closed++;
              },
              { scope: 'shutdown', key: 'tenant-A-only' },
            );
            return 'opened';
          },
        }),
      )
      .tool(
        defineTool({
          name: 'hold',
          description: 'hold',
          inputSchema: { type: 'object' },
          checkIn: 'always',
          execute: () => {
            ran++;
            return 'ran';
          },
        }),
      )
      .build();
  const original = build(false),
    fresh = build(true);
  const statuses: unknown[] = [];
  fresh.on('agentfootprint.tools.resource_restore', (event) => statuses.push(event.payload));
  try {
    const paused = await original.run(
      { message: 'hold', identity: { conversationId: 'B', tenant: 'B', principal: 'bob' } },
      { sessionId: 'B' },
    );
    if (!isPaused(paused) || paused.checkIn === undefined) throw new Error('Expected check-in');
    await fresh.run(
      { message: 'shared', identity: { conversationId: 'A', tenant: 'A', principal: 'alice' } },
      { sessionId: 'A' },
    );
    await expect(
      fresh.resume(paused.checkpoint, checkInApproved({ request: paused.checkIn, by: 'bob' })),
    ).resolves.toBe('done');
    expect(statuses).toEqual([{ local: 'none-known-locally', remote: 'unknown' }]);
    expect(ran).toBe(1);
    expect(closed).toBe(0);
  } finally {
    await original.shutdown({ stop: true });
    await fresh.shutdown({ stop: true });
  }
  expect(closed).toBe(1);
});
