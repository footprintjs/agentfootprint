import { describe, it, expect } from 'vitest';
import { explainChoice } from '../../../src/lib/influence-core/explain.js';
import { snippetUnits } from '../../../src/lib/influence-core/snippets.js';
import { staticEmbedder } from '../../../src/embedders/index.js';
import type { AttributionUnit, Embedder } from '../../../src/lib/influence-core/types.js';

/** Deterministic embedder: fixed vectors per exact text (unknown → zero). */
function fakeEmbedder(map: Record<string, number[]>, dimensions = 2): Embedder {
  const vec = (t: string) => map[t] ?? new Array<number>(dimensions).fill(0);
  return {
    dimensions,
    async embed({ text }) {
      return vec(text);
    },
    async embedBatch({ texts }) {
      return texts.map(vec);
    },
  };
}

describe('explainChoice — the verdict shape (deterministic embedder)', () => {
  // tool at 45°: S1 cos≈0.7071, S2 cos≈0.9487, T1 cos≈0.7071, D1 cos=-1 (clamped)
  const units: AttributionUnit[] = [
    { id: 's1', channel: 'system', text: 'S1' },
    { id: 's2', channel: 'system', text: 'S2' },
    { id: 't1', channel: 'task', text: 'T1' },
    { id: 'd1', channel: 'data', text: 'D1' },
  ];
  const embedder = fakeEmbedder({
    TOOL: [1, 1],
    S1: [1, 0],
    S2: [1, 2],
    T1: [0, 1],
    D1: [-1, -1],
  });

  it('sorts channels by share descending and still lists the zero-share channel', async () => {
    const r = await explainChoice({ tool: { name: 't', text: 'TOOL' }, units, embedder });

    expect(r.channels.map((c) => c.channel)).toEqual(['system', 'task', 'data']);
    // shares: system = (0.7071+0.9487)/2.3629, task = 0.7071/2.3629, data clamped to 0
    expect(r.channels[0].share).toBeCloseTo(1.6558 / 2.3629, 3);
    expect(r.channels[1].share).toBeCloseTo(0.7071 / 2.3629, 3);
    expect(r.channels[2].share).toBe(0);
    // shares sum to ~1 even with the zero-share channel listed
    expect(r.channels.reduce((sum, c) => sum + c.share, 0)).toBeCloseTo(1, 5);
  });

  it('reports the best unit per channel, text carried through', async () => {
    const r = await explainChoice({ tool: { name: 't', text: 'TOOL' }, units, embedder });

    const system = r.channels.find((c) => c.channel === 'system');
    expect(system?.top?.id).toBe('s2'); // 0.9487 beats 0.7071 inside system
    expect(system?.top?.text).toBe('S2');
    const task = r.channels.find((c) => c.channel === 'task');
    expect(task?.top?.id).toBe('t1');
    expect(task?.top?.text).toBe('T1');
    // even the zero-share channel names its (negative) best unit
    const data = r.channels.find((c) => c.channel === 'data');
    expect(data?.top?.id).toBe('d1');
  });

  it('ranks all units descending with text, and the overall top is the citation', async () => {
    const r = await explainChoice({ tool: { name: 't', text: 'TOOL' }, units, embedder });

    // s2 (0.9487), then the s1/t1 tie keeps input order, d1 (-1) last
    expect(r.units.map((u) => u.id)).toEqual(['s2', 's1', 't1', 'd1']);
    expect(r.units.map((u) => u.text)).toEqual(['S2', 'S1', 'T1', 'D1']);
    expect(r.top.id).toBe('s2');
    expect(r.top.text).toBe('S2');
    expect(r.top.score).toBeCloseTo(3 / Math.sqrt(2 * 5), 5);
    expect(r.tool).toBe('t');
  });

  it('throws on empty units (inherited from attributeChoice)', async () => {
    await expect(
      explainChoice({ tool: { name: 't', text: 'x' }, units: [], embedder }),
    ).rejects.toThrow(/non-empty/);
  });
});

