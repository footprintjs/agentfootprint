import { Agent, Sequence, absent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'core-flow/07-group-assessment',
  title: 'Sequence group assessment',
  group: 'core-flow',
  description: 'Record the group standing and coverage from committed member assessments.',
  defaultInput: 'Check the attachment.',
  providerSlots: [],
  tags: ['Sequence', 'standing', 'coverage'],
};

export async function run(message: string): Promise<unknown> {
  const researcher = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'lookup-1', name: 'lookup', args: {} }] },
        { content: 'The attachment was unavailable.' },
      ],
    }),
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'lookup',
        description: 'Find the attachment',
        inputSchema: { type: 'object', properties: {} },
        execute: () => absent({ what: 'an attachment', checked: ['attached files'] }),
      }),
    )
    .answerLayer({ standingLine: false })
    .build();

  // #region opt-in
  const sequence = Sequence.create({ groupAssessment: true })
    .step('check-source', researcher)
    .build();

  const unsubscribe = sequence.on('agentfootprint.composition.exit', ({ payload }) => {
    console.log(payload.groupAssessment);
  });
  try {
    return await sequence.run({ message });
  } finally {
    unsubscribe();
  }
  // #endregion opt-in
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
