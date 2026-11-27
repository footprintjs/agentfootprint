import { Agent, inMemoryArtifacts } from '../../src/index.js';
import type { AgentHost, HostHandler, HostedCompletedAgentTurn } from '../../src/hosting/index.js';
import { memorySessions, standingAgent } from '../../src/hosting/index.js';
import { mock } from '../../src/llm-providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'artifacts/completed-turn-evidence',
  title: 'Read evidence from one verified Agent turn',
  group: 'artifacts',
  description: 'Use the original completed turn and its saved recording after another turn runs.',
  defaultInput: 'Summarize the current state.',
  providerSlots: [],
  tags: ['hosting', 'evidence', 'recording'],
};

export async function run(input: string) {
  let deliver: HostHandler | undefined;
  const host: AgentHost = {
    name: 'in-process-demo',
    capabilities: [],
    serve: async (handler) => {
      deliver = handler;
      return { close: async () => undefined };
    },
  };
  const agent = Agent.create({
    provider: mock({ reply: 'Finished.' }),
    model: 'mock',
    artifacts: { store: inMemoryArtifacts(), recordings: { layout: 'parts', packed: true } },
  }).build();

  // #region completed-turn
  const completed: HostedCompletedAgentTurn[] = [];
  const handle = await standingAgent({
    agent,
    host,
    sessions: memorySessions(),
    identity: {
      verify: async (token) => {
        if (token !== 'local-example-token') throw new Error('Unverified demo caller');
        return { userId: 'demo-user' };
      },
    },
    onCompletedTurn: (turn) => {
      completed.push(turn);
    },
  });
  try {
    if (deliver === undefined) throw new Error('The demo host is unavailable.');
    const request = {
      sessionId: 'demo-session',
      headers: { authorization: 'Bearer local-example-token' },
    };
    const reply = {
      complete: () => undefined,
      fail: (error: Error) => {
        throw error;
      },
    };
    await deliver({ ...request, input }, reply);
    await deliver({ ...request, input: 'Another turn' }, reply);
    const first = completed[0];
    if (first === undefined) throw new Error('No completed turn was captured.');
    const turn = await first.forRequest(() => request, 'saved');
    if (turn === undefined) throw new Error('The first completed turn is unavailable.');
    return await first.agent.whatWasNotRead(turn);
  } finally {
    await handle.close();
  }
  // #endregion completed-turn
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput!).then(printResult, (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
