/**
 * restoration — the causal tier for the missing-context finder (interface #3),
 * the mirror of ablation.
 *
 * Convention-3 coverage: unit · functional · integration · property ·
 * security · performance · load. The integration tier wires it through
 * `localizeContextBug`'s `missingContext` option end to end.
 */
import { describe, expect, it } from 'vitest';
import { mockEmbedder } from '../../../src/memory/embedding/mockEmbedder';
import {
  runRestorationProbe,
  type RestorationRunner,
} from '../../../src/lib/context-bisect/restoration';
import { runRestorationProbe as runViaObserve } from '../../../src/observe';
import type { ContextUnit } from '../../../src/lib/context-bisect/missingContext';

const embedder = mockEmbedder();
const u = (id: string): ContextUnit => ({ id });

/** A runner whose output flips to a DIFFERENT string only when `flipId` is restored. */
const flipOnRestore =
  (flipId: string, buggy = 'DECLINE DECLINE DECLINE', fixed = 'totally different APPROVED text'): RestorationRunner =>
  async (units) =>
    units.some((x) => x.id === flipId) ? fixed : buggy;

// ─── 1. UNIT ─────────────────────────────────────────────────────────
describe('runRestorationProbe — unit', () => {
  it('baseline (restore nothing) reproduces the original → 0 flips', async () => {
    const buggy = 'DECLINE DECLINE DECLINE';
    const stats = await runRestorationProbe(
      { rerun: { runner: flipOnRestore('override', buggy), originalOutput: buggy }, embedder },
      [],
    );
    expect(stats.flips).toBe(0);
    expect(stats.samples).toBeGreaterThanOrEqual(2);
  });

  it('restoring the culprit flips the outcome in every seeded rerun', async () => {
    const buggy = 'DECLINE DECLINE DECLINE';
    const stats = await runRestorationProbe(
      { rerun: { runner: flipOnRestore('override', buggy), originalOutput: buggy, samples: 3 }, embedder },
      [u('override')],
    );
    expect(stats.flips).toBe(3);
  });

  it('restoring an innocent does not flip', async () => {
    const buggy = 'DECLINE DECLINE DECLINE';
    const stats = await runRestorationProbe(
      { rerun: { runner: flipOnRestore('override', buggy), originalOutput: buggy }, embedder },
      [u('innocent')],
    );
    expect(stats.flips).toBe(0);
  });

  it('samples clamped to >= 2 (no single-run verdicts)', async () => {
    const stats = await runRestorationProbe(
      { rerun: { runner: async () => 'x', originalOutput: 'x', samples: 1 }, embedder },
      [],
    );
    expect(stats.samples).toBe(2);
  });
});

