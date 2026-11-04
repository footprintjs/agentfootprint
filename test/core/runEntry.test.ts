import { expect, it } from 'vitest';
import { flowChart, type RunOptions } from 'footprintjs';
import { RunnerExecution } from '../../src/core/runnerExecution.js';

it('caller options/env getters run once under admission and unrelated fields are never read', async () => {
  const reads: Record<string, number> = {};
  const read = (key: string) => {
    reads[key] = (reads[key] ?? 0) + 1;
  };
  const controller = new AbortController();
  let nested: Promise<unknown> | undefined;
  let seen: AbortSignal | undefined;
  const chart = flowChart(
    'check',
    (scope) => {
      seen = scope.$getEnv().signal;
      return 'ok';
    },
    'check',
  ).build();
  const execution = new RunnerExecution(
    chart,
    { runnerId: 'options', compositionPath: ['options'] },
    () => ({}),
  );
  const env = {
    get signal() {
      read('env.signal');
      return undefined;
    },
    get traceId() {
      read('env.traceId');
      nested = execution
        .withRun(() => 'intruder')
        .then(
          (value) => value,
          (error: unknown) => error,
        );
      return 'declared-trace';
    },
  };
  const options: RunOptions = {
    get signal() {
      read('signal');
      return controller.signal;
    },
    get env() {
      read('env');
      return env;
    },
    get timeoutMs() {
      read('timeoutMs');
      return undefined;
    },
    get deadline() {
      read('deadline');
      return undefined;
    },
    get maxDepth() {
      read('maxDepth');
      return undefined;
    },
    get maxIterations() {
      read('maxIterations');
      return undefined;
    },
    get input() {
      read('input');
      return {};
    },
  };
  Object.defineProperty(options, 'request', {
    enumerable: true,
    get() {
      throw new Error('not an engine option');
    },
  });
  await expect(
    execution.withRun((invocation) => invocation.execute({ kind: 'run', options })),
  ).resolves.toBe('ok');
  expect(seen).toBeDefined();
  expect(reads).toEqual({
    signal: 1,
    env: 1,
    'env.signal': 1,
    'env.traceId': 1,
    timeoutMs: 1,
    deadline: 1,
    maxDepth: 1,
    maxIterations: 1,
    input: 1,
  });
  expect(await nested).toMatchObject({ code: 'ERR_RUN_IN_FLIGHT' });
});
