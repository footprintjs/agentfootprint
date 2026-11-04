import { FlowChartExecutor, flowChart } from 'footprintjs';
import { expect, it } from 'vitest';
import { RunnerExecution } from '../../src/core/runnerExecution.js';

it('memory-like mappers resolve only their actual parent component, never selected state or copied coordinates', async () => {
  const mapped: object[] = [];
  const write = flowChart('write', () => 'written', 'write').build();
  const child = flowChart('seed', () => undefined, 'seed')
    .addSubFlowChartNext('write', write, 'write', {
      inputMapper: (_state, binding) => {
        const current = owner.forScope(binding);
        mapped.push(current.value.marker);
        expect(() => owner.forScope(undefined)).toThrow();
        expect(() => owner.forScope({ origin: binding?.origin })).toThrow();
        expect(() => owner.forScope(_state)).toThrow();
        return {};
      },
    })
    .build();
  const owner = new RunnerExecution(
    child,
    { runnerId: 'component', compositionPath: ['Component'] },
    () => ({ marker: {} }),
  );
  await owner.withRun((invocation) => invocation.execute({ kind: 'run' }));
  const selected = owner.selected()?.value.marker;
  expect(selected).toBe(mapped[0]);
  const parent = flowChart('parent', () => undefined, 'parent')
    .addSubFlowChartNext('child', child, 'child', {
      inputMapper: (_state, binding) => {
        // This mapper belongs to the outer parent, before entering the child's boundary.
        expect(() => owner.forScope(binding)).toThrow();
        return {};
      },
    })
    .build();
  await new FlowChartExecutor(parent).run();
  expect(mapped).toHaveLength(2);
  expect(mapped[1]).not.toBe(selected);
  expect(owner.selected()?.value.marker).toBe(selected);
});
