import { describe, it, expect } from 'vitest';
import { MockRetriever, mockRetriever } from '../../src';

describe('MockRetriever', () => {
  it('returns scripted responses in order', async () => {
    const retriever = mockRetriever([
      { chunks: [{ content: 'Doc A', score: 0.9 }] },
      { chunks: [{ content: 'Doc B', score: 0.8 }] },
    ]);

    const r1 = await retriever.retrieve('query 1');
    expect(r1.chunks).toHaveLength(1);
    expect(r1.chunks[0].content).toBe('Doc A');
    expect(r1.query).toBe('query 1');

    const r2 = await retriever.retrieve('query 2');
    expect(r2.chunks[0].content).toBe('Doc B');
    expect(r2.query).toBe('query 2');
  });

  it('throws when responses exhausted', async () => {
    const retriever = mockRetriever([{ chunks: [{ content: 'Only one' }] }]);
    await retriever.retrieve('first');

    await expect(retriever.retrieve('second')).rejects.toThrow('no more responses');
  });

  it('tracks call count', async () => {
    const retriever = mockRetriever([{ chunks: [] }, { chunks: [] }]);
    expect(retriever.getCallCount()).toBe(0);

    await retriever.retrieve('a');
    expect(retriever.getCallCount()).toBe(1);

    await retriever.retrieve('b');
    expect(retriever.getCallCount()).toBe(2);
  });

  it('tracks individual calls', async () => {
    const retriever = mockRetriever([{ chunks: [] }]);
    await retriever.retrieve('test query');

    const call = retriever.getCall(0);
    expect(call?.query).toBe('test query');
    expect(retriever.getCall(1)).toBeUndefined();
  });

  it('getAllCalls returns all calls', async () => {
    const retriever = mockRetriever([{ chunks: [] }, { chunks: [] }]);
    await retriever.retrieve('q1');
    await retriever.retrieve('q2');

    const calls = retriever.getAllCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0].query).toBe('q1');
    expect(calls[1].query).toBe('q2');
  });

  it('reset resets call index but keeps responses', async () => {
    const retriever = mockRetriever([{ chunks: [{ content: 'A' }] }]);
    await retriever.retrieve('first');
    retriever.reset();

    expect(retriever.getCallCount()).toBe(0);
    const result = await retriever.retrieve('again');
    expect(result.chunks[0].content).toBe('A');
  });

  it('empty chunks array is valid', async () => {
    const retriever = mockRetriever([{ chunks: [] }]);
    const result = await retriever.retrieve('no results');
    expect(result.chunks).toEqual([]);
  });

  it('preserves chunk metadata', async () => {
    const retriever = mockRetriever([
      {
        chunks: [
          { content: 'Doc', score: 0.95, id: 'doc-1', metadata: { source: 'wiki', page: 42 } },
        ],
      },
    ]);

    const result = await retriever.retrieve('query');
    expect(result.chunks[0].id).toBe('doc-1');
    expect(result.chunks[0].metadata).toEqual({ source: 'wiki', page: 42 });
    expect(result.chunks[0].score).toBe(0.95);
  });

  it('factory function creates MockRetriever instance', () => {
    const retriever = mockRetriever([]);
    expect(retriever).toBeInstanceOf(MockRetriever);
  });
});
