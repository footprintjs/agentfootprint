import {
  flowChart,
  FlowChartExecutor,
  getSubtreeSnapshot,
  type RuntimeSnapshot,
} from 'footprintjs';
import { explain } from 'footprintjs/explain';
import { createRecordGraph } from 'foottrace/cause';
import { expect, it, vi } from 'vitest';

import { issueCompletedTurn } from '../core/agent/turnEvidence/completedTurnHandle.js';
import type { AgentfootprintEventMap } from '../events/registry.js';
import { readLogAddress } from '../recorders/observability/recordingParts/invocations.js';
import { explainCompletedTurn } from './completedTurnWhy.js';

const secret = 'PRIVATE-CHILD-SEED';
const owner = {};
const scope = { principal: 'operator', conversation: 'fixture', tenant: 'tenant' };
const { nodeId } = createRecordGraph([]);
vi.mock('footprintjs', async (importOriginal) => {
  const original = await importOriginal<{ getSubtreeSnapshot: typeof getSubtreeSnapshot }>();
  return { ...original, getSubtreeSnapshot: vi.fn(original.getSubtreeSnapshot) };
});

const knobs = {
  writeProvenance: 'reads-prefix',
  readTracking: 'full',
  captureOutputHandoff: true,
} as const;

function leaf() {
  return flowChart<{ seed: string; result: string }>(
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
    .build();
}

function childNode(snapshot: RuntimeSnapshot, path: readonly string[]) {
  const result = snapshot.subflowResults?.[path.at(-1) ?? ''];
  const address = readLogAddress(result?.treeContext.logAddress);
  const history = result?.treeContext.history;
  if (!address || !history || !snapshot.runId) throw Error('Expected exact recorded child');
  const copy = history.findIndex((entry) => entry.trace?.some((row) => row.path === 'result'));
  const seed = history.findIndex((entry) => entry.trace?.some((row) => row.path === 'seed'));
  if (copy === -1 || seed === -1) throw Error('Expected child seed and copy');
  return {
    node: {
      id: nodeId(address, {
        commitIdx: copy,
        runtimeStageId: history[copy]!.runtimeStageId,
        key: 'result',
      }),
      runId: snapshot.runId,
      logAddress: address,
    },
    sourceId: nodeId(address, {
      commitIdx: seed,
      runtimeStageId: history[seed]!.runtimeStageId,
      key: 'seed',
    }),
    raw: result,
  };
}

function held(snapshot: RuntimeSnapshot) {
  const { runId, logAddress } = snapshot;
  if (!runId || !logAddress) throw Error('Expected exact root');
  const terminal: AgentfootprintEventMap['agentfootprint.agent.turn_end'] = {
    type: 'agentfootprint.agent.turn_end',
    payload: {
      turnIndex: 0,
      finalContent: 'fixture',
      totalInputTokens: 0,
      totalOutputTokens: 0,
      iterationCount: 1,
      durationMs: 0,
    },
    meta: {
      runId,
      runtimeStageId: 'terminal',
      subflowPath: [],
      compositionPath: [],
      wallClockMs: 0,
      runOffsetMs: 0,
    },
  };
  return {
    origin: { runId, engineRunId: runId, logAddress },
    recording: { snapshot, events: [terminal] },
  };
}

function live(snapshot: RuntimeSnapshot) {
  const { origin, recording } = held(snapshot);
  return issueCompletedTurn({
    owner,
    origin,
    scope,
    source: { kind: 'live', recording },
    allowed: () => true,
  });
}

function leafPaths(snapshot: RuntimeSnapshot) {
  return Object.values(snapshot.subflowResults ?? {})
    .map((entry) => readLogAddress(entry.treeContext.logAddress)?.drillPath)
    .filter((path): path is readonly string[] => path !== undefined && path.length > 0);
}

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

it('rechecks a saved capability after the exact child read and holds the requested address across awaits', async () => {
  const root = flowChart('Root', () => undefined, 'root')
    .addSubFlowChartNext('child', leaf(), 'Child')
    .build();
  const executor = new FlowChartExecutor(root, knobs);
  await executor.run();
  const snapshot = executor.getSnapshot();
  const path = leafPaths(snapshot)[0];
  if (!path) throw Error('Expected child path');
  const { node, raw } = childNode(snapshot, path);
  const mutable = { ...node, logAddress: { ...node.logAddress, drillPath: [...path] } };
  const { origin, recording } = held(snapshot);
  let allowed = true;
  const readChild = vi.fn(async () => {
    allowed = false;
    return raw;
  });
  const turn = issueCompletedTurn({
    owner,
    origin,
    scope,
    source: {
      kind: 'saved',
      receiptRef: 'fixture-recording',
      redeem: async (ref) => {
        mutable.logAddress.drillPath[0] = 'unrelated#0';
        return { ref, originRunId: origin.runId, recording, readChild };
      },
    },
    allowed: () => allowed,
  });
  expect(await explainCompletedTurn(owner, mutable, turn)).toEqual({ gaps: ['turn-unavailable'] });
  expect(readChild).toHaveBeenCalledExactlyOnceWith(path, expect.any(AbortSignal));
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
    explain(true, knobs),
  );
  await executor.run();
  const snapshot = executor.getSnapshot();
  expect(snapshot.capture).toBeDefined();
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
  const executor = new FlowChartExecutor(
    flowChart('Root', () => undefined, 'root')
      .addSubFlowChartNext('child', leaf(), 'Child')
      .build(),
    knobs,
  );
  await executor.run();
  const snapshot = executor.getSnapshot();
  const path = leafPaths(snapshot)[0];
  if (!path || !snapshot.executionTree) throw Error('Expected addressed fixture');
  const { node, raw } = childNode(snapshot, path);
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
  const executor = new FlowChartExecutor(
    flowChart('Root', () => undefined, 'root')
      .addSubFlowChartNext('child', leaf(), 'Child')
      .build(),
    knobs,
  );
  await executor.run();
  const snapshot = executor.getSnapshot();
  const path = leafPaths(snapshot)[0];
  if (!path) throw Error('Expected exact child');
  const { node, raw } = childNode(snapshot, path);
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

it('ignores request accessors and a late saved child result that ignored its signal', async () => {
  const executor = new FlowChartExecutor(
    flowChart('Root', () => undefined, 'root')
      .addSubFlowChartNext('child', leaf(), 'Child')
      .build(),
    knobs,
  );
  await executor.run();
  const snapshot = executor.getSnapshot();
  const path = leafPaths(snapshot)[0];
  if (!path) throw Error('Expected selected native child');
  const { node, raw } = childNode(snapshot, path);
  const { origin, recording } = held(snapshot);
  const readChild = vi.fn(async () => raw);
  const allowed = vi.fn(() => true);
  const turn = issueCompletedTurn({
    owner,
    origin,
    scope,
    source: {
      kind: 'saved',
      receiptRef: 'fixture-recording',
      redeem: async (ref) => ({ ref, originRunId: origin.runId, recording, readChild }),
    },
    allowed,
  });

  const getter = vi.fn(() => path[0]);
  const drillPath = [...path];
  Object.defineProperty(drillPath, 0, { get: getter });
  const forged = { ...node, logAddress: { ...node.logAddress, drillPath } };
  expect(await explainCompletedTurn(owner, forged, turn)).toEqual({ gaps: ['turn-unavailable'] });
  expect(allowed).not.toHaveBeenCalled();
  expect(getter).not.toHaveBeenCalled();
  expect(readChild).not.toHaveBeenCalled();

  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
  try {
    expect(await explainCompletedTurn(owner, node, turn)).toEqual({
      gaps: ['subflow-evidence-unavailable'],
    });
    expect(readChild).toHaveBeenCalledExactlyOnceWith(path, expect.any(AbortSignal));
  } finally {
    timeout.mockRestore();
  }
});
