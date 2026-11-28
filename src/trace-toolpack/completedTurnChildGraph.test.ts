import {
  flowChart,
  FlowChartExecutor,
  getSubtreeSnapshot,
  type RuntimeSnapshot,
} from 'footprintjs';
import { controlDepRecorder } from 'footprintjs/trace';
import { expect, it, vi } from 'vitest';

import {
  childNode,
  held,
  knobs,
  leaf,
  leafPaths,
  live,
  owner,
  runChild,
  scope,
  secret,
} from '../../test/trace-toolpack/completedTurnChildFixtures.js';
import { issueCompletedTurn } from '../core/agent/turnEvidence/completedTurnHandle.js';
import { readLogAddress } from '../recorders/observability/recordingParts/invocations.js';
import { assessCapture } from './causeCapture.js';
import { explainCompletedTurn } from './completedTurnWhy.js';

vi.mock('footprintjs', async (importOriginal) => {
  const original = await importOriginal<{ getSubtreeSnapshot: typeof getSubtreeSnapshot }>();
  return { ...original, getSubtreeSnapshot: vi.fn(original.getSubtreeSnapshot) };
});

function scopeVisits<T extends object>(tree: T, onVisit: () => void): T {
  return new Proxy(tree, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'runtimeStageId') onVisit();
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
}

function distinctFacts(name: 'sibling' | 'grandchild') {
  return flowChart(
    'Seed',
    (state) => {
      state.$setValue(`${name}Seed`, name);
    },
    'seed',
  )
    .addFunction(
      'Copy',
      (state) => {
        state.$setValue(`${name}Result`, state.$getValue(`${name}Seed`));
      },
      'copy',
    )
    .build();
}

it.each(['live', 'saved'] as const)(
  'visits one selected child while the sibling and grandchild share its name (%s)',
  async (source) => {
    const branch = flowChart<{ seed: string; result: string }>(
      'Seed',
      (state) => {
        state.seed = secret;
      },
      'seed',
    )
      .addFunction(
        'Copy',
        (state) => {
          state.result = state.seed;
        },
        'copy',
      )
      .addSubFlowChartNext('grandchild', distinctFacts('grandchild'), 'Grandchild')
      .build();
    const executor = new FlowChartExecutor(
      flowChart('Root', () => undefined, 'root')
        .addSubFlowChartNext('selected', branch, 'Selected')
        .addSubFlowChartNext('sibling', distinctFacts('sibling'), 'Sibling')
        .build(),
      knobs,
    );
    await executor.run();
    const snapshot = executor.getSnapshot();
    const results = snapshot.subflowResults;
    if (!results) throw Error('Expected child results');
    const paths = new Map(
      Object.values(results).map((entry) => [
        entry.subflowId,
        readLogAddress(entry.treeContext.logAddress)?.drillPath,
      ]),
    );
    const picked = paths.get('selected');
    const sibling = paths.get('sibling');
    const grandchild = [...paths.values()].find((path) => path?.length === 2);
    if (!picked || !sibling || !grandchild) throw Error('Expected three exact scopes');

    const { node, sourceId } = childNode(snapshot, picked);
    const selectedVisits = vi.fn();
    const siblingVisits = vi.fn();
    const grandchildVisits = vi.fn();
    const selectedRoot = results[picked.at(-1)!]!.treeContext.stageContexts;
    const subflowResults = { ...results };
    for (const [path, visit] of [
      [picked, selectedVisits],
      [sibling, siblingVisits],
      [grandchild, grandchildVisits],
    ] as const) {
      const key = path.at(-1)!;
      const result = results[key]!;
      const stageContexts = scopeVisits(
        { ...result.treeContext.stageContexts, runtimeStageId: selectedRoot.runtimeStageId },
        visit,
      );
      subflowResults[key] = { ...result, treeContext: { ...result.treeContext, stageContexts } };
    }
    const partial = { ...snapshot, subflowResults };
    const { origin, recording } = held(partial);
    const { subflowResults: _stripped, ...savedRoot } = partial;
    const readChild = vi.fn(async (path: readonly string[]) => subflowResults[path.at(-1)!]);
    const handle =
      source === 'live'
        ? live(partial)
        : issueCompletedTurn({
            owner,
            origin,
            scope,
            source: {
              kind: 'saved',
              receiptRef: 'selected-child',
              redeem: async (ref) => ({
                ref,
                originRunId: origin.runId,
                recording: { ...recording, snapshot: savedRoot },
                readChild,
              }),
            },
            allowed: () => true,
          });
    const answer = await explainCompletedTurn(owner, node, handle);
    expect(answer).toMatchObject({
      facts: [{ from: node.id, to: sourceId }],
      gaps: expect.arrayContaining(['scope-boundary', 'cause-incomplete']),
    });
    expect(JSON.stringify(answer)).not.toMatch(
      /siblingSeed|siblingResult|grandchildSeed|grandchildResult/,
    );
    expect(selectedVisits).toHaveBeenCalledTimes(1);
    expect(siblingVisits).not.toHaveBeenCalled();
    expect(grandchildVisits).not.toHaveBeenCalled();
    if (source === 'saved')
      expect(readChild).toHaveBeenCalledExactlyOnceWith(picked, expect.any(AbortSignal));
  },
);

