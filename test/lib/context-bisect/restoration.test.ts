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
