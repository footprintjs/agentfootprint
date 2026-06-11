/**
 * scoreMargin — RFC-002 C4 core acceptance.
 *
 * C4 acceptance (RFC-002 §6): fixtures — decisive, narrow,
 * proxy-disagreement. Plus boundary / fail-loud tiers.
 */
import { describe, expect, it } from 'vitest';
import { mockEmbedder } from '../../../src/memory/embedding/mockEmbedder';
import { scoreMargin } from '../../../src/lib/influence-core';

// Context that strongly shares vocabulary with the influx candidate.
const CONTEXT = 'query the FC name server database registrations from influx time series';

const DISTINCT_CATALOG = [
  {
    name: 'influx_get_fcns_database',
    text: 'Get FC name server database registrations from influx time series.',
  },
  { name: 'send_email', text: '!!! ### 0101010101 zzzzzz qqqq 9999 ****' },
];

// Deliberate near-twins (the Neo confusable pair shape).
const TWIN_CATALOG = [
  {
    name: 'get_fcns_database',
    text: 'Get FC name server database registrations from the fabric live.',
  },
  {
    name: 'influx_get_fcns_database',
    text: 'Get FC name server database registrations from influx history.',
  },
  { name: 'send_email', text: '!!! ### 0101010101 zzzzzz qqqq 9999 ****' },
];

describe('scoreMargin — C4 acceptance fixtures', () => {
  it('DECISIVE: chosen clearly wins → wide margin, no flags', async () => {
    const result = await scoreMargin({
      candidates: DISTINCT_CATALOG,
      contextText: CONTEXT,
      chosen: ['influx_get_fcns_database'],
      embedder: mockEmbedder(),
    });
    expect(result.topScored).toBe('influx_get_fcns_database');
    expect(result.margin).toBeGreaterThan(0.05);
    expect(result.flags.narrow).toBe(false);
    expect(result.flags.proxyDisagreement).toBe(false);
  });

  it('NARROW: near-twin descriptions → margin under threshold, narrow flagged', async () => {
    // Whichever twin the "model" picked, the proxy competition between
    // near-identical descriptions is a near-tie: |margin| < threshold,
    // so narrow flags either way (negative margin is also < threshold).
    const result = await scoreMargin({
      candidates: TWIN_CATALOG,
      contextText: CONTEXT,
      chosen: ['get_fcns_database'],
      embedder: mockEmbedder(),
    });
    expect(result.margin).toBeDefined();
    expect(Math.abs(result.margin!)).toBeLessThan(0.05);
    expect(result.flags.narrow).toBe(true);
  });

  it('PROXY-DISAGREEMENT: model chose the low-scoring candidate → flagged', async () => {
    const result = await scoreMargin({
      candidates: DISTINCT_CATALOG,
      contextText: CONTEXT,
      chosen: ['send_email'],
      embedder: mockEmbedder(),
    });
    expect(result.topScored).toBe('influx_get_fcns_database');
    expect(result.flags.proxyDisagreement).toBe(true);
    // Negative margin — also a narrow choice by definition.
    expect(result.margin).toBeLessThan(0);
    expect(result.flags.narrow).toBe(true);
  });
});

describe('scoreMargin — semantics', () => {
  it('scores are ranked descending and cover every candidate', async () => {
    const result = await scoreMargin({
      candidates: TWIN_CATALOG,
      contextText: CONTEXT,
      chosen: ['get_fcns_database'],
      embedder: mockEmbedder(),
    });
    expect(result.scores.map((s) => s.name).sort()).toEqual(TWIN_CATALOG.map((c) => c.name).sort());
    for (let i = 1; i < result.scores.length; i++) {
      expect(result.scores[i].score).toBeLessThanOrEqual(result.scores[i - 1].score);
    }
  });

  it('multi-chosen: margin measured from the BEST chosen', async () => {
    const result = await scoreMargin({
      candidates: TWIN_CATALOG,
      contextText: CONTEXT,
      chosen: ['get_fcns_database', 'influx_get_fcns_database'],
      embedder: mockEmbedder(),
    });
    // Both twins chosen — competition is only the junk candidate.
    const bestChosen = Math.max(
      result.scores.find((s) => s.name === 'get_fcns_database')!.score,
      result.scores.find((s) => s.name === 'influx_get_fcns_database')!.score,
    );
    const other = result.scores.find((s) => s.name === 'send_email')!.score;
    expect(result.margin).toBeCloseTo(bestChosen - other, 12);
    expect(result.flags.proxyDisagreement).toBe(false);
  });

  it('every candidate chosen → margin undefined, narrow false', async () => {
    const result = await scoreMargin({
      candidates: DISTINCT_CATALOG,
      contextText: CONTEXT,
      chosen: DISTINCT_CATALOG.map((c) => c.name),
      embedder: mockEmbedder(),
    });
    expect(result.margin).toBeUndefined();
    expect(result.flags.narrow).toBe(false);
    expect(result.flags.proxyDisagreement).toBe(false);
  });

  it('single-candidate catalog → margin undefined (no competition)', async () => {
    const result = await scoreMargin({
      candidates: [DISTINCT_CATALOG[0]],
      contextText: CONTEXT,
      chosen: [DISTINCT_CATALOG[0].name],
      embedder: mockEmbedder(),
    });
    expect(result.margin).toBeUndefined();
    expect(result.topScored).toBe(DISTINCT_CATALOG[0].name);
    expect(result.flags.narrow).toBe(false);
  });

  it('custom marginThreshold is honored', async () => {
    const result = await scoreMargin({
      candidates: DISTINCT_CATALOG,
      contextText: CONTEXT,
      chosen: ['influx_get_fcns_database'],
      embedder: mockEmbedder(),
      marginThreshold: 0.99, // absurdly strict — everything is narrow
    });
    expect(result.flags.narrow).toBe(true);
  });

  it('chosen echoes input; input arrays are not mutated', async () => {
    const chosen = ['influx_get_fcns_database'];
    const result = await scoreMargin({
      candidates: DISTINCT_CATALOG,
      contextText: CONTEXT,
      chosen,
      embedder: mockEmbedder(),
    });
    expect(result.chosen).toEqual(chosen);
    expect(result.chosen).not.toBe(chosen); // defensive copy out
  });
});

describe('scoreMargin — fail-loud validation', () => {
  const base = {
    contextText: CONTEXT,
    embedder: mockEmbedder(),
  };

  it('empty candidates throw', async () => {
    await expect(scoreMargin({ ...base, candidates: [], chosen: ['x'] })).rejects.toThrow(
      /candidates must be non-empty/,
    );
  });

  it('empty chosen throws', async () => {
    await expect(
      scoreMargin({ ...base, candidates: DISTINCT_CATALOG, chosen: [] }),
    ).rejects.toThrow(/chosen must be non-empty/);
  });

  it('duplicate candidate names throw', async () => {
    await expect(
      scoreMargin({
        ...base,
        candidates: [
          { name: 'dup', text: 'a' },
          { name: 'dup', text: 'b' },
        ],
        chosen: ['dup'],
      }),
    ).rejects.toThrow(/duplicate candidate name 'dup'/);
  });

  it('chosen name missing from candidates throws', async () => {
    await expect(
      scoreMargin({ ...base, candidates: DISTINCT_CATALOG, chosen: ['not_a_tool'] }),
    ).rejects.toThrow(/'not_a_tool' is not among the candidates/);
  });
});
