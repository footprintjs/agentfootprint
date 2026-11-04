import { expect, it } from 'vitest';
import { Agent, defineTool, inMemoryArtifacts } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';

it('files the completed recording after joined resource cleanup and before its own mint event', async () => {
  const store = inMemoryArtifacts(),
    scope = { conversationId: 'record-finalization' };
  let closed = 0;
  const agent = Agent.create({
    provider: mock({
      replies: [{ toolCalls: [{ id: 'open', name: 'resource', args: {} }] }, { content: 'done' }],
    }),
    model: 'mock',
    artifacts: { store, recordings: true },
  })
    .tool(
      defineTool({
        name: 'resource',
        description: 'Local recording fixture',
        inputSchema: { type: 'object', properties: {} },
        execute: (_args, context) => {
          context.onTeardown!(
            () => {
              closed++;
            },
            { scope: 'run' },
          );
          return 'opened';
        },
      }),
    )
    .build();
  await expect(agent.run({ message: 'start', identity: scope })).resolves.toBe('done');
  expect(closed).toBe(1);
  const rows = (await store.list(scope)).artifacts.filter((meta) => meta.kind === 'recording/run');
  expect(rows).toHaveLength(1);
  const record = await store.get(scope, rows[0]!.ref);
  const saved = JSON.parse(record!.data as string) as {
    events: { type: string; meta?: { runId?: string } }[];
  };
  const cleanup = saved.events.filter(
    (event) => event.type === 'agentfootprint.tools.session_closed',
  );
  expect(cleanup).toHaveLength(1);
  expect(cleanup[0]?.meta?.runId).toBe(record?.meta.origin?.runId);
  expect(saved.events.some((event) => event.type === 'agentfootprint.artifacts.minted')).toBe(
    false,
  );
});
