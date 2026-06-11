/**
 * bisectCulprits (RFC-003 D9) — functional / multi-culprit / honesty /
 * budget tiers.
 *
 * The runner here is synthetic: a rule decides which ablation SETS flip
 * the outcome, so each algorithmic path (single culprit, independent
 * culprits, joint/redundant culprits, not-reproducible, unstable
 * baseline, budget exhaustion) is exercised deterministically.
 */
import { describe, expect, it } from 'vitest';

import {
  bisectCulprits,
  suspectLabel,
  type AblationSpec,
  type Embedder,
  type Suspect,
} from '../../../src/lib/context-bisect';

/** Toy embedder: WRONG-prefixed and RIGHT-prefixed outputs are orthogonal. */
const toyEmbedder: Embedder = {
  dimensions: 2,
  embed: async ({ text }) => (text.startsWith('WRONG') ? [1, 0] : [0, 1]),
};

function injectionSuspect(id: string, score: number): Suspect {
  return {
    source: `context#${id}`,
    stageName: 'Context',
    kind: 'injection',
    detail: { injectionId: id },
    score,
    structuralScore: score,
    edgePath: [],
    ablation: { kind: 'injection', excludeInjectionIds: [id] },
  };
}

/** Runner factory: `flips(excludedIds)` decides whether the output flips. */
function makeRunner(flips: (excluded: ReadonlySet<string>) => boolean) {
  let calls = 0;
  const runner = async (specs: readonly AblationSpec[]): Promise<string> => {
    calls++;
    const excluded = new Set<string>();
    for (const spec of specs) {
      if (spec.kind === 'injection') for (const id of spec.excludeInjectionIds) excluded.add(id);
    }
    return flips(excluded) ? 'RIGHT corrected output' : 'WRONG buggy output';
  };
  return { runner, callCount: () => calls };
}

const rerunWith = (runner: (specs: readonly AblationSpec[]) => Promise<string>) => ({
  runner,
  originalOutput: 'WRONG buggy output',
  samples: 2,
});

describe('bisectCulprits — single culprit', () => {
  it('isolates the one suspect whose ablation flips the outcome', async () => {
    const suspects = ['a', 'b', 'c', 'd', 'e'].map((id, i) => injectionSuspect(id, 1 - i * 0.1));
    const { runner, callCount } = makeRunner((excluded) => excluded.has('c'));
    const result = await bisectCulprits({
      suspects,
      rerun: rerunWith(runner),
      embedder: toyEmbedder,
    });
    expect(result.verdict).toBe('confirmed');
    expect(result.culprits).toHaveLength(1);
    expect(result.culprits[0].map((suspect) => suspect.detail?.injectionId)).toEqual(['c']);
    // Variance discipline: every probe ran N seeded reruns; runsUsed adds up.
    expect(result.probes[0].ablated).toEqual([]); // baseline first
    for (const probe of result.probes) expect(probe.stats.samples).toBe(2);
    expect(result.runsUsed).toBe(result.probes.length * 2);
    expect(callCount()).toBe(result.runsUsed);
  });
});

describe('bisectCulprits — multi-culprit', () => {
  it('joint culprits (redundant causes): flips only when BOTH are ablated → one minimal set {a, b}', async () => {
    const suspects = ['a', 'b', 'c', 'd'].map((id, i) => injectionSuspect(id, 1 - i * 0.1));
    const { runner } = makeRunner((excluded) => excluded.has('a') && excluded.has('b'));
    const result = await bisectCulprits({
      suspects,
      rerun: rerunWith(runner),
      embedder: toyEmbedder,
    });
    expect(result.verdict).toBe('confirmed');
    expect(result.culprits).toHaveLength(1);
    expect(new Set(result.culprits[0].map((suspect) => suspect.detail?.injectionId))).toEqual(
      new Set(['a', 'b']),
    );
  });

  it('independent culprits: either ablation flips alone → two minimal sets {a}, {c}', async () => {
    const suspects = ['a', 'b', 'c', 'd'].map((id, i) => injectionSuspect(id, 1 - i * 0.1));
    const { runner } = makeRunner((excluded) => excluded.has('a') || excluded.has('c'));
    const result = await bisectCulprits({
      suspects,
      rerun: rerunWith(runner),
      embedder: toyEmbedder,
    });
    expect(result.verdict).toBe('confirmed');
    const sets = result.culprits.map((set) =>
      set.map((suspect) => suspect.detail?.injectionId).sort(),
    );
    expect(sets).toContainEqual(['a']);
    expect(sets).toContainEqual(['c']);
  });
});

