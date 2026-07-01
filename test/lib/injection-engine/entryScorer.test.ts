/**
 * entryScorer — the pluggable entry-relevance scorer strategy.
 *
 * Covers the 7 test types for the feature (Convention 3), in sections:
 *   Unit · Functional · Integration · Property · Security · Performance · Load.
 *
 * The headline cases: `keywordScorer()` routes with no embedder (word overlap),
 * `embeddingScorer(e)` is the semantic strategy, `.entryBy(scorer)` is the builder
 * slot, and the scorer name + ranking land on the snapshot for the "Why this skill?"
 * panel.
 */

import { describe, it, expect } from 'vitest';
import { Agent } from '../../../src/index.js'
import { keywordScorer, embeddingScorer, rankEntries, skillGraph, defineSkill } from '../../../src/injection-engine.js'
import { mockEmbedder } from '../../../src/memory/index.js'
import { mock } from '../../../src/llm-providers.js';
import type { EntryScorer, InjectionContext } from '../../../src/injection-engine.js';

const ctx = (over: Partial<InjectionContext>): InjectionContext => ({
  iteration: 1,
  userMessage: '',
  history: [],
  activatedInjectionIds: [],
  ...over,
});

const billing = defineSkill({
  id: 'billing',
  description: 'refunds and charges for payments',
  body: 'B',
});
const incident = defineSkill({
  id: 'incident',
  description: 'outages errors and crashes',
  body: 'I',
});

// ─── Unit ──────────────────────────────────────────────────────────────

describe('entryScorer — unit: keywordScorer', () => {
  const scorer = keywordScorer();

  it('is named "keyword"', () => {
    expect(scorer.name).toBe('keyword');
  });

  it('ranks the description with the most word overlap first', () => {
    const out = scorer.score({
      userMessage: 'I need a refund for my payment please',
      candidates: [
        { id: 'billing', description: billing.description! },
        { id: 'incident', description: incident.description! },
      ],
    });
    expect(out.scorer).toBe('keyword');
    expect(out.chosen).toBe('billing'); // shares "refund"/"payment"
    expect(out.ranked.map((r) => r.id)).toEqual(['billing', 'incident']);
    expect(out.ranked.find((r) => r.id === 'billing')!.score).toBeGreaterThan(
      out.ranked.find((r) => r.id === 'incident')!.score,
    );
  });

  it('empty candidates → no winner, empty ranking', () => {
    expect(scorer.score({ userMessage: 'x', candidates: [] })).toEqual({
      scorer: 'keyword',
      chosen: undefined,
      ranked: [],
    });
  });

  it('no shared words → all zero → first declared wins (declaration order tie-break)', () => {
    const out = scorer.score({
      userMessage: 'zzz qqq vvv',
      candidates: [
        { id: 'billing', description: billing.description! },
        { id: 'incident', description: incident.description! },
      ],
    });
    expect(out.ranked.every((r) => r.score === 0)).toBe(true);
    expect(out.chosen).toBe('billing'); // first declared
  });

  it('is case- and punctuation-insensitive', () => {
    const a = scorer.score({
      userMessage: 'REFUND!! payment.',
      candidates: [{ id: 'billing', description: billing.description! }],
    });
    const b = scorer.score({
      userMessage: 'refund payment',
      candidates: [{ id: 'billing', description: billing.description! }],
    });
    expect(a.ranked[0]!.score).toBeCloseTo(b.ranked[0]!.score, 10);
  });

  it('is deterministic (same input → identical output)', () => {
    const input = {
      userMessage: 'refund my payment',
      candidates: [
        { id: 'billing', description: billing.description! },
        { id: 'incident', description: incident.description! },
      ],
    };
    expect(scorer.score(input)).toEqual(scorer.score(input));
  });
});

