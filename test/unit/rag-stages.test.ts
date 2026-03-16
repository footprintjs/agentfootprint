import { describe, it, expect, vi } from 'vitest';
import {
  createRetrieveStage,
  augmentPromptStage,
  mockRetriever,
  AgentScope,
  RAG_PATHS,
  RAGRecorder,
} from '../../src';
import type { ScopeFacade } from 'footprintjs';

function mockScope(initial: Record<string, unknown> = {}): ScopeFacade {
  const store: Record<string, unknown> = { ...initial };
  return {
    getValue: vi.fn((key: string) => store[key]),
    setValue: vi.fn((key: string, value: unknown) => {
      store[key] = value;
    }),
    updateValue: vi.fn(),
    deleteValue: vi.fn(),
    getArgs: vi.fn(() => ({})),
    attachRecorder: vi.fn(),
  } as unknown as ScopeFacade;
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
    const resultCall = (scope.setValue as any).mock.calls.find(
      (c: any) => c[0] === RAG_PATHS.RETRIEVAL_RESULT,
    );
    expect(resultCall[1].chunks).toHaveLength(1);
    expect(resultCall[1].query).toBe('What is RAG?');
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
    const ctxCall = (scope.setValue as any).mock.calls.find(
      (c: any) => c[0] === RAG_PATHS.CONTEXT_WINDOW,
    );
    expect(ctxCall[1]).toContain('[1] Doc A');
    expect(ctxCall[1]).toContain('[2] Doc B');

    // Should inject context message after system
    const msgCall = (scope.setValue as any).mock.calls.find((c: any) => c[0] === 'messages');
    expect(msgCall[1]).toHaveLength(3); // system + context + user
    expect(msgCall[1][0].role).toBe('system');
    expect(msgCall[1][1].role).toBe('system'); // context is a system message
    expect(msgCall[1][1].content).toContain('Doc A');
    expect(msgCall[1][2].role).toBe('user');
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

    const msgCall = (scope.setValue as any).mock.calls.find((c: any) => c[0] === 'messages');
    expect(msgCall[1][0].role).toBe('system'); // context first
    expect(msgCall[1][0].content).toContain('Doc X');
    expect(msgCall[1][1].role).toBe('user');
  });

  it('no-op when no retrieval result', () => {
    const scope = mockScope({ messages: [{ role: 'user', content: 'Hi' }] });
    augmentPromptStage(scope);
    expect(scope.setValue).not.toHaveBeenCalled();
  });

  it('no-op when chunks array is empty', () => {
    const scope = mockScope({
      retrievalResult: { chunks: [], query: 'test' },
      messages: [{ role: 'user', content: 'Hi' }],
    });
    augmentPromptStage(scope);
    expect(scope.setValue).not.toHaveBeenCalled();
  });
});

describe('RAGRecorder', () => {
  it('records retrieval entry on write to RETRIEVAL_RESULT', () => {
    const recorder = new RAGRecorder();
    recorder.onStageStart();

    recorder.onWrite({
      key: RAG_PATHS.RETRIEVAL_RESULT,
      value: {
        query: 'test query',
        chunks: [
          { content: 'A', score: 0.9 },
          { content: 'B', score: 0.7 },
        ],
      },
    });

    recorder.onStageEnd();

    const stats = recorder.getStats();
    expect(stats.totalRetrievals).toBe(1);
    expect(stats.totalChunks).toBe(2);
    expect(stats.entries[0].query).toBe('test query');
    expect(stats.entries[0].averageScore).toBeCloseTo(0.8);
  });

  it('ignores writes to non-RAG keys', () => {
    const recorder = new RAGRecorder();
    recorder.onWrite({ key: 'messages', value: [] });
    recorder.onWrite({ key: 'adapterResult', value: {} });
    expect(recorder.getTotalRetrievals()).toBe(0);
  });

  it('tracks multiple retrievals', () => {
    const recorder = new RAGRecorder();

    recorder.onWrite({
      key: RAG_PATHS.RETRIEVAL_RESULT,
      value: { query: 'q1', chunks: [{ content: 'A', score: 0.9 }] },
    });

    recorder.onWrite({
      key: RAG_PATHS.RETRIEVAL_RESULT,
      value: { query: 'q2', chunks: [{ content: 'B' }, { content: 'C' }] },
    });

    expect(recorder.getTotalRetrievals()).toBe(2);
    expect(recorder.getTotalChunks()).toBe(3);
  });

  it('clear resets state', () => {
    const recorder = new RAGRecorder();
    recorder.onWrite({
      key: RAG_PATHS.RETRIEVAL_RESULT,
      value: { query: 'q', chunks: [{ content: 'A' }] },
    });
    recorder.clear();
    expect(recorder.getTotalRetrievals()).toBe(0);
    expect(recorder.getTotalChunks()).toBe(0);
  });

  it('handles chunks with no scores', () => {
    const recorder = new RAGRecorder();
    recorder.onWrite({
      key: RAG_PATHS.RETRIEVAL_RESULT,
      value: { query: 'q', chunks: [{ content: 'A' }, { content: 'B' }] },
    });

    const stats = recorder.getStats();
    expect(stats.entries[0].averageScore).toBe(0);
  });

  it('uses custom id', () => {
    const recorder = new RAGRecorder('my-rag');
    expect(recorder.id).toBe('my-rag');
  });
});

describe('RAG_PATHS', () => {
  it('has correct path values', () => {
    expect(RAG_PATHS.RETRIEVAL_QUERY).toBe('retrievalQuery');
    expect(RAG_PATHS.RETRIEVAL_RESULT).toBe('retrievalResult');
    expect(RAG_PATHS.CONTEXT_WINDOW).toBe('contextWindow');
  });
});
