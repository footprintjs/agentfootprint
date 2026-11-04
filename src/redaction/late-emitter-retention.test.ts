import { expect, it } from 'vitest';
import v8 from 'node:v8';
import vm from 'node:vm';
import { Agent, defineTool } from '../index.js';
import type { RunnerExecution } from '../core/runnerExecution.js';
import type { LLMRequest } from '../provider-contract/types.js';

v8.setFlagsFromString('--expose-gc');
const collect: () => void = vm.runInNewContext('gc');
const noCleanup = () => undefined;
const provider = {
  name: 'stateless-retention',
  complete: async (request: LLMRequest) =>
    request.messages.some((message) => message.role === 'tool')
      ? { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } }
      : {
          content: '',
          toolCalls: [{ id: 'open', name: 'open', args: {} }],
          usage: { input: 1, output: 1 },
        },
};
function selectedReference(agent: unknown): WeakRef<object> {
  return new WeakRef((agent as { execution: RunnerExecution<object> }).execution.selected()!.value);
}
it('retained session rows do not retain completed run banks, and still report their original origin', async () => {
  const agent = Agent.create({ provider, model: 'mock', contextBudget: { messages: 10_000_000 } })
    .tool(
      defineTool({
        name: 'open',
        description: 'Open a session',
        inputSchema: { type: 'object' },
        execute: (_args, ctx) => {
          ctx.onTeardown!(noCleanup, { scope: 'session', key: ctx.sessionId });
          return 'opened';
        },
      }),
    )
    .build();
  const starts: { runId?: string; sessionId?: string }[] = [],
    closes: { runId?: string; sessionId?: string }[] = [];
  agent.on('agentfootprint.stream.llm_start', (event) => {
    if (!starts.some((row) => row.runId === event.meta.runId)) starts.push(event.meta);
  });
  agent.on('agentfootprint.tools.session_closed', (event) => closes.push(event.meta));
  await agent.run('first:' + 'a'.repeat(200_000), { sessionId: 'first' });
  const first = selectedReference(agent);
  for (let index = 0; index < 20; index++)
    await agent.run('later:' + index + ':' + 'b'.repeat(200_000), { sessionId: 'later-' + index });
  expect(closes).toHaveLength(0);
  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    collect();
  }
  expect(first.deref(), 'the old bank must die while every session row stays live').toBeUndefined();
  await agent.shutdown();
  expect(closes).toHaveLength(21);
  expect(new Set(closes.map((row) => row.runId))).toEqual(new Set(starts.map((row) => row.runId)));
  expect(closes.some((row) => row.sessionId === 'first')).toBe(true);
}, 110000);