describe('bisectCulprits — honest exits', () => {
  it('not-reproducible: ablating every ranked suspect never flips', async () => {
    const suspects = ['a', 'b'].map((id, i) => injectionSuspect(id, 1 - i * 0.1));
    const { runner } = makeRunner(() => false);
    const result = await bisectCulprits({
      suspects,
      rerun: rerunWith(runner),
      embedder: toyEmbedder,
    });
    expect(result.verdict).toBe('not-reproducible');
    expect(result.culprits).toHaveLength(0);
  });

  it('unstable baseline → inconclusive (no probe trusted)', async () => {
    const suspects = [injectionSuspect('a', 1)];
    const { runner } = makeRunner(() => true); // even the baseline "flips"
    const result = await bisectCulprits({
      suspects,
      rerun: rerunWith(runner),
      embedder: toyEmbedder,
    });
    expect(result.verdict).toBe('inconclusive');
    expect(result.culprits).toHaveLength(0);
    expect(result.probes).toHaveLength(1); // stopped right after the baseline
  });

  it('a 1-in-3-flaky baseline is ZERO-TOLERANCE inconclusive — never a confirmed causal verdict (review Finding 1)', async () => {
    // The majority-rule gate would pass a 33%-flaky baseline through to a
    // 'confirmed' verdict; the §B2 discipline forbids it. One un-ablated
    // flip = the scenario can't support causal claims.
    const suspects = [injectionSuspect('a', 1)];
    let baselineCalls = 0;
    const { runner } = makeRunner((ablated) => {
      if (ablated.length === 0) {
        baselineCalls += 1;
        return baselineCalls === 2; // flips exactly once in the baseline probes
      }
      return true; // the ablation would "flip" — must never be reached as confirmed
    });
    const result = await bisectCulprits({
      suspects,
      rerun: rerunWith(runner),
      embedder: toyEmbedder,
    });
    expect(result.verdict).toBe('inconclusive');
    expect(result.culprits).toHaveLength(0);
  });

  it('probe budget exhausted → inconclusive, probes capped, no dressed-up partial claim', async () => {
    const suspects = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, i) =>
      injectionSuspect(id, 1 - i * 0.05),
    );
    const { runner } = makeRunner((excluded) => excluded.has('h'));
    const result = await bisectCulprits({
      suspects,
      rerun: rerunWith(runner),
      embedder: toyEmbedder,
      maxProbes: 3,
    });
    expect(result.verdict).toBe('inconclusive');
    expect(result.probes.length).toBeLessThanOrEqual(3);
  });

  it('suspects without applicable specs (stage/arg) are skipped entirely', async () => {
    const suspects: Suspect[] = [
      {
        source: 'route#1',
        stageName: 'Route',
        kind: 'stage',
        score: 1,
        structuralScore: 1,
        edgePath: [],
      },
      {
        source: 'seed#0',
        stageName: 'Seed',
        kind: 'arg',
        score: 1,
        structuralScore: 1,
        edgePath: [],
        ablation: { kind: 'arg', source: 'seed#0', note: 'override the input' },
      },
    ];
    const { runner, callCount } = makeRunner(() => false);
    const result = await bisectCulprits({
      suspects,
      rerun: rerunWith(runner),
      embedder: toyEmbedder,
    });
    // Baseline probe only — no candidates to reproduce with.
    expect(result.verdict).toBe('not-reproducible');
    expect(callCount()).toBe(2);
  });
});

describe('bisectCulprits — probe caching', () => {
  it('never re-runs the same ablation set (cached by spec-set key)', async () => {
    const suspects = ['a', 'b', 'c'].map((id, i) => injectionSuspect(id, 1 - i * 0.1));
    const probedSets: string[] = [];
    const { runner } = makeRunner((excluded) => excluded.has('a'));
    const trackingRunner = async (specs: readonly AblationSpec[]) => {
      probedSets.push(
        specs
          .flatMap((spec) => (spec.kind === 'injection' ? spec.excludeInjectionIds : []))
          .sort()
          .join('|'),
      );
      return runner(specs);
    };
    const result = await bisectCulprits({
      suspects,
      rerun: rerunWith(trackingRunner),
      embedder: toyEmbedder,
    });
    expect(result.verdict).toBe('confirmed');
    // Each distinct set appears exactly `samples` (=2) times — never more.
    const counts = new Map<string, number>();
    for (const key of probedSets) counts.set(key, (counts.get(key) ?? 0) + 1);
    for (const [, count] of counts) expect(count).toBe(2);
  });
});

describe('suspectLabel — unit', () => {
  it('prefers tool name, then injection id, then the step id', () => {
    expect(suspectLabel(injectionSuspect('vip', 1))).toBe("injection 'vip'");
    expect(
      suspectLabel({
        source: 's#1',
        stageName: 'S',
        kind: 'tool',
        detail: { toolName: 'lookup' },
        score: 1,
        structuralScore: 1,
        edgePath: [],
      }),
    ).toBe("tool 'lookup'");
    expect(
      suspectLabel({
        source: 's#1',
        stageName: 'S',
        kind: 'stage',
        score: 1,
        structuralScore: 1,
        edgePath: [],
      }),
    ).toBe("stage 's#1'");
  });
});
