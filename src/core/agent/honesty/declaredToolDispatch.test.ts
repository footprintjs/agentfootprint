import { AttemptTimeoutError, flowChart, FlowChartExecutor, type TypedScope } from 'footprintjs';
import { attempts } from 'footprintjs/recorders';
import { describe, expect, it } from 'vitest';
import { Agent, checkInApproved, defineTool, isCheckInPause, toolFailure } from '../../../index.js';
import { mock } from '../../../llm-providers.js';
import { assessAnswer, recordRun } from '../../../observe.js';
import { adoptScopeOutsideRun, outsideRunFor } from '../../../redaction/runRedaction.js';
import type { AgentState } from '../types.js';
import {
  admitDeclaredToolFailure,
  beginDeclaredToolDispatch,
  stageDeclaredToolHistory,
} from './declaredToolDispatch.js';
import type { LLMMessage } from '../../../provider-contract/types.js';

function fixture({
  checkIn,
  maxChars,
  hideAdvice,
}: {
  checkIn?: 'always';
  maxChars?: number;
  hideAdvice?: boolean;
} = {}) {
  const tool = defineTool({
    name: 'collector',
    description: 'Read the collector.',
    inputSchema: { type: 'object', properties: {} },
    checkIn,
    ...(maxChars !== undefined && { resultCeiling: { maxChars } }),
    execute: async () =>
      toolFailure('Collector unavailable.', {
        category: 'timeout',
        ...(hideAdvice && { tryInstead: 'secret-replica'.repeat(60), notChecked: 'primary' }),
      }),
  });
  const agent = Agent.create({
    model: 'mock',
    ...(hideAdvice && { redact: { fields: { history: ['2.toolDeclaredFailure.tryInstead'] } } }),
    provider: mock({
      replies: [
        { toolCalls: [{ name: 'collector', id: 'test-call', args: {} }] },
        { content: 'Done.' },
      ],
      chunkDelayMs: 0,
    }),
  })
    .answerLayer({ standingLine: true })
    .tool(tool)
    .build();
  return agent;
}

async function run(checkIn?: 'always', maxChars?: number, hideAdvice = false) {
  const agent = fixture({ checkIn, maxChars, hideAdvice });
  const recorder = recordRun(agent);
  try {
    const result = await agent.run({ message: 'Read the collector.' });
    if (checkIn === 'always') {
      if (!isCheckInPause(result)) throw new Error('Expected the native tool check-in.');
      await agent.resume(
        result.checkpoint,
        checkInApproved({ request: result.checkIn, by: 'fixture' }),
      );
    }
    const recording = recorder.toRecording();
    const history = recording.snapshot.sharedState.history as readonly LLMMessage[];
    const payload = JSON.stringify(recording.snapshot);
    const attempts =
      JSON.stringify(recording.snapshot.executionTree).match(/"provenance":"declared"/g)?.length ??
      0;
    return { message: history.find((m) => m.role === 'tool'), payload, attempts };
  } finally {
    recorder.stop();
    await agent.shutdown();
  }
}

describe('declared attempt uses the native settlement commit', () => {
  it.each([undefined, 'always'] as const)(
    'records a retained declaration after dispatch (%s)',
    async (checkIn) => {
      const { message, attempts } = await run(checkIn);
      expect(message?.toolDeclaredFailure).toEqual({ origin: 'declared', category: 'timeout' });
      expect(attempts).toBe(1);
    },
  );

  it('serves no text or omission mark for advice selected by the history policy', async () => {
    const { message, payload, attempts } = await run(undefined, undefined, true);
    expect(message?.toolDeclaredFailure).toEqual({
      origin: 'declared',
      category: 'timeout',
      notChecked: 'primary',
    });
    expect(payload).not.toContain('secret-replica');
    expect(attempts).toBe(1);
  });

  it('does not retain the declaration when the framework replaces the content', async () => {
    const { message, payload } = await run(undefined, 8);
    expect(message?.toolDeclaredFailure).toBeUndefined();
    expect(payload).not.toContain('"provenance":"declared"');
  });
});

