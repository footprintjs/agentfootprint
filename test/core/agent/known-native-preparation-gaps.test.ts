import { expect, it } from 'vitest';
import {
  Agent,
  askHuman,
  defineTool,
  isInputPause,
  isPaused,
  requestInput,
} from '../../../src/index.js';
import type { LLMRequest } from '../../../src/provider-contract/types.js';
import { mock } from '../../../src/llm-providers.js';
import { memorySessions, readPausedRun, standingAgent } from '../../../src/hosting/index.js';
import { inProcessHost } from '../../hosting/testHost.js';

function collecting() {
  return Agent.create({
    provider: {
      name: 'scripted',
      complete: async (r: LLMRequest) =>
        r.messages.some((m) => m.role === 'tool')
          ? { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } }
          : {
              content: '',
              toolCalls: [{ id: 'collect', name: 'collect', args: {} }],
              usage: { input: 1, output: 1 },
            },
    },
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'collect',
        description: 'Collect',
        inputSchema: { type: 'object' },
        execute: () =>
          requestInput({
            id: 'date',
            question: 'Year and month?',
            fields: [
              { id: 'year', type: 'number', required: true },
              { id: 'month', type: 'number', required: true },
            ],
          }),
      }),
    )
    .build();
}

it('known native gap: a fresh partial answer returns its pause but has no local pending guard before execution', async () => {
  const first = collecting();
  const pause = await first.run('first');
  if (!isInputPause(pause)) throw new Error('Expected input pause');
  const fresh = collecting();
  const partial = await fresh.resume(pause.checkpoint, {
    requestId: pause.awaitingInput.requestId,
    values: { year: 2026 },
  });
  expect(isInputPause(partial)).toBe(true);
  if (!isInputPause(partial)) throw new Error('Expected partial pause');
  expect(partial.awaitingInput.requestId).toBe(pause.awaitingInput.requestId);
  expect(fresh.checkpoint()).toBeUndefined();
  expect(isInputPause(await fresh.run('another'))).toBe(true);
});

it('a restarted host keeps the partial question in its store and will not start another message', async () => {
  const sessions = memorySessions();
  const firstHost = inProcessHost();
  const first = await standingAgent({ agent: collecting(), sessions, host: firstHost });
  const asked = await firstHost.deliver({ input: 'first', sessionId: 's' });
  const id = asked.awaiting!.awaitingInput!.requestId;
  await first.close();
  const host = inProcessHost();
  const handle = await standingAgent({ agent: collecting(), sessions, host });
  try {
    const partial = await host.deliver({
      input: '',
      sessionId: 's',
      decision: { requestId: id, values: { year: 2026 } },
    });
    expect(partial.awaiting?.awaitingInput?.requestId).toBe(id);
    expect(readPausedRun((await sessions.hydrate('s'))!)?.pending.awaitingInput?.requestId).toBe(
      id,
    );
    const unrelated = await host.deliver({ input: 'another message', sessionId: 's' });
    expect(unrelated.error).toBeDefined();
    expect(readPausedRun((await sessions.hydrate('s'))!)?.pending.awaitingInput?.requestId).toBe(
      id,
    );
    const done = await host.deliver({
      input: '',
      sessionId: 's',
      decision: { requestId: id, values: { month: 4 } },
    });
    expect(done.error).toBeUndefined();
    expect(done.output).toBe('done');
  } finally {
    await handle.close();
  }
});

it('preparation readers expose no previous run while the next resume has no native origin', async () => {
  const agent = Agent.create({
    provider: mock({ replies: [{ toolCalls: [{ id: 'ask', name: 'ask', args: {} }] }, 'done'] }),
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'ask',
        description: 'Ask',
        inputSchema: { type: 'object' },
        execute: () => askHuman({ question: 'Continue?' }),
      }),
    )
    .build();
  const pause = await agent.run('first');
  if (!isPaused(pause)) throw new Error('Expected pause');
  let observed = 0;
  agent.on('agentfootprint.pause.resume', () => {
    observed++;
    expect(agent.getLastSnapshot()).toBeUndefined();
    expect(agent.checkpoint()).toBeUndefined();
    expect(agent.getCommitCount()).toBe(0);
    expect(agent.getLastNarrativeEntries()).toEqual([]);
  });
  expect(await agent.resume(pause.checkpoint, 'yes')).toBe('done');
  expect(observed).toBe(1);
  expect(agent.checkpoint()).toBeDefined();
});
