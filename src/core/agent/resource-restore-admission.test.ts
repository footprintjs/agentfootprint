import { FlowChartExecutor, flowChart, type PausableHandler, type TypedScope } from 'footprintjs';
import { expect, it } from 'vitest';
import { RunnerExecution } from '../runnerExecution.js';
import { componentResources, type ComponentResources } from './componentResources.js';
import { ToolSessionTier } from '../../tools/toolSessions.js';

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function pausedFixture() {
  const entered = barrier(),
    release = barrier();
  let effects = 0,
    closes = 0;
  const tier = new ToolSessionTier();
  const resource = (scope: TypedScope<Record<string, unknown>>) => {
    const bound = owner.forScope(scope);
    return bound.value.resources!.context(scope, {
      runId: bound.context.runId,
      runContext: bound.context,
    });
  };
  const gate: PausableHandler<TypedScope<Record<string, unknown>>> = {
    execute: (scope) => {
      owner.forScope(scope).value.resources!.seed(scope);
      const call = resource(scope);
      call.view.register(
        call.owner,
        { tool: 'fixture', toolCallId: 'correlation' },
        () => {
          closes++;
        },
        { scope: 'run' },
      );
      return { question: 'continue?' };
    },
    resume: async (scope) => {
      resource(scope); // restoration/borrow and finite dispatch checks precede effects.
      effects++;
      entered.release();
      await release.promise;
    },
  };
  const chart = flowChart<Record<string, unknown>>('gate', gate, 'gate').build();
  const owner = new RunnerExecution(
    chart,
    { runnerId: 'owner', compositionPath: ['Owner'] },
    () => ({}),
    undefined,
    (component, value) => {
      value.resources = componentResources(component, () => tier);
      return {};
    },
  );
  return {
    chart,
    tier,
    entered,
    release,
    get effects() {
      return effects;
    },
    get closes() {
      return closes;
    },
  };
}

it('two native hosts cannot borrow one restored owner concurrently or close its active sibling', async () => {
  const f = pausedFixture(),
    original = new FlowChartExecutor(f.chart);
  await original.run();
  const checkpoint = original.getCheckpoint()!;
  const a = new FlowChartExecutor(f.chart),
    b = new FlowChartExecutor(f.chart);
  const first = a.resume(structuredClone(checkpoint), 'yes');
  const observed = first.catch((error: unknown) => ({ error }));
  try {
    await f.entered.promise;
    await expect(b.resume(structuredClone(checkpoint), 'yes')).rejects.toMatchObject({
      code: 'ERR_TOOL_RESOURCE_BORROWED',
    });
    expect(f.effects).toBe(1);
    expect(f.closes).toBe(0);
    expect(f.tier.liveCount()).toBe(1);
  } finally {
    f.release.release();
    await observed;
  }
  await first;
  expect(f.closes).toBe(1);
  expect(f.tier.liveCount()).toBe(0);
});

it.each(['malformed', 'exhausted', 'missing'] as const)(
  '%s saved ownership refuses before a resumed tool effect',
  async (kind) => {
    const f = pausedFixture(),
      original = new FlowChartExecutor(f.chart);
    await original.run();
    const checkpoint = structuredClone(original.getCheckpoint()!);
    const carrier = checkpoint.sharedState.toolResourceOwner as {
      version: number;
      birth: { runId: string; componentOrdinal: number };
      nextDispatch: number;
      pending?: { version: number; birth: object; ordinal: number };
    };
    if (kind === 'malformed')
      carrier.pending = {
        version: 1,
        birth: { ...carrier.birth, runId: 'foreign' },
        ordinal: 0,
      };
    else if (kind === 'exhausted') {
      carrier.nextDispatch = Number.MAX_SAFE_INTEGER;
      delete carrier.pending;
    } else delete checkpoint.sharedState.toolResourceOwner;
    f.release.release();
    await expect.soft(new FlowChartExecutor(f.chart).resume(checkpoint, 'yes')).rejects.toThrow();
    expect.soft(f.effects).toBe(0);
    // Invalid restoration cannot infer an owner; validated exhaustion can join exact cleanup.
    expect.soft(f.closes).toBe(kind === 'exhausted' ? 1 : 0);
    await f.tier.fireShutdown();
    expect(f.closes).toBe(1);
  },
);
