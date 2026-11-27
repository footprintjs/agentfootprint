import { FlowChartExecutor, flowChart } from 'footprintjs';
import { createRecordGraph } from 'foottrace/cause';
import { expect, it } from 'vitest';

import { Agent } from '../index.js';
import { mock } from '../llm-providers.js';
import { issueCompletedTurn } from '../core/agent/turnEvidence/completedTurnHandle.js';
import type { AgentfootprintEventMap } from '../events/registry.js';
import { explainCompletedTurn } from './completedTurnWhy.js';

it('returns pointers from the exact held turn with gaps for channels it did not record', async () => {
  const chart = flowChart<{ seed: string; result: string }>(
    'Seed',
    (scope) => {
      scope.seed = 'PRIVATE-FIXTURE-VALUE';
    },
    'seed',
  )
    .addFunction(
      'Read seed',
      (scope) => {
        scope.result = scope.seed;
      },
      'read-seed',
    )
    .build();
  const executor = new FlowChartExecutor(chart, {
    writeProvenance: 'reads-prefix',
    readTracking: 'full',
  });
  await executor.run();
  const snapshot = executor.getSnapshot();
  const { runId, logAddress } = snapshot;
  if (runId === undefined || logAddress === undefined) throw new Error('Expected an addressed run');
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
  const { nodeId } = createRecordGraph([]);
  const id = nodeId(logAddress, { runtimeStageId: 'read-seed#1', commitIdx: 1, key: 'result' });
  const sourceId = nodeId(logAddress, { runtimeStageId: 'seed#0', commitIdx: 0, key: 'seed' });
  const owner = Agent.create({ provider: mock({ reply: 'fixture' }), model: 'mock' }).build();
  const handle = issueCompletedTurn({
    owner,
    scope: { principal: 'operator', conversation: 'fixture', tenant: 'tenant' },
    origin: { runId, engineRunId: runId, logAddress },
    source: { kind: 'live', recording: { snapshot, events: [terminal] } },
    allowed: () => true,
  });
  await executor.run();

  const result = await owner.why({ id, runId, logAddress }, handle);
  expect(result).toMatchObject({
    runId,
    facts: [{ from: id, to: sourceId, kind: 'data', attribution: 'per-write' }],
    gaps: expect.arrayContaining([
      'unchanged-writes-not-collected',
      'skipped-writers-not-collected',
    ]),
  });
  expect(JSON.stringify(result)).not.toContain('PRIVATE-FIXTURE-VALUE');
  expect(await owner.why({ id, runId, logAddress })).toEqual({ gaps: ['turn-unavailable'] });
  expect(
    await explainCompletedTurn(owner, { id, logAddress, runId: 'different-turn' }, handle),
  ).toEqual({
    gaps: ['turn-unavailable'],
  });
});
