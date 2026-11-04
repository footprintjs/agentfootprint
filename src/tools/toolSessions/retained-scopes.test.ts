import { localResourceStatus } from './localStatus.js';
import { expect, it } from 'vitest';
import { Agent, defineTool, hashSessionKey, toolSessionKey } from '../../index.js';
import { mock } from '../../providers.js';

it('shutdown resources with one fixed key stay process-wide across conversations', async () => {
  let starts = 0,
    closes = 0;
  const registrations: string[] = [];
  const agent = Agent.create({
    provider: mock({
      replies: Array.from({ length: 140 }, (_, index) =>
        index % 2 === 0 ? { toolCalls: [{ id: 'call', name: 'resource', args: {} }] } : 'done',
      ),
    }),
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'resource',
        description: 'Resource',
        inputSchema: { type: 'object' },
        execute: (_args, ctx) => {
          ctx.onTeardown!(
            () => {
              closes++;
            },
            { scope: 'shutdown', key: 'one' },
          );
          return 'ok';
        },
      }),
    )
    .build();
  agent.on('agentfootprint.tools.session_started', () => {
    starts++;
  });
  agent.on('agentfootprint.tools.session_reused', (e) => {
    registrations.push(e.payload.keyHash);
  });
  for (let index = 0; index < 70; index++)
    await agent.run('go', { sessionId: `conversation-${index}` });
  expect(starts).toBe(1);
  expect(closes).toBe(0);
  expect(registrations).toHaveLength(69);
  await agent.shutdown();
  expect(closes).toBe(1);
});

it('session report keyHash joins the actual public isolation key', async () => {
  let expected: string | undefined;
  const actual: string[] = [];
  const agent = Agent.create({
    provider: mock({ replies: [{ toolCalls: [{ id: 'a', name: 'resource', args: {} }] }, 'done'] }),
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'resource',
        description: 'Resource',
        inputSchema: { type: 'object' },
        execute: (_args, ctx) => {
          const key = toolSessionKey(ctx, 'session')!;
          expected = hashSessionKey(key);
          ctx.onTeardown!(() => undefined, { scope: 'session', key });
          return 'ok';
        },
      }),
    )
    .build();
  agent.on('agentfootprint.tools.session_started', (e) => actual.push(e.payload.keyHash));
  agent.on('agentfootprint.tools.session_closed', (e) => actual.push(e.payload.keyHash));
  await agent.run(
    {
      message: 'go',
      identity: { conversationId: 'conversation', tenant: 'tenant', principal: 'person' },
    },
    { sessionId: 'transport' },
  );
  await agent.shutdown();
  expect(actual).toEqual([expected, expected]);
});

it.each([
  ['own call', [{ fired: false, scope: 'call', partition: 'turn' }], 'retained'],
  ['own run', [{ fired: false, scope: 'run', partition: 'turn' }], 'retained'],
  ['own session', [{ fired: false, scope: 'session', partition: 'conversation' }], 'retained'],
  ['foreign run', [{ fired: false, scope: 'run', partition: 'other' }], 'none-known-locally'],
  [
    'foreign session',
    [{ fired: false, scope: 'session', partition: 'other' }],
    'none-known-locally',
  ],
  ['tier-wide shutdown', [{ fired: false, scope: 'shutdown' }], 'none-known-locally'],
  ['retired run', [{ fired: true, scope: 'run', partition: 'turn' }], 'none-known-locally'],
  [
    'retired session',
    [{ fired: true, scope: 'session', partition: 'conversation' }],
    'none-known-locally',
  ],
  ['retired shutdown', [{ fired: true, scope: 'shutdown' }], 'none-known-locally'],
] as const)(
  'local status reports only matching live registrations: %s',
  (_case, rows, expected) => {
    expect(localResourceStatus(rows, 'turn', 'conversation')).toBe(expected);
  },
);
