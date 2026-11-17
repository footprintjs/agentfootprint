/** Mock-only native protocol correction; a declared source must still pass the ordinary checks. */
import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

const VM = 'fixture-alpha';
export const meta: ExampleMeta = {
  id: 'features/122-source-declaration-correction',
  title: 'Correct a missing source declaration before asking the person',
  group: 'features',
  description:
    'Hold the whole batch, request one genuine source declaration, then verify the new proposal.',
  defaultInput: `Read disks for ${VM}.`,
  providerSlots: [],
  tags: ['features', 'inputs', 'findings', 'security'],
};

export async function run(input: string): Promise<unknown> {
  let executions = 0;
  // #region source-correction
  const agent = Agent.create({
    provider: mock({
      replies: [
        { content: '', toolCalls: [{ id: 'omitted', name: 'read_disks', args: { vm: VM } }] },
        {
          content: '',
          toolCalls: [
            {
              id: 'declared',
              name: 'read_disks',
              args: {
                vm: VM,
                _findings: { from: [{ argument: 'vm', source: 'user', quote: input }] },
              },
            },
          ],
        },
        'The synthetic disk lookup completed.',
      ],
    }),
    model: 'mock',
    recordReceipt: false,
  })
    .tool(
      defineTool({
        name: 'read_disks',
        description: 'Read a synthetic VM disk inventory.',
        inputSchema: { type: 'object', properties: { vm: { type: 'string' } }, required: ['vm'] },
        askOrAssume: { vm: { ask: 'Which VM?' } },
        execute: () => {
          executions++;
          return [{ disk: 'fixture-disk', capacityGb: 12 }];
        },
      }),
    )
    .inputsLayer({ argumentSources: true, declarationCorrection: 'once' })
    .build();
  // #endregion source-correction
  try {
    const answer = await agent.run({ message: input });
    return {
      answer,
      executions,
      ledger: agent.findings(),
      protocolFeedback: (agent.getSnapshot()?.sharedState.history ?? [])
        .filter((message) => message.role === 'tool' && message.toolResultOrigin === 'not-entered')
        .map((message) => message.content),
      limitation:
        'A verified source declaration traces bytes; it does not prove relevance or truth.',
    };
  } finally {
    await agent.shutdown();
  }
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
