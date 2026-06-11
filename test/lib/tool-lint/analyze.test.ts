/**
 * analyzeToolCatalog (RFC-002 C1) — unit + functional tiers.
 *
 * Verdict policy (thresholds, watch band, ok logic), the embedder-less
 * structural-only mode, the duplicate-name precondition, the Tool[]
 * adapter, and the differentiating-axis hints.
 *
 * Absolute-threshold tests use a HAND-ROLLED embedder with known
 * geometry (orthogonal/parallel vectors) — never the mock's prose
 * compression (the calibration note) — so verdict boundaries are exact.
 */
import { describe, expect, it } from 'vitest';
import { defineTool } from '../../../src/index';
import type { Embedder } from '../../../src/lib/influence-core';
import {
  analyzeToolCatalog,
  catalogFromTools,
  confusabilityText,
  differentiationHint,
  DEFAULT_CONFUSABILITY_THRESHOLD,
  DEFAULT_WATCH_BAND,
  formatToolCatalogReport,
  type CatalogTool,
} from '../../../src/lib/tool-lint';

/** Embedder with EXACT geometry: each text maps to a fixed vector. */
function plantedEmbedder(vectors: Record<string, number[]>): Embedder {
  const lookup = (text: string): number[] => {
    for (const [key, vec] of Object.entries(vectors)) {
      if (text.includes(key)) return vec;
    }
    throw new Error(`plantedEmbedder: no vector planted for "${text}"`);
  };
  return {
    dimensions: 3,
    embed: async ({ text }) => lookup(text),
    embedBatch: async ({ texts }) => texts.map(lookup),
  };
}

// cos(twin-a, twin-b) ≈ 0.9899; cos(*, unrelated) = 0.
const GEOMETRY = plantedEmbedder({
  'twin a': [1, 0.1, 0],
  'twin b': [1, 0.3, 0],
  unrelated: [0, 0, 1],
});

// Descriptions are ≥40 chars and carry WHEN cues so structural noise
// stays out of similarity-focused tests.
const TWIN_A: CatalogTool = {
  name: 'twin_a',
  description: 'twin a — use only for the primary path when the cache is warm.',
};
const TWIN_B: CatalogTool = {
  name: 'twin_b',
  description: 'twin b — use only for the primary path when the cache is warm.',
};
const UNRELATED: CatalogTool = {
  name: 'send_email',
  description: 'unrelated — sends a notification email after the report completes.',
};

describe('analyzeToolCatalog — verdict policy (unit)', () => {
  it('pair at/above the threshold → confusable; ok flips false', async () => {
    const report = await analyzeToolCatalog([TWIN_A, TWIN_B, UNRELATED], {
      embedder: GEOMETRY,
      confusabilityThreshold: 0.95,
    });
    expect(report.similarity.analyzed).toBe(true);
    expect(report.similarity.confusable).toHaveLength(1);
    expect(report.similarity.confusable[0]).toMatchObject({
      kind: 'confusable',
      a: 'twin_a',
      b: 'twin_b',
    });
    expect(report.similarity.confusable[0].similarity).toBeGreaterThan(0.95);
    expect(report.ok).toBe(false);
    expect(report.summary.confusable).toBe(1);
  });

  it('pair inside the watch band → watch (advisory; ok stays true)', async () => {
    const report = await analyzeToolCatalog([TWIN_A, TWIN_B, UNRELATED], {
      embedder: GEOMETRY,
      confusabilityThreshold: 0.999, // twins (≈0.9899) fall just below…
      watchBand: 0.02, // …but inside the band
    });
    expect(report.similarity.confusable).toHaveLength(0);
    expect(report.similarity.watch).toHaveLength(1);
    expect(report.similarity.watch[0].kind).toBe('watch');
    expect(report.ok).toBe(true);
    expect(report.summary.watch).toBe(1);
  });

  it('pair below threshold − band → unflagged but still RANKED', async () => {
    const report = await analyzeToolCatalog([TWIN_A, UNRELATED], {
      embedder: GEOMETRY,
      confusabilityThreshold: 0.5,
    });
    expect(report.similarity.confusable).toHaveLength(0);
    expect(report.similarity.watch).toHaveLength(0);
    expect(report.similarity.ranked).toHaveLength(1); // the full ordering view
    expect(report.ok).toBe(true);
  });

  it('defaults are the documented real-embedder starting points', async () => {
    const report = await analyzeToolCatalog([TWIN_A, UNRELATED], { embedder: GEOMETRY });
    expect(report.similarity.thresholds).toEqual({
      confusabilityThreshold: DEFAULT_CONFUSABILITY_THRESHOLD,
      watchBand: DEFAULT_WATCH_BAND,
    });
    expect(DEFAULT_CONFUSABILITY_THRESHOLD).toBe(0.85);
    expect(DEFAULT_WATCH_BAND).toBe(0.05);
  });
});

