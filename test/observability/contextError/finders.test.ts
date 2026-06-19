/**
 * observability/contextError/finders — the plain context-bug finder surface.
 *
 * Convention-3 test tiers (unit / functional / integration / property / security /
 * performance / load). Deterministic: a mock embedder (char-frequency) for the ranking
 * finders and a scripted `rerun` for the counterfactual finders — no servers, no model.
 */
import { describe, expect, it } from 'vitest';

import { mockEmbedder } from '../../../src/index';
import {
  compareFinders,
  rankSuspects,
  removeAndRetry,
  shrinkToCause,
  testManyCombos,
  traceSteps,
  type FindInput,
  type Finder,
} from '../../../src/observability/contextError/finders';

// ── shared planted fixture ───────────────────────────────────────────
// The wrong answer and a culprit whose text shares its character distribution (so the
// char-frequency mock embedder ranks it high), plus innocents with different letters.
const WRONG = 'DENIED loan high risk subprime credit default';
const CULPRIT = 'plant-policy';
const SUSPECTS = [
  { id: 'ok-weather', text: 'sunny mild weather, gentle breeze' },
  { id: CULPRIT, text: 'subprime high risk credit loan denied default override policy' },
  { id: 'ok-meeting', text: 'quarterly sync agenda; bring laptops' },
];

/** Scripted counterfactual: only removing the culprit recovers the outcome. */
const rerun = async (removedIds: readonly string[]) => ({
  recovered: removedIds.includes(CULPRIT),
});

const baseInput = (over: Partial<FindInput> = {}): FindInput => ({
  suspects: SUSPECTS,
  wrongOutput: WRONG,
  embedder: mockEmbedder(),
  rerun,
  ...over,
});

const STEPS = [
  { id: 'step-lookup', label: 'lookup@L0', text: 'looked up the account balance, all normal' },
  { id: 'step-promo', label: 'promo@L1', text: 'DENIED loan high risk subprime credit default applied' },
];

// ── UNIT — each finder's contract in isolation ───────────────────────
describe('finders — unit', () => {
  it('rankSuspects: guesses (no checks), returns a ranked permutation + a lead', async () => {
    const r = await rankSuspects.find(baseInput());
    expect(r.finder).toBe('rankSuspects');
    expect(r.evidence).toBe('guessed');
    expect(r.granularity).toBe('piece');
    expect(r.checks).toBe(0);
    expect(r.suspects.map((s) => s.id).sort()).toEqual(SUSPECTS.map((s) => s.id).sort());
    expect(r.lead).toBeTruthy();
  });

  it('removeAndRetry: proves by re-running, one check per suspect, flippers in shortlist', async () => {
    const r = await removeAndRetry.find(baseInput());
    expect(r.finder).toBe('removeAndRetry');
    expect(r.evidence).toBe('proven');
    expect(r.checks).toBe(SUSPECTS.length);
    expect(r.shortlist).toEqual([CULPRIT]);
    expect(r.lead).toBe(CULPRIT);
  });

  it('traceSteps: step granularity over the trajectory', async () => {
    const r = await traceSteps.find(baseInput({ steps: STEPS }));
    expect(r.finder).toBe('traceSteps');
    expect(r.granularity).toBe('step');
    expect(r.suspects.map((s) => s.id).sort()).toEqual(STEPS.map((s) => s.id).sort());
  });

  it('traceSteps: guesses without rerun, proves (1 check) with rerun', async () => {
    const guessed = await traceSteps.find({
      suspects: SUSPECTS,
      wrongOutput: WRONG,
      embedder: mockEmbedder(),
      steps: STEPS,
    });
    expect(guessed.evidence).toBe('guessed');
    expect(guessed.checks).toBe(0);

    const proven = await traceSteps.find(baseInput({ steps: STEPS }));
    expect(proven.evidence).toBe('proven');
    expect(proven.checks).toBe(1);
    expect(proven.explanation).toMatch(/recover/i);
  });

  it('rankSuspects: escalates (no clear winner → shortlist of ≥2) on a tie', async () => {
    // identical texts → identical scores → no clear winner → cover the runner-up
    const r = await rankSuspects.find({
      suspects: [
        { id: 'a', text: 'same content' },
        { id: 'b', text: 'same content' },
      ],
      wrongOutput: 'same content',
      embedder: mockEmbedder(),
    });
    expect(r.shortlist.length).toBeGreaterThanOrEqual(2);
    expect(r.explanation).toMatch(/escalate/i);
  });

  it('every finder carries plain meta with the academic attribution off the name', () => {
    for (const f of [rankSuspects, removeAndRetry, traceSteps]) {
      expect(f.meta.label.length).toBeGreaterThan(0);
      expect(f.meta.method.length).toBeGreaterThan(0);
      // the import name is plain; the paper lives in meta
      expect(f.name).not.toMatch(/FALAT|ContextCite|CausalArmor|ablation/i);
    }
    expect(traceSteps.meta.paper).toMatch(/FALAT/);
  });
});

