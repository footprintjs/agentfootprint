/**
 * Strategy arms — the SUBSTITUTION tier (`src/lib/context-bisect/arms/`).
 *
 * Sections follow Convention 3: Functional (refusals, manifest algebra, the
 * probe, the verdict tiers) · Integration (real agents, real
 * `agentfootprint.agent.run_configured` manifests, the mis-wired experiment the
 * manifest catches) · Security & containment (an arm carries names, and a
 * verdict is refused rather than guessed) · Edge (degenerate bands, sample
 * clamping, absent manifests) · Regression (the null band actually gates, and
 * only on the axis it measures).
 */

import { describe, expect, it } from 'vitest';

import {
  applyArm,
  armConfigKey,
  armFacetsFromManifest,
  armLabel,
  checkArmApplication,
  checkArmApplied,
  collectArmRuns,
  compareStrategyArms,
  manifestFromEvents,
  matchArm,
  nullBandFrom,
  scoreArmRuns,
  validateStrategyArms,
  verdictForArm,
  type AblationRunStats,
  type ArmRunner,
  type Embedder,
  type NullBand,
  type RunManifestLike,
  type StrategyArm,
} from '../../../src/lib/context-bisect';
import { Agent } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import type { AgentfootprintEvent } from '../../../src/events/registry.js';

/**
 * A deterministic embedder whose cosine to the reference is WRITTEN IN THE
 * TEXT: `sim:0.79 …` embeds to a unit vector whose cosine with `sim:1 …` is
 * exactly 0.79. Band arithmetic is then readable off the fixture instead of
 * being an emergent property of some toy vocabulary.
 */
const cosEmbedder: Embedder = {
  dimensions: 2,
  embed: async ({ text }) => {
    const match = /^sim:([0-9.]+)/.exec(text);
    const x = match !== null ? Number(match[1]) : 0;
    return [x, Math.sqrt(Math.max(0, 1 - x * x))];
  },
};

const REFERENCE = 'sim:1 the original answer';

/** A runner scripted per arm: armId → the answer for each seed, in seed order. */
function scriptedRunner(
  script: Record<string, readonly string[]>,
  extra?: (armId: string, seed: number) => { manifest?: RunManifestLike; cost?: { loops: number } },
): ArmRunner {
  return async (arm, { seed }) => {
    const answers = script[arm.id];
    if (answers === undefined) throw new Error(`no script for arm '${arm.id}'`);
    const output = answers[seed % answers.length];
    const more = extra?.(arm.id, seed);
    return more === undefined ? output : { output, ...more };
  };
}

const TOP_K: StrategyArm = { id: 'topK', facets: { memory: { retrieval: 'topK' } } };
const RERANK: StrategyArm = { id: 'rerank', facets: { memory: { retrieval: 'rerank' } } };

// ═══ 1. FUNCTIONAL — the refusals ════════════════════════════════════

describe('validateStrategyArms — teaching refusals, all before the first model call', () => {
  it('one arm is not a comparison — and it names the door that IS', () => {
    expect(() => validateStrategyArms([TOP_K], undefined)).toThrow(/at least two arms/);
    expect(() => validateStrategyArms([TOP_K], undefined)).toThrow(/runAblationProbe/);
  });

  it('a blank or duplicated id makes the readout unreadable', () => {
    expect(() =>
      validateStrategyArms([{ id: '  ', facets: { model: 'a' } }, TOP_K], undefined),
    ).toThrow(/non-empty id/);
    expect(() =>
      validateStrategyArms([TOP_K, { id: 'topK', facets: { model: 'a' } }], undefined),
    ).toThrow(/share the id 'topK'/);
  });

  it('an unknown baselineArmId lists the arms it could have meant', () => {
    expect(() => validateStrategyArms([TOP_K, RERANK], 'nope')).toThrow(/\[topK, rerank\]/);
  });

  it('a challenger that declares nothing cannot be told apart from the baseline', () => {
    expect(() => validateStrategyArms([TOP_K, { id: 'other' }], undefined)).toThrow(
      /declares no configuration/,
    );
    // …but the BASELINE arm may declare nothing: "the configuration as it stands".
    expect(validateStrategyArms([{ id: 'as-is' }, RERANK], undefined)).toBe('as-is');
  });

  it('THE incoherent spec: two arms that are the same arm', () => {
    expect(() =>
      validateStrategyArms(
        [TOP_K, { id: 'also-topK', facets: { memory: { retrieval: 'topK' } } }],
        undefined,
      ),
    ).toThrow(/declare the SAME configuration/);
    // The message teaches what the caller actually wanted.
    expect(() =>
      validateStrategyArms(
        [TOP_K, { id: 'also-topK', facets: { memory: { retrieval: 'topK' } } }],
        undefined,
      ),
    ).toThrow(/raise `samples` on a single arm/);
  });

  it('the default baseline is the first arm', () => {
    expect(validateStrategyArms([TOP_K, RERANK], undefined)).toBe('topK');
    expect(validateStrategyArms([TOP_K, RERANK], 'rerank')).toBe('rerank');
  });
});