describe('entryScorer — unit: embeddingScorer', () => {
  const scorer = embeddingScorer(mockEmbedder());

  it('is named "embedding"', () => {
    expect(scorer.name).toBe('embedding');
  });

  it('produces a ranking whose relevances sum to 1, with a winner', async () => {
    const out = await scorer.score({
      userMessage: 'i need a refund for my payment',
      candidates: [
        { id: 'billing', description: billing.description! },
        { id: 'incident', description: incident.description! },
      ],
    });
    expect(out.scorer).toBe('embedding');
    expect(out.chosen).toBeDefined();
    expect(out.ranked.reduce((s, r) => s + r.relevance, 0)).toBeCloseTo(1, 5);
  });

  it('empty candidates → no winner', async () => {
    expect(await scorer.score({ userMessage: 'x', candidates: [] })).toEqual({
      scorer: 'embedding',
      chosen: undefined,
      ranked: [],
    });
  });
});

describe('entryScorer — unit: rankEntries', () => {
  const cands = [
    { id: 'a', description: '' },
    { id: 'b', description: '' },
    { id: 'c', description: '' },
  ];

  it('softmaxes raw scores into relevances summing to 1 and keeps the raw score', () => {
    const out = rankEntries('x', cands, [0.9, 0.2, 0.1]);
    expect(out.ranked.reduce((s, r) => s + r.relevance, 0)).toBeCloseTo(1, 10);
    expect(out.ranked[0]!.score).toBe(0.9);
  });

  it('chosen is the argmax score AND the argmax relevance (softmax is order-preserving)', () => {
    const out = rankEntries('x', cands, [0.2, 0.9, 0.1]);
    const byScore = [...out.ranked].sort((p, q) => q.score - p.score)[0]!.id;
    const byRelevance = [...out.ranked].sort((p, q) => q.relevance - p.relevance)[0]!.id;
    expect(out.chosen).toBe('b');
    expect(byScore).toBe('b');
    expect(byRelevance).toBe('b'); // the surfaced % and the pick can never disagree
  });

  it('ties → first declared', () => {
    expect(rankEntries('x', cands, [0.5, 0.5, 0.5]).chosen).toBe('a');
  });

  it('handles negative scores (embedding cosine can be < 0)', () => {
    const out = rankEntries('x', cands, [-0.9, -0.1, -0.5]);
    expect(out.chosen).toBe('b'); // least-negative
    expect(out.ranked.reduce((s, r) => s + r.relevance, 0)).toBeCloseTo(1, 10);
  });

  it('sanitizes non-finite scores — a NaN/Inf candidate never silently wins', () => {
    const out = rankEntries('x', cands, [NaN, 0.5, Infinity]);
    expect(out.chosen).toBe('b'); // the only finite, highest score
    expect(out.ranked.every((r) => Number.isFinite(r.relevance))).toBe(true);
    expect(out.ranked.reduce((s, r) => s + r.relevance, 0)).toBeCloseTo(1, 6);
    // chosen is the argmax RELEVANCE (the surfaced %) — never a non-finite raw score.
    const byRelevance = [...out.ranked].sort((p, q) => q.relevance - p.relevance)[0]!.id;
    expect(byRelevance).toBe('b');
  });

  it('a leading NaN does not seed-and-win the ranking', () => {
    expect(rankEntries('x', cands, [NaN, NaN, 0.1]).chosen).toBe('c');
  });
});

// ─── Functional ────────────────────────────────────────────────────────

