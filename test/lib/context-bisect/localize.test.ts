/**
 * localizeContextBug (RFC-003 D8) — functional / integration / honesty /
 * trigger-derivation / control-edge / security tiers.
 *
 * The acceptance scenario: a planted misleading FACT injection in a real
 * agent run is FOUND (top ablatable suspect) and CONFIRMED via
 * counterfactual ablation (majority of seeded reruns flip). The no-rerun
 * mode stops at the ranking and says so (§B2).
 */
import { describe, expect, it } from 'vitest';
import { decide, flowChart, FlowChartExecutor } from 'footprintjs';
import { controlDepRecorder } from 'footprintjs/trace';

import { mockEmbedder } from '../../../src/memory/embedding/mockEmbedder';
import {
  embeddingCache,
  scoreContrastiveInfluence,
  scoreInfluence,
  type Embedder,
  type InfluenceScorer,
} from '../../../src/lib/influence-core';
import {
  formatContextBugReport,
  localizeContextBug,
  type ContextBugReport,
  type Suspect,
} from '../../../src/lib/context-bisect';
import { decisionChanged, plantedScenario, runPlantedScenario } from './plantedFactFixture';

const embedder = () => embeddingCache(mockEmbedder());

function findSuspect(report: ContextBugReport, injectionId: string): Suspect | undefined {
  return report.suspects.find((suspect) => suspect.detail?.injectionId === injectionId);
}

// ── E2E: planted fact found + confirmed (the D8 acceptance) ──────────