describe('armConfigKey — sameness is about configuration, not authoring order', () => {
  it('field order and spec-list order do not make a new arm', () => {
    const a: StrategyArm = {
      id: 'a',
      facets: { model: 'm', scorer: 's' },
      ablations: [{ kind: 'tool', ignoredTools: ['x', 'y'] }],
    };
    const b: StrategyArm = {
      id: 'b',
      facets: { scorer: 's', model: 'm' },
      ablations: [{ kind: 'tool', ignoredTools: ['y', 'x'] }],
    };
    expect(armConfigKey(a)).toBe(armConfigKey(b));
  });

  it('a real difference is a real difference', () => {
    expect(armConfigKey(TOP_K)).not.toBe(armConfigKey(RERANK));
  });
});

// ═══ 2. FUNCTIONAL — the manifest algebra ════════════════════════════

const MANIFEST: RunManifestLike = {
  agentId: 'agent',
  llm: { provider: 'mock', model: 'fast' },
  reactMode: 'dynamic',
  memories: [{ id: 'docs', type: 'semantic', strategy: 'topK', retrieval: 'rerank' }],
  window: 'slidingWindow',
  skillGraph: { routing: 'guard', continuity: 'turn', scorer: 'keyword' },
};

describe('the manifest bridge', () => {
  it('projects a manifest onto the facet vocabulary and labels it stably', () => {
    const facets = armFacetsFromManifest(MANIFEST);
    expect(facets.provider).toBe('mock');
    expect(facets.model).toBe('fast');
    expect(facets.scorer).toBe('keyword');
    expect(facets.memory?.retrieval).toBe('rerank');
    // Sorted `k=v` — the same configuration always renders the same string.
    expect(armLabel(facets)).toBe(
      'continuity=turn,memory.id=docs,memory.retrieval=rerank,memory.strategy=topK,' +
        'memory.type=semantic,model=fast,provider=mock,reactMode=dynamic,routing=guard,' +
        'scorer=keyword,window=slidingWindow',
    );
  });

  it('only DECLARED facets are compared — an arm claims what it names', () => {
    expect(checkArmApplied(RERANK, MANIFEST)).toEqual([]);
    expect(checkArmApplied({ id: 'x', facets: { model: 'fast' } }, MANIFEST)).toEqual([]);
  });

  it('a contradiction is reported with declared AND observed', () => {
    expect(checkArmApplied(TOP_K, MANIFEST)).toEqual([
      {
        facet: 'memory',
        declared: 'memory.retrieval=topK',
        observed: expect.stringContaining('memory.retrieval=rerank'),
      },
    ]);
    expect(checkArmApplied({ id: 'x', facets: { model: 'slow' } }, MANIFEST)).toEqual([
      { facet: 'model', declared: 'slow', observed: 'fast' },
    ]);
  });

  it('ABSENCE is a contradiction, not a wildcard — the manifest says "not configured"', () => {
    const noWindow: RunManifestLike = { llm: { provider: 'mock', model: 'fast' }, memories: [] };
    const mismatches = checkArmApplied({ id: 'x', facets: { window: 'tokenBudget' } }, noWindow);
    expect(mismatches).toEqual([{ facet: 'window', declared: 'tokenBudget' }]);
    expect(mismatches[0].observed).toBeUndefined();
  });

  it('memory.id narrows to ONE row; without it any row may satisfy the claim', () => {
    const twoMemories: RunManifestLike = {
      memories: [
        { id: 'chat', retrieval: 'topK' },
        { id: 'docs', retrieval: 'rerank' },
      ],
    };
    expect(
      checkArmApplied({ id: 'x', facets: { memory: { retrieval: 'rerank' } } }, twoMemories),
    ).toEqual([]);
    expect(
      checkArmApplied(
        { id: 'x', facets: { memory: { id: 'chat', retrieval: 'rerank' } } },
        twoMemories,
      ),
    ).toEqual([{ facet: 'memory.retrieval', declared: 'rerank', observed: 'topK' }]);
    expect(checkArmApplied({ id: 'x', facets: { memory: { id: 'ghost' } } }, twoMemories)).toEqual([
      { facet: 'memory.id', declared: 'ghost', observed: 'chat, docs' },
    ]);
  });

  it('matchArm classifies a run by what the RUN says, most-specific first', () => {
    expect(matchArm([TOP_K, RERANK], MANIFEST)?.id).toBe('rerank');
    // More facets = more specific; the vaguer arm loses.
    const specific: StrategyArm = {
      id: 'rerank-fast',
      facets: { model: 'fast', memory: { retrieval: 'rerank' } },
    };
    expect(matchArm([RERANK, specific], MANIFEST)?.id).toBe('rerank-fast');
  });

  it('matchArm refuses to guess: a tie and an arm declaring nothing both yield undefined', () => {
    const tie: StrategyArm = { id: 'by-model', facets: { model: 'fast' } };
    const tie2: StrategyArm = { id: 'by-scorer', facets: { scorer: 'keyword' } };
    expect(matchArm([tie, tie2], MANIFEST)).toBeUndefined();
    expect(matchArm([{ id: 'anything' }], MANIFEST)).toBeUndefined();
    expect(matchArm([TOP_K], MANIFEST)).toBeUndefined();
  });

  it('manifestFromEvents finds the one manifest in a run’s captured events', () => {
    const events = [
      { type: 'agentfootprint.agent.turn_start', payload: {}, meta: { runtimeStageId: 'seed#0' } },
      {
        type: 'agentfootprint.agent.run_configured',
        payload: MANIFEST,
        meta: { runtimeStageId: 'run-configured#0' },
      },
    ];
    expect(manifestFromEvents(events)?.llm?.model).toBe('fast');
    expect(manifestFromEvents([])).toBeUndefined();
    expect(manifestFromEvents(undefined)).toBeUndefined();
  });
});

