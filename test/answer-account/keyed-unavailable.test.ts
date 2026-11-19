import { expect, it } from 'vitest';
import { Agent, coverage, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { accountForAnswer, recordRun, type Recording } from '../../src/observe.js';
import type { LLMMessage } from '../../src/provider-contract/types.js';

it('names a missing or conflicting keyed result distinctly from legacy unmatched evidence', async () => {
  const inventory = defineTool({
    name: 'inventory',
    description: 'Read fixture shelves.',
    inputSchema: { type: 'object', properties: {} },
    execute: () => coverage(['book'], { checked: ['shelf A'], notChecked: ['shelf B'] }),
  });
  const agent = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'sample', name: 'inventory', args: {} }] },
        { content: 'Done.' },
      ],
    }),
    model: 'mock',
  })
    .tool(inventory)
    .build();
  const recorder = recordRun(agent);
  try {
    await agent.run({ message: 'Read the shelf.' });
    const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
    const state = recording.snapshot.sharedState as { history: LLMMessage[] };
    const result = state.history.find((entry) => entry.role === 'tool');
    expect(result).toHaveProperty('callOccurrenceKey');
    const standingText = (source: Recording) =>
      accountForAnswer(source)
        .rows.find((row) => row.id === 'how-sure')
        ?.lines.map(({ text }) => text);

    const original = state.history;
    state.history = original.filter(
      (entry) => entry.role !== 'tool' && entry.toolCalls === undefined,
    );
    expect(standingText(recording)).toContain(
      'The call result is unavailable in the retained history for 1 evidence row.',
    );
    const legacy = JSON.parse(
      JSON.stringify(recording, (name, value: unknown) =>
        name === 'callOccurrenceKey' ? undefined : value,
      ),
    ) as Recording;
    expect(standingText(legacy)).toContain('1 evidence row could not be matched to a call.');
    expect(standingText(recording)).not.toContain('1 evidence row could not be matched to a call.');

    state.history = [...original, { ...result! }];
    expect(standingText(recording)).toContain(
      'The recorded call address is unreadable for 1 evidence row.',
    );
  } finally {
    recorder.stop();
  }
});
