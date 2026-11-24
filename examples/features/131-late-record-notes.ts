/** Observe late record note submission with a scripted SDK. No network or API key. */
import { Agent, coverage, defineTool } from '../../src/index.js';
import { openai } from '../../src/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/131-late-record-notes',
  title: 'Read a late record note receipt',
  group: 'features',
  description: 'Record an unchecked archive and observe the note at the next SDK handoff.',
  defaultInput: 'What is available in the index?',
  providerSlots: [],
  tags: ['features', 'tools', 'observability'],
};

const model = 'gpt-4o-mini';

function scriptedProvider() {
  let sentToolCall = false;
  return openai({
    _client: {
      chat: {
        completions: {
          async *create(request) {
            if (!request.stream) throw new Error('This example expects a streamed request.');
            if (!sentToolCall) {
              sentToolCall = true;
              yield {
                id: 'read-index',
                model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: 'index-1',
                          function: { name: 'read_index', arguments: '{}' },
                        },
                      ],
                    },
                    finish_reason: 'tool_calls',
                  },
                ],
              };
              return;
            }
            const tail = request.messages.at(-1);
            if (
              tail?.role !== 'user' ||
              typeof tail.content !== 'string' ||
              !tail.content.includes('The archive is awaiting export.')
            )
              throw new Error('The follow-up request should include the recorded archive limit.');
            yield {
              id: 'index-answer',
              model,
              choices: [
                {
                  index: 0,
                  delta: {
                    content: 'The active index is available. The archive is awaiting export.',
                  },
                  finish_reason: 'stop',
                },
              ],
            };
          },
        },
      },
    },
  });
}

type Attempt = Readonly<{ ordinal: number; disposition: string }>;
type SnapshotState = {
  readonly lateRecordNoteReceipt?: readonly [
    Readonly<{ attempts: readonly Attempt[]; accepted?: Attempt }>,
  ];
};

// #region late-record-notes
export async function run(message: string) {
  const agent = Agent.create({ provider: scriptedProvider(), model, lateRecordNotes: true })
    .tool(
      defineTool({
        name: 'read_index',
        displayName: 'Index reader',
        description: 'Read the synthetic active index.',
        inputSchema: { type: 'object', properties: {} },
        execute: () =>
          coverage('The active index is available.', {
            checked: ['active index'],
            notChecked: [{ what: 'archive', why: 'The archive is awaiting export.' }],
          }),
      }),
    )
    .build();

  try {
    const answer = await agent.run({ message });
    const state = agent.getLastSnapshot()?.sharedState as SnapshotState | undefined;
    const receipt = state?.lateRecordNoteReceipt?.[0];
    if (receipt?.accepted?.disposition !== 'submitted')
      throw new Error('Expected the selected response to have a submitted note.');
    return { answer, receipt };
  } finally {
    await agent.shutdown();
  }
}
// #endregion late-record-notes

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