describe('checkArmApplication — absence of evidence is not evidence of absence', () => {
  it('no manifest reported → checked:false, and no arm is punished for it', () => {
    const app = checkArmApplication(RERANK, []);
    expect(app).toEqual({ manifestsSeen: 0, checked: false, applied: false, mismatches: [] });
  });

  it('an arm of pure removals declares nothing a manifest names → checked:false', () => {
    const removalArm: StrategyArm = {
      id: 'no-lookup',
      ablations: [{ kind: 'tool', ignoredTools: ['lookup'] }],
    };
    expect(checkArmApplication(removalArm, [MANIFEST]).checked).toBe(false);
  });

  it('EVERY run must agree — one contradicting seed is enough', () => {
    const wrong: RunManifestLike = { memories: [{ id: 'docs', retrieval: 'topK' }] };
    const app = checkArmApplication(RERANK, [MANIFEST, MANIFEST, wrong]);
    expect(app.checked).toBe(true);
    expect(app.applied).toBe(false);
    expect(app.mismatches).toHaveLength(1);
  });
});

// ═══ 3. FUNCTIONAL — probe + verdict tiers ═══════════════════════════

describe('collectArmRuns / scoreArmRuns — the shared statistics', () => {
  it('calls the runner once per seed (0..N-1) and normalizes both return shapes', async () => {
    const seeds: number[] = [];
    const runs = await collectArmRuns(
      RERANK,
      async (_arm, { seed }) => {
        seeds.push(seed);
        return seed === 0
          ? 'sim:1 plain string'
          : { output: 'sim:0.5 rich', cost: { loops: 2 }, manifest: MANIFEST };
      },
      3,
    );
    expect(seeds).toEqual([0, 1, 2]);
    expect(runs.answers).toHaveLength(3);
    expect(runs.loops).toEqual([2, 2]);
    expect(runs.manifests).toHaveLength(2);
  });

  it('scores similarity + flips against the reference, variance always reported', async () => {
    const runs = await collectArmRuns(
      RERANK,
      async (_arm, { seed }) => ['sim:1 a', 'sim:0.2 b', 'sim:0.2 c'][seed],
      3,
    );
    const stats = await scoreArmRuns(runs, REFERENCE, cosEmbedder, async (_o, a) =>
      a.startsWith('sim:0.2'),
    );
    expect(stats.samples).toBe(3);
    expect(stats.flips).toBe(2);
    expect(stats.similarity.max).toBeCloseTo(1, 5);
    expect(stats.similarity.min).toBeCloseTo(0.2, 5);
    expect(stats.similarity.stdev).toBeGreaterThan(0);
  });
});

