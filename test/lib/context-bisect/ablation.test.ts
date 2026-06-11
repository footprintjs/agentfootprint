/**
 * Ablation adapters + the construction seam + the probe engine
 * (RFC-003 D8 stage 4 / D9 stats) — unit / property / fail-loud tiers.
 */
import { describe, expect, it } from 'vitest';

import { defineTool } from '../../../src/core/tools';
import { defineFact } from '../../../src/lib/injection-engine/factories/defineFact';
import {
  ablationForSuspect,
  applyAblations,
  defaultOutcomeComparator,
  probeFlipped,
  runAblationProbe,
  verdictFor,
  type AblationRunStats,
  type AblationSpec,
  type Embedder,
  type Suspect,
} from '../../../src/lib/context-bisect';

function suspect(partial: Partial<Suspect> & Pick<Suspect, 'kind'>): Suspect {
  return {
    source: 's#0',
    stageName: 'S',
    score: 1,
    structuralScore: 1,
    edgePath: [],
    ...partial,
  };
}

// ── ablationForSuspect (the per-kind adapters) ───────────────────────

describe('ablationForSuspect — unit', () => {
  it('tool → ignoredTools', () => {
    expect(ablationForSuspect(suspect({ kind: 'tool', detail: { toolName: 'lookup' } }))).toEqual({
      kind: 'tool',
      ignoredTools: ['lookup'],
    });
  });

  it('injection → excludeInjectionIds; memory → excludeMemoryIds', () => {
    expect(
      ablationForSuspect(suspect({ kind: 'injection', detail: { injectionId: 'vip' } })),
    ).toEqual({ kind: 'injection', excludeInjectionIds: ['vip'] });
    expect(ablationForSuspect(suspect({ kind: 'memory', detail: { injectionId: 'm1' } }))).toEqual({
      kind: 'memory',
      excludeMemoryIds: ['m1'],
    });
  });

  it('arg → consumer-override note naming the step; stage → undefined', () => {
    const spec = ablationForSuspect(suspect({ kind: 'arg', source: 'seed#0' }));
    expect(spec?.kind).toBe('arg');
    if (spec?.kind === 'arg') {
      expect(spec.source).toBe('seed#0');
      expect(spec.note).toContain('runner must override');
    }
    expect(ablationForSuspect(suspect({ kind: 'stage' }))).toBeUndefined();
    // Missing identity → no spec (never a spec that silently removes nothing).
    expect(ablationForSuspect(suspect({ kind: 'tool' }))).toBeUndefined();
    expect(ablationForSuspect(suspect({ kind: 'injection' }))).toBeUndefined();
  });
});

// ── applyAblations (the documented construction seam) ────────────────

describe('applyAblations — the seam', () => {
  const toolA = defineTool<Record<string, never>, string>({
    name: 'tool_a',
    description: 'a',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'a',
  });
  const toolB = defineTool<Record<string, never>, string>({
    name: 'tool_b',
    description: 'b',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'b',
  });
  const factX = defineFact({ id: 'x', data: 'X.' });
  const factY = defineFact({ id: 'y', data: 'Y.' });

  it('filters tools by schema name, injections and memory entries by id', () => {
    const specs: AblationSpec[] = [
      { kind: 'tool', ignoredTools: ['tool_a'] },
      { kind: 'injection', excludeInjectionIds: ['x'] },
      { kind: 'memory', excludeMemoryIds: ['m2'] },
    ];
    const out = applyAblations(specs, {
      tools: [toolA, toolB],
      injections: [factX, factY],
      memoryEntries: [{ id: 'm1' }, { id: 'm2' }],
    });
    expect(out.tools.map((tool) => tool.schema.name)).toEqual(['tool_b']);
    expect(out.injections.map((injection) => injection.id)).toEqual(['y']);
    expect(out.memoryEntries.map((entry) => entry.id)).toEqual(['m1']);
  });

  it('no specs → everything passes through; arg specs filter nothing', () => {
    const out = applyAblations([{ kind: 'arg', source: 's#0', note: 'n' }], {
      tools: [toolA],
      injections: [factX],
      memoryEntries: [{ id: 'm1' }],
    });
    expect(out.tools).toHaveLength(1);
    expect(out.injections).toHaveLength(1);
    expect(out.memoryEntries).toHaveLength(1);
  });

  it('property: never drops a non-matching id (random ids fuzz)', () => {
    for (let round = 0; round < 25; round++) {
      const ids = Array.from({ length: 8 }, (_, i) => `id-${round}-${i}`);
      const excluded = ids.filter(() => Math.random() < 0.5);
      const out = applyAblations([{ kind: 'memory', excludeMemoryIds: excluded }], {
        memoryEntries: ids.map((id) => ({ id })),
      });
      const kept = new Set(out.memoryEntries.map((entry) => entry.id));
      for (const id of ids) {
        expect(kept.has(id)).toBe(!excluded.includes(id));
      }
    }
  });
});

