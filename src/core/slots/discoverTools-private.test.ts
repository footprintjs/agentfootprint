import { expect, it } from 'vitest';
import { Agent, defineTool, isInputPause } from '../../index.js';
import { SHOWN_ARGS } from '../toolShownArgs.js';
import { scripted, batch, events } from '../../../test/core/agent/arguments/askReviewHarness.js';

function dynamicTool() {
  const tool = defineTool({
    name: 'lookup',
    description: 'Lookup',
    inputSchema: { type: 'object', properties: { account: { type: 'string' } } },
    askOrAssume: { account: { ask: 'Account?' } },
    execute: () => 'found',
  });
  return {
    ...tool,
    [SHOWN_ARGS]: (args: Record<string, unknown>) =>
      'account' in args ? { ...args, account: 'REDACTED' } : args,
  };
}
it('refuses a late private mapper before model offer or any question without a native arm', async () => {
  const mock = scripted([batch({ id: 'one', name: 'lookup', args: {} })]);
  let listed = 0;
  const agent = Agent.create({ provider: mock.provider as never, model: 'fixture' })
    .inputsLayer()
    .toolProvider({
      id: 'late',
      list: () => {
        listed++;
        return [dynamicTool() as never];
      },
    })
    .build();
  const seen = events(agent);
  try {
    let refusal: unknown;
    try {
      await agent.run({ message: 'go' });
    } catch (error) {
      refusal = error;
    }
    const error = refusal as { cause?: { code?: string }; code?: string };
    expect(error?.code ?? error?.cause?.code).toBe('ERR_PRIVATE_ARGUMENT_RECORD');
    expect(listed).toBe(1);
    expect(mock.requests).toHaveLength(0);
    expect(seen.some((event) => event.type === 'agentfootprint.pause.request')).toBe(false);
  } finally {
    await agent.shutdown();
  }
});
it('an explicitly armed caller policy permits the late private question', async () => {
  const mock = scripted([batch({ id: 'one', name: 'lookup', args: {} })]);
  const agent = Agent.create({
    provider: mock.provider as never,
    model: 'fixture',
    redact: { diagnostics: { keys: ['private-diagnostic'] } },
  })
    .inputsLayer()
    .toolProvider({ id: 'late', list: () => [dynamicTool() as never] })
    .build();
  try {
    expect(isInputPause(await agent.run({ message: 'go' }))).toBe(true);
  } finally {
    await agent.shutdown();
  }
});