describe('verdictForArm — the tiers, in refusal order', () => {
  const stats = (flips: number, mean: number, samples = 3): AblationRunStats => ({
    samples,
    flips,
    similarity: { mean, min: mean, max: mean, stdev: 0.05 },
  });
  const band = (floor: number, gates = true): NullBand => ({
    baselineArmId: 'topK',
    similarity: { mean: floor, min: floor, max: 1, stdev: 0.05 },
    floor,
    degenerate: false,
    gates,
    note: '',
  });
  const ctx = (over: Partial<Parameters<typeof verdictForArm>[2]> = {}) => ({
    baselineArmId: 'topK',
    baselineStable: true,
    baselineStats: stats(0, 1),
    band: band(0.9),
    outsideNullBand: true,
    application: { manifestsSeen: 0, checked: false, applied: false, mismatches: [] },
    ...over,
  });

  it('1. an unstable baseline outranks every other finding', () => {
    const v = verdictForArm(
      'rerank',
      stats(3, 0.1),
      ctx({ baselineStable: false, baselineStats: stats(1, 0.5) }),
    );
    expect(v.verdict).toBe('inconclusive');
    expect(v.claim).toContain("baseline arm 'topK' did not reproduce");
    expect(v.claim).toContain('1/3');
  });

  it('2. an arm the manifest contradicts gets no verdict, and the claim names the facet', () => {
    const v = verdictForArm(
      'rerank',
      stats(3, 0.1),
      ctx({
        application: {
          manifestsSeen: 3,
          checked: true,
          applied: false,
          mismatches: [{ facet: 'memory.retrieval', declared: 'rerank', observed: 'topK' }],
        },
      }),
    );
    expect(v.verdict).toBe('inconclusive');
    expect(v.claim).toContain('memory.retrieval=rerank');
    expect(v.claim).toContain('did not take effect');
  });

  it('3. a majority flip INSIDE the band is not separable from noise', () => {
    const v = verdictForArm('rerank', stats(2, 0.95), ctx({ outsideNullBand: false }));
    expect(v.verdict).toBe('inconclusive');
    expect(v.claim).toContain('INSIDE the baseline');
  });

  it('4. majority + outside band + stable baseline = the causal tier, scenario-bounded', () => {
    const v = verdictForArm('rerank', stats(3, 0.1), ctx());
    expect(v.verdict).toBe('confirmed');
    expect(v.claim).toContain('CAUSAL');
    expect(v.claim).toContain('3/3');
    expect(v.claim).toContain('±');
    expect(v.claim).toContain('Bounded by this scenario');
  });

  it('5. minority flips and 6. no flips', () => {
    expect(verdictForArm('rerank', stats(1, 0.5), ctx()).verdict).toBe('inconclusive');
    const none = verdictForArm('rerank', stats(0, 1), ctx());
    expect(none.verdict).toBe('not-confirmed');
    // Never "the strategies are the same" — a finding about THIS scenario.
    expect(none.claim).toContain('not about the strategies');
  });
});