describe('analyzeToolCatalog — structural-only mode (no embedder)', () => {
  it('skips similarity, still runs the rule pack, ok reflects structure', async () => {
    const report = await analyzeToolCatalog([{ name: 'bare' }]);
    expect(report.similarity.analyzed).toBe(false);
    expect(report.similarity.ranked).toHaveLength(0);
    expect(report.structural.some((f) => f.rule === 'description-missing-or-short')).toBe(true);
    expect(report.ok).toBe(false); // missing description is an error
  });

  it('failOn: "warn" makes warnings fail the gate (strict mode)', async () => {
    const shortDesc: CatalogTool = { name: 't', description: 'Short for now.' };
    const lax = await analyzeToolCatalog([shortDesc]);
    const strict = await analyzeToolCatalog([shortDesc], { failOn: 'warn' });
    expect(lax.ok).toBe(true); // warn only
    expect(strict.ok).toBe(false);
  });

  it('a single tool with an embedder: nothing to pair, analyzed=false', async () => {
    const report = await analyzeToolCatalog([TWIN_A], { embedder: GEOMETRY });
    expect(report.similarity.analyzed).toBe(false);
    expect(report.similarity.ranked).toHaveLength(0);
  });
});

describe('analyzeToolCatalog — duplicate-name precondition', () => {
  it('reports duplicate-name as a structural ERROR and drops the dupe from similarity', async () => {
    const report = await analyzeToolCatalog([TWIN_A, TWIN_A, UNRELATED], {
      embedder: GEOMETRY,
    });
    const dupes = report.structural.filter((f) => f.rule === 'duplicate-name');
    expect(dupes).toHaveLength(1);
    expect(dupes[0]).toMatchObject({ tool: 'twin_a', severity: 'error' });
    expect(report.ok).toBe(false);
    // similarity ran over the deduped catalog (1 pair, not 3)
    expect(report.similarity.ranked).toHaveLength(1);
  });
});

describe('catalogFromTools — the library Tool[] adapter', () => {
  it('maps Tool.schema 1:1 onto CatalogTool', () => {
    const tool = defineTool({
      name: 'lookup',
      description: 'Looks things up when an id is already known.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      execute: async () => 'ok',
    });
    const [catalogTool] = catalogFromTools([tool]);
    expect(catalogTool).toEqual({
      name: 'lookup',
      description: 'Looks things up when an id is already known.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    });
  });
});

describe('confusabilityText — what gets embedded', () => {
  it('opens name boundaries (snake/kebab/camel) and appends the description', () => {
    expect(confusabilityText({ name: 'influx_get_fcns_database', description: 'FCNS DB.' })).toBe(
      'influx get fcns database: FCNS DB.',
    );
    expect(confusabilityText({ name: 'getFcnsDatabase', description: 'FCNS DB.' })).toBe(
      'get Fcns Database: FCNS DB.',
    );
    expect(confusabilityText({ name: 'plain-name' })).toBe('plain name');
  });
});

describe('differentiationHint — the suggested axis', () => {
  it('near-twin names: names the qualifier and asks for WHEN', () => {
    const hint = differentiationHint(
      { name: 'get_fcns_database', description: 'FC Name Server DB.' },
      { name: 'influx_get_fcns_database', description: 'FC Name Server registrations.' },
    );
    expect(hint).toContain("'influx'");
    expect(hint).toContain('WHEN');
  });

  it('different names: surfaces each side’s distinct description terms', () => {
    const hint = differentiationHint(
      { name: 'alpha_fetch', description: 'reads sensor temperature data nightly' },
      { name: 'beta_push', description: 'writes sensor calibration data nightly' },
    );
    expect(hint).toContain('alpha_fetch');
    expect(hint).toContain('beta_push');
    expect(hint.toLowerCase()).toContain('use when');
  });

  it('identical descriptions, distinct names: near-duplicate fallback', () => {
    const hint = differentiationHint(
      { name: 'aaaa_one_thing', description: 'does the thing' },
      { name: 'zzzz_other_widget', description: 'does the thing' },
    );
    expect(hint).toContain('near-duplicates');
  });
});

describe('formatToolCatalogReport — presenter (functional)', () => {
  it('renders verdicts, hints, structure and the RESULT line', async () => {
    const report = await analyzeToolCatalog([TWIN_A, TWIN_B, { name: 'bare' }], {
      embedder: plantedEmbedder({ 'twin a': [1, 0, 0], 'twin b': [1, 0.05, 0], bare: [0, 1, 0] }),
      confusabilityThreshold: 0.95,
    });
    const text = formatToolCatalogReport(report);
    expect(text).toContain('✗ CONFUSABLE');
    expect(text).toContain('twin_a <> twin_b');
    expect(text).toContain('hint:');
    expect(text).toContain('[description-missing-or-short] bare');
    expect(text).toContain('RESULT: FAIL');
  });

  it('renders the skipped-similarity note without an embedder', async () => {
    const report = await analyzeToolCatalog([TWIN_A, TWIN_B]);
    expect(formatToolCatalogReport(report)).toContain('skipped (no embedder');
  });
});
