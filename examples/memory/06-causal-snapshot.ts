/**
 * Store two causal snapshots with explicit component-leg observation coverage.
 * The default provider and embedder are local fixtures; no model request is made.
 */
import { Agent, defineTool, type LLMProvider } from '../../src/index.js';
import {
  defineMemory,
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
  SNAPSHOT_PROJECTIONS,
  InMemoryStore,
  mockEmbedder,
  type SnapshotEntry,
} from '../../src/doors/memory.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'memory/06-causal-snapshot',
  title: 'Causal memory — bounded evidence from an actual execution leg',
  group: 'memory',
  description:
    'Store query/answer snapshots with explicit observed, partial or unavailable evidence.',
  defaultInput: 'What record is available?',
  providerSlots: ['default'],
  tags: ['memory', 'causal', 'snapshot'],
};

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  const store = new InMemoryStore();
  // #region define-causal
  const causal = defineMemory({
    id: 'causal',
    type: MEMORY_TYPES.CAUSAL,
    strategy: { kind: MEMORY_STRATEGIES.TOP_K, topK: 1, threshold: 0.5, embedder: mockEmbedder() },
    store,
    projection: SNAPSHOT_PROJECTIONS.DECISIONS,
  });
  // #endregion define-causal
  const scripted: LLMProvider = {
    name: 'scripted',
    complete: async (request) => {
      const result = request.messages.filter((message) => message.role === 'tool').at(-1);
      return result === undefined
        ? {
            content: '',
            toolCalls: [{ id: 'record', name: 'read_record', args: {} }],
            usage: { input: 11, output: 3 },
            stopReason: 'tool_use',
          }
        : {
            content: result.content,
            toolCalls: [],
            usage: { input: 17, output: 5 },
            stopReason: 'end_turn',
          };
    },
  };
  const agent = Agent.create({ provider: provider ?? scripted, model: 'mock', maxIterations: 3 })
    .tool(
      defineTool({
        name: 'read_record',
        description: 'Read the local example record.',
        inputSchema: { type: 'object', properties: {} },
        execute: (_args, context) => 'Local record for ' + context.identity?.conversationId,
      }),
    )
    .memory(causal)
    .build();
  const identity = { conversationId: 'causal-example' };
  await agent.run({ message: 'Read the local record.', identity });
  const answer = await agent.run({ message: input, identity });
  if (typeof answer !== 'string') throw new Error('The example paused unexpectedly.');

  const snapshots = (await store.list<SnapshotEntry>(identity)).entries
    .map((entry) => entry.value)
    .filter((value) => 'query' in value);
  if (snapshots.length !== 2) throw new Error('Expected two separately stored snapshots.');
  for (const snapshot of snapshots) {
    if (snapshot.schemaVersion !== 2 || snapshot.availability === 'unavailable')
      throw new Error('Expected explicit component observation coverage.');
    if (snapshot.coverage.priorLegs !== 'not-carried' || snapshot.coverage.source.kind !== 'stage')
      throw new Error('The writer must identify its actual native source.');
    if (
      provider === undefined &&
      (snapshot.toolCalls.length !== 1 ||
        snapshot.tokenUsage.input !== 28 ||
        snapshot.tokenUsage.output !== 8)
    )
      throw new Error('The scripted tool pair and reported usage must be observed once.');
  }
  return answer;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
