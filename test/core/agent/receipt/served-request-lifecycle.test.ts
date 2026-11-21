import { expect, it } from 'vitest';
import { Agent, defineTool, isPaused, pauseHere, Sequence } from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import { recordRun } from '../../../../src/observe.js';
import type { LLMRequest } from '../../../../src/provider-contract/types.js';
import {
  epochLocations,
  readAfterCall,
  readAtCall,
  type EpochLocation,
  type FoldSourceLike,
} from '../../../../src/time-travel/index.js';

const key = 'sourceLinkServedRows';

function wholeHistoryRow(epoch: EpochLocation, length: number) {
  return {
    kind: 'served',
    version: 1,
    consumer: epoch.callRuntimeStageId,
    served: [{ key: 'history', elements: [[0, length]] }],
  };
}

it('retains the served row across a pause and appends only the resumed execution', async () => {
  const requests: LLMRequest[] = [];
  const fixture = mock({
    replies: [
      { toolCalls: [{ id: 'ask-label', name: 'ask_label', args: {} }] },
      { content: 'Recorded the label.' },
    ],
  });
  const agent = Agent.create({
    provider: {
      name: fixture.name,
      complete(request) {
        requests.push(request);
        return fixture.complete(request);
      },
    },
    model: 'mock',
    reactMode: 'dynamic',
  })
    .tool(
      defineTool({
        name: 'ask_label',
        description: 'Ask the user for the sample label.',
        inputSchema: { type: 'object' },
        execute: () => pauseHere({ question: 'What is the label?' }),
      }),
    )
    .build();

  try {
    const paused = await agent.run('Record the label.');
    if (!isPaused(paused)) throw new Error('Expected the agent to pause for the label.');
    expect(requests).toHaveLength(1);
    const beforePause = epochLocations(agent.getSnapshot());
    expect(beforePause).toHaveLength(1);
    const [first] = beforePause;
    const firstRow = wholeHistoryRow(first!, 1);
    expect(requests[0]!.messages).toEqual([{ role: 'user', content: 'Record the label.' }]);
    expect(readAtCall(first!, key)).toBeUndefined();
    expect(readAfterCall(first!, key)).toEqual([firstRow]);

    const checkpoint = JSON.parse(JSON.stringify(paused.checkpoint)) as typeof paused.checkpoint;
    expect(await agent.resume(checkpoint, 'blue')).toBe('Recorded the label.');
    expect(requests).toHaveLength(2);
    const afterResume = epochLocations(agent.getSnapshot());
    expect(afterResume).toHaveLength(1);
    const [resumed] = afterResume;
    expect(resumed!.callRuntimeStageId).not.toBe(firstRow.consumer);
    expect(requests[1]!.messages).toHaveLength(3);
    expect(requests[1]!.messages.at(-1)).toMatchObject({
      role: 'tool',
      content: 'blue',
    });
    expect(readAtCall(resumed!, key)).toEqual([firstRow]);
    expect(readAfterCall(resumed!, key)).toEqual([firstRow, wholeHistoryRow(resumed!, 3)]);
    const writes = resumed!.log.flatMap((commit) =>
      commit.trace.filter((row) => row.path === key).map(() => commit.runtimeStageId),
    );
    expect(writes).toEqual([resumed!.callRuntimeStageId]);
  } finally {
    await agent.shutdown();
  }
});

it('writes a mounted agent’s row in its own record for its own history', async () => {
  const requests: LLMRequest[] = [];
  const fixture = mock({ reply: 'Mounted answer.' });
  const child = Agent.create({
    provider: {
      name: fixture.name,
      complete(request) {
        requests.push(request);
        return fixture.complete(request);
      },
    },
    model: 'mock',
    reactMode: 'dynamic',
  }).build();
  const first = Agent.create({
    provider: mock({ reply: 'Input for the child.' }),
    model: 'mock',
  }).build();
  const parent = Sequence.create().step('first', first).step('worker', child).build();
  const recorder = recordRun(parent);

  try {
    expect(await parent.run({ message: 'Input for the first step.' })).toBe('Mounted answer.');
    expect(requests).toHaveLength(1);
    expect(requests[0]!.messages).toEqual([{ role: 'user', content: 'Input for the child.' }]);
    const snapshot = parent.getSnapshot();
    expect(snapshot).toBeDefined();
    expect(snapshot!.commitLog.some((commit) => commit.trace.some((row) => row.path === key))).toBe(
      false,
    );

    const { treeContext } = snapshot!.subflowResults!['step-worker'] as {
      treeContext: FoldSourceLike;
    };
    const epochs = epochLocations({
      commitLog: treeContext.history,
      initialState: treeContext.initialState,
    });
    expect(epochs).toHaveLength(1);
    const [epoch] = epochs;
    const call = recorder
      .toRecording()
      .events.find(
        (event) =>
          event.type === 'agentfootprint.stream.llm_start' &&
          event.meta.subflowPath.includes('step-worker'),
      );
    expect(call?.meta.runtimeStageId).toBe(epoch!.callRuntimeStageId);
    expect(readAtCall(epoch!, 'history')).toEqual(requests[0]!.messages);
    expect(readAfterCall(epoch!, key)).toEqual([wholeHistoryRow(epoch!, 1)]);
    expect(epoch!.log[epoch!.callIdx]!.trace.filter((row) => row.path === key)).toHaveLength(1);
  } finally {
    recorder.stop();
    await parent.shutdown();
  }
});
