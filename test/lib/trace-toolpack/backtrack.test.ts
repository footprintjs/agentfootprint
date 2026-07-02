/**
 * `backtrack` tool — the variable-first triage entry of the toolpack.
 *
 * What is being pinned:
 * 1. VARIABLE-FIRST: no step id needed — "why is `quote` what it is?" works
 *    straight off the key, anchored at its last writer.
 * 2. ELEMENT MODE — the agent mega-key story: on a loop growing an array
 *    (the `history` shape), backtrack('history', element: N) names the exact
 *    iteration that produced element N, with the attribution basis.
 * 3. HONESTY: never-written keys explain the blind spot; out-of-range and
 *    not-an-array answers are corrective, not errors; chained-triage hints
 *    carry real commit indices.
 * 4. The tool ships in the pack and is reserved under selfExplain.
 */

import { flowChart, FlowChartExecutor } from 'footprintjs';
import { describe, expect, it } from 'vitest';

import { callTraceTool, traceToolpack, type TraceToolpackArtifacts } from '../../../src/observe.js';
import type { Tool } from '../../../src/index.js';

// ── Fixture 1: the mixed pipeline (variable-first slice) ───────────────────

interface QuoteState { rates: number[]; baseRate?: number; riskFactor?: number; quote?: number }

async function quoteFixture(): Promise<Tool[]> {
  const chart = flowChart<QuoteState>('LoadRates', async (scope) => {
    scope.rates = [3.1, 3.4, 9.9];
  }, 'load-rates')
    .addFunction('PickBase', async (scope) => {
      scope.baseRate = scope.rates[2];
    }, 'pick-base')
    .addFunction('AssessRisk', async (scope) => {
      scope.riskFactor = 1.2;
    }, 'assess-risk')
    .addFunction('Quote', async (scope) => {
      scope.quote = scope.baseRate! * scope.riskFactor!;
    }, 'quote')
    .build();
  const executor = new FlowChartExecutor(chart, { commitValues: 'delta' });
  await executor.run();
  const artifacts: TraceToolpackArtifacts = { snapshot: executor.getSnapshot() };
  return traceToolpack(artifacts);
}

// ── Fixture 2: the history-shaped loop (element mode) ──────────────────────

interface LoopState { history: string[]; round?: number }

async function historyFixture(): Promise<Tool[]> {
  const chart = flowChart<LoopState>('Seed', async (scope) => {
    scope.history = ['user-question'];
    scope.round = 0;
  }, 'seed')
    .addFunction('Work', async (scope) => {
      scope.round = scope.round! + 1;
      scope.history.push(`tool-result-${scope.round}`);
    }, 'work')
    .addDeciderFunction('Check', async (scope) => (scope.round! < 3 ? 'again' : 'done'), 'check')
    .addFunctionBranch('again', 'Loop', async () => { /* hop */ }, undefined, { loopTo: 'work' })
    .addFunctionBranch('done', 'Finish', async () => { /* end */ })
    .setDefault('done')
    .end()
    .build();
  const executor = new FlowChartExecutor(chart, { commitValues: 'delta' });
  await executor.run();
  return traceToolpack({ snapshot: executor.getSnapshot() });
}

describe('backtrack — variable-first slice mode', () => {
  it('ships in the pack', async () => {
    const tools = await quoteFixture();
    expect(tools.map((t) => t.schema.name)).toContain('backtrack');
  });

  it("answers 'why is quote what it is?' with the full chain, no step id needed", async () => {
    const tools = await quoteFixture();
    const out = await callTraceTool(tools, 'backtrack', { variable: 'quote' });
    expect(out).toContain("SLICE for 'quote'");
    expect(out).toContain('Quote');
    expect(out).toContain('PickBase');
    expect(out).toContain('LoadRates'); // transitive: quote ← baseRate ← rates
    expect(out).toContain('AssessRisk');
    expect(out).toContain('trace_node'); // drill hint for the next hop
  });

  it('honest absence: a never-written variable explains the blind spot', async () => {
    const tools = await quoteFixture();
    const out = await callTraceTool(tools, 'backtrack', { variable: 'discount' });
    expect(out).toContain('never written');
    expect(out).toContain('initial state');
    expect(out).toContain('closure');
  });

  it('`before` time-travels the anchor', async () => {
    const tools = await quoteFixture();
    // rates is written at commit 0; before:1 still finds it, before:0 cannot.
    const at1 = await callTraceTool(tools, 'backtrack', { variable: 'rates', before: 1 });
    expect(at1).toContain("SLICE for 'rates'");
    const at0 = await callTraceTool(tools, 'backtrack', { variable: 'rates', before: 0 });
    expect(at0).toContain('never written');
  });
});

describe('backtrack — element mode (the history mega-key story)', () => {
  it('names the exact loop iteration that produced history[2]', async () => {
    const tools = await historyFixture();
    const out = await callTraceTool(tools, 'backtrack', { variable: 'history', element: 2 });
    expect(out).toContain("'history'[2]");
    expect(out).toContain('tool-result-2');
    expect(out).toMatch(/born at work#\d+/); // a SPECIFIC execution of `work`
    expect(out).toContain('append-verb'); // delta mode → engine-recorded, exact
    expect(out).toContain('exact');
    // The chained-triage hint carries a real commit index for `before`.
    expect(out).toMatch(/before: \d+/);
  });

  it('different elements name DIFFERENT executions (per-iteration attribution)', async () => {
    const tools = await historyFixture();
    const born = async (i: number) =>
      (await callTraceTool(tools, 'backtrack', { variable: 'history', element: i })).match(/born at (\S+?) /)![1];
    expect(await born(0)).toMatch(/^seed#/);
    const w1 = await born(1);
    const w3 = await born(3);
    expect(w1).toMatch(/^work#/);
    expect(w3).toMatch(/^work#/);
    expect(w1).not.toBe(w3); // distinct iterations, distinct runtimeStageIds
  });

  it('out-of-range and non-array answers are corrective, not errors', async () => {
    const tools = await historyFixture();
    const oor = await callTraceTool(tools, 'backtrack', { variable: 'history', element: 99 });
    expect(oor).toContain('out of range');
    expect(oor).toContain('Valid indices: 0..3');
    const scalar = await callTraceTool(tools, 'backtrack', { variable: 'round', element: 0 });
    expect(scalar).toContain('not an array');
    expect(scalar).toContain("without 'element'");
  });
});
