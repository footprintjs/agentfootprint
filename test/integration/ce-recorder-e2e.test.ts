import { describe, expect, it } from 'vitest';
import { RAG, mock, mockRetriever, contextEngineering } from '../../src';

describe('contextEngineering() — internal end-to-end wiring', () => {
  it('captures RAG injections during a real RAG.run()', async () => {
    const ctx = contextEngineering();
    const rag = RAG.create({
      provider: mock([{ content: 'According to docs, the answer is 42.' }]),
      retriever: mockRetriever([
        {
          chunks: [
            { content: '42 is the answer.', score: 0.95 },
            { content: 'Also relevant context.', score: 0.78 },
          ],
        },
      ]),
    })
      .system('Answer using the provided context.')
      .recorder(ctx)
      .build();

    await rag.run('What is the answer?');

    const list = ctx.injections();
    expect(list.length).toBeGreaterThanOrEqual(1);
    const ragInj = list.find((i) => i.source === 'rag');
    expect(ragInj).toBeDefined();
    expect(ragInj?.slot).toBe('messages');
    expect(ragInj?.role).toBe('system');
    expect(ctx.ledger().system).toBeGreaterThanOrEqual(1);
  });
});
