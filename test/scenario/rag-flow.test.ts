import { describe, it, expect } from 'vitest';
import { RAG, mock, mockRetriever } from '../../src';

describe('Scenario: RAG end-to-end', () => {
  it('retrieves context and generates answer', async () => {
    const rag = RAG.create({
      provider: mock([{ content: 'Based on the context, the answer is 42.' }]),
      retriever: mockRetriever([
        {
          chunks: [
            { content: 'The answer to life is 42.', score: 0.95, id: 'doc-1' },
            { content: 'Douglas Adams wrote this.', score: 0.8, id: 'doc-2' },
          ],
        },
      ]),
    })
      .system('Answer using the provided context.')
      .build();

    const result = await rag.run('What is the answer to life?');

    expect(result.content).toBe('Based on the context, the answer is 42.');
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0].content).toContain('42');
    expect(result.query).toBe('What is the answer to life?');
  });

  it('works without system prompt', async () => {
    const rag = RAG.create({
      provider: mock([{ content: 'Got it.' }]),
      retriever: mockRetriever([{ chunks: [{ content: 'Relevant doc' }] }]),
    }).build();

    const result = await rag.run('Question');
    expect(result.content).toBe('Got it.');
  });

  it('narrative includes Retrieve and AugmentPrompt stages', async () => {
    const rag = RAG.create({
      provider: mock([{ content: 'Answer.' }]),
      retriever: mockRetriever([{ chunks: [{ content: 'Context doc' }] }]),
    })
      .system('Be helpful.')
      .build();

    await rag.run('Question');

    const narrative = rag.getNarrative();
    expect(narrative.length).toBeGreaterThan(0);
    // Should mention the RAG stages
    const fullNarrative = narrative.join(' ');
    expect(fullNarrative).toContain('Retrieve');
    expect(fullNarrative).toContain('AugmentPrompt');
    expect(fullNarrative).toContain('CallLLM');
  });

  it('context appears in messages sent to LLM', async () => {
    const provider = mock([{ content: 'Answer with context.' }]);
    const rag = RAG.create({
      provider,
      retriever: mockRetriever([{ chunks: [{ content: 'Important fact: X = Y' }] }]),
    })
      .system('Use context.')
      .build();

    await rag.run('What is X?');

    // Check that the LLM received the context
    const call = provider.getCall(0);
    const messages = call?.messages ?? [];
    const contextMsg = messages.find(
      (m) => m.role === 'system' && m.content.includes('Important fact'),
    );
    expect(contextMsg).toBeDefined();
  });

  it('handles empty retrieval gracefully', async () => {
    const rag = RAG.create({
      provider: mock([{ content: 'No context available.' }]),
      retriever: mockRetriever([{ chunks: [] }]),
    }).build();

    const result = await rag.run('Obscure question');
    expect(result.content).toBe('No context available.');
    expect(result.chunks).toEqual([]);
  });

  it('RAGResult includes all retrieved chunks', async () => {
    const chunks = Array.from({ length: 5 }, (_, i) => ({
      content: `Chunk ${i}`,
      score: 0.9 - i * 0.1,
      id: `chunk-${i}`,
    }));

    const rag = RAG.create({
      provider: mock([{ content: 'Synthesized answer.' }]),
      retriever: mockRetriever([{ chunks }]),
    }).build();

    const result = await rag.run('Complex query');
    expect(result.chunks).toHaveLength(5);
    expect(result.chunks[0].id).toBe('chunk-0');
    expect(result.chunks[4].id).toBe('chunk-4');
  });
});