// ── runAblationProbe (the D9 stats engine) ───────────────────────────

/** Deterministic toy embedder: 'A…' and 'B…' texts are orthogonal. */
const toyEmbedder: Embedder = {
  dimensions: 2,
  embed: async ({ text }) => (text.startsWith('A') ? [1, 0] : [0, 1]),
};

describe('runAblationProbe — variance discipline (D9)', () => {
  it('calls the runner once per seed (0..N-1) and reports flips + variance', async () => {
    const seeds: number[] = [];
    const stats = await runAblationProbe(
      {
        embedder: toyEmbedder,
        rerun: {
          runner: async (_specs, run) => {
            seeds.push(run.seed);
            return run.seed === 0 ? 'A same' : 'B different';
          },
          originalOutput: 'A original',
          samples: 3,
        },
      },
      [],
    );
    expect(seeds).toEqual([0, 1, 2]);
    expect(stats.samples).toBe(3);
    expect(stats.flips).toBe(2); // orthogonal outputs < 0.8 similarity
    expect(stats.similarity.min).toBeLessThanOrEqual(stats.similarity.mean);
    expect(stats.similarity.mean).toBeLessThanOrEqual(stats.similarity.max);
    expect(stats.similarity.stdev).toBeGreaterThan(0);
  });

  it('never runs a single-sample probe — samples clamp to ≥ 2', async () => {
    let calls = 0;
    const stats = await runAblationProbe(
      {
        embedder: toyEmbedder,
        rerun: {
          runner: async () => {
            calls++;
            return 'A same';
          },
          originalOutput: 'A original',
          samples: 1, // asks for a single-run verdict — refused
        },
      },
      [],
    );
    expect(calls).toBe(2);
    expect(stats.samples).toBe(2);
  });

  it('honors a domain outcomeChanged comparator over the similarity default', async () => {
    const stats = await runAblationProbe(
      {
        embedder: toyEmbedder,
        rerun: {
          runner: async () => 'A textually-similar but DECLINED',
          originalOutput: 'A textually-similar and APPROVED',
          samples: 2,
          outcomeChanged: (a, b) => a.includes('APPROVED') !== b.includes('APPROVED'),
        },
      },
      [],
    );
    expect(stats.flips).toBe(2);
  });
});

describe('defaultOutcomeComparator / probeFlipped — unit', () => {
  it('flips below the threshold, not above', async () => {
    const compare = defaultOutcomeComparator(toyEmbedder, 0.8);
    expect(await compare('A x', 'B y')).toBe(true); // orthogonal
    expect(await compare('A x', 'A y')).toBe(false); // identical direction
  });

  it('probeFlipped = strict majority of samples', () => {
    const stats = (flips: number, samples: number): AblationRunStats => ({
      samples,
      flips,
      similarity: { mean: 0, min: 0, max: 0, stdev: 0 },
    });
    expect(probeFlipped(stats(2, 3))).toBe(true);
    expect(probeFlipped(stats(1, 3))).toBe(false);
    expect(probeFlipped(stats(1, 2))).toBe(false); // a tie is not a majority
    expect(probeFlipped(stats(2, 2))).toBe(true);
  });
});

// ── verdictFor (the §B2 claim tiers) ─────────────────────────────────

describe('verdictFor — claim discipline (§B2)', () => {
  const stats = (flips: number, samples = 3): AblationRunStats => ({
    samples,
    flips,
    similarity: { mean: 0.5, min: 0.4, max: 0.6, stdev: 0.1 },
  });

  it('majority flips on a stable baseline → confirmed, phrased CAUSAL with variance', () => {
    const verdict = verdictFor("injection 'vip'", stats(3), true);
    expect(verdict.verdict).toBe('confirmed');
    expect(verdict.claim).toContain('CAUSAL');
    expect(verdict.claim).toContain('3/3');
    expect(verdict.claim).toContain('±');
  });

  it('zero flips → not-confirmed, phrased as proxy-only', () => {
    const verdict = verdictFor("tool 'lookup'", stats(0), true);
    expect(verdict.verdict).toBe('not-confirmed');
    expect(verdict.claim).toContain('correlational proxy');
  });

  it('minority flips → inconclusive; unstable baseline forces inconclusive', () => {
    expect(verdictFor('x', stats(1), true).verdict).toBe('inconclusive');
    const unstable = verdictFor('x', stats(3), false);
    expect(unstable.verdict).toBe('inconclusive');
    expect(unstable.claim).toContain('baseline');
  });
});
