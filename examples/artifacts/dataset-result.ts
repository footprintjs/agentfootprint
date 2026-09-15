/** A producer declares rows once; a follow-up tool receives them through wants. */
import {
  Agent, defineTool, inMemoryArtifacts, withDatasetArtifacts,
  type DatasetResultAdapter, type LLMProvider, type LLMRequest,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'artifacts/dataset-result',
  title: 'Publish a dataset, then follow its reference',
  group: 'artifacts',
  description: 'Declare producer-owned rowsets, keep source lineage, and redeem the reference on a later turn.',
  defaultInput: 'Load the synthetic ledger.',
  providerSlots: ['default'],
  tags: ['artifacts', 'datasets', 'wants', 'follow-up'],
};

const fixture = {
  rows: [{ id: 'a', amount: 0 }, { id: 'b', amount: 10 }, { id: 'c', amount: 20 }],
  source: { name: 'synthetic ledger', version: 1, live: false },
};
type Ticket = { dataset: { ref: string; rows: number }; source: { status: string; ref?: string } };

const adapter: DatasetResultAdapter<Record<string, unknown>, typeof fixture, Ticket> = {
  describe(result) {
    return {
      datasets: [{
        key: 'rows',
        artifact: { kind: 'dataset/rows', mediaType: 'application/json', data: result.rows },
        source: { kind: 'evidence/source', mediaType: 'application/json', data: result.source },
      }],
      project(publications) {
        const publication = publications[0]!;
        if (publication.artifact.status !== 'stored') throw new Error('The dataset could not be retained.');
        return {
          dataset: { ref: publication.artifact.meta.ref, rows: result.rows.length },
          source: publication.source?.status === 'stored'
            ? { status: 'available', ref: publication.source.meta.ref }
            : { status: 'unavailable' },
        };
      },
    };
  },
};

function lastTool(request: LLMRequest): string {
  return String([...request.messages].reverse().find(message => message.role === 'tool')?.content ?? '');
}

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  let sourceReads = 0;
  let call = 0;
  let ticket: Ticket | undefined;
  const lookup = defineTool({
    name: 'lookup_ledger', description: 'Load the synthetic ledger and return a dataset reference.',
    execute: async () => { sourceReads++; return fixture; },
  });
  const total = defineTool<{ dataset: string }, string>({
    name: 'sum_ledger', description: 'Sum a stored ledger; pass its dataset reference.',
    inputSchema: { type: 'object', properties: { dataset: { type: 'string' } }, required: ['dataset'] },
    wants: { dataset: 'dataset/rows' },
    execute(args) {
      // The dispatcher redeemed the reference under this conversation's scope.
      const rows = args.dataset as unknown as typeof fixture.rows;
      return `Total ${rows.reduce((sum, row) => sum + row.amount, 0)} over ${rows.length} rows.`;
    },
  });
  const agent = Agent.create({
    artifacts: inMemoryArtifacts(), model: 'mock', maxIterations: 4,
    provider: provider ?? mock({ respond(request) {
      switch (++call) {
        case 1: return { toolCalls: [{ id: 'lookup', name: 'lookup_ledger', args: {} }] };
        case 2:
          ticket = JSON.parse(lastTool(request)) as Ticket;
          return `Loaded ${ticket.dataset.rows} rows by reference.`;
        case 3: return { toolCalls: [{ id: 'sum', name: 'sum_ledger', args: { dataset: ticket!.dataset.ref } }] };
        default: return lastTool(request);
      }
    } }),
  }).system('Use lookup_ledger for the initial request and sum_ledger for a total. Keep the source limitations.')
    .tool(withDatasetArtifacts(lookup, adapter)).tool(total).build();

  const loaded = await agent.run({ message: input, identity: { conversationId: 'synthetic-ledger-demo' } });
  const answer = await agent.followUp('Total those rows.');
  return `${String(loaded)}\n${String(answer)}\nSource reads: ${sourceReads}. Synthetic data only.`;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(error => { console.error(error); process.exitCode = 1; });
}
