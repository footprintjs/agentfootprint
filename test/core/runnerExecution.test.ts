import { describe, expect, it } from 'vitest';
import { flowChart, type FlowChart } from 'footprintjs';

import { RunnerExecution } from '../../src/core/runnerExecution.js';

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function observed<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: unknown) => ({ status: 'rejected' as const, reason }),
  );
}

describe('the runner domain adapter uses native execution ownership', () => {
  it('reserves before domain initialization callbacks and preserves the actual origin', async () => {
    let initializationCount = 0;
    let nested: ReturnType<typeof observed<unknown>> | undefined;
    const chart = flowChart('answer', () => 'ok', 'answer').build();
    const execution = new RunnerExecution(
      chart,
      { runnerId: 'outer', compositionPath: ['Outer'] },
      () => {
        initializationCount++;
        if (initializationCount === 1) nested = observed(execution.withRun(() => 'intruder'));
        return { secret: 'private-only' };
      },
    );
    let actualRunId: string | undefined;
    const answer = await execution.withRun(async (invocation) => {
      const result = await invocation.execute({ kind: 'run' });
      actualRunId = invocation.context().runId;
      expect(invocation.context().runStartMs).toBe(invocation.run.origin?.startedAtMs);
      return result;
    });
    expect(answer).toBe('ok');
    expect(await nested).toMatchObject({
      status: 'rejected',
      reason: { code: 'ERR_RUN_IN_FLIGHT' },
    });
    expect(initializationCount).toBe(1);
    expect(execution.selected()?.context.runId).toBe(actualRunId);
    expect(JSON.stringify(execution.view()?.snapshot())).not.toContain('private-only');
    await expect(
      execution.withRun((invocation) => invocation.execute({ kind: 'run' })),
    ).resolves.toBe('ok');
    expect(initializationCount).toBe(2);
  });

  it('selects the actual in-progress execution, then retains that completed view', async () => {
    const gate = barrier();
    const reached = barrier();
    const chart = flowChart<Record<string, unknown>>(
      'seed',
      (scope) => {
        scope.visible = 'in progress';
      },
      'seed',
    )
      .addFunction(
        'answer',
        async (scope) => {
          reached.release();
          await gate.promise;
          scope.visible = 'finished';
          return 'ok';
        },
        'answer',
      )
      .build();
    const execution = new RunnerExecution(
      chart,
      { runnerId: 'live', compositionPath: ['Live'] },
      () => ({}),
    );
    expect(execution.selected()).toBeUndefined();
    const pending = execution.withRun((invocation) => invocation.execute({ kind: 'run' }));
    try {
      await reached.promise;
      expect(execution.view()?.phase).toBe('executing');
      expect(execution.view()?.snapshot()?.sharedState.visible).toBe('in progress');
      expect(execution.selected()?.context.runId).toBe(execution.view()?.origin?.runId);
    } finally {
      gate.release();
      await observed(pending);
    }
    await expect(pending).resolves.toBe('ok');
    expect(execution.view()?.phase).toBe('settled');
    expect(execution.view()?.snapshot()?.sharedState.visible).toBe('finished');
  });

  it('a shared child resolves separate runtime values and host identity for two parents and a direct run', async () => {
    const gate = barrier();
    const allReached = barrier();
    const rows: Array<{
      runId: string;
      principal: string | undefined;
      value: object;
      own: boolean;
    }> = [];
    const childChart = flowChart(
      'child',
      async (scope) => {
        const bound = child.forScope(scope);
        bound.value.visits++;
        rows.push({
          runId: bound.context.runId,
          principal: bound.context.principal,
          value: bound.value,
          own: bound.own,
        });
        if (rows.length === 3) allReached.release();
        await gate.promise;
        expect(bound.value.visits).toBe(1);
        expect(child.forScope(scope).value).toBe(bound.value);
        return 'child';
      },
      'child',
    ).build();
    const child = new RunnerExecution(
      childChart,
      { runnerId: 'child', compositionPath: ['Child'] },
      () => ({ visits: 0 }),
    );
    const parentChart = (): FlowChart =>
      flowChart('seed', () => undefined, 'seed')
        .addSubFlowChartNext('member', childChart, 'member')
        .build();
    const a = new RunnerExecution(
      parentChart(),
      { runnerId: 'a', compositionPath: ['A'] },
      () => ({}),
    );
    const b = new RunnerExecution(
      parentChart(),
      { runnerId: 'b', compositionPath: ['B'] },
      () => ({}),
    );
    const start = <T>(owner: RunnerExecution<T>, principal: string) =>
      owner.withRun((invocation) =>
        invocation.execute({ kind: 'run' }, undefined, {
          metadata: { compositionPath: [principal], principal },
        }),
      );
    const pending = [start(a, 'alice'), start(b, 'bob'), start(child, 'carol')].map(observed);
    try {
      await allReached.promise;
      expect(new Set(rows.map((row) => row.runId)).size).toBe(3);
      expect(new Set(rows.map((row) => row.value)).size).toBe(3);
      expect(rows.map((row) => [row.principal, row.own])).toEqual(
        expect.arrayContaining([
          ['alice', false],
          ['bob', false],
          ['carol', true],
        ]),
      );
      expect(new Set(rows.map((row) => row.runId))).toEqual(
        new Set([a.view()?.origin?.runId, b.view()?.origin?.runId, child.view()?.origin?.runId]),
      );
    } finally {
      gate.release();
      await Promise.all(pending);
    }
    expect((await Promise.all(pending)).map((row) => row.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'fulfilled',
    ]);
  });

  it('copies allowed domain metadata once and never accepts a caller-supplied run id', async () => {
    const chart = flowChart('answer', () => 'ok', 'answer').build();
    const execution = new RunnerExecution(
      chart,
      { runnerId: 'identity', compositionPath: ['Identity'] },
      () => ({}),
    );
    const metadata = {
      compositionPath: ['Caller'],
      principal: 'alice',
      runId: 'forged',
      runStartMs: 1,
      secret: 'never-metadata',
    };
    await execution.withRun(async (invocation) => {
      await invocation.execute({ kind: 'run' }, undefined, { metadata });
      metadata.principal = 'mallory';
      metadata.compositionPath.push('changed');
      expect(invocation.context()).toMatchObject({
        principal: 'alice',
        compositionPath: ['Caller'],
      });
      expect(invocation.context().runId).not.toBe('forged');
      expect(invocation.context()).not.toHaveProperty('secret');
      expect(invocation.context()).not.toHaveProperty('runnerId');
    });
    expect(execution.selected()?.context.principal).toBe('alice');
  });

  it('retains native admission through finalization even when domain initialization or cleanup throws', async () => {
    const gate = barrier();
    const cleanupReached = barrier();
    const original = new Error('body failed');
    const chart = flowChart('answer', () => 'ok', 'answer').build();
    let initialize = 0;
    const execution = new RunnerExecution(
      chart,
      { runnerId: 'cleanup', compositionPath: ['Cleanup'] },
      () => {
        if (++initialize === 1) throw original;
        return {};
      },
    );
    await expect(execution.withRun(() => 'unused')).rejects.toBe(original);
    const pending = observed(
      execution.withRun((invocation) => {
        invocation.run.onFinalize(async () => {
          cleanupReached.release();
          await gate.promise;
          throw new Error('secondary');
        });
        throw original;
      }),
    );
    try {
      await cleanupReached.promise;
      await expect(execution.withRun(() => 'intruder')).rejects.toMatchObject({
        code: 'ERR_RUN_IN_FLIGHT',
      });
    } finally {
      gate.release();
      await pending;
    }
    expect(await pending).toMatchObject({ status: 'rejected', reason: original });
    await expect(
      execution.withRun((invocation) => invocation.execute({ kind: 'run' })),
    ).resolves.toBe('ok');
  });
});