describe('localizeContextBug — planted-fact e2e (causal mode)', () => {
  it(
    'finds the planted fact as top ablatable suspect and CONFIRMS it via ablation',
    { timeout: 30000 },
    async () => {
      const scenario = plantedScenario();
      const original = await runPlantedScenario(scenario);
      expect(original.content).toContain('APPROVED'); // the bug manifests

      const report = await localizeContextBug({
        artifacts: {
          snapshot: original.snapshot,
          controlDeps: original.controlDeps,
          events: original.events,
        },
        embedder: embedder(),
        atStep: original.lastLlmCallId,
        rerun: {
          runner: async (specs) => (await runPlantedScenario(scenario, specs)).content,
          originalOutput: original.content,
          samples: 3,
          outcomeChanged: decisionChanged,
        },
      });

      expect(report.mode).toBe('causal');
      expect(report.baseline?.flips).toBe(0); // stable scenario

      // FOUND: the planted fact is the top-ranked ablatable suspect.
      const ablatable = report.suspects.filter(
        (suspect) => suspect.ablation !== undefined && suspect.ablation.kind !== 'arg',
      );
      expect(ablatable[0]?.detail?.injectionId).toBe('vip-override-fact');
      expect(ablatable[0]?.kind).toBe('injection');

      // CONFIRMED: causal verdict with full variance evidence.
      const planted = findSuspect(report, 'vip-override-fact');
      expect(planted?.verdict?.verdict).toBe('confirmed');
      expect(planted?.runs?.flips).toBe(3);
      expect(planted?.runs?.samples).toBe(3);
      expect(planted?.verdict?.claim).toContain('CAUSAL');

      // The benign fact and the tool are NOT confirmed.
      expect(findSuspect(report, 'style-fact')?.verdict?.verdict).toBe('not-confirmed');
      const tool = report.suspects.find((suspect) => suspect.kind === 'tool');
      expect(tool?.detail?.toolName).toBe('lookup_order');
      expect(tool?.verdict?.verdict).toBe('not-confirmed');

      // Every suspect carries a drillable id + its evidence path.
      for (const suspect of report.suspects) {
        expect(suspect.source).toMatch(/#\d+$/);
        expect(Array.isArray(suspect.edgePath)).toBe(true);
      }
    },
  );

  it('is deterministic — two localizations of the same run produce the same ranking', async () => {
    const scenario = plantedScenario();
    const original = await runPlantedScenario(scenario);
    const artifacts = {
      snapshot: original.snapshot,
      controlDeps: original.controlDeps,
      events: original.events,
    };
    const run = () =>
      localizeContextBug({ artifacts, embedder: embedder(), atStep: original.lastLlmCallId });
    const [a, b] = [await run(), await run()];
    expect(a.suspects.map((s) => [s.source, s.kind, s.detail?.injectionId, s.score])).toEqual(
      b.suspects.map((s) => [s.source, s.kind, s.detail?.injectionId, s.score]),
    );
  });
});

// ── No-rerun mode: stops at the ranking, marked correlational ────────

describe('localizeContextBug — correlational mode (no rerun)', () => {
  it('makes no causal claims and says so in the report', async () => {
    const scenario = plantedScenario();
    const original = await runPlantedScenario(scenario);
    const report = await localizeContextBug({
      artifacts: {
        snapshot: original.snapshot,
        controlDeps: original.controlDeps,
        events: original.events,
      },
      embedder: embedder(),
      atStep: original.lastLlmCallId,
    });

    expect(report.mode).toBe('correlational');
    expect(report.baseline).toBeUndefined();
    for (const suspect of report.suspects) {
      expect(suspect.verdict).toBeUndefined();
      expect(suspect.runs).toBeUndefined();
    }
    const formatted = formatContextBugReport(report);
    expect(formatted).toContain('CORRELATIONAL');
    expect(formatted).toContain('no causal claim');
    expect(formatted).toContain('only ablation verdicts make causal claims');
  });
});

// ── Honesty flags ────────────────────────────────────────────────────

describe('localizeContextBug — honesty flags propagate', () => {
  it('flags untracked sources, missing control deps, and missing llm ids', async () => {
    const scenario = plantedScenario();
    const original = await runPlantedScenario(scenario);
    const report = await localizeContextBug({
      artifacts: { snapshot: original.snapshot }, // no controlDeps, no events
      embedder: embedder(),
      atStep: original.lastLlmCallId,
    });
    const flags = report.honestyFlags.map((flag) => flag.flag);
    expect(flags).toContain('no-control-deps');
    expect(flags).toContain('no-llm-call-ids');
    expect(flags).toContain('untracked-sources'); // the agent seed reads args
    // No llm ids → no weighted edges → structure-only ranking.
    expect(report.sliceStats.weightedEdges).toBe(0);
    const formatted = formatContextBugReport(report);
    expect(formatted).toContain('⚠ [no-control-deps]');
    expect(formatted).toContain('⚠ [no-llm-call-ids]');
  });

  it('flags slice truncation when budgets cut the slice', async () => {
    const scenario = plantedScenario();
    const original = await runPlantedScenario(scenario);
    const report = await localizeContextBug({
      artifacts: { snapshot: original.snapshot, events: original.events },
      embedder: embedder(),
      atStep: original.lastLlmCallId,
      maxDepth: 1,
      maxNodes: 2,
    });
    expect(report.sliceStats.truncated).toBeDefined();
    expect(report.honestyFlags.map((flag) => flag.flag)).toContain('slice-truncated');
    expect(formatContextBugReport(report)).toContain('⚠ [slice-truncated]');
  });

  it('flags missing read tracking (slice cannot follow read→write edges)', async () => {
    type State = { x: number; y: number };
    const chart = flowChart<State>(
      'A',
      async (scope) => {
        scope.x = 1;
      },
      'a',
    )
      .addFunction(
        'B',
        async (scope) => {
          scope.y = scope.x + 1;
        },
        'b',
      )
      .build();
    const executor = new FlowChartExecutor(chart, { readTracking: 'off' });
    await executor.run({});
    const report = await localizeContextBug({
      artifacts: { snapshot: executor.getSnapshot() },
      embedder: embedder(),
      atStep: 'b#1',
    });
    expect(report.honestyFlags.map((flag) => flag.flag)).toContain('no-read-tracking');
    expect(report.suspects).toHaveLength(0); // only the trigger in the slice
  });
});

// ── Trigger derivation ───────────────────────────────────────────────

describe('localizeContextBug — trigger resolution', () => {
  it('uses the quality lookup when no atStep is given (lowest-scoring step)', async () => {
    const scenario = plantedScenario();
    const original = await runPlantedScenario(scenario);
    const report = await localizeContextBug({
      artifacts: {
        snapshot: original.snapshot,
        events: original.events,
        quality: {
          getLowest: () => ({
            runtimeStageId: original.lastLlmCallId,
            entry: { score: 0.3, stageName: 'CallLLM' },
          }),
        },
      },
      embedder: embedder(),
    });
    expect(report.triggerSource).toBe('quality');
    expect(report.triggerScore).toBe(0.3);
    expect(report.step).toBe(original.lastLlmCallId);
  });

  it('consults a custom trigger strategy; atStep wins over everything', async () => {
    const scenario = plantedScenario();
    const original = await runPlantedScenario(scenario);
    const viaCustom = await localizeContextBug({
      artifacts: { snapshot: original.snapshot, events: original.events },
      embedder: embedder(),
      trigger: () => original.lastLlmCallId,
    });
    expect(viaCustom.triggerSource).toBe('custom');
    const viaExplicit = await localizeContextBug({
      artifacts: { snapshot: original.snapshot, events: original.events },
      embedder: embedder(),
      atStep: original.lastLlmCallId,
      trigger: () => 'would-lose#0',
    });
    expect(viaExplicit.triggerSource).toBe('explicit');
  });

  it('fails loud when no trigger is derivable or the step is unknown', async () => {
    const scenario = plantedScenario();
    const original = await runPlantedScenario(scenario);
    await expect(
      localizeContextBug({ artifacts: { snapshot: original.snapshot }, embedder: embedder() }),
    ).rejects.toThrow(/no trigger step/);
    await expect(
      localizeContextBug({
        artifacts: { snapshot: original.snapshot },
        embedder: embedder(),
        atStep: 'ghost#42',
      }),
    ).rejects.toThrow(/not in the commit log/);
  });
});

// ── Control-edge scenario (the credit fixture shape) ─────────────────

describe('localizeContextBug — control edges on a plain decide() chart', () => {
  interface LoanState {
    monthlyDebt: number;
    annualIncome: number;
    monthlyIncome: number;
    dti: number;
    decision: string;
  }

  async function runLoanChart() {
    const chart = flowChart<LoanState>(
      'Intake',
      async (scope) => {
        scope.monthlyDebt = 2310;
        scope.annualIncome = 66000;
        scope.monthlyIncome = 5500;
      },
      'intake',
    )
      .addFunction(
        'Normalize',
        async (scope) => {
          // The planted wrong computation: divides by ANNUAL income.
          scope.dti = Math.round((scope.monthlyDebt / scope.annualIncome) * 1000) / 1000;
        },
        'normalize',
      )
      .addDeciderFunction(
        'Adjudicate',
        (scope) =>
          decide(scope as unknown as LoanState, [
            { when: { dti: { gt: 0.4 } }, then: 'decline', label: 'DTI above ceiling' },
            { when: { dti: { lte: 0.4 } }, then: 'approve', label: 'Within affordability' },
          ]),
        'adjudicate',
      )
      .addFunctionBranch('approve', 'Approve', async (scope) => {
        scope.decision = 'approve';
      })
      .addFunctionBranch('decline', 'Decline', async (scope) => {
        scope.decision = 'decline';
      })
      .end()
      .build();
    const executor = new FlowChartExecutor(chart);
    const ctrl = controlDepRecorder();
    executor.attachCombinedRecorder(ctrl);
    await executor.run({});
    return { snapshot: executor.getSnapshot(), controlDeps: ctrl.asLookup() };
  }

  it('routes the slice through the decider with a labeled control hop', async () => {
    const { snapshot, controlDeps } = await runLoanChart();
    const approveId = (snapshot.commitLog as { stageId: string; runtimeStageId: string }[]).find(
      (bundle) => bundle.stageId === 'approve',
    )!.runtimeStageId;

    const report = await localizeContextBug({
      artifacts: { snapshot, controlDeps },
      embedder: embedder(),
      atStep: approveId,
    });

    // Non-agent chart → the honest 'stage' fallback classification.
    expect(report.suspects.every((suspect) => ['stage', 'arg'].includes(suspect.kind))).toBe(true);
    expect(report.sliceStats.controlEdges).toBeGreaterThan(0);

    // The decider appears as a suspect reached via a control hop carrying
    // the decide() rule label.
    const decider = report.suspects.find((suspect) => suspect.source.startsWith('adjudicate#'));
    expect(decider).toBeDefined();
    const controlHop = decider!.edgePath.find((hop) => hop.kind === 'control');
    expect(controlHop?.key).toBe('Within affordability');
    // And the wrong-computation stage is upstream of the decider.
    expect(report.suspects.some((suspect) => suspect.source.startsWith('normalize#'))).toBe(true);
    expect(formatContextBugReport(report)).toContain('[control: Within affordability]');
  });
});

// ── Security: the embedder never sees redacted values ────────────────

describe('localizeContextBug — security (redaction respected end-to-end)', () => {
  it('embeds placeholders, not the secret, for policy-redacted keys', async () => {
    const SECRET = 'SECRET-SSN-078-05-1120';
    type State = { ssn: string; summary: string; verdict: string };
    const chart = flowChart<State>(
      'Collect',
      async (scope) => {
        scope.ssn = SECRET;
        scope.summary = 'applicant summary text';
      },
      'collect',
    )
      .addFunction(
        'Assess',
        async (scope) => {
          scope.verdict = `assessed (${scope.ssn.length} chars on file, ${scope.summary})`;
        },
        'assess',
      )
      .build();
    const executor = new FlowChartExecutor(chart);
    executor.setRedactionPolicy({ keys: ['ssn'] });
    await executor.run({});
    const snapshot = executor.getSnapshot();
    const assessId = (snapshot.commitLog as { stageId: string; runtimeStageId: string }[]).find(
      (bundle) => bundle.stageId === 'assess',
    )!.runtimeStageId;

    const seen: string[] = [];
    const inner = mockEmbedder();
    const spy: Embedder = {
      dimensions: inner.dimensions,
      embed: async (args) => {
        seen.push(args.text);
        return inner.embed(args);
      },
      embedBatch: async (args) => {
        seen.push(...args.texts);
        return inner.embedBatch(args);
      },
    };

    await localizeContextBug({
      artifacts: { snapshot, llmCallIds: [assessId] },
      embedder: spy,
      atStep: assessId,
    });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.join('\n')).not.toContain(SECRET);
  });
});

