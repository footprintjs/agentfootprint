import { expect, it } from 'vitest';
import { Agent, allow, defineTool } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { assessAnswer, recordRun } from '../../../src/observe.js';

async function countShelves(ids: readonly [string, string]) {
  const ran: { n: number; window: string }[] = [];
  const agent = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: ids.map((id, index) => ({ id, name: 'count', args: { n: index + 1 } })) },
        'Counted.',
      ],
    }),
    model: 'mock',
  })
    .tool(
      defineTool<{ n: number; window: string }, unknown>({
        name: 'count',
        description: 'Read one fixture shelf for a window.',
        inputSchema: {
          type: 'object',
          properties: { n: { type: 'integer' }, window: { type: 'string' } },
          required: ['n', 'window'],
        },
        askOrAssume: { window: { assume: '2h' } },
        execute: (args) => {
          ran.push({ ...args });
          return [{ shelf: args.n }];
        },
      }),
    )
    .toolMiddleware({
      name: 'office-hours',
      onToolCall: ({ args }) =>
        args.n === 1
          ? allow({ ...args, window: '9h' }, 'office policy', { from: { window: 'app' } })
          : allow(),
    })
    .inputsLayer()
    .answerLayer({ standingLine: true })
    .build();
  const recorder = recordRun(agent);
  try {
    const answer = await agent.run('Count the shelves.');
    const reason = assessAnswer(recorder.toRecording()).reasons.find(
      (row) => row.reason === 'argument-assumed',
    );
    return { answer, ran, witness: reason?.witness };
  } finally {
    recorder.stop();
    await agent.shutdown();
  }
}

it('names an assumed value when only a sibling with the same provider ID was rewritten', async () => {
  const unique = await countShelves(['first', 'second']);
  const reused = await countShelves(['same', 'same']);
  expect(unique).toEqual({
    answer:
      'Counted.\n\n---\n\nNot sure — window = "2h" was assumed by count\'s rule, not given by you.',
    ran: [
      { n: 1, window: '9h' },
      { n: 2, window: '2h' },
    ],
    witness: [{ kind: 'state', key: 'findingsLedger', path: '/1/argument' }],
  });
  expect(reused).toEqual(unique);
});