describe('snippetUnits — cutting a tool result into citable units', () => {
  it('splits a prose string into sentence units', () => {
    const r = snippetUnits('Found 2 dresses. The red one ships free!\nBlue is back-ordered.');
    expect(r.map((u) => u.text)).toEqual([
      'Found 2 dresses.',
      'The red one ships free!',
      'Blue is back-ordered.',
    ]);
    expect(r.map((u) => u.id)).toEqual(['data-1', 'data-2', 'data-3']);
    expect(r.every((u) => u.channel === 'data')).toBe(true);
  });

  it('emits one unit per array element object — the search-hit grain', () => {
    const r = snippetUnits({
      results: [
        { id: 'd42', name: 'red dress', price: 89 },
        { id: 'd7', name: 'blue gown', price: 150 },
      ],
    });
    expect(r).toHaveLength(2);
    expect(r[0].text).toBe('id: d42, name: red dress, price: 89');
    expect(r[1].text).toBe('id: d7, name: blue gown, price: 150');
  });

  it('groups a plain object’s primitive fields into one unit, skipping booleans/null/empty', () => {
    const r = snippetUnits({ status: 'ok', count: 2, cached: true, error: null, note: '  ' });
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe('status: ok, count: 2');
  });

  it('respects max and maxLength (ellipsis appended, cap included)', () => {
    const many = { results: Array.from({ length: 20 }, (_, i) => ({ id: `d${i}` })) };
    expect(snippetUnits(many, { max: 3 })).toHaveLength(3);
    expect(snippetUnits(many)).toHaveLength(12); // default max

    const long = snippetUnits('x'.repeat(500), { maxLength: 10 });
    expect(long[0].text).toHaveLength(10);
    expect(long[0].text.endsWith('…')).toBe(true);
  });

  it('never throws on circular references or weird values', () => {
    const loop: Record<string, unknown> = { name: 'loop' };
    loop['self'] = loop;
    loop['fn'] = () => 'nope';
    expect(() => snippetUnits(loop)).not.toThrow();
    expect(snippetUnits(loop).map((u) => u.text)).toEqual(['name: loop']);
    expect(snippetUnits(undefined)).toEqual([]);
    expect(snippetUnits(Symbol('odd'))).toEqual([]);
  });

  it('honors channel and idPrefix overrides (defaults: data/data)', () => {
    const custom = snippetUnits('One hit.', { channel: 'result', idPrefix: 'hit' });
    expect(custom[0].channel).toBe('result');
    expect(custom[0].id).toBe('hit-1');

    const defaults = snippetUnits('One hit.');
    expect(defaults[0].channel).toBe('data');
    expect(defaults[0].id).toBe('data-1');
  });
});

// The real proof (potion embeddings): a purchase pick that names d42 can be
// traced to the search-result snippet that RETURNED d42 — the data channel
// pulls, and its best citation is the d42 row. We do NOT assert data wins
// overall (embedding proxies are noisy); we assert what must be true.
describe('explainChoice + snippetUnits — real purchase pick (potion)', () => {
  it("cites the d42 search hit for 'open dress d42 and buy it'", async () => {
    const units: AttributionUnit[] = [
      {
        id: 'task',
        channel: 'task',
        text: 'find me a red dress under $150 and buy the cheapest',
      },
      {
        id: 'rule-1',
        channel: 'system',
        text: 'Call whats_here first — it tells you where the user is, what happened since your last look, and which actions and skills exist right now.',
      },
      {
        id: 'rule-4',
        channel: 'system',
        text: 'High-effect steps come back as needs-confirm. You must then call request_confirmation and only after approval call the skill again with confirm: true.',
      },
      ...snippetUnits({
        results: [
          { id: 'd42', name: 'red dress', price: 89 },
          { id: 'd7', name: 'blue gown', price: 150 },
        ],
      }),
    ];

    const r = await explainChoice({
      tool: {
        name: 'skill_purchase',
        text: 'skill_purchase: open dress d42 red dress and buy it',
      },
      units,
      embedder: staticEmbedder(),
    });

    // every channel we fed in appears in the verdict
    expect(r.channels.map((c) => c.channel).sort()).toEqual(['data', 'system', 'task']);

    const data = r.channels.find((c) => c.channel === 'data');
    expect(data?.share ?? 0).toBeGreaterThan(0); // the data channel pulls
    expect(data?.top?.text).toContain('d42'); // and its citation is the d42 row
  }, 30_000);
});
