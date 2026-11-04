import { expect, it, vi } from 'vitest';
import { Agent, checkInApproved, defineTool, isCheckInPause } from '../../../src/index.js';
import type { ToolDispatchContext } from '../../../src/tools/toolProvider.js';

it.each(['dynamic', 'dynamic-grouped'] as const)(
  '%s fresh resume reacquires only the paused provider party under restored caller facts',
  async (reactMode) => {
    const oldCall = vi.fn(() => 'old');
    const newCall = vi.fn(() => 'new');
    const registryCall = vi.fn(() => 'wrong registry party');
    const contexts: ToolDispatchContext[] = [];
    const tool = (execute: () => string) =>
      defineTool({
        name: 'read_rows',
        description: 'Local rows',
        inputSchema: { type: 'object' },
        checkIn: 'always',
        execute,
      });
    const build = (execute: () => string, withdrawn = false) =>
      Agent.create({
        provider: {
          name: 'scripted',
          complete: async (request: import('../../../src/provider-contract/types.js').LLMRequest) =>
            request.messages.some((m) => m.role === 'tool')
              ? { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } }
              : {
                  content: '',
                  toolCalls: [{ id: 'reused', name: 'read_rows', args: {} }],
                  usage: { input: 1, output: 1 },
                },
        },
        model: 'mock',
        reactMode,
      })
        .tool(tool(registryCall))
        .toolProvider({
          id: 'same-provider',
          list: (ctx) => {
            contexts.push(ctx);
            return withdrawn ? [] : [tool(execute)];
          },
        })
        .build();
    // Provider is first on this wire only when no registered holder competes.
    const first = Agent.create({
      provider: {
        name: 'scripted',
        complete: async () => ({
          content: '',
          toolCalls: [{ id: 'reused', name: 'read_rows', args: {} }],
          usage: { input: 1, output: 1 },
        }),
      },
      model: 'mock',
      reactMode,
    })
      .toolProvider({ id: 'same-provider', list: () => [tool(oldCall)] })
      .build();
    const identity = { principal: 'person', tenant: 'tenant', conversationId: 'thread' };
    const pause = await first.run({ message: 'read', identity }, { sessionId: 'transport' });
    if (!isCheckInPause(pause)) throw new Error('fixture did not request a decision');
    const fresh = build(newCall);
    const controller = new AbortController();
    await fresh.resume(
      structuredClone(pause.checkpoint),
      checkInApproved({ request: pause.checkIn, by: 'person' }),
      { identity, sessionId: 'transport', signal: controller.signal },
    );
    expect(oldCall).not.toHaveBeenCalled();
    expect(registryCall).not.toHaveBeenCalled();
    expect(newCall).toHaveBeenCalledTimes(1);
    expect(contexts[0]?.identity).toEqual(identity);
    expect(contexts[0]?.callerIdentity).toEqual(identity);
    expect(contexts[0]?.signal?.aborted).toBe(false);
  },
);

it('a withdrawn paused provider never falls back to a newly present registered holder', async () => {
  const ran = vi.fn(() => 'wrong party');
  const provider = {
    name: 'scripted',
    complete: async (request: import('../../../src/provider-contract/types.js').LLMRequest) =>
      request.messages.some((m) => m.role === 'tool')
        ? { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } }
        : {
            content: '',
            toolCalls: [{ id: 'same', name: 'read_rows', args: {} }],
            usage: { input: 1, output: 1 },
          },
  };
  const tool = defineTool({
    name: 'read_rows',
    description: 'Local rows',
    inputSchema: { type: 'object' },
    checkIn: 'always',
    execute: ran,
  });
  const first = Agent.create({ provider, model: 'mock' })
    .toolProvider({ id: 'provider', list: () => [tool] })
    .build();
  const pause = await first.run({ message: 'read' });
  if (!isCheckInPause(pause)) throw new Error('fixture did not request a decision');
  const fresh = Agent.create({ provider, model: 'mock' })
    .tool(tool)
    .toolProvider({ id: 'provider', list: () => [] })
    .build();
  await fresh.resume(
    structuredClone(pause.checkpoint),
    checkInApproved({ request: pause.checkIn, by: 'person' }),
  );
  expect(ran).not.toHaveBeenCalled();
  expect(JSON.stringify(fresh.checkpoint()?.history)).toContain(
    'offered under that name was not available to answer it.',
  );
});
