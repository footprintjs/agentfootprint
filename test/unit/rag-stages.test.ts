import { describe, it, expect, vi } from 'vitest';
import { createRetrieveStage, augmentPromptStage, mockRetriever } from '../../src/test-barrel';
import type { TypedScope } from 'footprintjs';
import type { RAGState } from '../../src/scope/types';

function mockScope(initial: Partial<RAGState> = {}): TypedScope<RAGState> {
  const obj: any = { ...initial };
  obj.$getValue = vi.fn((key: string) => obj[key]);
  obj.$setValue = vi.fn((key: string, value: unknown) => {
    obj[key] = value;
  });
  return obj as TypedScope<RAGState>;
}

describe('createRetrieveStage', () => {
  it('calls retriever with last user message as query', async () => {
    const retriever = mockRetriever([{ chunks: [{ content: 'Found it', score: 0.9 }] }]);
    const stage = createRetrieveStage(retriever);

    const scope = mockScope({
      messages: [
        { role: 'system', content: 'Be helpful' },
        { role: 'user', content: 'What is RAG?' },
      ],
    });

    await stage(scope);

    expect(retriever.getCall(0)?.query).toBe('What is RAG?');
    expect(scope.retrievalResult.chunks).toHaveLength(1);
    expect(scope.retrievalResult.query).toBe('What is RAG?');
  });

  it('passes retrieval options to retriever', async () => {
    const retriever = mockRetriever([{ chunks: [] }]);
    const stage = createRetrieveStage(retriever, { topK: 3, minScore: 0.5 });

    const scope = mockScope({ messages: [{ role: 'user', content: 'query' }] });
    await stage(scope);

    expect(retriever.getCall(0)?.options).toEqual({ topK: 3, minScore: 0.5 });
  });

  it('uses explicit retrieval query when set', async () => {
    const retriever = mockRetriever([{ chunks: [] }]);
    const stage = createRetrieveStage(retriever);

    const scope = mockScope({
      retrievalQuery: 'custom query',
      messages: [{ role: 'user', content: 'original message' }],
    });

    await stage(scope);
    expect(retriever.getCall(0)?.query).toBe('custom query');
  });

  it('uses empty string when no messages', async () => {
    const retriever = mockRetriever([{ chunks: [] }]);
    const stage = createRetrieveStage(retriever);

    const scope = mockScope({ messages: [] });
    await stage(scope);
    expect(retriever.getCall(0)?.query).toBe('');
  });
});

describe('augmentPromptStage', () => {
  it('injects context after system prompt', () => {
    const scope = mockScope({
      retrievalResult: {
        chunks: [
          { content: 'Doc A', score: 0.9 },
          { content: 'Doc B', score: 0.8 },
        ],
        query: 'test',
      },
      messages: [
        { role: 'system', content: 'Be helpful' },
        { role: 'user', content: 'Question?' },
      ],
    });

    augmentPromptStage(scope);

    // Should write context window
    expect(scope.contextWindow).toContain('[1] Doc A');
    expect(scope.contextWindow).toContain('[2] Doc B');

    // Should inject context message after system
    expect(scope.messages).toHaveLength(3); // system + context + user
    expect(scope.messages[0].role).toBe('system');
    expect(scope.messages[1].role).toBe('system'); // context is a system message
    expect(scope.messages[1].content as string).toContain('Doc A');
    expect(scope.messages[2].role).toBe('user');
  });

  it('injects at front when no system prompt', () => {
    const scope = mockScope({
      retrievalResult: {
        chunks: [{ content: 'Doc X' }],
        query: 'test',
      },
      messages: [{ role: 'user', content: 'Question?' }],
    });

    augmentPromptStage(scope);

    expect(scope.messages[0].role).toBe('system'); // context first
    expect(scope.messages[0].content as string).toContain('Doc X');
    expect(scope.messages[1].role).toBe('user');
  });

  it('no-op when no retrieval result', () => {
    const scope = mockScope({ messages: [{ role: 'user', content: 'Hi' }] });
    augmentPromptStage(scope);
    // Messages should remain unchanged
    expect(scope.messages).toHaveLength(1);
  });

  it('no-op when chunks array is empty', () => {
    const scope = mockScope({
      retrievalResult: { chunks: [], query: 'test' },
      messages: [{ role: 'user', content: 'Hi' }],
    });
    augmentPromptStage(scope);
    // Messages should remain unchanged
    expect(scope.messages).toHaveLength(1);
  });
});
