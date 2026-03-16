import { describe, it, expect } from 'vitest';
import { RAG, mock, mockRetriever } from '../../src';
import type { RetrievalChunk } from '../../src';

describe('Property: RAG invariants', () => {
  it('RAGResult.chunks always matches what retriever returned (0..N chunks)', async () => {
    for (let n = 0; n <= 10; n++) {
      const chunks: RetrievalChunk[] = Array.from({ length: n }, (_, i) => ({
        content: `chunk-${i}`,
        score: 0.5 + i * 0.05,
      }));

      const rag = RAG.create({
        provider: mock([{ content: 'answer' }]),
        retriever: mockRetriever([{ chunks }]),
      }).build();

      const result = await rag.run('query');
      expect(result.chunks).toHaveLength(n);
      for (let i = 0; i < n; i++) {
        expect(result.chunks[i].content).toBe(`chunk-${i}`);
      }
    }
  });

  it('user message is never lost during augmentation', async () => {
    for (let chunkCount = 0; chunkCount <= 5; chunkCount++) {
      const chunks = Array.from({ length: chunkCount }, (_, i) => ({
        content: `doc-${i}`,
      }));

      const rag = RAG.create({
        provider: mock([{ content: 'reply' }]),
        retriever: mockRetriever([{ chunks }]),
      })
        .system('System prompt')
        .build();

      const result = await rag.run('My question');
      const userMsgs = result.messages.filter((m) => m.role === 'user');
      expect(userMsgs.length).toBeGreaterThanOrEqual(1);
      expect(userMsgs.some((m) => m.content === 'My question')).toBe(true);
    }
  });

  it('system prompt is preserved through augmentation', async () => {
    const rag = RAG.create({
      provider: mock([{ content: 'reply' }]),
      retriever: mockRetriever([{ chunks: [{ content: 'context doc' }] }]),
    })
      .system('Original system prompt')
      .build();

    const result = await rag.run('Question');
    const systemMsgs = result.messages.filter((m) => m.role === 'system');
    expect(systemMsgs[0].content).toBe('Original system prompt');
  });

  it('RAGResult.query echoes back the user query', async () => {
    const queries = ['simple', 'with spaces', 'unicode: 日本語', ''];
    for (const query of queries) {
      const rag = RAG.create({
        provider: mock([{ content: 'reply' }]),
        retriever: mockRetriever([{ chunks: [] }]),
      }).build();

      const result = await rag.run(query);
      expect(result.query).toBe(query);
    }
  });
});
