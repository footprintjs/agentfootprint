/**
 * Sample 03: RAG Retrieval
 *
 * RAG builder + retriever + agentObservability — retrieve-augment-generate pattern.
 * Retrieves relevant chunks, augments the prompt, then generates.
 */
import { RAG, mock, mockRetriever } from 'agentfootprint';
import { agentObservability } from 'agentfootprint/observe';

export async function run(input: string) {
  const obs = agentObservability();

  const runner = RAG
    .create({
      provider: mock([{ content: 'According to the documentation, the answer is 42.' }]),
      retriever: mockRetriever([{
        chunks: [
          { content: 'The ultimate answer to life, the universe, and everything is 42.', score: 0.95, metadata: { source: 'guide.pdf' } },
          { content: 'This was computed by Deep Thought over 7.5 million years.', score: 0.82, metadata: { source: 'guide.pdf' } },
        ],
      }]),
    })
    .system('Answer the question using only the provided context.')
    .topK(3)
    .recorder(obs)
    .build();

  const result = await runner.run(input);
  return { content: result.content, tokens: obs.tokens(), tools: obs.tools(), cost: obs.cost() };
}

if (process.argv[1] === import.meta.filename) {
  run('What is the ultimate answer?').then(console.log);
}