// ── FUNCTIONAL — happy path convicts the planted culprit ─────────────
describe('finders — functional', () => {
  it('removeAndRetry convicts exactly the planted culprit', async () => {
    const r = await removeAndRetry.find(baseInput());
    expect(r.lead).toBe(CULPRIT);
    expect(r.shortlist).toEqual([CULPRIT]);
    expect(r.explanation).toContain(CULPRIT);
  });

  it('rankSuspects ranks the culprit above the unrelated innocents', async () => {
    const r = await rankSuspects.find(baseInput());
    const rank = (id: string) => r.suspects.findIndex((s) => s.id === id);
    expect(rank(CULPRIT)).toBeLessThan(rank('ok-weather'));
    expect(rank(CULPRIT)).toBeLessThan(rank('ok-meeting'));
  });
});

// ── INTEGRATION — finders cooperate through compareFinders ───────────
describe('finders — integration', () => {
  it('compareFinders runs several finders and returns one row each', async () => {
    const rows = await compareFinders([rankSuspects, removeAndRetry, traceSteps], baseInput({ steps: STEPS }));
    expect(rows.map((r) => r.finder)).toEqual(['rankSuspects', 'removeAndRetry', 'traceSteps']);
    expect(rows.every((r) => r.result !== null)).toBe(true);
  });

  it('ranking (guess) and ablation (proof) agree on the culprit on a clean single-cause case', async () => {
    const ranked = await rankSuspects.find(baseInput());
    const proven = await removeAndRetry.find(baseInput());
    expect(proven.lead).toBe(CULPRIT);
    expect(ranked.suspects[0]?.id).toBe(CULPRIT); // mock embedder favors the shared-character culprit
  });
});

// ── testManyCombos (ContextCite) + shrinkToCause (BugDoc) ────────────
describe('finders — testManyCombos + shrinkToCause', () => {
  it('shrinkToCause finds the minimal recovering set = the culprit (proven)', async () => {
    const r = await shrinkToCause.find(baseInput());
    expect(r.finder).toBe('shrinkToCause');
    expect(r.evidence).toBe('proven');
    expect(r.shortlist).toEqual([CULPRIT]);
    expect(r.lead).toBe(CULPRIT);
  });

  it('shrinkToCause reaches the cause in FEWER checks than leave-one-out', async () => {
    const n = 12;
    const culprit = 'p7';
    const suspects = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, text: `piece ${i}` }));
    const r = await shrinkToCause.find({
      suspects,
      wrongOutput: 'bad',
      rerun: async (rm) => ({ recovered: rm.includes(culprit) }),
    });
    expect(r.lead).toBe(culprit);
    expect(r.shortlist).toEqual([culprit]);
    expect(r.checks).toBeLessThan(n); // ddmin beats exhaustive leave-one-out
  });

  it('shrinkToCause: removing all and not recovering → no removable cause (guessed, empty)', async () => {
    const r = await shrinkToCause.find({
      suspects: SUSPECTS,
      wrongOutput: WRONG,
      rerun: async () => ({ recovered: false }),
    });
    expect(r.evidence).toBe('guessed');
    expect(r.shortlist).toEqual([]);
    expect(r.lead).toBeUndefined();
  });

  it('testManyCombos learns the culprit from sampled combinations and confirms it', async () => {
    const r = await testManyCombos.find(baseInput({ samples: 24 }));
    expect(r.finder).toBe('testManyCombos');
    expect(r.lead).toBe(CULPRIT);
    expect(r.evidence).toBe('proven'); // confirmed by the single follow-up ablation
    expect(r.checks).toBe(24 + 1);
  });

  it('testManyCombos is deterministic (reproducible masking → same result twice)', async () => {
    const a = await testManyCombos.find(baseInput({ samples: 16 }));
    const b = await testManyCombos.find(baseInput({ samples: 16 }));
    expect(a.suspects).toEqual(b.suspects);
    expect(a.lead).toBe(b.lead);
  });
});

