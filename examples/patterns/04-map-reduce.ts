/**
 * Pattern 04 — MapReduce.
 *
 * Split input into N fixed shards; summarize each shard in parallel;
 * combine summaries via a reducer (pure fn or LLM).
 *
 * Classic use case: summarize a document that exceeds the context window.
 *
 * Run:  npx tsx examples/v2/patterns/04-map-reduce.ts
 */

import { mapReduce } from '../../src/index.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';
import { exampleProvider } from '../helpers/provider.js';

export const meta: ExampleMeta = {
  id: 'v2/patterns/04-map-reduce',
  title: 'MapReduce — split → summarize shards → combine',
  group: 'v2-patterns',
  description: 'Fixed shard count; each branch runs one LLMCall; a reducer fn or merge-LLM combines. Classic long-document summarization pattern.',
  defaultInput: 'Paragraph 1: intro about cats.\n\nParagraph 2: habits of cats.\n\nParagraph 3: cats vs dogs.',
  providerSlots: ['default'],
  tags: ['v2', 'pattern', 'MapReduce'],
};


export async function run(input: string, provider?: import("../../src/index.js").LLMProvider): Promise<unknown> {
  // Simulated long document — the splitter breaks it into 3 paragraphs.
  const doc = [
    'Paragraph 1: intro about cats.',
    'Paragraph 2: habits of cats.',
    'Paragraph 3: cats vs dogs.',
  ].join('\n\n');

  const runner = mapReduce({
    // Mock summarizer — returns "summary(<shard>)" so shard routing is
    // visible in the output. Real provider via ProviderPicker bypasses.
    provider: provider ?? exampleProvider('pattern', {
      respond: (req) => {
        const last = [...req.messages].reverse().find((m) => m.role === 'user');
        return `summary(${last?.content ?? ''})`;
      },
    }),
    model: 'mock',
    mapPrompt: 'Summarize the paragraph in one sentence.',
    shardCount: 3,
    // Splitter: split on paragraph breaks. Must return exactly shardCount shards.
    split: (input, n) => {
      const parts = input.split('\n\n').slice(0, n);
      while (parts.length < n) parts.push('');
      return parts;
    },
    // Reducer: simple concatenator.
    reduce: {
      kind: 'fn',
      fn: (results) =>
        Object.keys(results)
          .sort()
          .map((id) => `• ${results[id]}`)
          .join('\n'),
    },
  });

  const summary = await runner.run({ message: doc });
  console.log('Final summary:\n' + summary);
  return summary;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '').then(printResult).catch(console.error);
}