// ─── 2. FUNCTIONAL + 3. INTEGRATION (through localizeContextBug) ──────
describe('restoration tier — via localizeContextBug', () => {
  it('observe re-export is the same function', () => {
    expect(runViaObserve).toBe(runRestorationProbe);
  });

  it('confirms a restored culprit and lists it on report.dropped', async () => {
    const { localizeContextBug } = await import('../../../src/lib/context-bisect/localize');
    const buggy = 'DECLINE DECLINE DECLINE';
    const report = await localizeContextBug({
      // minimal artifacts: an explicit trigger over a tiny commit log
      artifacts: {
        snapshot: { commitLog: [{ runtimeStageId: 'call#0', stageId: 'call', idx: 0, trace: [], overwrite: {}, updates: {} }] } as never,
      },
      embedder,
      atStep: 'call#0',
      missingContext: {
        available: [u('override'), u('filler'), u('credit')],
        sent: [u('credit')], // override + filler dropped
        rerun: { runner: flipOnRestore('override', buggy), originalOutput: buggy, samples: 3 },
      },
    });
    expect(report.mode).toBe('causal'); // a restoration verdict is a causal claim
    expect(report.dropped?.map((d) => d.id)).toEqual(['override', 'filler']);
    const overrideCandidate = report.dropped?.find((d) => d.id === 'override');
    expect(overrideCandidate?.verdict?.verdict).toBe('confirmed');
    expect(overrideCandidate?.verdict?.claim).toContain('CAUSAL');
    expect(overrideCandidate?.verdict?.claim).toContain('restoring');
    const fillerCandidate = report.dropped?.find((d) => d.id === 'filler');
    expect(fillerCandidate?.verdict?.verdict).toBe('not-confirmed');
  });

  it('without a restoration runner, lists dropped candidates with no verdicts (correlational)', async () => {
    const { localizeContextBug } = await import('../../../src/lib/context-bisect/localize');
    const report = await localizeContextBug({
      artifacts: {
        snapshot: { commitLog: [{ runtimeStageId: 'call#0', stageId: 'call', idx: 0, trace: [], overwrite: {}, updates: {} }] } as never,
      },
      embedder,
      atStep: 'call#0',
      missingContext: { available: [u('a'), u('b')], sent: [u('a')] },
    });
    expect(report.mode).toBe('correlational');
    expect(report.dropped?.map((d) => d.id)).toEqual(['b']);
    expect(report.dropped?.[0].verdict).toBeUndefined();
  });

  const baseReport = async (mc: object) => {
    const { localizeContextBug } = await import('../../../src/lib/context-bisect/localize');
    return localizeContextBug({
      artifacts: { snapshot: { commitLog: [{ runtimeStageId: 'call#0', stageId: 'call', idx: 0, trace: [], overwrite: {}, updates: {} }] } as never },
      embedder,
      atStep: 'call#0',
      missingContext: mc as never,
    });
  };

  it('unstable un-restored baseline → every candidate inconclusive + a report-level honesty flag', async () => {
    // a runner that flips REGARDLESS of units (even baseline []), i.e. the scenario doesn't reproduce
    const flaky: RestorationRunner = async () => 'totally different text every time';
    const report = await baseReport({
      available: [u('override'), u('credit')], sent: [u('credit')],
      rerun: { runner: flaky, originalOutput: 'DECLINE DECLINE DECLINE', samples: 3 },
    });
    const c = report.dropped?.find((d) => d.id === 'override');
    expect(c?.verdict?.verdict).toBe('inconclusive');
    expect(c?.verdict?.claim).toContain('un-restored');
    expect(c?.verdict?.claim).toContain('restoration');
    expect(report.honestyFlags.some((f) => f.flag === 'baseline-unstable' && /un-restored/.test(f.note))).toBe(true);
    expect(report.restorationBaseline).toBeDefined();
  });

  it('maxCandidates: first K probed (verdicts), the rest listed bare', async () => {
    const buggy = 'DECLINE DECLINE DECLINE';
    const report = await baseReport({
      available: [u('d1'), u('d2'), u('d3')], sent: [], // all 3 dropped
      rerun: { runner: flipOnRestore('never', buggy), originalOutput: buggy, samples: 2, maxCandidates: 2 },
    });
    expect(report.dropped?.[0].verdict).toBeDefined();
    expect(report.dropped?.[1].verdict).toBeDefined();
    expect(report.dropped?.[2].verdict).toBeUndefined(); // over budget — listed, not probed
    expect(report.dropped?.[2].id).toBe('d3'); // still present
  });

  it('empty dropped + runner supplied → NO baseline probe is spent (runner never called)', async () => {
    let calls = 0;
    const counting: RestorationRunner = async () => { calls++; return 'x'; };
    const report = await baseReport({
      available: [u('a')], sent: [u('a')], // nothing dropped
      rerun: { runner: counting, originalOutput: 'x', samples: 3 },
    });
    expect(calls).toBe(0); // short-circuited before the baseline probe
    expect(report.dropped ?? []).toEqual([]);
  });

  it('content is carried through onto a candidate that ALSO has a verdict', async () => {
    const buggy = 'DECLINE DECLINE DECLINE';
    const report = await baseReport({
      available: [{ id: 'override', content: 'the committee note' }, u('credit')], sent: [u('credit')],
      rerun: { runner: flipOnRestore('override', buggy), originalOutput: buggy, samples: 2 },
    });
    const c = report.dropped?.find((d) => d.id === 'override');
    expect(c?.content).toBe('the committee note');
    expect(c?.verdict?.verdict).toBe('confirmed');
  });

  it('both tiers in one call: suspects carry ablation verdicts AND dropped carry restoration verdicts', async () => {
    const { localizeContextBug } = await import('../../../src/lib/context-bisect/localize');
    const buggy = 'DECLINE DECLINE DECLINE';
    const report = await localizeContextBug({
      artifacts: { snapshot: { commitLog: [{ runtimeStageId: 'call#0', stageId: 'call', idx: 0, trace: [], overwrite: {}, updates: {} }] } as never },
      embedder,
      atStep: 'call#0',
      rerun: { runner: async () => buggy, originalOutput: buggy, samples: 2 }, // ablation tier (stable baseline)
      missingContext: {
        available: [u('override'), u('credit')], sent: [u('credit')],
        rerun: { runner: flipOnRestore('override', buggy), originalOutput: buggy, samples: 2 },
      },
    });
    expect(report.mode).toBe('causal');
    expect(report.baseline).toBeDefined(); // ablation baseline present
    expect(report.restorationBaseline).toBeDefined(); // restoration baseline present
    expect(report.dropped?.find((d) => d.id === 'override')?.verdict?.verdict).toBe('confirmed');
  });

  it('formatContextBugReport renders the MISSING CONTEXT section', async () => {
    const { formatContextBugReport } = await import('../../../src/lib/context-bisect/localize');
    const buggy = 'DECLINE DECLINE DECLINE';
    const report = await baseReport({
      available: [u('override'), u('credit')], sent: [u('credit')],
      rerun: { runner: flipOnRestore('override', buggy), originalOutput: buggy, samples: 2 },
    });
    const text = formatContextBugReport(report);
    expect(text).toContain('MISSING CONTEXT');
    expect(text).toContain("dropped 'override'");
    expect(text).toMatch(/CAUSAL: restoring/);
  });

  it('a throwing runner rejects the probe (fail-loud, no partial state)', async () => {
    const boom: RestorationRunner = async () => { throw new Error('runner exploded'); };
    await expect(
      runRestorationProbe({ rerun: { runner: boom, originalOutput: 'x' }, embedder }, [u('a')]),
    ).rejects.toThrow('runner exploded');
  });

  it('samples: NaN falls back to the default (no NaN leaking into the verdict)', async () => {
    const stats = await runRestorationProbe(
      { rerun: { runner: async () => 'x', originalOutput: 'x', samples: NaN as number }, embedder },
      [],
    );
    expect(Number.isFinite(stats.samples)).toBe(true);
    expect(stats.samples).toBe(3); // CONTEXT_BISECT_DEFAULTS.samples
  });
});