describe('entryScorer — functional: .entryBy() on the skill graph', () => {
  it('.entryBy(keywordScorer()) wires graph.scoreEntries and picks the overlap', async () => {
    const g = skillGraph().entry(billing).entry(incident).entryBy(keywordScorer()).build();
    expect(g.scoreEntries).toBeDefined();
    const res = await g.scoreEntries!(ctx({ userMessage: 'refund my payment' }));
    expect(res.scorer).toBe('keyword');
    expect(res.chosen).toBe('billing');
  });

  it('scoreEntries is absent with no scorer; present with .entryBy()', () => {
    expect(skillGraph().entry(billing).build().scoreEntries).toBeUndefined();
    expect(skillGraph().entry(billing).entryBy(keywordScorer()).build().scoreEntries).toBeDefined();
  });

  it('.entryByRelevance(embedder) is sugar for .entryBy(embeddingScorer)', async () => {
    const g = skillGraph().entry(billing).entry(incident).entryByRelevance(mockEmbedder()).build();
    const res = await g.scoreEntries!(ctx({ userMessage: 'refund' }));
    expect(res.scorer).toBe('embedding');
  });

  it('.entryBy() makes the entries EXCLUSIVE (rule triggers, not always-on)', () => {
    const g = skillGraph().entry(billing).entry(incident).entryBy(keywordScorer()).build();
    for (const s of g.skills) {
      expect(s.trigger?.kind).toBe('rule'); // cursor-gated, not 'always'
    }
  });

  it('guardrail: .entryBy() + .entryByRead() throws', () => {
    expect(() =>
      skillGraph().entry(billing).entryBy(keywordScorer()).entryByRead().build(),
    ).toThrow(/pick one of \.entryByRead\(\) or \.entryBy\(\)/);
  });

  it('config-object form: start.scoredBy selects the scorer', async () => {
    const g = skillGraph({
      skills: [billing, incident],
      start: { entries: ['billing', 'incident'], scoredBy: keywordScorer() },
    });
    const res = await g.scoreEntries!(ctx({ userMessage: 'refund payment' }));
    expect(res.scorer).toBe('keyword');
    expect(res.chosen).toBe('billing');
  });
});

// ─── Integration ───────────────────────────────────────────────────────

describe('entryScorer — integration: through the REAL Agent loop', () => {
  it('.entryBy(keywordScorer()) routes to the relevant entry; the others stay dormant', async () => {
    const graph = skillGraph().entry(billing).entry(incident).entryBy(keywordScorer()).build();
    const activeIds: string[][] = [];
    const recorder = {
      id: 'cap',
      onEmit: (e: { name: string; payload?: { activeIds?: string[] } }) => {
        if (e.name === 'agentfootprint.context.evaluated')
          activeIds.push([...(e.payload?.activeIds ?? [])]);
      },
    };
    const agent = Agent.create({
      provider: mock({ reply: 'done' }),
      model: 'mock',
      maxIterations: 3,
    })
      .system('')
      .skillGraph(graph)
      .recorder(recorder)
      .build();
    await agent.run({ message: 'i need a refund for my payment' });

    const everActive = new Set(activeIds.flat());
    expect(everActive.has('billing')).toBe(true);
    expect(everActive.has('incident')).toBe(false);
  });

  it('exposes the ranking AND the scorer name on the snapshot', async () => {
    const graph = skillGraph().entry(billing).entry(incident).entryBy(keywordScorer()).build();
    const agent = Agent.create({
      provider: mock({ reply: 'done' }),
      model: 'mock',
      maxIterations: 2,
    })
      .system('')
      .skillGraph(graph)
      .build();
    await agent.run({ message: 'i need a refund for my payment' });

    const state = agent.getLastSnapshot()?.sharedState as {
      entryScores?: Array<{ id: string; score: number; relevance: number }>;
      entryScorer?: string;
    };
    expect(state?.entryScorer).toBe('keyword');
    expect(state?.entryScores?.map((s) => s.id).sort()).toEqual(['billing', 'incident']);
    expect(state!.entryScores!.reduce((sum, s) => sum + s.relevance, 0)).toBeCloseTo(1, 5);
  });
});

// ─── Property ──────────────────────────────────────────────────────────