// ── PROPERTY — invariants over randomized inputs ─────────────────────
describe('finders — property', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${i}`);

  it('removeAndRetry: checks === #suspects; ranking is a permutation; flippers ⊆ suspects', async () => {
    for (const n of [1, 2, 5, 12]) {
      const suspects = ids(n).map((id) => ({ id, text: `piece ${id}` }));
      const flipId = `s${n - 1}`;
      const r = await removeAndRetry.find({
        suspects,
        wrongOutput: 'bad',
        rerun: async (rm) => ({ recovered: rm.includes(flipId) }),
      });
      expect(r.checks).toBe(n);
      expect(r.suspects.map((s) => s.id).sort()).toEqual(suspects.map((s) => s.id).sort());
      expect(r.shortlist.every((id) => suspects.some((s) => s.id === id))).toBe(true);
      expect(r.shortlist).toEqual([flipId]);
    }
  });

  it('rankSuspects: output is always a permutation of inputs with valid evidence', async () => {
    const emb = mockEmbedder();
    for (const n of [1, 3, 8]) {
      const suspects = ids(n).map((id) => ({ id, text: `context piece number ${id} content` }));
      const r = await rankSuspects.find({ suspects, wrongOutput: 'some wrong answer', embedder: emb });
      expect(r.suspects.map((s) => s.id).sort()).toEqual(suspects.map((s) => s.id).sort());
      expect(r.evidence).toBe('guessed');
      expect(['piece', 'step']).toContain(r.granularity);
    }
  });
});

// ── SECURITY / robustness — adversarial + missing-dependency inputs ──
describe('finders — security/robustness', () => {
  it('finders throw a clear error (not a crash) when a needed dependency is missing', async () => {
    await expect(rankSuspects.find({ suspects: SUSPECTS, wrongOutput: WRONG })).rejects.toThrow(/embedder/);
    await expect(removeAndRetry.find({ suspects: SUSPECTS, wrongOutput: WRONG })).rejects.toThrow(/rerun/);
    await expect(traceSteps.find(baseInput({ steps: undefined }))).rejects.toThrow(/steps/);
  });

  it('compareFinders ERROR-ISOLATES a failing finder instead of aborting the rest', async () => {
    // no embedder/steps → rankSuspects + traceSteps error; removeAndRetry still runs
    const rows = await compareFinders([rankSuspects, removeAndRetry, traceSteps], {
      suspects: SUSPECTS,
      wrongOutput: WRONG,
      rerun,
    });
    const byName = Object.fromEntries(rows.map((r) => [r.finder, r]));
    expect(byName.rankSuspects.result).toBeNull();
    expect(byName.rankSuspects.error).toMatch(/embedder/);
    expect(byName.removeAndRetry.result?.lead).toBe(CULPRIT);
  });

  it('handles empty + oversized inputs without throwing', async () => {
    const empty = await removeAndRetry.find({ suspects: [], wrongOutput: '', rerun });
    expect(empty.checks).toBe(0);
    expect(empty.shortlist).toEqual([]);
    const big = await rankSuspects.find({
      suspects: [{ id: 'x', text: 'q'.repeat(20000) }],
      wrongOutput: 'q'.repeat(20000),
      embedder: mockEmbedder(),
    });
    expect(big.suspects).toHaveLength(1);
  });
});

// ── PERFORMANCE — within a budget on a non-trivial case ──────────────
describe('finders — performance', () => {
  it('rankSuspects scores 50 pieces under budget', async () => {
    const suspects = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, text: `policy clause ${i} about credit and risk` }));
    const t0 = performance.now();
    const r = await rankSuspects.find({ suspects, wrongOutput: WRONG, embedder: mockEmbedder() });
    expect(r.suspects).toHaveLength(50);
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('removeAndRetry does exactly N re-runs (cost is linear + reported)', async () => {
    let calls = 0;
    const suspects = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, text: `x${i}` }));
    const r = await removeAndRetry.find({
      suspects,
      wrongOutput: 'bad',
      rerun: async () => {
        calls++;
        return { recovered: false };
      },
    });
    expect(calls).toBe(30);
    expect(r.checks).toBe(30);
  });
});

// ── LOAD — sustains many finders / large comparisons ─────────────────
describe('finders — load', () => {
  it('compareFinders sustains a large finder list + suspect set', async () => {
    const finders: Finder[] = Array.from({ length: 20 }, () => removeAndRetry);
    const suspects = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, text: `c${i}` }));
    const rows = await compareFinders(finders, { suspects, wrongOutput: 'bad', rerun: async () => ({ recovered: false }) });
    expect(rows).toHaveLength(20);
    expect(rows.every((r) => r.result?.checks === 40)).toBe(true);
  });
});
