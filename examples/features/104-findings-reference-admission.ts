/** Mock-only reference identity admission; source identity never proves a claim. */
import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/104-findings-reference-admission',
  title: 'Refuse an unserved findings reference before invoking a tool',
  group: 'features',
  description: 'Keep an unknown attempted citation as evidence while refusing its tool proposal.',
  defaultInput: 'Read the inventory.',
  providerSlots: [],
  tags: ['features', 'findings', 'security'],
};

export async function run(input: string): Promise<unknown> {
  let executions = 0;
  // #region reference-admission
  const agent = Agent.create({
    provider: mock({
      replies: [
        {
          content: '',
          toolCalls: [
            {
              id: 'attempt-1',
              name: 'read_inventory',
              args: {
                _findings: { previous: [{ toolCallId: 'never-served', standing: 'fact' }] },
              },
            },
          ],
        },
        'The proposed citation was refused. I need to read the source first.',
      ],
    }),
    model: 'mock',
    recordReceipt: false,
  })
    .tool(
      defineTool({
        name: 'read_inventory',
        description: 'Read fixture inventory.',
        inputSchema: { type: 'object', properties: {} },
        execute: () => {
          executions++;
          return 'fixture inventory';
        },
      }),
    )
    .findings()
    .build();
  // #endregion reference-admission
  const answer = await agent.run({ message: input });
  if (executions !== 0) throw new Error('The refused proposal unexpectedly invoked the tool.');
  return {
    answer,
    executions,
    ledger: agent.findings(),
    limitation: 'A served ID admits a reference identity, never assertion truth.',
  };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
