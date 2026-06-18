/**
 * Two-score localization — the COST score (proposal 004).
 *
 * One ablation re-run, two independent readouts: the flip `verdict` (quality)
 * and the `cost` verdict (loops/tokens saved on removal). The cost score is a
 * WEAKER, gated tier: placebo control (leave-one-out over non-flipping pieces) +
 * stability (consistent reduction), and it shows necessity-for-the-cost, never
 * "wasted". Classifies each suspect on the 2×2.
 *
 * Convention-3 coverage: unit · functional · integration · property · security ·
 * performance · load.
 */
import { describe, expect, it } from 'vitest';
import {
  assignCostVerdicts,
  classifySuspect,
  costStatsFrom,
  median,
  runAblationProbe,
  type AblationRunStats,
  type Embedder,
  type Suspect,
} from '../../../src/lib/context-bisect/index';
import { classifySuspect as viaObserve } from '../../../src/observe';

// Deterministic toy embedder ('A…' / 'B…' orthogonal) — matches ablation.test.ts.
const toyEmbedder: Embedder = {
  dimensions: 2,
  embed: async ({ text }) => (text.startsWith('A') ? [1, 0] : [0, 1]),
};

/** Build a minimal Suspect with a flip verdict + optional cost reruns. */
function mkSuspect(
  source: string,
  opts: {
    flipped?: boolean;
    loopsMedian?: number;
    loopsMax?: number;
    tokensMedian?: number;
    noCost?: boolean;
  } = {},
): Suspect {
  const flips = opts.flipped ? 2 : 0;
  const base = {
    source,
    stageName: source,
    kind: 'injection' as const,
    detail: { injectionId: source },
    score: 0.5,
    structuralScore: 0.5,
    hasContentEvidence: true,
    edgePath: [],
    ablation: { kind: 'injection' as const, excludeInjectionIds: [source] },
    verdict: {
      verdict: opts.flipped ? ('confirmed' as const) : ('not-confirmed' as const),
      claim: '',
    },
  };
  const sim = { mean: 0, min: 0, max: 0, stdev: 0 };
  if (opts.noCost) return { ...base, runs: { samples: 2, flips, similarity: sim } };
  const lm = opts.loopsMedian ?? 0;
  return {
    ...base,
    runs: {
      samples: 2,
      flips,
      similarity: sim,
      cost: {
        samples: 2,
        loops: { median: lm, min: lm, max: opts.loopsMax ?? lm },
        ...(opts.tokensMedian !== undefined
          ? {
              tokens: { median: opts.tokensMedian, min: opts.tokensMedian, max: opts.tokensMedian },
            }
          : {}),
      },
    },
  };
}

const baseline = (loopsMedian: number, tokensMedian?: number): AblationRunStats => ({
  samples: 2,
  flips: 0,
  similarity: { mean: 1, min: 1, max: 1, stdev: 0 },
  cost: {
    samples: 2,
    loops: { median: loopsMedian, min: loopsMedian, max: loopsMedian },
    ...(tokensMedian !== undefined
      ? { tokens: { median: tokensMedian, min: tokensMedian, max: tokensMedian } }
      : {}),
  },
});

const costOf = (s: Suspect) => s.cost;

// ─── 1. UNIT ─────────────────────────────────────────────────────────
describe('unit — median, costStatsFrom, classifySuspect', () => {
  it('median: odd, even, empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it('costStatsFrom: undefined when no cost; ranges otherwise', () => {
    expect(costStatsFrom(2, [], [])).toBeUndefined();
    const cs = costStatsFrom(3, [4, 2, 2], [100, 120, 110])!;
    expect(cs.samples).toBe(3);
    expect(cs.loops).toEqual({ median: 2, min: 2, max: 4 });
    expect(cs.tokens).toEqual({ median: 110, min: 100, max: 120 });
  });

  it('classifySuspect covers all four cells', () => {
    const cell = (flipped: boolean, reduced: boolean) =>
      classifySuspect({
        ...mkSuspect('x', { flipped }),
        cost: { reducedCostOnRemoval: reduced, loopsSaved: 1, tokensSaved: 0, stable: reduced },
      });
    expect(cell(true, true)).toBe('both');
    expect(cell(true, false)).toBe('content-bug');
    expect(cell(false, true)).toBe('cost-cause');
    expect(cell(false, false)).toBe('no-detected-effect');
  });
});

// ─── 2. FUNCTIONAL — runAblationProbe reads cost from the same reruns ─
describe('functional — cost capture in runAblationProbe', () => {
  it('captures loops/tokens when the runner returns { output, cost }', async () => {
    const stats = await runAblationProbe(
      {
        embedder: toyEmbedder,
        rerun: {
          runner: async (_s, run) => ({
            output: 'A same',
            cost: { loops: 3 + run.seed, tokens: 100 },
          }),
          originalOutput: 'A original',
          samples: 3,
        },
      },
      [],
    );
    expect(stats.cost).toBeDefined();
    expect(stats.cost!.loops).toEqual({ median: 4, min: 3, max: 5 });
    expect(stats.cost!.tokens).toEqual({ median: 100, min: 100, max: 100 });
  });

  it('a bare-string runner reports NO cost (quality-only, unchanged)', async () => {
    const stats = await runAblationProbe(
      {
        embedder: toyEmbedder,
        rerun: { runner: async () => 'A same', originalOutput: 'A original', samples: 2 },
      },
      [],
    );
    expect(stats.cost).toBeUndefined();
    expect(stats.flips).toBe(0);
  });
});