describe('nullBandFrom — what "placebo" means for a substitution', () => {
  const stats = (min: number, stdev: number): AblationRunStats => ({
    samples: 3,
    flips: 0,
    similarity: { mean: min, min, max: 1, stdev },
  });

  it('the floor is the baseline arm’s own worst reproduction', () => {
    const band = nullBandFrom('topK', stats(0.82, 0.05), true);
    expect(band.floor).toBeCloseTo(0.82, 5);
    expect(band.degenerate).toBe(false);
    expect(band.gates).toBe(true);
    expect(band.note).toContain('further from the reference');
  });

  it('a perfectly reproducible baseline yields a DEGENERATE band, and says so', () => {
    const band = nullBandFrom('topK', stats(1, 0), true);
    expect(band.degenerate).toBe(true);
    expect(band.note).toContain('only as strong as the determinism');
  });

  it('a custom comparator turns the band into a REPORT, never a veto', () => {
    const band = nullBandFrom('topK', stats(0.82, 0.05), false);
    expect(band.gates).toBe(false);
    expect(band.note).toContain('Reported, not applied');
  });
});

// ═══ 4. FUNCTIONAL — the product loop ════════════════════════════════

describe('compareStrategyArms', () => {
  it('WORKED EXAMPLE: topK vs rerank — the challenger really answers differently', async () => {
    const result = await compareStrategyArms({
      arms: [TOP_K, RERANK],
      baselineArmId: 'topK',
      originalAnswer: REFERENCE,
      embedder: cosEmbedder,
      samples: 3,
      runner: scriptedRunner({
        topK: ['sim:1 a', 'sim:1 b', 'sim:1 c'],
        rerank: ['sim:0.2 x', 'sim:0.2 y', 'sim:0.2 z'],
      }),
    });

    expect(result.baselineStable).toBe(true);
    expect(result.reference.from).toBe('prior-run');
    expect(result.runsUsed).toBe(6); // samples × arms, no hidden baseline surcharge
    const rerank = result.arms.find((a) => a.armId === 'rerank');
    expect(rerank?.verdict?.verdict).toBe('confirmed');
    expect(rerank?.outsideNullBand).toBe(true);
    // The baseline arm is a row, not a challenger: it never judges itself.
    const baseline = result.arms.find((a) => a.isBaseline);
    expect(baseline?.verdict).toBeUndefined();
    expect(baseline?.outsideNullBand).toBe(false);
    expect(result.summary).toContain("Answered differently: 'rerank'");
  });

  it('an UNSTABLE baseline refuses every verdict — zero tolerance, one flip is enough', async () => {
    const result = await compareStrategyArms({
      arms: [TOP_K, RERANK],
      originalAnswer: REFERENCE,
      embedder: cosEmbedder,
      samples: 3,
      runner: scriptedRunner({
        // The incumbent itself wanders once. Majority-rule would have let this
        // scenario reach a causal verdict; the engine refuses instead.
        topK: ['sim:1 a', 'sim:0.2 wandered', 'sim:1 c'],
        rerank: ['sim:0.2 x', 'sim:0.2 y', 'sim:0.2 z'],
      }),
    });

    expect(result.baselineStable).toBe(false);
    expect(result.arms.find((a) => a.armId === 'rerank')?.verdict?.verdict).toBe('inconclusive');
    expect(result.summary).toContain('no arm comparison is trustworthy');
  });

  it('REGRESSION: the null band really gates — a majority flip inside it is inconclusive', async () => {
    const result = await compareStrategyArms({
      arms: [TOP_K, RERANK],
      originalAnswer: REFERENCE,
      embedder: cosEmbedder,
      samples: 3,
      runner: scriptedRunner({
        // Baseline reproduces (all ≥ 0.8) but drifts: floor 0.82.
        topK: ['sim:0.82 a', 'sim:0.82 b', 'sim:0.95 c'],
        // Challenger flips 2/3 (0.79 < 0.8) but its MEAN (0.86) is still inside
        // the incumbent's own spread.
        rerank: ['sim:0.79 x', 'sim:0.79 y', 'sim:1 z'],
      }),
    });

    expect(result.baselineStable).toBe(true);
    expect(result.nullBand.floor).toBeCloseTo(0.82, 5);
    const rerank = result.arms.find((a) => a.armId === 'rerank');
    expect(rerank?.runs.flips).toBe(2); // a MAJORITY flip …
    expect(rerank?.outsideNullBand).toBe(false); // … that the band vetoes
    expect(rerank?.verdict?.verdict).toBe('inconclusive');
  });

  it('REGRESSION: a domain comparator is never vetoed by an embedding band', async () => {
    const result = await compareStrategyArms({
      arms: [TOP_K, RERANK],
      originalAnswer: REFERENCE,
      embedder: cosEmbedder,
      samples: 3,
      // Same numbers as the test above — only the instrument changes.
      answerChanged: (_original, answer) => answer.includes('DENIED'),
      runner: scriptedRunner({
        topK: ['sim:0.82 a', 'sim:0.82 b', 'sim:0.95 c'],
        rerank: ['sim:0.79 DENIED', 'sim:0.79 DENIED', 'sim:1 z'],
      }),
    });

    expect(result.nullBand.gates).toBe(false);
    const rerank = result.arms.find((a) => a.armId === 'rerank');
    expect(rerank?.outsideNullBand).toBe(false);
    expect(rerank?.verdict?.verdict).toBe('confirmed'); // the real finding survives
  });

  it('EDGE: no prior answer → the incumbent’s seed-0 answer is the reference, and says so', async () => {
    const result = await compareStrategyArms({
      arms: [TOP_K, RERANK],
      embedder: cosEmbedder,
      samples: 2,
      runner: scriptedRunner({
        topK: ['sim:1 incumbent', 'sim:1 incumbent'],
        rerank: ['sim:0.2 challenger', 'sim:0.2 challenger'],
      }),
    });
    expect(result.reference.from).toBe('baseline-arm');
    expect(result.reference.text).toBe('sim:1 incumbent');
    expect(result.arms.find((a) => a.armId === 'rerank')?.verdict?.verdict).toBe('confirmed');
  });

  it('EDGE: samples clamp to ≥ 2 — never a single-run comparison', async () => {
    let calls = 0;
    const result = await compareStrategyArms({
      arms: [TOP_K, RERANK],
      originalAnswer: REFERENCE,
      embedder: cosEmbedder,
      samples: 1,
      runner: async () => {
        calls++;
        return 'sim:1 same';
      },
    });
    expect(calls).toBe(4); // 2 arms × clamped 2 samples
    expect(result.runsUsed).toBe(4);
    expect(result.arms[1].runs.samples).toBe(2);
  });

  it('a runner reporting cost gets the cost readout for free (one run, two readouts)', async () => {
    const result = await compareStrategyArms({
      arms: [TOP_K, RERANK],
      originalAnswer: REFERENCE,
      embedder: cosEmbedder,
      samples: 2,
      runner: scriptedRunner(
        { topK: ['sim:1 a', 'sim:1 b'], rerank: ['sim:1 a', 'sim:1 b'] },
        (armId) => ({ cost: { loops: armId === 'topK' ? 4 : 2 } }),
      ),
    });
    expect(result.arms[0].runs.cost?.loops?.median).toBe(4);
    expect(result.arms[1].runs.cost?.loops?.median).toBe(2);
  });
});

