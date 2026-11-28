import type { LogAddress } from 'foottrace';
import { createRecordGraph } from 'foottrace/cause';

import { Agent, inMemoryArtifacts, RECORDING_INDEX_ARTIFACT_KIND } from '../../src/index.js';
import type { AgentHost, HostHandler, HostedCompletedAgentTurn } from '../../src/hosting/index.js';
import { memorySessions, standingAgent } from '../../src/hosting/index.js';
import { mock } from '../../src/llm-providers.js';
import { openSavedRecording } from '../../src/observe.js';
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
    const coverage = await first.agent.whatWasNotRead(turn);

    const authorized = await handle.artifactsForRequest(request);
    if (!authorized.bound) throw new Error('The demo recording is unavailable.');
    const { artifacts } = await authorized.artifacts.list();
    const receipt = artifacts.find(
      (item) => item.kind === RECORDING_INDEX_ARTIFACT_KIND && item.origin?.runId === first.runId,
    );
    if (!receipt) throw new Error('No recording for the first turn.');
    const recording = await openSavedRecording(authorized.artifacts, receipt.ref);
    if (recording.status !== 'ready' || !recording.complete)
      throw new Error('The saved index is unavailable.');
    const invocation = recording.invocations.find((item) => item.recorded);
    if (!invocation) throw new Error('The turn did not record a child.');
    const part = await recording.readInvocation(invocation.key);
    if (part.status !== 'ready') throw new Error('The child is unavailable.');
    const tree = (
      part.result as {
        treeContext?: { logAddress?: LogAddress; history?: readonly { runtimeStageId?: string }[] };
      }
    ).treeContext;
    const last = tree?.history?.at(-1);
    if (!tree?.logAddress || !last?.runtimeStageId)
      throw new Error('The child has no recorded address.');

    // #region child-why
    const selected = createRecordGraph([]).nodeId(tree.logAddress, {
      runtimeStageId: last.runtimeStageId,
    });
    const why = await first.agent.why(first.node(selected, tree.logAddress), turn);
    // #endregion child-why
    return { coverage, why };
  } finally {
    await handle.close();
  }
  // #endregion completed-turn
}

if (isCliEntry(import.meta.url) && typeof meta.defaultInput === 'string') {
  run(meta.defaultInput).then(printResult, (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