// ─── 3. INTEGRATION — the full cost pipeline (probe → assign → classify) ─
describe('integration — assignCostVerdicts + the 2×2', () => {
  it('classifies content-bug / both / cost-cause / no-detected-effect', () => {
    // baseline 6 loops. 'both' saves 4, 'silent' saves 3 (distinct so each beats its
    // leave-one-out band — the placebo is conservative, see cost.ts limitation note).
    const suspects = [
      mkSuspect('content', { flipped: true, loopsMedian: 6 }), // flips, no cost
      mkSuspect('both', { flipped: true, loopsMedian: 2, loopsMax: 2 }), // flips + saves 4
      mkSuspect('silent', { flipped: false, loopsMedian: 3, loopsMax: 3 }), // saves 3, no flip
      mkSuspect('innocentA', { flipped: false, loopsMedian: 6 }), // placebo (saves 0)
      mkSuspect('innocentB', { flipped: false, loopsMedian: 6 }), // placebo (saves 0)
    ];
    const out = assignCostVerdicts(suspects, baseline(6));
    const cls = Object.fromEntries(out.map((s) => [s.source, classifySuspect(s)]));
    expect(cls.content).toBe('content-bug');
    expect(cls.both).toBe('both');
    expect(cls.silent).toBe('cost-cause'); // the silent decision bug
    expect(cls.innocentA).toBe('no-detected-effect');
    expect(out.find((s) => s.source === 'silent')!.cost!.loopsSaved).toBe(3);
  });

  it('PLACEBO gate: a saving that does not beat the non-flipping band is NOT a cost cause', () => {
    // A and B (both innocent) each save 2 — leave-one-out, neither beats the other.
    const out = assignCostVerdicts(
      [
        mkSuspect('A', { flipped: false, loopsMedian: 3, loopsMax: 3 }),
        mkSuspect('B', { flipped: false, loopsMedian: 3, loopsMax: 3 }),
      ],
      baseline(5),
    );
    for (const s of out) {
      expect(costOf(s)!.reducedCostOnRemoval).toBe(false);
      expect(classifySuspect(s)).toBe('no-detected-effect');
    }
  });

  it('STABILITY gate: an inconsistent reduction (a seed used MORE than baseline) is not stable', () => {
    const out = assignCostVerdicts(
      [
        mkSuspect('jumpy', { flipped: false, loopsMedian: 2, loopsMax: 6 }), // median saves but max > baseline
        mkSuspect('innocent', { flipped: false, loopsMedian: 5 }),
      ],
      baseline(5),
    );
    const jumpy = out.find((s) => s.source === 'jumpy')!;
    expect(jumpy.cost!.stable).toBe(false);
    expect(jumpy.cost!.reducedCostOnRemoval).toBe(false);
  });

  it('NO placebo band (the only non-flipper is the candidate) → stable false', () => {
    const out = assignCostVerdicts(
      [mkSuspect('lonely', { flipped: false, loopsMedian: 2, loopsMax: 2 })],
      baseline(5),
    );
    expect(out[0].cost!.stable).toBe(false);
    expect(out[0].cost!.reducedCostOnRemoval).toBe(false);
  });
});

// ─── 4. PROPERTY ─────────────────────────────────────────────────────
describe('property', () => {
  it('classifySuspect is a pure function of (flips, costCause&stable) for all combos', () => {
    for (const flipped of [true, false]) {
      for (const reduced of [true, false]) {
        const c = classifySuspect({
          ...mkSuspect('p', { flipped }),
          cost: { reducedCostOnRemoval: reduced, loopsSaved: 1, tokensSaved: 0, stable: reduced },
        });
        const expected = flipped
          ? reduced
            ? 'both'
            : 'content-bug'
          : reduced
          ? 'cost-cause'
          : 'no-detected-effect';
        expect(c).toBe(expected);
      }
    }
  });

  it('assignCostVerdicts never adds cost to a suspect with no rerun cost', () => {
    const out = assignCostVerdicts(
      [mkSuspect('q', { noCost: true }), mkSuspect('r', { loopsMedian: 1 })],
      baseline(3),
    );
    expect(out.find((s) => s.source === 'q')!.cost).toBeUndefined();
    expect(out.find((s) => s.source === 'r')!.cost).toBeDefined();
  });
});

// ─── 5. SECURITY / robustness ────────────────────────────────────────
describe('security & robustness', () => {
  it('baseline without loop cost → loopsSaved 0, not a cost cause (no false positive)', () => {
    const noLoopBaseline: AblationRunStats = {
      samples: 2,
      flips: 0,
      similarity: { mean: 1, min: 1, max: 1, stdev: 0 },
    };
    const out = assignCostVerdicts(
      [
        mkSuspect('x', { flipped: false, loopsMedian: 2 }),
        mkSuspect('y', { flipped: false, loopsMedian: 5 }),
      ],
      noLoopBaseline,
    );
    for (const s of out) expect(s.cost!.reducedCostOnRemoval).toBe(false);
  });

  it('empty suspects → empty result', () => {
    expect(assignCostVerdicts([], baseline(5))).toEqual([]);
  });

  it('observe re-export is the same function', () => {
    expect(viaObserve).toBe(classifySuspect);
  });
});

// ─── 6. PERFORMANCE + 7. LOAD ────────────────────────────────────────
describe('performance & load', () => {
  it('assignCostVerdicts over 300 suspects is prompt', () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      mkSuspect(`s${i}`, { flipped: i % 7 === 0, loopsMedian: i % 3, loopsMax: i % 3 }),
    );
    const t0 = performance.now();
    const out = assignCostVerdicts(many, baseline(4));
    expect(out.length).toBe(300);
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('sustains many classify calls', () => {
    const s = {
      ...mkSuspect('z', { flipped: true }),
      cost: { reducedCostOnRemoval: true, loopsSaved: 2, tokensSaved: 9, stable: true },
    };
    for (let i = 0; i < 5000; i++) expect(classifySuspect(s)).toBe('both');
  });
});
