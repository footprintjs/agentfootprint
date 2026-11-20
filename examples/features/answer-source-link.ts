/** Record a checked answer value and its source with a scripted provider. */
import assert from 'node:assert/strict';
import { Agent, defineTool, keyedFold } from '../../src/index.js';
import { openRecording, recordRun } from '../../src/doors/observe.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/answer-source-link',
  title: 'Record the source of a checked answer value',
  group: 'features',
  description:
    'A scripted agent records a match between its final answer and a served tool result.',
  defaultInput: 'What is the storage capacity?',
  providerSlots: [],
  tags: ['features', 'observability', 'evidence'],
};

export async function run(input: string): Promise<unknown> {
  // #region record-answer-link
  const agent = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'capacity-call', name: 'capacity', args: {} }] },
        { content: 'The storage pool has 4200 GB.' },
      ],
    }),
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'capacity',
        description: 'Read the storage capacity.',
        inputSchema: { type: 'object' },
        execute: () => 'The storage pool has 4200 GB.',
      }),
    )
    .namesAndNumbersFromEvidence({ posture: 'assist' })
    .build();
  const recorder = recordRun(agent);

  try {
    const answer = await agent.run(input);
    const saved = openRecording(JSON.parse(JSON.stringify(recorder.toRecording())));
    assert(saved.snapshot);
    const state = keyedFold(saved.snapshot);
    const matches = state.valueAt('sourceLinkRows', state.length - 1);
    assert(Array.isArray(matches) && matches.length === 1);
    return { answer, recordedMatches: matches.length };
  } finally {
    recorder.stop();
    await agent.shutdown();
  }
  // #endregion record-answer-link
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
