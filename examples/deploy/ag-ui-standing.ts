/** AG-UI and JSON share one conversation owner and bounded agent pool.
 * Run: npm run example examples/deploy/ag-ui-standing.ts */
import { Agent, type LLMRequest } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { agUi } from '../../src/doors/ag-ui.js';
import {
  httpHost,
  jsonWire,
  memorySessions,
  protocolRoute,
  standingAgent,
} from '../../src/doors/hosting.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'deploy/ag-ui-standing',
  title: 'AG-UI with a shared standing conversation owner',
  group: 'deploy',
  description:
    'A bounded agent pool serves AG-UI and JSON through the same authentication, admission, session lane and checkpoint lifecycle.',
  defaultInput: 'Remember that we are discussing array A.',
  providerSlots: [],
  tags: ['deploy', 'ag-ui', 'hosting', 'streaming', 'sessions'],
};

export async function run(input: string): Promise<string> {
  let builds = 0;
  const requests: LLMRequest[] = [];
  const provider = mock({
    respond: (request) => {
      requests.push(request);
      return { content: 'The conversation is available.', toolCalls: [] };
    },
  });
  // #region standing-host
  const host = httpHost({
    name: 'example',
    hostname: '127.0.0.1',
    port: 0,
    invokePath: '/invoke',
    healthPath: '/health',
    wire: jsonWire,
    protocols: [protocolRoute({ path: '/ag-ui', adapter: agUi() })],
  });
  const handle = await standingAgent({
    host,
    sessions: memorySessions(), // Use a persistent store to survive restarts.
    maxActiveSessions: 20,
    identity: {
      verify: async (token) => {
        if (token !== 'example-token') throw new Error('Invalid example credential');
        return { userId: 'example-reader' };
      },
    },
    agentFactory: () => {
      builds++;
      return Agent.create({ provider, model: 'mock' }).build();
    },
  });
  // #endregion standing-host
  try {
    // #region turn
    const headers = {
      'content-type': 'application/json',
      authorization: 'Bearer example-token',
      'x-session-id': 'example-chat',
    };
    const streamed = await fetch(`${handle.url}/ag-ui`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        threadId: 'example-chat',
        runId: 'first-run',
        messages: [{ id: 'first-message', role: 'user', content: input }],
        tools: [],
        context: [],
        state: {},
      }),
    });
    const events = await streamed.text();
    if (!streamed.ok || !events.includes('RUN_FINISHED')) throw new Error('AG-UI did not finish');
    const followed = await fetch(`${handle.url}/invoke`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ input: 'Continue the same conversation.' }),
    });
    if (!followed.ok) throw new Error('The JSON follow-up failed');
    await followed.json();
    // #endregion turn
    if (
      builds !== 1 ||
      requests.length !== 2 ||
      !requests[1]?.messages.some((message) => message.content === input)
    ) {
      throw new Error('Both protocols must share the pooled agent and saved conversation');
    }
    console.log(events);
    return 'Two protocols, one conversation owner, one pooled agent.';
  } finally {
    await handle.close();
  }
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
