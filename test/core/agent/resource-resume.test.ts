import { createRunLifecycle, flowChart, type PausableHandler, type TypedScope } from 'footprintjs';
import { expect, it } from 'vitest';
import {
  Agent,
  checkInApproved,
  isCheckInPause,
  isPaused,
  defineTool,
  pauseHere,
} from '../../../src/index.js';
import { RunnerExecution } from '../../../src/core/runnerExecution.js';
import {
  componentResources,
  type ComponentResources,
} from '../../../src/core/agent/componentResources.js';
import { ToolSessionTier, toolSessionKey } from '../../../src/tools/toolSessions.js';
import { readToolOwner, type ToolCallOwner } from '../../../src/tools/toolResourceOwner.js';
import type { LLMProvider } from '../../../src/provider-contract/types.js';

it.each(['same', 'fresh'] as const)(
  'retains the high-water mark across a %s pause BETWEEN calls',
  async (mode) => {
    const closed: string[] = [],
      calls: ToolCallOwner[] = [],
      reports: string[] = [];
    const tier = new ToolSessionTier({
      report: (_report, origin) => {
        if (origin.runContext !== undefined) reports.push(origin.runContext.runId);
      },
    });
    const dispatch = async (scope: TypedScope<Record<string, unknown>>) => {
      const bound = execution.forScope(scope),
        resources = bound.value.resources!;
      const call = resources.context(scope, {
        runId: bound.context.runId,
        runContext: bound.context,
      });
      calls.push(call.owner);
      const origin = {
        tool: 'resource',
        toolCallId: 'same-provider-id',
        runId: bound.context.runId,
        runContext: bound.context,
      };
      call.view.register(
        call.owner,
        origin,
        () => {
          closed.push('call-' + call.owner.ordinal);
        },
        { scope: 'call' },
      );
      call.view.register(
        call.owner,
        origin,
        () => {
          closed.push('run');
        },
        { scope: 'run', key: 'same-custom' },
      );
      await resources.endCall(scope);
    };
    const gate: PausableHandler<TypedScope<Record<string, unknown>>> = {
      execute: async () => ({ question: 'between calls?' }),
      resume: async () => undefined,
    };
    const chart = flowChart<Record<string, unknown>>(
      'first',
      (scope) => {
        execution.forScope(scope).value.resources!.seed(scope);
        return dispatch(scope);
      },
      'first',
    )
      .addPausableFunction('pause', gate, 'pause')
      .addFunction('after', dispatch, 'after')
      .build();
    const execution = new RunnerExecution(
      chart,
      { runnerId: 'resource-fixture', compositionPath: ['Fixture'] },
      () => ({}),
      undefined,
      (component, values) => {
        values.resources = componentResources(component, () => tier);
        return {};
      },
    );
    await execution.withRun((invocation) => invocation.execute({ kind: 'run' }));
    const continuation = execution.continuation()!;
    const checkpoint = continuation.checkpoint();
    const saved = readToolOwner(checkpoint.sharedState.toolResourceOwner);
    expect(saved.nextDispatch).toBe(1);
    expect(saved.pending).toBeUndefined();
    expect(closed).toEqual(['call-0']);
    await execution.withRun((invocation) =>
      invocation.execute(
        mode === 'same'
          ? { kind: 'resume', mode, continuation, input: 'yes' }
          : { kind: 'resume', mode, checkpoint: structuredClone(checkpoint), input: 'yes' },
      ),
    );
    expect(calls.map((call) => call.ordinal)).toEqual([0, 1]);
    expect(calls[1]?.birth).toEqual(calls[0]?.birth);
    expect(closed).toEqual(['call-0', 'call-1', 'run']);
    expect(new Set(reports)).toEqual(
      new Set([calls[0]?.birth.runId, execution.view()?.origin?.runId]),
    );
    expect(tier.liveCount()).toBe(0);
  },
);

