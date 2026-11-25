import { Agent } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'deploy/host-ended-turn',
  title: 'End a turn when the host reaches its cap',
  group: 'deploy',
  description: 'Deliver a host notice and inspect its authorship in the saved conversation.',
  defaultInput: null,
  providerSlots: [],
  tags: ['hosting', 'conversation', 'checkpoint'],
};

// #region host-ended-turn
export async function run() {
  const agent = Agent.create({
    hostEndedTurns: true,
    model: 'mock',
    provider: mock({
      respond() {
        throw new Error('The host notice should complete without a provider call');
      },
    }),
  }).build();
  try {
    const delivered = await agent.endTurn({
      reply: 'The request limit has been reached.',
      reason: 'host-cap',
    });
    const entry = agent.checkpoint()?.history.at(-1);
    return { delivered, author: entry?.replyOrigin?.kind, runId: entry?.replyOrigin?.runId };
  } finally {
    await agent.shutdown();
  }
}
// #endregion host-ended-turn

if (isCliEntry(import.meta.url)) void run().then(printResult);
