/** A clean preview cannot conceal a mistyped tail in the actual published dataset. */
import { Agent, defineTool, inMemoryArtifacts, type LLMProvider } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'artifacts/governed-result-rowsets',
  title: 'Check the complete current-call dataset',
  group: 'artifacts',
  description:
    'Bind column types to the final payload or a bounded same-call dataset, with no extra query.',
  defaultInput: 'Read the synthetic disk inventory.',
  providerSlots: ['default'],
  tags: ['artifacts', 'datasets', 'column-types', 'integrity'],
};

export async function run(input: string, suppliedProvider?: LLMProvider): Promise<string> {
  let sourceCalls = 0;
  const checks: unknown[] = [];
  // #region declared-final-rowset
  const source = defineTool({
    name: 'read_disks',
    description: 'Read the local synthetic disk inventory.',
    resultRowsets: [
      {
        key: 'disks',
        columns: { capacity_gb: 'number', is_rdm: 'boolean' },
        source: {
          kind: 'published-dataset',
          refPath: ['dataset'],
          artifactKind: 'dataset/disks',
          maxRows: 1000,
          maxBytes: 1048576,
        },
      },
    ],
    async execute(_args, context) {
      sourceCalls++;
      const rows = [
        { capacity_gb: 0, is_rdm: false },
        { capacity_gb: 8, is_rdm: true },
        { capacity_gb: 'wrong-type', is_rdm: false },
      ];
      const dataset = await context.artifacts.put({
        kind: 'dataset/disks',
        mediaType: 'application/json',
        data: rows,
        digest: 'sha-256',
      });
      return { preview: rows.slice(0, 2), dataset: dataset.ref };
    },
  });
  const agent = Agent.create({
    model: 'mock',
    checkColumnTypes: 'enforce',
    artifacts: inMemoryArtifacts(),
    maxIterations: 3,
    provider:
      suppliedProvider ??
      mock({
        replies: [
          { toolCalls: [{ id: 'read-disks', name: 'read_disks', args: {} }] },
          'The inventory was rejected because capacity_gb contains a string. Correct the source type before using it.',
        ],
      }),
  })
    .tool(source)
    .build();
  // #endregion declared-final-rowset
  agent.on('agentfootprint.tools.rowset_checked', (event) => checks.push(event.payload));
  const answer = await agent.run({
    message: input,
    identity: { principal: 'fixture', conversationId: 'governed-rowsets-example' },
  });
  if (!suppliedProvider && (sourceCalls !== 1 || checks.length !== 1))
    throw new Error('Expected one native source call and one rowset encounter.');
  return JSON.stringify({ answer, sourceCalls, checks }, null, 2);
}

if (isCliEntry(import.meta.url)) run(meta.defaultInput ?? '').then(printResult);
