/**
 * pairwiseSimilarity — RFC-002 C1 core acceptance.
 *
 * C1 acceptance (RFC-002 §6): property — symmetric; self-sim = 1;
 * threshold monotonicity (mockEmbedder). Plus boundary / scenario /
 * fail-loud tiers.
 */
import { describe, expect, it } from 'vitest';
import { mockEmbedder } from '../../../src/memory/embedding/mockEmbedder';
import { EmbeddingCache, pairwiseSimilarity } from '../../../src/lib/influence-core';

const CATALOG = [
  // The Neo twin pair RFC-002 names as the canonical confusable case.
  {
    id: 'get_fcns_database',
    text: 'Get FC name server database registrations for the fabric.',
  },
  {
    id: 'influx_get_fcns_database',
    text: 'Get FC name server database registrations from Influx time series.',
  },
  { id: 'send_email', text: 'Send an email notification to the operations distribution list.' },
  { id: 'reboot_switch', text: 'Reboot a switch after maintenance approval window opens.' },
];

describe('pairwiseSimilarity — C1 acceptance properties', () => {
  it('matrix is symmetric with diagonal EXACTLY 1', async () => {
    const { matrix } = await pairwiseSimilarity({ items: CATALOG, embedder: mockEmbedder() });
    for (let i = 0; i < matrix.length; i++) {
      expect(matrix[i][i]).toBe(1); // exact, by definition — not toBeCloseTo
      for (let j = 0; j < matrix.length; j++) {
        expect(matrix[i][j]).toBe(matrix[j][i]); // mirrored, bit-identical
      }
    }
  });

  it('threshold monotonicity: pairs-at-or-above-t never grows as t rises', async () => {
    const { pairs } = await pairwiseSimilarity({ items: CATALOG, embedder: mockEmbedder() });
    let prevCount = Infinity;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const count = pairs.filter((p) => p.similarity >= t).length;
      expect(count).toBeLessThanOrEqual(prevCount);
      prevCount = count;
    }
  });

  it('N items → N·(N−1)/2 ranked pairs, descending', async () => {
    const { pairs } = await pairwiseSimilarity({ items: CATALOG, embedder: mockEmbedder() });
    expect(pairs.length).toBe((CATALOG.length * (CATALOG.length - 1)) / 2);
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i].similarity).toBeLessThanOrEqual(pairs[i - 1].similarity);
    }
  });

  it('ids array preserves input order (the matrix axes)', async () => {
    const { ids } = await pairwiseSimilarity({ items: CATALOG, embedder: mockEmbedder() });
    expect(ids).toEqual(CATALOG.map((c) => c.id));
  });
});

describe('pairwiseSimilarity — scenario', () => {
  it('the Neo twin descriptions rank as the top pair', async () => {
    const { pairs } = await pairwiseSimilarity({ items: CATALOG, embedder: mockEmbedder() });
    expect([pairs[0].a, pairs[0].b].sort()).toEqual([
      'get_fcns_database',
      'influx_get_fcns_database',
    ]);
    // ...and clearly above an unrelated pairing.
    const unrelated = pairs.find(
      (p) => [p.a, p.b].includes('send_email') && [p.a, p.b].includes('reboot_switch'),
    );
    expect(pairs[0].similarity).toBeGreaterThan(unrelated!.similarity);
  });

  it('identical texts under different ids compare at ~1 via cosine', async () => {
    const { matrix } = await pairwiseSimilarity({
      items: [
        { id: 'a', text: 'same description' },
        { id: 'b', text: 'same description' },
      ],
      embedder: mockEmbedder(),
    });
    expect(matrix[0][1]).toBeCloseTo(1, 12);
  });
});

describe('pairwiseSimilarity — boundary + fail-loud', () => {
  it('empty items → empty result', async () => {
    const result = await pairwiseSimilarity({ items: [], embedder: mockEmbedder() });
    expect(result).toEqual({ ids: [], matrix: [], pairs: [] });
  });

  it('single item → 1×1 identity matrix, no pairs', async () => {
    const result = await pairwiseSimilarity({
      items: [{ id: 'only', text: 'one description' }],
      embedder: mockEmbedder(),
    });
    expect(result.matrix).toEqual([[1]]);
    expect(result.pairs).toEqual([]);
  });

  it('duplicate ids throw (ranked pairs would be ambiguous)', async () => {
    await expect(
      pairwiseSimilarity({
        items: [
          { id: 'dup', text: 'x' },
          { id: 'dup', text: 'y' },
        ],
        embedder: mockEmbedder(),
      }),
    ).rejects.toThrow(/duplicate item id 'dup'/);
  });

  it('does not mutate the input items', async () => {
    const items = CATALOG.map((c) => ({ ...c }));
    const before = JSON.stringify(items);
    await pairwiseSimilarity({ items, embedder: mockEmbedder() });
    expect(JSON.stringify(items)).toBe(before);
  });
});

describe('pairwiseSimilarity — performance (catalog-scale, cached)', () => {
  it('a 40-tool catalog scores in one pass and re-lints from cache only', async () => {
    let innerCalls = 0;
    const inner = mockEmbedder();
    const counting = {
      dimensions: inner.dimensions,
      embed: async (args: { text: string }) => {
        innerCalls += 1;
        return inner.embed(args);
      },
    };
    const cache = new EmbeddingCache(counting);
    const items = Array.from({ length: 40 }, (_, i) => ({
      id: `tool-${i}`,
      text: `Tool number ${i} does operation ${i % 7} on resource ${i % 5}.`,
    }));

    const first = await pairwiseSimilarity({ items, embedder: cache });
    expect(innerCalls).toBe(40); // one embedding per description (RFC-002 §3)
    const second = await pairwiseSimilarity({ items, embedder: cache });
    expect(innerCalls).toBe(40); // re-lint: all hits, zero new embeds
    expect(second.pairs[0]).toEqual(first.pairs[0]);
  });
});
