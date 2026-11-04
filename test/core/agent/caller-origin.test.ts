import { expect, it } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import { mock } from '../../../src/adapters/llm/MockProvider.js';
import {
  callerIdentityOf,
  restoredIdentityOf,
  pausedSessionOf,
} from '../../../src/core/agent/callerIdentity.js';

it.each(['native-opaque', 'run-1-1'])(
  'caller identity is explicit data even when it looks like an engine id: %s',
  (conversationId) => {
    const state = {
      runIdentity: { conversationId },
      runIdentitySource: 'caller',
      runSessionId: null,
    };
    expect(callerIdentityOf(state)).toEqual({ conversationId });
    expect(restoredIdentityOf(state)).toEqual({ conversationId });
    expect(pausedSessionOf(state)).toBeUndefined();
  },
);

it('an absent or unknown origin marker cannot establish a resumable identity', () => {
  expect
    .soft(restoredIdentityOf({ runIdentity: { conversationId: 'looks-named' } }))
    .toBe('malformed');
  expect
    .soft(
      restoredIdentityOf({
        runIdentity: { conversationId: 'opaque' },
        runIdentitySource: 'unknown',
      }),
    )
    .toBe('malformed');
  expect.soft(callerIdentityOf({ runIdentity: { conversationId: 'looks-named' } })).toBeUndefined();
});

it.each([
  {
    input: { message: 'go', identity: { conversationId: 'caller' } },
    options: undefined,
    source: 'caller',
  },
  { input: { message: 'go' }, options: { sessionId: 'session' }, source: 'session' },
  { input: { message: 'go' }, options: undefined, source: 'run' },
])('seed records the actual identity origin $source', async ({ input, options, source }) => {
  const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' }).build();
  await expect(agent.run(input, options)).resolves.toBe('ok');
  expect(agent.getLastSnapshot()?.sharedState.runIdentitySource).toBe(source);
});
