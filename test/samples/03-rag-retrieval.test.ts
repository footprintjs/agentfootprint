/**
 * Sample 03: RAG (Retrieval-Augmented Generation)
 *
 * Retrieve relevant context from a knowledge base, augment the prompt,
 * then generate a response. The retriever is swappable — use vector DBs,
 * search APIs, or mock for testing.
 */
import { describe, it, expect } from 'vitest';
import { RAG, mock, mockRetriever } from '../../src';

describe('Sample 03: RAG Retrieval', () => {
  it('retrieves context and generates an answer', async () => {
    // Mock retriever returns relevant chunks
    const retriever = mockRetriever([
      {
        query: 'company policy',
        chunks: [
          { content: 'Employees get 20 days PTO per year.', score: 0.95 },
          { content: 'Remote work is allowed 3 days per week.', score: 0.88 },
        ],
      },
    ]);

    const rag = RAG.create({
      provider: mock([
        { content: 'Based on our policy, you get 20 days PTO and can work remotely 3 days/week.' },
      ]),
      retriever,
    })
      .system('You are an HR assistant. Answer based on retrieved context.')
      .build();

    const result = await rag.run('What is our PTO policy?');
    expect(result.content).toContain('20 days PTO');
  });

  it('provides retrieval stats', async () => {
    const rag = RAG.create({
      provider: mock([{ content: 'Answer.' }]),
      retriever: mockRetriever([
        {
          query: 'test',
          chunks: [{ content: 'chunk1', score: 0.9 }],
        },
      ]),
    }).build();

    const result = await rag.run('test query');
    expect(result.content).toBe('Answer.');

    // RAG produces narrative showing retrieval + generation
    const narrative = rag.getNarrative();
    expect(narrative.length).toBeGreaterThan(0);
  });
});
