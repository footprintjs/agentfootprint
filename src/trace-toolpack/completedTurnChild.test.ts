import { flowChart, FlowChartExecutor } from 'footprintjs';
import { expect, it } from 'vitest';

import {
  childNode,
  knobs,
  leaf,
  leafPaths,
  live,
  owner,
  runChild,
  secret,
} from '../../test/trace-toolpack/completedTurnChildFixtures.js';
import { readLogAddress } from '../recorders/observability/recordingParts/invocations.js';
import { explainCompletedTurn } from './completedTurnWhy.js';

it('follows an exact nested child to its own source and refuses an alias and the wrong ancestor', async () => {
  const parent = flowChart('Parent', () => undefined, 'branch')
    .addSubFlowChartNext('leaf', leaf(), 'Leaf')
    .build();
  const root = flowChart('Root', () => undefined, 'root')
    .addSubFlowChartNext('parent', parent, 'Parent')
    .build();
  const executor = new FlowChartExecutor(root, knobs);
  await executor.run();
  const snapshot = executor.getSnapshot();
  const path = leafPaths(snapshot).find((entry) => entry.length === 2);
  if (!path) throw Error('Expected nested path');
  const { node, sourceId } = childNode(snapshot, path);
  const turn = live(snapshot);
  const result = await explainCompletedTurn(owner, node, turn);
  expect(result).toMatchObject({
    facts: [{ from: node.id, to: sourceId, kind: 'data', attribution: 'per-write' }],
    gaps: expect.arrayContaining(['cause-incomplete']),
  });
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(
    await explainCompletedTurn(
      owner,
      { ...node, logAddress: { ...node.logAddress, drillPath: ['leaf'] } },
      turn,
    ),
  ).toEqual({ gaps: ['turn-unavailable'] });
  expect(
    await explainCompletedTurn(
      owner,
      { ...node, logAddress: { ...node.logAddress, drillPath: ['unrelated#0', path[1]!] } },
      turn,
    ),
  ).toEqual({ gaps: ['subflow-evidence-unavailable'] });
});

it.each(['same', 'fresh', 'withheld'] as const)(
  'uses only the engine-served earlier child after %s resume',
  async (mode) => {
    const root = flowChart('Root', () => undefined, 'root')
      .addSubFlowChartNext('before', leaf(), 'Before')
      .addPausableFunction('Wait', { execute: () => 'Continue?', resume: () => undefined }, 'pause')
      .addSubFlowChartNext('after', leaf(), 'After')
      .build();
    let executor = new FlowChartExecutor(root, knobs);
    await executor.run();
    const paused = executor.getSnapshot();
    const path = leafPaths(paused)[0];
    const checkpoint = executor.getCheckpoint();
    if (!path || !checkpoint) throw Error('Expected a paused child prefix');
    const before = childNode(paused, path).node;
    if (mode === 'fresh') executor = new FlowChartExecutor(root, knobs);
    if (mode === 'withheld') executor.setRedactionPolicy({ keys: ['seed'] });
    await executor.resume(
      mode === 'fresh' ? JSON.parse(JSON.stringify(checkpoint)) : checkpoint,
      true,
    );
    const snapshot = executor.getSnapshot({ redact: true, resumePrefix: true });
    if (!snapshot.runId || !snapshot.logAddress) throw Error('Expected resumed root');
    const selected = {
      ...before,
      runId: snapshot.runId,
      logAddress: { logRunId: snapshot.logAddress.logRunId, drillPath: path },
    };
    const result = await explainCompletedTurn(owner, selected, live(snapshot));
    if (mode === 'same') expect(result).toMatchObject({ facts: [{ from: selected.id }] });
    else expect(result).toEqual({ gaps: ['subflow-evidence-unavailable'] });
    expect(JSON.stringify(result)).not.toContain(secret);

    if (mode === 'withheld') {
      expect(snapshot.subflowEvidenceGap).toBe('retained-child-evidence-withheld');
      const absent = { ...snapshot };
      delete absent.subflowEvidenceGap;
      expect(JSON.stringify(await explainCompletedTurn(owner, selected, live(absent)))).toBe(
        JSON.stringify(result),
      );
      const visible = leafPaths(snapshot)[0];
      if (!visible) throw Error('Expected an accessible sibling');
      const sibling = childNode(snapshot, visible);
      expect(await explainCompletedTurn(owner, sibling.node, live(snapshot))).toMatchObject({
        facts: [{ from: sibling.node.id, to: sibling.sourceId }],
      });
    }
  },
);

it('opens each execution of a repeated mount without substituting the latest alias', async () => {
  const executor = new FlowChartExecutor(
    flowChart<{ loops: number }>(
      'Root',
      (state) => {
        state.loops = 0;
      },
      'root',
    )
      .addFunction('Loop body', () => undefined, 'body')
      .addSubFlowChartNext('repeated', leaf(), 'Repeated')
      .addFunction(
        'Stop',
        (state) => {
          state.loops += 1;
          if (state.loops === 2) state.$break();
        },
        'stop',
      )
      .loopTo('body')
      .build(),
    knobs,
  );
  await executor.run();
  const snapshot = executor.getSnapshot();
  const exact = Object.entries(snapshot.subflowResults ?? {}).flatMap(([key, result]) => {
    const path = readLogAddress(result.treeContext.logAddress)?.drillPath;
    return path?.at(-1) === key ? [path] : [];
  });
  expect(exact).toHaveLength(2);
  const prior = childNode(snapshot, exact[0]!);
  const later = childNode(snapshot, exact[1]!);
  expect(prior.node.id).not.toBe(later.node.id);
  const turn = live(snapshot);
  for (const { node, sourceId } of [prior, later]) {
    expect(await explainCompletedTurn(owner, node, turn)).toMatchObject({
      facts: [{ from: node.id, to: sourceId, kind: 'data', attribution: 'per-write' }],
    });
  }
});

it('keeps both an unaddressed older child and a child beyond the existing graph bound uncertain', async () => {
  const { snapshot, path, node, raw } = await runChild();
  if (!raw) throw Error('Expected retained result');
  const key = path.at(-1)!;
  const { logAddress: _address, ...legacyContext } = raw.treeContext;
  const legacy = {
    ...snapshot,
    subflowResults: { [key]: { ...raw, treeContext: legacyContext } },
  };
  expect(await explainCompletedTurn(owner, node, live(legacy))).toEqual({
    gaps: ['subflow-evidence-unavailable'],
  });
  const oversized = {
    ...snapshot,
    subflowResults: {
      [key]: {
        ...raw,
        treeContext: { ...raw.treeContext, history: Array(4097).fill(raw.treeContext.history[0]) },
      },
    },
  };
  expect(await explainCompletedTurn(owner, node, live(oversized))).toMatchObject({
    facts: [],
    gaps: expect.arrayContaining(['cause-truncated']),
  });
});