describe('the live and saved warning', () => {
  it('attributes a declared timeout and its advice independently from a classified timeout', async () => {
    const provider = mock({
      replies: [
        {
          toolCalls: [
            { name: 'collector', id: 'declared', args: {} },
            { name: 'archive', id: 'classified', args: {} },
          ],
        },
        { content: 'Done.' },
      ],
      chunkDelayMs: 0,
    });
    const inputSchema = { type: 'object', properties: {} } as const;
    const collector = defineTool({
      name: 'collector',
      displayName: 'Live collector',
      description: 'Read the collector.',
      inputSchema,
      execute: () =>
        toolFailure('Offline.', { category: 'timeout', tryInstead: 'check the replica' }),
    });
    const archive = defineTool({
      name: 'archive',
      displayName: 'Archive lookup',
      description: 'Read the archive.',
      inputSchema,
      execute: () => {
        throw new AttemptTimeoutError(1, 30_000);
      },
    });
    const agent = Agent.create({ model: 'mock', provider })
      .answerLayer({ standingLine: true })
      .tool(collector)
      .tool(archive)
      .build();
    const attemptRecorder = attempts();
    const detach = agent.attach(attemptRecorder);
    const recorder = recordRun(agent);
    try {
      const result = await agent.run({ message: 'Read both sources.' });
      expect(result).toContain('Live collector reported a timeout');
      expect(result).toContain('Live collector suggested check the replica');
      expect(result).toContain('Archive lookup timed out');
      const recording = JSON.parse(JSON.stringify(recorder.toRecording()));
      const replayed = assessAnswer(recording);
      expect(await agent.assessment()).toEqual(replayed);
      expect(attemptRecorder.byTarget().get('collector')).toMatchObject({
        count: 1,
        retries: 0,
        gaveUp: 0,
        byCategoryProvenance: { timeout: { declared: 1 } },
      });
      const otel = JSON.stringify(attemptRecorder.toOTel());
      expect(otel).toContain(
        '"key":"footprint.attempt.provenance","value":{"stringValue":"declared"}',
      );
      expect(otel).not.toContain('check the replica');
      expect(
        replayed.reasons.find((reason) => reason.reason === 'call-not-completed')?.source,
      ).toMatchObject({
        kind: 'calls',
        calls: [
          { toolCallId: 'declared', declaredFailure: { category: 'timeout', origin: 'declared' } },
          { toolCallId: 'classified', category: 'timeout' },
        ],
      });
    } finally {
      recorder.stop();
      detach();
      await agent.shutdown();
    }
  });
});

describe('the delivery boundary does not report a discarded declaration', () => {
  it.each([false, true])(
    'the native write must commit successfully (force failure: %s)',
    async (fail) => {
      let staged = false;
      const chart = flowChart(
        'Seed',
        (scope: TypedScope<{ history: readonly LLMMessage[]; invalid?: unknown }>) => {
          scope.history = [];
        },
        'seed',
      )
        .addFunction(
          'Deliver',
          (raw) => {
            const scope = raw as unknown as TypedScope<AgentState>;
            adoptScopeOutsideRun(scope, outsideRunFor({ state: 'declared-none' }));
            const dispatch = beginDeclaredToolDispatch(scope, 'collector');
            expect(dispatch).toBeDefined();
            const message = admitDeclaredToolFailure(
              scope,
              {
                role: 'tool',
                toolName: 'collector',
                toolCallId: 'call',
                callOccurrenceKey: [1, 2, 3, 4, 5],
                content: 'Offline.',
                outcome: 'failed',
                toolResultExecution: 'returned',
              },
              { dispatch, category: 'timeout', startedAt: 100, durationMs: 5 },
            );
            expect(message.toolDeclaredFailure?.category).toBe('timeout');
            stageDeclaredToolHistory(scope, [message]);
            if (fail) raw.invalid = () => 0;
            staged = true;
          },
          'deliver',
        )
        .build();
      const recorder = attempts();
      const executor = new FlowChartExecutor(chart);
      executor.attachCombinedRecorder(recorder);
      if (fail) await expect(executor.run()).rejects.toThrow();
      else await executor.run();
      expect(staged).toBe(true);
      expect(recorder.byTarget().get('collector')?.count ?? 0).toBe(fail ? 0 : 1);
    },
  );

  it('a declaration returned after cancellation never reaches the attempt recorder', async () => {
    let markEntered!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = mock({
      replies: [{ toolCalls: [{ id: 'late', name: 'collector', args: {} }] }, { content: 'Done.' }],
      chunkDelayMs: 0,
    });
    const agent = Agent.create({ model: 'mock', provider })
      .answerLayer({ standingLine: true })
      .tool(
        defineTool({
          name: 'collector',
          description: 'Read the collector.',
          inputSchema: { type: 'object', properties: {} },
          execute: async () => {
            markEntered();
            await wait;
            return toolFailure('Late return.', { category: 'timeout' });
          },
        }),
      )
      .build();
    const recorder = attempts();
    const detach = agent.attach(recorder);
    const controller = new AbortController();
    const running = agent.run({ message: 'Read the collector.' }, { signal: controller.signal });
    running.catch(() => undefined);
    try {
      await entered;
      controller.abort(new Error('Cancelled in the fixture.'));
      release();
      await expect(running).rejects.toThrow('Cancelled in the fixture.');
      expect(recorder.byTarget().get('collector')).toBeUndefined();
      expect(JSON.stringify(agent.getLastSnapshot())).not.toContain('"origin":"declared"');
    } finally {
      release();
      detach();
      await agent.shutdown();
    }
  });
});
