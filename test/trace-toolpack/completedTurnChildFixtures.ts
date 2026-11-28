import { flowChart, FlowChartExecutor, type RuntimeSnapshot } from 'footprintjs';
import { createRecordGraph } from 'foottrace/cause';

import { issueCompletedTurn } from '../../src/core/agent/turnEvidence/completedTurnHandle.js';
import type { AgentfootprintEventMap } from '../../src/events/registry.js';
import { readLogAddress } from '../../src/recorders/observability/recordingParts/invocations.js';

export const secret = 'PRIVATE-CHILD-SEED';
export const owner = {};
export const scope = { principal: 'operator', conversation: 'fixture', tenant: 'tenant' };
const { nodeId } = createRecordGraph([]);

export const knobs = {
  writeProvenance: 'reads-prefix',
  readTracking: 'full',
  captureOutputHandoff: true,
} as const;

export function leaf() {
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

export function childNode(snapshot: RuntimeSnapshot, path: readonly string[]) {
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

export function held(snapshot: RuntimeSnapshot) {
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

export function live(snapshot: RuntimeSnapshot) {
  const { origin, recording } = held(snapshot);
  return issueCompletedTurn({
    owner,
    origin,
    scope,
    source: { kind: 'live', recording },
    allowed: () => true,
  });
}

export function leafPaths(snapshot: RuntimeSnapshot) {
  return Object.values(snapshot.subflowResults ?? {})
    .map((entry) => readLogAddress(entry.treeContext.logAddress)?.drillPath)
    .filter((path): path is readonly string[] => path !== undefined && path.length > 0);
}

export async function runChild() {
  const executor = new FlowChartExecutor(
    flowChart('Root', () => undefined, 'root')
      .addSubFlowChartNext('child', leaf(), 'Child')
      .build(),
    knobs,
  );
  await executor.run();
  const snapshot = executor.getSnapshot();
  const path = leafPaths(snapshot)[0];
  if (!path) throw Error('Expected an exact native child');
  return { snapshot, path, ...childNode(snapshot, path) };
}
