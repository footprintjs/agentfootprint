/**
 * RAG — Retrieve-Augment-Generate. Look things up in a knowledge base
 * before the LLM answers. The answer is grounded in retrieved chunks.
 */

import { RAG, mock, mockRetriever } from 'agentfootprint';
import { agentObservability } from 'agentfootprint/observe';
import type { LLMProvider } from 'agentfootprint';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli';

export const meta: ExampleMeta = {
  id: 'concepts/03-rag',
  title: 'RAG — retrieve, augment, generate',
  group: 'concepts',
  description: 'Fetch relevant chunks from a retriever, inject into the prompt, then generate.',
  defaultInput: 'What is the ultimate answer?',
  providerSlots: ['default'],
  tags: ['RAG', 'retrieval', 'grounding'],
};

const defaultMock = (): LLMProvider =>
  mock([{ content: 'According to the documentation, the answer is 42.' }]);

const defaultRetriever = () =>
  mockRetriever([
    {
      chunks: [
        {
          content: 'The ultimate answer to life, the universe, and everything is 42.',
          score: 0.95,
          metadata: { source: 'guide.pdf' },
        },
        {
          content: 'This was computed by Deep Thought over 7.5 million years.',
          score: 0.82,
          metadata: { source: 'guide.pdf' },
        },
      ],
    },
  ]);

export async function run(input: string, provider?: LLMProvider) {
  const obs = agentObservability();

  const runner = RAG.create({
    provider: provider ?? defaultMock(),
    retriever: defaultRetriever(),
  })
    .system('Answer the question using only the provided context.')
    .topK(3)
    .recorder(obs)
    .build();

  const result = await runner.run(input);
  return {
    content: result.content,
    chunks: result.chunks,
    tokens: obs.tokens(),
    tools: obs.tools(),
    cost: obs.cost(),
  };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput as string)
    .then(printResult)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