// ─── 4. PROPERTY ─────────────────────────────────────────────────────
describe('runRestorationProbe — property', () => {
  it('flips never exceed samples; both always >= 0', async () => {
    for (let i = 0; i < 30; i++) {
      const samples = 2 + (i % 4);
      const stats = await runRestorationProbe(
        { rerun: { runner: flipOnRestore('z'), originalOutput: 'DECLINE DECLINE DECLINE', samples }, embedder },
        i % 2 === 0 ? [u('z')] : [u('other')],
      );
      expect(stats.flips).toBeGreaterThanOrEqual(0);
      expect(stats.flips).toBeLessThanOrEqual(stats.samples);
      expect(stats.samples).toBe(samples);
    }
  });
});

// ─── 5. SECURITY / robustness ────────────────────────────────────────
describe('runRestorationProbe — robustness', () => {
  it('a custom outcomeChanged comparator is honored (decision-extracting)', async () => {
    const decision = (s: string) => /APPROVE/i.test(s);
    const stats = await runRestorationProbe(
      {
        rerun: {
          runner: flipOnRestore('override', 'DECISION: DECLINE', 'DECISION: APPROVE'),
          originalOutput: 'DECISION: DECLINE',
          outcomeChanged: (orig, out) => decision(orig) !== decision(out),
          samples: 2,
        },
        embedder,
      },
      [u('override')],
    );
    expect(stats.flips).toBe(2);
  });
});

// ─── 6. PERFORMANCE + 7. LOAD ────────────────────────────────────────
describe('runRestorationProbe — performance & load', () => {
  it('many probes complete promptly (mock runner + mock embedder)', async () => {
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) {
      await runRestorationProbe(
        { rerun: { runner: async () => 'x', originalOutput: 'x', samples: 2 }, embedder },
        [u('a')],
      );
    }
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
