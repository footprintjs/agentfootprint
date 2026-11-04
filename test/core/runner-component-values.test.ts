import { expect, it } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { bindRunnerStage, RunnerExecution } from '../../src/core/runnerExecution.js';

it('one runner shares private values with its internal charts and isolates independent mounts', async () => {
  const rows: Array<{ where: string; value: { secret: string; visits: number }; runId: string }> =
    [];
  const visit = (where: string, scope: unknown) => {
    const bound = execution.forScope(scope);
    bound.value.visits++;
    rows.push({ where, value: bound.value, runId: bound.context.runId });
  };
  const internal = flowChart(
    'internal',
    async (scope) => {
      await Promise.resolve();
      visit('internal', scope);
    },
    'internal',
  ).build();
  const chart = flowChart('entry', (scope) => visit('entry', scope), 'entry')
    .addSubFlowChartNext('internal', internal, 'internal')
    .addFunction('finish', (scope) => visit('finish', scope), 'finish')
    .build();
  const execution = new RunnerExecution(
    chart,
    { runnerId: 'component', compositionPath: ['component'] },
    () => ({ secret: 'PRIVATE-COMPONENT-491', visits: 0 }),
  );
  const outer = flowChart('parent', () => undefined, 'parent')
    .addSubFlowChartNext('first', chart, 'first')
    .addSubFlowChartNext('second', chart, 'second')
    .build();
  const parent = new FlowChartExecutor(outer);
  await Promise.all([
    parent.run(),
    execution.withRun((invocation) => invocation.execute({ kind: 'run' })),
  ]);
  expect(rows).toHaveLength(9);
  const values = new Set(rows.map((row) => row.value));
  expect(values.size).toBe(3);
  expect(new Set(rows.map((row) => row.runId)).size).toBe(2);
  for (const value of values) {
    expect(rows.filter((row) => row.value === value).map((row) => row.where)).toEqual([
      'entry',
      'internal',
      'finish',
    ]);
    expect(value.visits).toBe(3);
  }
  expect(JSON.stringify(parent.getSnapshot())).not.toContain('PRIVATE-COMPONENT-491');
  expect(JSON.stringify(execution.view()?.snapshot())).not.toContain('PRIVATE-COMPONENT-491');
});

it('a bound stage keeps its own values and native context across reverse completion', async () => {
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const rows: Array<{ label: string; runId: string; visits: number }> = [];
  const chart = flowChart('bound stage', (scope) => stage(scope), 'bound').build();
  const execution = new RunnerExecution(
    chart,
    { runnerId: 'stage', compositionPath: ['stage'] },
    () => ({ visits: 0 }),
  );
  const stage = bindRunnerStage(
    (scope: object) => execution.forScope(scope),
    (bound) => async () => {
      const first = rows.length === 0;
      bound.value.visits++;
      rows.push({
        label: first ? 'first-start' : 'second',
        runId: bound.context.runId,
        visits: bound.value.visits,
      });
      if (first) {
        entered();
        await held;
        rows.push({ label: 'first-end', runId: bound.context.runId, visits: bound.value.visits });
      }
    },
  );
  const first = execution.withRun((invocation) => invocation.execute({ kind: 'run' }));
  const observed = first.catch((error: unknown) => ({ error }));
  try {
    await reached;
    await new FlowChartExecutor(chart).run();
  } finally {
    release();
    await observed;
  }
  await first;
  expect(rows.map((row) => row.label)).toEqual(['first-start', 'second', 'first-end']);
  expect(rows.map((row) => row.visits)).toEqual([1, 1, 1]);
  expect(rows[0]?.runId).toBe(rows[2]?.runId);
  expect(rows[0]?.runId).not.toBe(rows[1]?.runId);
});