describe('applyArm — an arm’s removals ride the UNCHANGED removal machinery', () => {
  it('filters exactly as applyAblations does, and is the identity without ablations', () => {
    const targets = {
      tools: [{ schema: { name: 'lookup' } }, { schema: { name: 'search' } }],
      injections: [{ id: 'vip' }, { id: 'plain' }],
      memoryEntries: [{ id: 'm1' }],
    };
    const arm: StrategyArm = {
      id: 'no-lookup',
      facets: { memory: { retrieval: 'rerank' } },
      ablations: [
        { kind: 'tool', ignoredTools: ['lookup'] },
        { kind: 'injection', excludeInjectionIds: ['vip'] },
      ],
    };
    const out = applyArm(arm, targets);
    expect(out.tools.map((t) => t.schema.name)).toEqual(['search']);
    expect(out.injections.map((i) => i.id)).toEqual(['plain']);
    expect(applyArm(TOP_K, targets)).toEqual(targets);
  });

  it('the arm the runner receives carries its own removals', async () => {
    const seen: StrategyArm[] = [];
    await compareStrategyArms({
      arms: [TOP_K, { id: 'no-lookup', ablations: [{ kind: 'tool', ignoredTools: ['lookup'] }] }],
      originalAnswer: REFERENCE,
      embedder: cosEmbedder,
      samples: 2,
      runner: async (arm) => {
        seen.push(arm);
        return 'sim:1 same';
      },
    });
    expect(seen.filter((a) => a.id === 'no-lookup')).toHaveLength(2);
    expect(applyArm(seen[2], { tools: [{ schema: { name: 'lookup' } }] }).tools).toEqual([]);
  });
});

