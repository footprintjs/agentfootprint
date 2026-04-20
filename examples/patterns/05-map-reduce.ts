/**
 * mapReduce — fan-out N pre-bound mappers → reduce.
 *
 * Each mapper is a runner with its slice of work already bound. The
 * reducer is either an LLM merge call or a pure function.
 *
 * Background: the map-reduce shape predates LLMs (Dean & Ghemawat 2004).
 * LLM-flavored variants appear in summarization-tree literature.
 * HONESTY BOX: this factory is the simple flat form — no hierarchical
 * reduce, no recursive splitting. For very large N (hundreds of mappers),
 * build a tree of mapReduce calls.
 */

import { LLMCall, mock } from 'agentfootprint';
import { mapReduce } from 'agentfootprint/patterns';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'patterns/05-map-reduce',
  title: 'mapReduce — fan-out mappers → reduce',
  group: 'patterns',
  description: 'Pre-bound mappers run in parallel; reducer combines results (LLM or function).',
  defaultInput: 'Produce the executive summary.',
  providerSlots: ['mapper', 'reducer'],
  tags: ['Patterns', 'mapReduce', 'composition'],
};

const docs = ['quarterly report', 'sales forecast', 'customer interviews'];

export async function run(
  input: string,
  providers?: { mapper?: LLMProvider; reducer?: LLMProvider },
) {
  const reducerProvider = providers?.reducer ?? mock([{ content: 'Merged summary: doc-0, doc-1, doc-2' }]);

  const pipeline = mapReduce({
    provider: reducerProvider,
    mappers: docs.map((doc, i) => ({
      id: `doc-${i}`,
      description: `Summarize doc ${i}`,
      runner: LLMCall.create({
        provider:
          providers?.mapper ??
          mock([{ content: `summary-of-${doc.split(' ')[0]}` }]),
      })
        .system(`Summarize: ${doc}`)
        .build(),
    })),
    reduce: { mode: 'llm', prompt: 'Combine into a single executive summary.' },
  });

  const result = await pipeline.run(input);
  return { content: result.content };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput as string)
    .then(printResult)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
