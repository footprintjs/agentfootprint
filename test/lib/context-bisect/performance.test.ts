/**
 * context-bisect — performance / load tiers.
 *
 * Budgets are calibrated for the SLOWEST CI runner (the 9.7.0 release
 * lesson): generous wall-clock ceilings; the LOAD assertions are about
 * BOUNDEDNESS (suspect cap, slice budgets honored, embedder call volume
 * bounded by the cache), which is what actually protects production.
 */
import { describe, expect, it } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';

import { mockEmbedder } from '../../../src/memory/embedding/mockEmbedder';
import { embeddingCache, type Embedder } from '../../../src/lib/influence-core';
import { localizeContextBug } from '../../../src/lib/context-bisect';

/** A loop-shaped run: `iterations` × (gather → think → act) executions. */
async function runLoopChart(iterations: number) {
  type State = { i: number; gathered: string; thought: string; acted: string };
  const chart = flowChart<State>(
    'Seed',
    async (scope) => {
      scope.i = 0;
      scope.gathered = '';
    },
    'seed',
  )
    .addFunction(
      'Gather',
      async (scope) => {
        scope.gathered = `evidence batch ${scope.i}: sensor drift readings and calibration notes`;
      },
      'gather',
    )
    .addFunction(
      'Think',
      async (scope) => {
        scope.thought = `analysis of ${scope.gathered}`;
        scope.i = scope.i + 1;
      },
      'think',
    )
    .addDeciderFunction(
      'Loop',
      (scope) => ((scope as unknown as State).i < iterations ? 'again' : 'done'),
      'loop',
    )
    .addFunctionBranch(
      'again',
      'Again',
      async () => {
        /* loop hop — no state change */
      },
      undefined,
      { loopTo: 'gather' },
    )
    .addFunctionBranch('done', 'Act', async (scope) => {
      scope.acted = `final action after ${scope.i} rounds: ${scope.thought}`;
    })
    .setDefault('done')
    .end()
    .build();
  const executor = new FlowChartExecutor(chart);
  await executor.run({});
  return executor.getSnapshot();
}

describe('context-bisect — performance', () => {
  it('localizes a ~300-commit loop run within a generous budget', { timeout: 30000 }, async () => {
    const snapshot = await runLoopChart(80); // ~320+ commits
    const commitLog = snapshot.commitLog as { stageId: string; runtimeStageId: string }[];
    expect(commitLog.length).toBeGreaterThan(250);
    const actId = [...commitLog]
      .reverse()
      .find((bundle) => bundle.stageId === 'done')!.runtimeStageId;
    const thinkIds = commitLog
      .filter((bundle) => bundle.stageId === 'think')
      .map((bundle) => bundle.runtimeStageId);

    const startedAt = Date.now();
    const report = await localizeContextBug({
      artifacts: { snapshot, llmCallIds: thinkIds },
      embedder: embeddingCache(mockEmbedder()),
      atStep: actId,
    });
    const elapsedMs = Date.now() - startedAt;

    expect(report.suspects.length).toBeGreaterThan(0);
    // Slowest-runner ceiling — this is a smoke budget, not a benchmark.
    expect(elapsedMs).toBeLessThan(15000);
  });
});

describe('context-bisect — load (boundedness)', () => {
  it('honors slice budgets and the suspect cap on a long run', { timeout: 30000 }, async () => {
    const snapshot = await runLoopChart(80);
    const commitLog = snapshot.commitLog as { stageId: string; runtimeStageId: string }[];
    const actId = [...commitLog]
      .reverse()
      .find((bundle) => bundle.stageId === 'done')!.runtimeStageId;

    let embedCalls = 0;
    const inner = mockEmbedder();
    const counting: Embedder = {
      dimensions: inner.dimensions,
      embed: async (args) => {
        embedCalls++;
        return inner.embed(args);
      },
      embedBatch: async (args) => {
        embedCalls += args.texts.length;
        return inner.embedBatch(args);
      },
    };

    const report = await localizeContextBug({
      artifacts: {
        snapshot,
        llmCallIds: commitLog
          .filter((bundle) => bundle.stageId === 'think')
          .map((bundle) => bundle.runtimeStageId),
      },
      embedder: embeddingCache(counting),
      atStep: actId,
      maxDepth: 6,
      maxNodes: 20,
      maxSuspects: 5,
    });

    expect(report.suspects.length).toBeLessThanOrEqual(5);
    expect(report.sliceStats.nodes).toBeLessThanOrEqual(20);
    // Truncation of a long history is REPORTED, never silent.
    expect(report.honestyFlags.map((flag) => flag.flag)).toContain('slice-truncated');
    // The cache bounds embedding volume: dedup keeps calls well under the
    // number of edges × samples a naive implementation would issue.
    expect(embedCalls).toBeLessThan(200);
  });
});