// ═══ 5. INTEGRATION — real agents, real manifests ════════════════════

/** Build a real agent for an arm and hand back the run's OWN manifest. */
function realAgentRunner(
  modelFor: (armId: string) => string,
  replyFor: (armId: string) => string,
): ArmRunner {
  return async (arm) => {
    const agent = Agent.create({
      provider: mock({ reply: replyFor(arm.id) }),
      model: modelFor(arm.id),
    }).build();
    const events: AgentfootprintEvent[] = [];
    agent.on('*', (e) => events.push(e));
    const output = await agent.run({ message: 'the same question' });
    return { output, manifest: manifestFromEvents(events) };
  };
}

describe('INTEGRATION — the arm a run belonged to comes from the run', () => {
  const FAST: StrategyArm = { id: 'fast', facets: { provider: 'mock', model: 'fast-model' } };
  const SLOW: StrategyArm = { id: 'slow', facets: { provider: 'mock', model: 'slow-model' } };

  it('a real run_configured payload satisfies RunManifestLike and classifies its own run', async () => {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'slow-model' }).build();
    const events: AgentfootprintEvent[] = [];
    agent.on('*', (e) => events.push(e));
    await agent.run({ message: 'hi' });

    const manifest = manifestFromEvents(events);
    expect(manifest).toBeDefined();
    // No bookkeeping: the RUN says which arm it was.
    expect(matchArm([FAST, SLOW], manifest as RunManifestLike)?.id).toBe('slow');
    expect(armFacetsFromManifest(manifest as RunManifestLike).model).toBe('slow-model');
  });

  it('two real arms, two real manifests, one causal verdict', async () => {
    const result = await compareStrategyArms({
      arms: [FAST, SLOW],
      originalAnswer: REFERENCE,
      embedder: cosEmbedder,
      samples: 2,
      runner: realAgentRunner(
        (id) => (id === 'fast' ? 'fast-model' : 'slow-model'),
        (id) => (id === 'fast' ? 'sim:1 the original answer' : 'sim:0.2 a different answer'),
      ),
    });

    expect(result.baselineStable).toBe(true);
    for (const arm of result.arms) {
      expect(arm.application.checked).toBe(true);
      expect(arm.application.applied).toBe(true);
      expect(arm.application.manifestsSeen).toBe(2);
    }
    expect(result.arms.find((a) => a.armId === 'slow')?.verdict?.verdict).toBe('confirmed');
  });

  it('THE MIS-WIRED EXPERIMENT: a runner that ignores the arm is caught by the manifest', async () => {
    const result = await compareStrategyArms({
      arms: [FAST, SLOW],
      originalAnswer: REFERENCE,
      embedder: cosEmbedder,
      samples: 2,
      // The runner *believes* it varies the model. It does not — both arms build
      // 'fast-model'. Bookkeeping would have reported a difference between two
      // configurations that were one configuration.
      runner: realAgentRunner(
        () => 'fast-model',
        (id) => (id === 'fast' ? 'sim:1 the original answer' : 'sim:0.2 a different answer'),
      ),
    });

    const slow = result.arms.find((a) => a.armId === 'slow');
    expect(slow?.runs.flips).toBe(2); // the numbers SAY there is a difference …
    expect(slow?.application.applied).toBe(false); // … but the arm never ran
    expect(slow?.application.mismatches).toEqual([
      { facet: 'model', declared: 'slow-model', observed: 'fast-model' },
    ]);
    expect(slow?.verdict?.verdict).toBe('inconclusive');
    expect(slow?.verdict?.claim).toContain('did not take effect');
  });
});