describe('entryScorer — property: invariants over random input', () => {
  const scorer = keywordScorer();
  const words = [
    'refund',
    'payment',
    'outage',
    'crash',
    'login',
    'invoice',
    'error',
    'ticket',
    'order',
    'bug',
  ];
  const pick = (n: number, seed: number) =>
    Array.from({ length: n }, (_, i) => words[(seed * 7 + i * 13) % words.length]).join(' ');

  it('relevances always sum to 1 and chosen is always the max-score id', () => {
    for (let seed = 0; seed < 50; seed++) {
      const candidates = [
        { id: 'a', description: pick(3, seed) },
        { id: 'b', description: pick(4, seed + 1) },
        { id: 'c', description: pick(2, seed + 2) },
      ];
      const out = scorer.score({ userMessage: pick(3, seed + 3), candidates });
      expect(out.ranked.reduce((s, r) => s + r.relevance, 0)).toBeCloseTo(1, 6);
      const maxId = [...out.ranked].sort((p, q) => q.score - p.score)[0]!.id;
      expect(out.chosen).toBe(maxId);
    }
  });

  it('is a pure function of its input', () => {
    for (let seed = 0; seed < 25; seed++) {
      const input = {
        userMessage: pick(3, seed),
        candidates: [{ id: 'a', description: pick(4, seed + 1) }],
      };
      expect(scorer.score(input)).toEqual(scorer.score(input));
    }
  });
});

// ─── Security ──────────────────────────────────────────────────────────

describe('entryScorer — security: hostile input is contained', () => {
  const scorer = keywordScorer();

  it('regex-special and unicode descriptions do not crash the tokenizer', () => {
    const out = scorer.score({
      userMessage: '.*+?^${}()|[]\\ <script>alert(1)</script> 你好',
      candidates: [
        { id: 'a', description: '.*+?^${}()|[]\\' },
        { id: 'b', description: 'normal words here' },
      ],
    });
    expect(out.ranked).toHaveLength(2);
    expect(Number.isFinite(out.ranked[0]!.relevance)).toBe(true);
  });

  it('a very long description does not blow up (bounded by tokenization)', () => {
    const huge = 'refund '.repeat(100_000);
    const out = scorer.score({
      userMessage: 'refund',
      candidates: [{ id: 'a', description: huge }],
    });
    expect(out.chosen).toBe('a');
    expect(Number.isFinite(out.ranked[0]!.score)).toBe(true);
  });

  it('a throwing custom scorer does not crash the run — the agent falls back to cold-start', async () => {
    const boom: EntryScorer = {
      name: 'boom',
      score() {
        throw new Error('scorer exploded');
      },
    };
    const graph = skillGraph().entry(billing).entry(incident).entryBy(boom).build();
    const agent = Agent.create({
      provider: mock({ reply: 'done' }),
      model: 'mock',
      maxIterations: 2,
    })
      .system('')
      .skillGraph(graph)
      .build();
    // Should resolve (not throw) — PickEntry catches and falls back to cold-start.
    await expect(agent.run({ message: 'refund' })).resolves.toBeDefined();
  });
});

// ─── Performance ───────────────────────────────────────────────────────

describe('entryScorer — performance', () => {
  it('keywordScorer ranks 50 candidates in well under budget', () => {
    const scorer = keywordScorer();
    const candidates = Array.from({ length: 50 }, (_, i) => ({
      id: `s${i}`,
      description: `skill number ${i} handling refunds payments outages crashes orders invoices`,
    }));
    const start = performance.now();
    const out = scorer.score({ userMessage: 'refund payment outage crash', candidates });
    const ms = performance.now() - start;
    expect(out.ranked).toHaveLength(50);
    expect(ms).toBeLessThan(50);
  });
});

// ─── Load ──────────────────────────────────────────────────────────────

describe('entryScorer — load', () => {
  it('sustains 1000 scoring calls without degradation', () => {
    const scorer = keywordScorer();
    const candidates = [
      { id: 'billing', description: billing.description! },
      { id: 'incident', description: incident.description! },
    ];
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      const out = scorer.score({ userMessage: 'refund payment', candidates });
      expect(out.chosen).toBe('billing');
    }
    expect(performance.now() - start).toBeLessThan(500);
  });
});