it('retains a local edge with per-write attribution when the child prefix or parent seed is absent', async () => {
  const child = flowChart<{ input: string; seed: string; result: string }>(
    'Copy input',
    (state) => {
      state.seed = state.input;
    },
    'seed',
  )
    .addFunction(
      'Copy seed',
      (state) => {
        state.result = state.seed;
      },
      'copy',
    )
    .build();
  const executor = new FlowChartExecutor(
    flowChart<{ parentOnly: string }>(
      'Parent',
      (state) => {
        state.parentOnly = secret;
      },
      'root',
    )
      .addSubFlowChartNext('child', child, 'Child', {
        inputMapper: (outer) => ({ input: outer.parentOnly }),
      })
      .build(),
    { ...knobs, captureCoverage: true, writeTracking: 'full' },
  );
  executor.attachFlowRecorder(controlDepRecorder({ captureCoverage: true }));
  await executor.run();
  const snapshot = executor.getSnapshot();
  expect(snapshot.capture).toBeDefined();
  expect(assessCapture(snapshot, snapshot.commitLog?.length ?? 0).status).toBe('admitted');
  const path = leafPaths(snapshot)[0];
  if (!path) throw Error('Expected selected child');
  const mount = path.at(-1)!;
  const complete = childNode(snapshot, path);
  const result = snapshot.subflowResults?.[mount];
  if (!result) throw Error('Expected retained result');
  expect(await explainCompletedTurn(owner, complete.node, live(snapshot))).toMatchObject({
    facts: expect.arrayContaining([
      {
        from: complete.node.id,
        to: complete.sourceId,
        kind: 'data',
        attribution: 'per-write',
        evidence: expect.any(Array),
      },
    ]),
  });

  const partial = {
    ...snapshot,
    subflowResults: {
      ...snapshot.subflowResults,
      [mount]: {
        ...result,
        treeContext: { ...result.treeContext, history: result.treeContext.history.slice(1) },
      },
    },
  };
  const { node, sourceId } = childNode(partial, path);
  const explained = await explainCompletedTurn(owner, node, live(partial));
  expect(explained).toMatchObject({
    facts: [{ from: node.id, to: sourceId, kind: 'data', attribution: 'per-write' }],
    gaps: expect.arrayContaining(['cause-incomplete']),
  });
  expect(explained).not.toHaveProperty('rootCause');
  expect(JSON.stringify(explained)).not.toContain('parentOnly');
  expect(JSON.stringify(explained)).not.toContain(secret);
});

it('refuses a child without its own tree before entering the native subtree helper', async () => {
  const { snapshot, path, node, raw } = await runChild();
  if (!snapshot.executionTree) throw Error('Expected a recorded root tree');
  if (!raw) throw Error('Expected retained child');
  const { stageContexts: _removed, ...treeContext } = raw.treeContext;
  const parentVisits = vi.fn();
  const openSubtree = vi.mocked(getSubtreeSnapshot);
  openSubtree.mockClear();
  const broken = {
    ...snapshot,
    executionTree: scopeVisits(snapshot.executionTree, parentVisits),
    subflowResults: { [path.at(-1)!]: { ...raw, treeContext } },
  } as RuntimeSnapshot;
  expect(await explainCompletedTurn(owner, node, live(broken))).toEqual({
    gaps: ['subflow-evidence-unavailable'],
  });
  expect(openSubtree).not.toHaveBeenCalled();
  expect(parentVisits).not.toHaveBeenCalled();
});
