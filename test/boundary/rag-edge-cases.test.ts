import { describe, it, expect } from 'vitest';
import { RAG, mock, mockRetriever } from '../../src/test-barrel';
import type { RetrieverProvider } from '../../src/test-barrel';

describe('Boundary: RAG edge cases', () => {
  it('handles very large chunks (100KB each)', async () => {
    const largeContent = 'x'.repeat(100_000);
    const rag = RAG.create({
      provider: mock([{ content: 'Processed.' }]),
      retriever: mockRetriever([{ chunks: [{ content: largeContent }] }]),
    }).build();

    const result = await rag.run('Large query');
    expect(result.content).toBe('Processed.');
    expect(result.chunks[0].content).toHaveLength(100_000);
  });

  it('handles unicode and emoji in chunks', async () => {
    const rag = RAG.create({
      provider: mock([{ content: 'Got it.' }]),
      retriever: mockRetriever([
        {
          chunks: [
            { content: '日本語のドキュメント 🎌' },
            { content: 'مستند عربی' },
            { content: 'Документ на русском' },
          ],
        },
      ]),
    }).build();

    const result = await rag.run('Question');
    expect(result.chunks).toHaveLength(3);
    expect(result.chunks[0].content).toContain('🎌');
  });

  it('handles chunks with score 0 and score 1', async () => {
    const rag = RAG.create({
      provider: mock([{ content: 'Answer.' }]),
      retriever: mockRetriever([
        {
          chunks: [
            { content: 'Perfect match', score: 1.0 },
            { content: 'No match', score: 0 },
          ],
        },
      ]),
    }).build();

    const result = await rag.run('Query');
    expect(result.chunks).toHaveLength(2);
  });

  it('retriever error propagates cleanly', async () => {
    const failingRetriever: RetrieverProvider = {
      retrieve: async () => {
        throw new Error('Vector DB connection failed');
      },
    };

    const rag = RAG.create({
      provider: mock([{ content: 'Should not reach' }]),
      retriever: failingRetriever,
    }).build();

    await expect(rag.run('Query')).rejects.toThrow('Vector DB connection failed');
  });

  it('handles empty query string', async () => {
    const rag = RAG.create({
      provider: mock([{ content: 'Default response.' }]),
      retriever: mockRetriever([{ chunks: [{ content: 'Fallback doc' }] }]),
    }).build();

    const result = await rag.run('');
    expect(result.content).toBe('Default response.');
  });

  it('passes signal for abort', async () => {
    const controller = new AbortController();
    controller.abort();

    const rag = RAG.create({
      provider: mock([{ content: 'Hi' }]),
      retriever: mockRetriever([{ chunks: [] }]),
    }).build();

    await expect(rag.run('test', { signal: controller.signal })).rejects.toThrow();
  });

  it('many chunks (50) are all included', async () => {
    const chunks = Array.from({ length: 50 }, (_, i) => ({
      content: `Chunk number ${i}`,
      score: 0.5,
      id: `id-${i}`,
    }));

    const rag = RAG.create({
      provider: mock([{ content: 'Synthesized.' }]),
      retriever: mockRetriever([{ chunks }]),
    }).build();

    const result = await rag.run('Big retrieval');
    expect(result.chunks).toHaveLength(50);
  });
});
