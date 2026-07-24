/**
 * rerunWithoutSources / removableSources — the one-call counterfactual
 * re-run over the planted-fact scenario. Everything $0: mock provider, mock
 * embedder, a domain outcome comparator (APPROVED vs DECLINED).
 *
 * The report is built ONCE in correlational mode (no rerun); each test then
 * drives the product loop off it.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mockEmbedder } from '../../../src/memory/embedding/mockEmbedder';
import { embeddingCache } from '../../../src/lib/influence-core';
import {
  localizeContextBug,
  removableSources,
  rerunWithoutSources,
  type AblationRunner,
  type AblationSpec,
  type ContextBugReport,
} from '../../../src/lib/context-bisect';
import {
  decisionChanged,
  plantedScenario,
  runPlantedScenario,
  type PlantedScenario,
} from './plantedFactFixture';

const embedder = () => embeddingCache(mockEmbedder());

let scenario: PlantedScenario;
let report: ContextBugReport;
let originalAnswer: string;
let runner: AblationRunner;

beforeAll(async () => {
  scenario = plantedScenario();
  const original = await runPlantedScenario(scenario);
  originalAnswer = original.content;
  expect(originalAnswer).toContain('APPROVED'); // the bug manifests
  runner = async (specs) => (await runPlantedScenario(scenario, specs)).content;
  report = await localizeContextBug({
    artifacts: {
      snapshot: original.snapshot,
      controlDeps: original.controlDeps,
      events: original.events,
    },
    embedder: embedder(),
    atStep: original.lastLlmCallId,
  });
  expect(report.mode).toBe('correlational');
}, 30000);

const common = () => ({
  report,
  runner,
  originalAnswer,
  embedder: embedder(),
  answerChanged: decisionChanged,
});

describe('rerunWithoutSources — round-trip flip (observed tier)', () => {
  it('ignoring the decisive fact flips APPROVED → DECLINED', { timeout: 30000 }, async () => {
    const result = await rerunWithoutSources({ ...common(), ignore: ['vip-override-fact'] });
    expect(result.answer).toContain('DECLINED');
    expect(result.answers.length).toBe(result.runs.samples);
    expect(result.answers[0]).toBe(result.answer);
    expect(result.whatChanged.answerFlipped).toBe(true);
    expect(result.whatChanged.flips).toBe(result.whatChanged.samples);
    expect(result.removed).toEqual([
      { kind: 'injection', excludeInjectionIds: ['vip-override-fact'] },
    ]);
    expect(result.verdict).toBeUndefined();
    expect(result.baseline).toBeUndefined();
    expect(result.whatChanged.baselineChecked).toBe(false);
    expect(result.whatChanged.summary).toContain('checkBaseline');
  });
});

describe('rerunWithoutSources — innocent source', () => {
  it('ignoring the benign fact does not change the answer', { timeout: 30000 }, async () => {
    const result = await rerunWithoutSources({ ...common(), ignore: ['style-fact'] });
    expect(result.whatChanged.answerFlipped).toBe(false);
    expect(result.answer).toContain('APPROVED');
    expect(result.whatChanged.summary).toContain('did not change the answer');
  });
});

describe('rerunWithoutSources — id resolution', () => {
  it('matches by toolName', { timeout: 30000 }, async () => {
    const result = await rerunWithoutSources({ ...common(), ignore: ['lookup_order'] });
    expect(result.removed).toEqual([{ kind: 'tool', ignoredTools: ['lookup_order'] }]);
  });

  it(
    'matches by runtimeStageId (same spec as the injectionId path)',
    { timeout: 30000 },
    async () => {
      const vip = report.suspects.find((s) => s.detail?.injectionId === 'vip-override-fact')!;
      const result = await rerunWithoutSources({ ...common(), ignore: [vip.source] });
      expect(result.removed).toEqual([
        { kind: 'injection', excludeInjectionIds: ['vip-override-fact'] },
      ]);
    },
  );

  it('throws on an unknown id, listing the removable ids', async () => {
    await expect(rerunWithoutSources({ ...common(), ignore: ['no-such-source'] })).rejects.toThrow(
      /vip-override-fact/,
    );
  });

  it('dedupes duplicate string ids', { timeout: 30000 }, async () => {
    const result = await rerunWithoutSources({
      ...common(),
      ignore: ['vip-override-fact', 'vip-override-fact'],
    });
    expect(result.removed).toHaveLength(1);
  });

  it('passes an explicit spec through untouched', { timeout: 30000 }, async () => {
    const spec: AblationSpec = { kind: 'injection', excludeInjectionIds: ['vip-override-fact'] };
    const result = await rerunWithoutSources({ ...common(), ignore: [spec] });
    expect(result.removed).toEqual([spec]);
    expect(result.whatChanged.answerFlipped).toBe(true);
  });

  it('throws on empty ignore', async () => {
    await expect(rerunWithoutSources({ ...common(), ignore: [] })).rejects.toThrow(
      /ignore is empty/,
    );
  });
});

describe('rerunWithoutSources — samples', () => {
  it('clamps samples to >= 2 and defaults to 3', { timeout: 30000 }, async () => {
    const clamped = await rerunWithoutSources({
      ...common(),
      ignore: ['vip-override-fact'],
      samples: 1,
    });
    expect(clamped.runs.samples).toBe(2);
    const dflt = await rerunWithoutSources({ ...common(), ignore: ['vip-override-fact'] });
    expect(dflt.runs.samples).toBe(3);
  });

  it(
    'calls the runner with seeds 0..N-1 and the resolved specs each time',
    { timeout: 30000 },
    async () => {
      const spy = vi.fn(runner);
      await rerunWithoutSources({
        ...common(),
        runner: spy,
        ignore: ['vip-override-fact'],
        samples: 3,
      });
      expect(spy).toHaveBeenCalledTimes(3);
      const seeds = spy.mock.calls.map((c) => c[1].seed).sort();
      expect(seeds).toEqual([0, 1, 2]);
      for (const call of spy.mock.calls) {
        expect(call[0]).toEqual([
          { kind: 'injection', excludeInjectionIds: ['vip-override-fact'] },
        ]);
      }
    },
  );
});

describe('rerunWithoutSources — causal tier (checkBaseline)', () => {
  it('confirms a causal verdict on a stable baseline', { timeout: 30000 }, async () => {
    const result = await rerunWithoutSources({
      ...common(),
      ignore: ['vip-override-fact'],
      checkBaseline: true,
    });
    expect(result.baseline).toBeDefined();
    expect(result.verdict?.verdict).toBe('confirmed');
    expect(result.verdict?.claim.startsWith('CAUSAL')).toBe(true);
    expect(result.whatChanged.baselineChecked).toBe(true);
  });

  it('reports inconclusive on an unstable baseline', { timeout: 30000 }, async () => {
    // A runner whose UN-ablated (empty-specs) baseline itself flips vs the
    // original → the scenario is not reproducible, so no verdict is trustworthy.
    const flaky: AblationRunner = async (specs) =>
      specs.length === 0 ? 'Refund DECLINED (flaky baseline)' : 'Refund DECLINED';
    const result = await rerunWithoutSources({
      report,
      runner: flaky,
      originalAnswer,
      embedder: embedder(),
      answerChanged: decisionChanged,
      ignore: ['vip-override-fact'],
      checkBaseline: true,
    });
    expect(result.verdict?.verdict).toBe('inconclusive');
    expect(result.whatChanged.summary).toContain('unstable scenario');
  });
});

describe('rerunWithoutSources — cost passthrough', () => {
  it('surfaces runs.cost when the runner reports RunCost', { timeout: 30000 }, async () => {
    const costed: AblationRunner = async () => ({
      output: 'Refund DECLINED',
      cost: { loops: 1, tokens: 100 },
    });
    const result = await rerunWithoutSources({
      report,
      runner: costed,
      originalAnswer,
      embedder: embedder(),
      answerChanged: decisionChanged,
      ignore: ['vip-override-fact'],
    });
    expect(result.runs.cost).toBeDefined();
  });
});

describe('removableSources', () => {
  it('offers deduped tool/injection/memory toggles in ranked order', () => {
    const rows = removableSources(report);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('vip-override-fact');
    expect(ids).toContain('style-fact');
    expect(ids).toContain('lookup_order');
    // no plain-stage / arg rows
    for (const r of rows) {
      expect(r.kind === 'tool' || r.kind === 'injection' || r.kind === 'memory').toBe(true);
    }
    // deduped
    expect(new Set(ids).size).toBe(ids.length);
    // each row is well-formed and points at a real suspect
    for (const r of rows) {
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.spec).toBeDefined();
      expect(Number.isFinite(r.score)).toBe(true);
      expect(report.suspects.some((s) => s.source === r.source)).toBe(true);
    }
    // order follows the suspect ranking (rows appear in first-seen suspect order)
    const rankOf = (id: string) =>
      report.suspects.findIndex(
        (s) => s.detail?.injectionId === id || s.detail?.toolName === id || s.source === id,
      );
    for (let i = 1; i < rows.length; i++) {
      expect(rankOf(rows[i].id)).toBeGreaterThan(rankOf(rows[i - 1].id));
    }
  });
});
