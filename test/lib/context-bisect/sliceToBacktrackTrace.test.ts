/**
 * sliceToBacktrackTrace — structural slice → atui BacktrackTrace.
 *
 * What is being pinned:
 * 1. STRUCTURAL HONESTY: mode always 'correlational'; every card
 *    upperBound (hatched meter); the score formula named in honesty lines;
 *    no verdict is ever fabricated.
 * 2. Slice honesty rides along: reads-coverage warning, truncation, per-node
 *    incomplete-sources, and honest ABSENCE (empty board, reason stated).
 * 3. Shape fidelity end-to-end from a REAL run: sliceToJSON (footprintjs)
 *    → mapper → the contract atui renders (decidedAt/edges/paths/folded).
 */

import { flowChart, FlowChartExecutor } from 'footprintjs';
import { keysReadFromExecutionTree, sliceForKey, sliceToJSON, type SliceJSON } from 'footprintjs/trace';
import { describe, expect, it } from 'vitest';

import { sliceToBacktrackTrace } from '../../../src/debug.js';

const ANSWER = { text: 'The quote is 11.88.' };

interface QuoteState { rates: number[]; baseRate?: number; riskFactor?: number; quote?: number }

async function realSlice(): Promise<SliceJSON> {
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
  const snap = executor.getSnapshot();
  return sliceToJSON(sliceForKey(snap.commitLog, 'quote', keysReadFromExecutionTree(snap.executionTree)));
}

describe('sliceToBacktrackTrace — real run end-to-end', () => {
  it('maps the slice onto the board with the writer as decidedAt and honest chips', async () => {
    const trace = sliceToBacktrackTrace(await realSlice(), { answer: ANSWER, agent: 'QuoteBot' });
    expect(trace.mode).toBe('correlational');
    expect(trace.modeLabel).toContain('not ablation-tested');
    expect(trace.decidedAt.id).toMatch(/^quote#/);
    expect(trace.decidedAt.label).toBe('Quote');
    expect(trace.answer).toEqual(ANSWER);
    // Every upstream stage is a card; all path-only upper bounds, no verdicts.
    const names = trace.suspects.map((s) => s.name);
    expect(names).toContain('PickBase');
    expect(names).toContain('AssessRisk');
    expect(names).toContain('LoadRates');
    expect(trace.suspects.every((s) => s.upperBound === true)).toBe(true);
    expect(trace.suspects.every((s) => s.verdict === undefined)).toBe(true);
    // Inbound edges carry the linking key.
    const pick = trace.suspects.find((s) => s.name === 'PickBase')!;
    expect(pick.edge?.key).toBe('baseRate');
    expect(pick.edge?.kind).toBe('data');
    // Depth-2 nodes get a multi-hop path.
    const load = trace.suspects.find((s) => s.name === 'LoadRates')!;
    expect(load.path).toBeDefined();
    expect(load.path!.map((h) => h.key)).toContain('rates');
    // The honesty lines name the score formula — nobody reads hops as influence.
    expect(trace.honesty!.join('\n')).toContain('hop proximity');
    expect(trace.honesty!.join('\n')).toContain('only ablation verdicts make causal claims');
  });

  it('claim defaults to the variable question; consumer claim wins', async () => {
    const json = await realSlice();
    expect(sliceToBacktrackTrace(json, { answer: ANSWER }).claim).toBe("Why is 'quote' what it is?");
    expect(sliceToBacktrackTrace(json, { answer: ANSWER, claim: 'Why 11.88?' }).claim).toBe('Why 11.88?');
  });
});

describe('sliceToBacktrackTrace — honesty units (hand-built slices)', () => {
  it('honest absence: never-written renders an empty board that says why', () => {
    const json: SliceJSON = { key: 'ghost', missing: 'never-written', keysReadKind: 'map' };
    const trace = sliceToBacktrackTrace(json, { answer: ANSWER });
    expect(trace.suspects).toHaveLength(0);
    expect(trace.honesty!.join('\n')).toContain('never written');
    expect(trace.honesty!.join('\n')).toContain('closure');
    expect(trace.decidedAt.label).toContain('no recorded writer');
  });

  it('reads-coverage zero → the readTracking-off warning', () => {
    const json: SliceJSON = {
      key: 'x',
      keysReadKind: 'execution-tree',
      readsCoverage: { steps: 5, stepsWithReads: 0 },
      writerId: 'w#0',
      nodes: { 'w#0': { stageId: 'w', stageName: 'W', keysWritten: ['x'], depth: 0 } },
      edges: [],
    };
    const trace = sliceToBacktrackTrace(json, { answer: ANSWER });
    expect(trace.honesty!.join('\n')).toContain('reads were not recorded');
    expect(trace.honesty!.join('\n')).toContain('NOT absent');
  });

  it('truncation and incomplete-sources surface as ⚠ lines', () => {
    const json: SliceJSON = {
      key: 'x',
      keysReadKind: 'map',
      writerId: 'w#1',
      truncated: { byDepth: true, byNodes: false },
      nodes: {
        'w#1': { stageId: 'w', stageName: 'W', keysWritten: ['x'], depth: 0 },
        'p#0': { stageId: 'p', stageName: 'P', keysWritten: ['y'], depth: 1, incompleteSources: ['args'] },
      },
      edges: [{ from: 'w#1', to: 'p#0', kind: 'data', key: 'y', weight: 1 }],
    };
    const trace = sliceToBacktrackTrace(json, { answer: ANSWER });
    const h = trace.honesty!.join('\n');
    expect(h).toContain('truncated');
    expect(h).toContain('untracked inputs');
  });

  it('maxSuspects folds the tail with full disclosure', () => {
    const nodes: NonNullable<SliceJSON['nodes']> = {
      'w#9': { stageId: 'w', stageName: 'W', keysWritten: ['x'], depth: 0 },
    };
    const edges: NonNullable<SliceJSON['edges']> = [];
    for (let i = 0; i < 8; i++) {
      nodes[`p${i}#${i}`] = { stageId: `p${i}`, stageName: `P${i}`, keysWritten: [`k${i}`], depth: 1 };
      edges.push({ from: 'w#9', to: `p${i}#${i}`, kind: 'data', key: `k${i}`, weight: 1 });
    }
    const trace = sliceToBacktrackTrace(
      { key: 'x', keysReadKind: 'map', writerId: 'w#9', nodes, edges },
      { answer: ANSWER, maxSuspects: 3 },
    );
    expect(trace.suspects).toHaveLength(3);
    expect(trace.folded).toContain('5 more steps folded');
    expect(trace.folded).toContain('drillable');
  });

  it('score is the documented proximity formula, capped board-safe', () => {
    const json: SliceJSON = {
      key: 'x',
      keysReadKind: 'map',
      writerId: 'w#1',
      nodes: {
        'w#1': { stageId: 'w', stageName: 'W', keysWritten: ['x'], depth: 0 },
        'a#0': { stageId: 'a', stageName: 'A', keysWritten: ['y'], depth: 1 },
        'b#0': { stageId: 'b', stageName: 'B', keysWritten: ['z'], depth: 3 },
      },
      edges: [],
    };
    const trace = sliceToBacktrackTrace(json, { answer: ANSWER });
    expect(trace.suspects.find((s) => s.name === 'A')!.score).toBe(0.5); // 1/(1+1)
    expect(trace.suspects.find((s) => s.name === 'B')!.score).toBe(0.25); // 1/(1+3)
  });
});
