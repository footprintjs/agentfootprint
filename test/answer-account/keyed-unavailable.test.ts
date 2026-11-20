import { expect, it } from 'vitest';
import { Agent, coverage, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { accountForAnswer, recordRun, type Recording } from '../../src/observe.js';
import type { LLMMessage } from '../../src/provider-contract/types.js';

it('standing uses only an addressable served result when a keyed result is missing or conflicting', async () => {
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
    const noVerdict =
      "Not assessed — this record's committed state holds no verdict the standing can rest on.";
    expect(standingText(recording)?.some((line) => line.includes('declared ground'))).toBe(true);

    state.history = original.filter(
      (entry) => entry.role !== 'tool' && entry.toolCalls === undefined,
    );
    expect(standingText(recording)).toContain(noVerdict);
    const legacy = JSON.parse(
      JSON.stringify(recording, (name, value: unknown) =>
        name === 'callOccurrenceKey' ? undefined : value,
      ),
    ) as Recording;
    expect(standingText(legacy)).toContain(noVerdict);

    state.history = [...original, { ...result! }];
    expect(standingText(recording)).toContain(noVerdict);
  } finally {
    recorder.stop();
  }
});