it.each(['same', 'fresh'] as const)(
  'a genuine paused tool keeps its call owner through %s resume and the next call gets a new key',
  async (mode) => {
    const closed: string[] = [],
      keys: string[] = [],
      runKeys: string[] = [];
    const provider: LLMProvider = {
      name: 'scripted',
      async complete(request) {
        const completed = request.messages.filter((message) => message.role === 'tool').length;
        return completed < 3
          ? {
              content: '',
              toolCalls: [{ id: 'same-provider-id', name: 'resource', args: { n: completed + 1 } }],
              usage: { input: 2, output: 1 },
            }
          : { content: 'done', toolCalls: [], usage: { input: 2, output: 1 } };
      },
    };
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 5 })
      .tool(
        defineTool({
          name: 'resource',
          description: 'Local resource fixture',
          inputSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
          execute: (args: { n: number }, context) => {
            keys.push(toolSessionKey(context, 'call')!);
            runKeys.push(toolSessionKey(context, 'run')!);
            context.onTeardown!(
              () => {
                closed.push('call-' + args.n);
              },
              { scope: 'call', key: 'same-custom' },
            );
            context.onTeardown!(
              () => {
                closed.push('run');
              },
              { scope: 'run', key: 'same-custom' },
            );
            if (args.n === 2) pauseHere({ question: 'continue?' });
            return String(args.n);
          },
        }),
      )
      .build();
    const host = createRunLifecycle(agent.getSpec(), { runnerId: 'native-host' });
    await host.withRun((run) =>
      run.execute({
        kind: 'run',
        options: { input: { message: 'start', identity: { conversationId: 'resource-resume' } } },
      }),
    );
    const continuation = host.continuation()!,
      checkpoint = continuation.checkpoint();
    const saved = readToolOwner(checkpoint.sharedState.toolResourceOwner);
    expect(saved.nextDispatch).toBe(2);
    expect(saved.pending?.ordinal).toBe(1);
    expect(closed).toEqual(['call-1']);
    await host.withRun((run) =>
      run.execute(
        mode === 'same'
          ? { kind: 'resume', mode, continuation, input: '2' }
          : { kind: 'resume', mode, checkpoint: structuredClone(checkpoint), input: '2' },
      ),
    );
    expect(new Set(keys).size).toBe(3);
    expect(new Set(runKeys).size).toBe(1);
    expect(closed.filter((value) => value.startsWith('call-')).sort()).toEqual([
      'call-1',
      'call-2',
      'call-3',
    ]);
    expect(closed.filter((value) => value === 'run')).toHaveLength(1);
  },
);

it('explicit abandonment closes only the paused owner and joins its local call/run cleanup', async () => {
  const closed: string[] = [];
  const agent = Agent.create({
    provider: {
      name: 'scripted',
      complete: async () => ({
        content: '',
        toolCalls: [{ id: 'pause', name: 'hold', args: {} }],
        usage: { input: 1, output: 1 },
      }),
    },
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'hold',
        description: 'Local paused handle',
        inputSchema: { type: 'object', properties: {} },
        execute: (_args, context) => {
          context.onTeardown!(
            () => {
              closed.push('call');
            },
            { scope: 'call' },
          );
          context.onTeardown!(
            () => {
              closed.push('run');
            },
            { scope: 'run' },
          );
          pauseHere({ question: 'continue?' });
        },
      }),
    )
    .build();
  const outcome = await agent.run({ message: 'start' });
  expect(outcome).toMatchObject({ paused: true });
  expect(closed).toEqual([]);
  await agent.abandonPause();
  expect(closed.sort()).toEqual(['call', 'run']);
});

it('a refused replay retains the resources of the still-open later pause', async () => {
  const closed: string[] = [];
  const agent = Agent.create({
    provider: {
      name: 'scripted',
      complete: async (request) => {
        const count = request.messages.filter((message) => message.role === 'tool').length;
        return count < 2
          ? {
              content: '',
              toolCalls: [{ id: 'same', name: 'held_rows', args: { n: count } }],
              usage: { input: 1, output: 1 },
            }
          : { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } };
      },
    },
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'held_rows',
        description: 'Local rows',
        inputSchema: { type: 'object' },
        checkIn: 'always',
        execute: (_args, ctx) => {
          ctx.onTeardown!(
            () => {
              closed.push('run');
            },
            { scope: 'run', key: 'one-owner' },
          );
          return 'rows';
        },
      }),
    )
    .build();
  const first = await agent.run({ message: 'read twice' });
  if (!isCheckInPause(first)) throw new Error('first fixture did not pause');
  const decision = checkInApproved({ request: first.checkIn, by: 'person' });
  const second = await agent.resume(first.checkpoint, decision);
  if (!isCheckInPause(second)) throw new Error('second fixture did not pause');
  await expect(agent.resume(first.checkpoint, decision)).rejects.toMatchObject({
    reason: 'already-answered',
  });
  expect(closed).toEqual([]);
  await agent.resume(second.checkpoint, checkInApproved({ request: second.checkIn, by: 'person' }));
  expect(closed).toEqual(['run']);
});

