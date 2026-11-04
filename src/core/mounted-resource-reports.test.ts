import { expect, it } from 'vitest';
import { Agent, Sequence, defineTool } from '../index.js';
import { mock } from '../llm-providers.js';

it('routes a mounted teardown report through its native parent run with readable payload', async () => {
  const member = Agent.create({
    provider: mock({
      replies: [{ toolCalls: [{ id: 'resource', name: 'open', args: {} }] }, 'done'],
    }),
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'open',
        description: 'Open a local resource',
        inputSchema: { type: 'object' },
        execute: (_args, ctx) => {
          ctx.onTeardown!(() => undefined, { scope: 'run', label: 'local-handle' });
          return 'opened';
        },
      }),
    )
    .build();
  const parent = Sequence.create().step('member', member).build();
  const reports: { payload: unknown; meta?: { runId?: string } }[] = [];
  const runIds: (string | undefined)[] = [];
  parent.on('agentfootprint.stream.llm_start', (e) => runIds.push(e.meta?.runId));
  parent.on('agentfootprint.tools.session_closed', (e) => reports.push(e));
  expect(await parent.run({ message: 'go' })).toBe('done');
  expect(reports).toHaveLength(1);
  expect(reports[0]!.payload).toMatchObject({
    tool: 'open',
    scope: 'run',
    label: 'local-handle',
    reason: 'run-end',
  });
  expect(runIds[0]).toBeDefined();
  expect(reports[0]!.meta?.runId).toBe(runIds[0]);
});
