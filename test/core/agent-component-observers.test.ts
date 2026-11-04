import { FlowChartExecutor, flowChart, type ComponentRun, type TypedScope } from 'footprintjs';
import { expect, it } from 'vitest';

import { RunnerExecution } from '../../src/core/runnerExecution.js';
import { agentComponentObservers } from '../../src/core/agent/componentObservers.js';
import { createAgentRunValues, type AgentRunValues } from '../../src/core/agent/runValues.js';
import {
  adoptScopeOutsideRun,
  bindScopeComputation,
  emitServed,
  outsideRunFor,
} from '../../src/redaction/runRedaction.js';
import { DECLARED_NONE } from '../../src/redaction/coverage.js';

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function fixture(
  body: (
    scope: TypedScope<Record<string, unknown>>,
    values: AgentRunValues,
    runId: string,
  ) => unknown,
  finalized?: (values: AgentRunValues) => void,
) {
  const opened: AgentRunValues[] = [];
  const chart = flowChart<Record<string, unknown>>(
    'component',
    (scope) => {
      const run = owner.forScope(scope);
      return body(scope, run.value, run.context.runId);
    },
    'component',
  ).build();
  const owner = new RunnerExecution(
    chart,
    { runnerId: 'fixture', compositionPath: ['Fixture'] },
    () => createAgentRunValues({ window: true }),
    undefined,
    (component: ComponentRun, value, entry) => {
      opened.push(value);
      component.onFinalize(() => finalized?.(value));
      const observers = agentComponentObservers(component, value, entry, {
        causal: true,
        window: true,
      });
      return {
        recorder: observers.recorder,
        bindScope: (scope) => {
          const bound = owner.forScope(scope);
          bindScopeComputation(scope, {
            owner: component,
            retired: () => bound.retired,
            emit: observers.emit,
          });
          adoptScopeOutsideRun(scope, outsideRunFor(DECLARED_NONE));
        },
      };
    },
  );
  return { chart, owner, opened };
}

it('same-leg components retain their own open phase and completed history', async () => {
  const aOpen = barrier(),
    releaseA = barrier();
  const seen = new Map<string, AgentRunValues>();
  const component = fixture(async (scope, values, runId) => {
    const who = scope.$getArgs<{ who: string }>().who;
    seen.set(who, values);
    values.checkpointTracker = {
      runId,
      originalInput: { message: who },
      history: [],
      lastCompletedIteration: 0,
    };
    if (who === 'a') {
      emitServed(scope, 'agentfootprint.agent.iteration_start', { iterIndex: 2 });
      emitServed(scope, 'agentfootprint.stream.llm_start', {});
      aOpen.release();
      await releaseA.promise;
    } else {
      await aOpen.promise;
      emitServed(scope, 'agentfootprint.stream.tool_start', { toolName: 'b-tool' });
      emitServed(scope, 'agentfootprint.stream.tool_end', {});
      emitServed(scope, 'agentfootprint.agent.iteration_end', {
        iterIndex: 8,
        history: [{ role: 'user', content: 'PRIVATE-B' }],
      });
      expect(seen.get('a')?.checkpointTracker).toMatchObject({
        inFlightIteration: 2,
        inFlightPhase: { phase: 'llm', stage: 'call-llm' },
        history: [],
      });
      releaseA.release();
    }
    return who;
  });
  const parent = flowChart('parent', () => undefined, 'parent')
    .addSelectorFunction('both', () => ['a', 'b'], 'both', undefined, { failFast: true })
    .addSubFlowChartBranch('a', component.chart, 'a', { inputMapper: () => ({ who: 'a' }) })
    .addSubFlowChartBranch('b', component.chart, 'b', { inputMapper: () => ({ who: 'b' }) })
    .end()
    .build();
  try {
    await new FlowChartExecutor(parent).run();
  } finally {
    releaseA.release();
  }
  expect(component.opened).toHaveLength(2);
  expect(seen.get('a')).not.toBe(seen.get('b'));
  expect(seen.get('b')?.checkpointTracker).toMatchObject({
    originalInput: { message: 'b' },
    history: [{ role: 'user', content: 'PRIVATE-B' }],
    lastCompletedIteration: 8,
  });
  expect(seen.get('a')?.checkpointTracker?.history).toEqual([]);
});

it('a retired component cannot reduce a retained scope emit while its sibling still runs', async () => {
  const aDone = barrier(),
    bEntered = barrier(),
    releaseB = barrier();
  let a: AgentRunValues | undefined;
  let stale: (() => void) | undefined;
  const component = fixture(
    async (scope, values) => {
      if (scope.$getArgs<{ who: string }>().who === 'a') {
        a = values;
        stale = () => emitServed(scope, 'agentfootprint.agent.iteration_start', { iterIndex: 99 });
        emitServed(scope, 'agentfootprint.agent.iteration_start', { iterIndex: 1 });
        return 'a';
      }
      bEntered.release();
      await releaseB.promise;
      return 'b';
    },
    (value) => {
      if (value === a) aDone.release();
    },
  );
  const parent = flowChart('parent', () => undefined, 'parent')
    .addSelectorFunction('both', () => ['a', 'b'], 'both', undefined, { failFast: true })
    .addSubFlowChartBranch('a', component.chart, 'a', { inputMapper: () => ({ who: 'a' }) })
    .addSubFlowChartBranch('b', component.chart, 'b', { inputMapper: () => ({ who: 'b' }) })
    .end()
    .build();
  const pending = new FlowChartExecutor(parent).run();
  const observed = pending.catch((error: unknown) => ({ error }));
  try {
    await Promise.all([aDone.promise, bEntered.promise]);
    const before = a?.causalEvidence?.collect();
    expect(before).toMatchObject({ observedIterationStarts: 1 });
    expect(stale).toBeTypeOf('function');
    // Native may refuse the stale public emit; private reduction must already be closed.
    try {
      stale?.();
    } catch {
      /* exact native stale refusal is outside this adapter's contract */
    }
    expect(a?.causalEvidence?.collect()).toMatchObject({
      observedIterationStarts: 1,
      lastObservedIteration: 1,
    });
  } finally {
    releaseB.release();
    await observed;
  }
  await pending;
});

it.each([false, true])(
  'private usage survives masked=%s while history provenance follows served writes',
  async (masked) => {
    let measurement: unknown, origins: readonly { stageId: string }[] | undefined;
    const writes: string[] = [];
    const component = fixture((scope, value) => {
      scope.$setValue('history', [{ role: 'user', content: 'PRIVATE-HISTORY' }]);
      emitServed(scope, 'agentfootprint.stream.llm_end', {
        iteration: 1,
        usage: { input: 901, output: 7 },
      });
      measurement = value.compactionMeter?.lastCall(2);
      origins = value.compactionMeter?.origins();
      return 'done';
    });
    const parent = flowChart('parent', () => undefined, 'parent')
      .addSubFlowChartNext('child', component.chart, 'child')
      .build();
    const executor = new FlowChartExecutor(parent);
    if (masked) executor.setRedactionPolicy({ keys: ['history', 'input', 'output'] });
    executor.attachCombinedRecorder(
      {
        id: 'public-deferred',
        onWrite(event) {
          if (event.key === 'history') writes.push(event.runtimeStageId);
        },
      },
      { delivery: 'deferred' },
    );
    await executor.run();
    expect(measurement).toEqual({ input: 901, output: 7, meteredAtIteration: 1 });
    if (masked) expect(origins).toEqual([]);
    else {
      expect(origins).toHaveLength(1);
      expect(writes).toContain(origins?.[0]?.stageId);
    }
  },
);
