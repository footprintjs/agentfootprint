/**
 * embedMessages stage — 5-pattern tests.
 *
 * Tiers:
 *   - unit:     single message → single vector written to scope
 *   - boundary: empty newMessages → empty embeddings array
 *   - scenario: custom textFrom pulls alternate field
 *   - property: vector count matches newMessages count; embedderId tag carried
 *   - security: AbortSignal flows through to the embedder
 */
import { describe, expect, it, vi } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { embedMessages, mockEmbedder } from '../../../src/memory/embedding';
import type { Embedder, EmbedMessagesState } from '../../../src/memory/embedding';
import type { Message } from '../../../src/types/messages';

const ID = { tenant: 't', conversationId: 'c' };

async function runStage(
  config: Parameters<typeof embedMessages>[0],
  newMessages: Message[],
  env?: { signal?: AbortSignal },
): Promise<EmbedMessagesState> {
  const chart = flowChart<EmbedMessagesState>(
    'Seed',
    (scope) => {
      scope.identity = ID;
      scope.turnNumber = 1;
      scope.contextTokensRemaining = 4000;
      scope.loaded = [];
      scope.selected = [];
      scope.formatted = [];
      scope.newMessages = newMessages;
    },
    'seed',
  )
    .addFunction('Embed', embedMessages(config), 'embed-messages')
    .build();
  const exec = new FlowChartExecutor(chart);
  await exec.run(env ? { env } : undefined);
  return (exec.getSnapshot()?.sharedState ?? {}) as EmbedMessagesState;
}

// ── Unit ────────────────────────────────────────────────────

describe('embedMessages — unit', () => {
  it('writes one vector per new message', async () => {
    const state = await runStage({ embedder: mockEmbedder() }, [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
    expect(state.newMessageEmbeddings).toHaveLength(2);
  });

  it('tags scope with embedderId when provided', async () => {
    const state = await runStage({ embedder: mockEmbedder(), embedderId: 'mock-32' }, [
      { role: 'user', content: 'x' },
    ]);
    expect(state.newMessageEmbeddingModel).toBe('mock-32');
  });

  it('uses embedBatch when the embedder provides it', async () => {
    const batchSpy = vi.fn(async ({ texts }: { texts: readonly string[] }) =>
      texts.map(() => new Array(8).fill(0)),
    );
    const embedSpy = vi.fn(async () => new Array(8).fill(0));
    const embedder: Embedder = {
      dimensions: 8,
      embed: embedSpy,
      embedBatch: batchSpy,
    };
    await runStage({ embedder }, [
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ]);
    expect(batchSpy).toHaveBeenCalledOnce();
    expect(embedSpy).not.toHaveBeenCalled();
  });

  it('falls back to sequential embed() when no batch is available', async () => {
    const embedSpy = vi.fn(async () => new Array(8).fill(0));
    const embedder: Embedder = {
      dimensions: 8,
      embed: embedSpy,
    };
    await runStage({ embedder }, [
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ]);
    expect(embedSpy).toHaveBeenCalledTimes(2);
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('embedMessages — boundary', () => {
  it('empty newMessages → empty embeddings, embedder NOT called', async () => {
    const spy = vi.fn(async () => new Array(8).fill(0));
    const state = await runStage({ embedder: { dimensions: 8, embed: spy } }, []);
    expect(state.newMessageEmbeddings).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('empty text in a message still produces a vector (zero or near-zero)', async () => {
    const state = await runStage({ embedder: mockEmbedder() }, [{ role: 'user', content: '' }]);
    expect(state.newMessageEmbeddings).toHaveLength(1);
    expect(state.newMessageEmbeddings![0]).toHaveLength(32);
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('embedMessages — scenario', () => {
  it('custom textFrom pulls alternate representation', async () => {
    const textFrom = (m: Message) => `[${m.role}]`;
    const embedder = mockEmbedder({ dimensions: 16 });
    const state = await runStage({ embedder, textFrom }, [
      { role: 'user', content: 'this text is ignored' },
      { role: 'assistant', content: 'also ignored' },
    ]);
    // Since textFrom returns `[user]` / `[assistant]` — the two vectors
    // should differ (different characters) from the actual content.
    const [v1, v2] = state.newMessageEmbeddings!;
    const userVec = await embedder.embed({ text: '[user]' });
    expect(v1).toEqual(userVec);
    expect(v1).not.toEqual(v2);
  });

  it('content-block arrays extract text parts by default', async () => {
    const embedder = mockEmbedder({ dimensions: 16 });
    const state = await runStage({ embedder }, [
      {
        role: 'user',
        content: [{ type: 'text', text: 'block content' }] as never,
      },
    ]);
    const expected = await embedder.embed({ text: 'block content' });
    expect(state.newMessageEmbeddings![0]).toEqual(expected);
  });
});

// ── Property ────────────────────────────────────────────────

describe('embedMessages — property', () => {
  it('vector count always equals newMessages count', async () => {
    for (const n of [1, 3, 5, 10]) {
      const msgs: Message[] = Array.from({ length: n }, (_, i) => ({
        role: 'user',
        content: `msg-${i}`,
      }));
      const state = await runStage({ embedder: mockEmbedder() }, msgs);
      expect(state.newMessageEmbeddings).toHaveLength(n);
    }
  });

  it('every vector has length === embedder.dimensions', async () => {
    const embedder = mockEmbedder({ dimensions: 64 });
    const msgs: Message[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'tool', content: 'result' },
    ];
    const state = await runStage({ embedder }, msgs);
    for (const v of state.newMessageEmbeddings!) {
      expect(v).toHaveLength(64);
    }
  });
});

// ── Security ────────────────────────────────────────────────

describe('embedMessages — security', () => {
  it('AbortSignal from env flows through to the embedder', async () => {
    const spy = vi.fn(async () => new Array(8).fill(0));
    const embedder: Embedder = { dimensions: 8, embed: spy };
    const controller = new AbortController();
    await runStage({ embedder }, [{ role: 'user', content: 'x' }], {
      signal: controller.signal,
    });
    const call = spy.mock.calls[0][0] as { signal?: AbortSignal };
    expect(call.signal).toBe(controller.signal);
  });

  it('embedder throwing propagates (fail-loud on real errors)', async () => {
    const bad: Embedder = {
      dimensions: 8,
      embed: async () => {
        throw new Error('embedder down');
      },
    };
    await expect(runStage({ embedder: bad }, [{ role: 'user', content: 'x' }])).rejects.toThrow(
      'embedder down',
    );
  });
});