// ── Pluggable influence scorer (the RANK extension point) ────────────

describe('localizeContextBug — pluggable scorer (scorer?:)', () => {
  it('defaults to scoreInfluence: omitting scorer === passing scoreInfluence explicitly', async () => {
    const scenario = plantedScenario();
    const original = await runPlantedScenario(scenario);
    const artifacts = { snapshot: original.snapshot, events: original.events };

    const def = await localizeContextBug({
      artifacts,
      embedder: embedder(),
      atStep: original.lastLlmCallId,
    });
    const explicit = await localizeContextBug({
      artifacts,
      embedder: embedder(),
      atStep: original.lastLlmCallId,
      scorer: scoreInfluence,
    });

    const shape = (report: ContextBugReport) =>
      report.suspects.map((s) => [s.source, s.kind, s.detail?.injectionId, s.semanticScore, s.score]);
    expect(shape(def)).toEqual(shape(explicit));
  });

  it('routes ranking through a custom scorer — its scores drive semanticScore, inverting the default order', async () => {
    const scenario = plantedScenario();
    const original = await runPlantedScenario(scenario);
    const artifacts = { snapshot: original.snapshot, events: original.events };

    // Default ranking: the planted VIP fact out-scores the benign style fact.
    const natural = await localizeContextBug({
      artifacts,
      embedder: embedder(),
      atStep: original.lastLlmCallId,
    });
    const naturalVip = findSuspect(natural, 'vip-override-fact')?.semanticScore;
    const naturalStyle = findSuspect(natural, 'style-fact')?.semanticScore;
    expect(naturalVip).toBeGreaterThan(naturalStyle!); // proxy ranks the plant high

    // A custom scorer that INVERTS it: anything mentioning "vip" scores low.
    const seen = { evidenceCount: 0, hasEmbedder: false, finalAnswerText: '' };
    const inverting: InfluenceScorer = async (args) => {
      seen.evidenceCount = args.evidence.length;
      seen.hasEmbedder = typeof args.embedder?.embed === 'function';
      seen.finalAnswerText = args.finalAnswerText;
      return args.evidence.map((item) => ({
        id: item.id,
        signals: { fa: 0, avg: 0, persist: 0, depth: 0 },
        weights: { fa: 1, avg: 0, persist: 0, depth: 0 },
        adapted: false,
        score: item.text.toLowerCase().includes('vip') ? 0.1 : 0.9,
      }));
    };

    const custom = await localizeContextBug({
      artifacts,
      embedder: embedder(),
      atStep: original.lastLlmCallId,
      scorer: inverting,
    });

    // The seam handed the scorer the localizer-assembled slice evidence,
    // the wrong-output text, and an embedder.
    expect(seen.evidenceCount).toBeGreaterThan(0);
    expect(seen.hasEmbedder).toBe(true);
    expect(seen.finalAnswerText).toContain('APPROVED');

    // The custom scores land verbatim as semanticScore — order inverted.
    expect(findSuspect(custom, 'vip-override-fact')?.semanticScore).toBeCloseTo(0.1);
    expect(findSuspect(custom, 'style-fact')?.semanticScore).toBeCloseTo(0.9);
    expect(findSuspect(custom, 'style-fact')!.semanticScore!).toBeGreaterThan(
      findSuspect(custom, 'vip-override-fact')!.semanticScore!,
    );
  });

  it('accepts scoreContrastiveInfluence wrapped with a referenceText (bring-your-own)', async () => {
    const scenario = plantedScenario();
    const original = await runPlantedScenario(scenario);

    // scoreContrastiveInfluence names the wrong-output field `answerText`
    // (vs ScoreInfluenceArgs.finalAnswerText) and needs a reference output —
    // so the wrap remaps that one field and supplies the reference.
    const contrastive: InfluenceScorer = (args) =>
      scoreContrastiveInfluence({
        evidence: args.evidence,
        answerText: args.finalAnswerText,
        referenceText: scenario.rightAnswer,
        embedder: args.embedder,
      });

    const report = await localizeContextBug({
      artifacts: { snapshot: original.snapshot, events: original.events },
      embedder: embedder(),
      atStep: original.lastLlmCallId,
      scorer: contrastive,
    });

    // The previously-unusable contrastive scorer now plugs into the localizer.
    expect(report.mode).toBe('correlational');
    expect(report.suspects.length).toBeGreaterThan(0);
    expect(findSuspect(report, 'vip-override-fact')?.hasContentEvidence).toBe(true);
  });
});
