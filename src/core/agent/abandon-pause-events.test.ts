import { expect, it } from 'vitest';
import { Agent, askHuman, defineTool, isPaused } from '../../index.js';
import { mock } from '../../providers.js';

// What `abandonPause()` emits, as `Agent.abandonPause` and `PendingQuestionError`
// document it: no pause event and no run record, but the paused run's call- and
// run-scoped tool teardowns are released, and each released teardown emits
// `agentfootprint.tools.session_closed` like any teardown does. Without a
// teardown, nothing is emitted at all.
it.each(['call', 'run', 'none'] as const)(
  'abandonPause emits only the teardown events of the paused run (teardown scope: %s)',
  async (scope) => {
    let cleaned = 0;
    const agent = Agent.create({
      provider: mock({ replies: [{ toolCalls: [{ id: 'c1', name: 'hold', args: {} }] }, 'done'] }),
      model: 'mock',
    })
      .tool(
        defineTool({
          name: 'hold',
          description: 'hold',
          inputSchema: { type: 'object' },
          execute: (_args, context) => {
            if (scope !== 'none')
              context.onTeardown!(
                () => {
                  cleaned++;
                },
                { scope },
              );
            return askHuman({ question: 'Continue?' });
          },
        }),
      )
      .build();
    const events: string[] = [];
    try {
      const paused = await agent.run('ask');
      if (!isPaused(paused)) throw new Error('Expected pause');
      agent.on('*', (event) => events.push(event.type));
      expect(await agent.abandonPause()).toMatchObject({ toolName: 'hold', toolCallId: 'c1' });
      expect(cleaned).toBe(scope === 'none' ? 0 : 1);
      expect(events).toEqual(scope === 'none' ? [] : ['agentfootprint.tools.session_closed']);
      expect(events.some((type) => type.startsWith('agentfootprint.pause.'))).toBe(false);
    } finally {
      await agent.shutdown({ stop: true });
    }
  },
);