it('a missing answer preserves the pending question and its retained resources', async () => {
  const closed: string[] = [];
  const agent = Agent.create({
    provider: {
      name: 'scripted',
      complete: async (request) =>
        request.messages.some((m) => m.role === 'tool')
          ? { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } }
          : {
              content: '',
              toolCalls: [{ id: 'same', name: 'hold', args: {} }],
              usage: { input: 1, output: 1 },
            },
    },
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'hold',
        description: 'Local handle',
        inputSchema: { type: 'object' },
        execute: (_args, ctx) => {
          ctx.onTeardown!(
            () => {
              closed.push('run');
            },
            { scope: 'run' },
          );
          pauseHere({ question: 'continue?' });
        },
      }),
    )
    .build();
  const pause = await agent.run({ message: 'hold' });
  if (!isPaused(pause)) throw new Error('fixture did not pause');
  await expect(agent.resume(pause.checkpoint)).rejects.toMatchObject({
    code: 'ERR_PAUSE_ANSWER_REQUIRED',
  });
  expect.soft(closed).toEqual([]);
  const fresh = await agent.run({ message: 'not an answer' }).catch((error: unknown) => error);
  expect.soft(fresh).toMatchObject({ code: 'ERR_PENDING_QUESTION' });
  await agent.resume(pause.checkpoint, 'yes');
  expect(closed).toEqual(['run']);
});

async function guardedResumeFixture(options: { failAnsweredLeg?: boolean } = {}) {
  const closed: string[] = [];
  let modelCalls = 0;
  const agent = Agent.create({
    provider: {
      name: 'scripted-admission',
      complete: async () => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'held-admission', name: 'hold_admission', args: {} }],
            usage: { input: 1, output: 1 },
          };
        }
        if (options.failAnsweredLeg && modelCalls === 2) {
          throw new Error('answered leg failed');
        }
        return { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } };
      },
    },
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'hold_admission',
        description: 'Hold one local synthetic resource',
        inputSchema: { type: 'object' },
        execute: (_args, ctx) => {
          ctx.onTeardown!(
            () => {
              closed.push('run');
            },
            { scope: 'run', key: 'admission-owner' },
          );
          return pauseHere({ question: 'continue admission?' });
        },
      }),
    )
    .build();
  const pause = await agent.run({ message: 'hold admission' });
  if (!isPaused(pause)) throw new Error('admission fixture did not pause');
  return { agent, pause, closed, modelCalls: () => modelCalls };
}

it.each(['run', 'followUp'] as const)(
  'resume admission keeps the question after native plan refusal before %s',
  async (door) => {
    const { agent, pause, closed, modelCalls } = await guardedResumeFixture();
    const bad = {
      ...structuredClone(pause.checkpoint),
      pausedStageId: '__absent_admission_stage__',
    };
    await expect(agent.resume(bad, 'yes')).rejects.toThrow(
      /Cannot resume: stage '__absent_admission_stage__' not found/,
    );
    expect.soft(modelCalls()).toBe(1);
    expect.soft(closed).toEqual([]);
    const next = await (door === 'run'
      ? agent.run({ message: 'not an answer' })
      : agent.followUp('not an answer')
    ).catch((error: unknown) => error);
    expect.soft(next).toMatchObject({ code: 'ERR_PENDING_QUESTION' });
    expect.soft(modelCalls()).toBe(1);
    await expect(agent.resume(pause.checkpoint, 'yes')).resolves.toBe('done');
    expect.soft(closed).toEqual(['run']);
    expect.soft(modelCalls()).toBe(2);
  },
);

it.each(['run', 'followUp'] as const)(
  'resume admission keeps the question after setup refusal before %s',
  async (door) => {
    const { agent, pause, closed, modelCalls } = await guardedResumeFixture();
    const options = {
      get correlationId(): string {
        throw new Error('fixture resume setup failure');
      },
    };
    await expect(agent.resume(pause.checkpoint, 'yes', options)).rejects.toThrow(
      'fixture resume setup failure',
    );
    expect.soft(modelCalls()).toBe(1);
    expect.soft(closed).toEqual([]);
    const next = await (door === 'run'
      ? agent.run({ message: 'not an answer' })
      : agent.followUp('not an answer')
    ).catch((error: unknown) => error);
    expect.soft(next).toMatchObject({ code: 'ERR_PENDING_QUESTION' });
    expect.soft(modelCalls()).toBe(1);
    await expect(agent.resume(pause.checkpoint, 'yes')).resolves.toBe('done');
    expect.soft(closed).toEqual(['run']);
    expect.soft(modelCalls()).toBe(2);
  },
);

it('resume admission does not resurrect a question after the answered leg fails', async () => {
  const { agent, pause, closed } = await guardedResumeFixture({ failAnsweredLeg: true });
  await expect(agent.resume(pause.checkpoint, 'yes')).rejects.toThrow('answered leg failed');
  expect(closed).toEqual(['run']);
  await expect(agent.run({ message: 'new work' })).resolves.toBe('done');
});
