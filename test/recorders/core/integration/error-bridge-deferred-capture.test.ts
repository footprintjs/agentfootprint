import {
  flowChart,
  FlowChartExecutor,
  type AttachRecorderOptions,
  type FlowRunFailedEvent,
} from 'footprintjs';
import { describe, expect, it } from 'vitest';
import { EventDispatcher } from '../../../../src/events/dispatcher.js';
import type { AgentfootprintEvent } from '../../../../src/events/registry.js';
import { EmitBridge } from '../../../../src/recorders/core/EmitBridge.js';
import { errorBridge } from '../../../../src/recorders/core/ErrorBridge.js';

describe('native fatal error capture', () => {
  const modes = [
    { name: 'deferred clone', options: { delivery: 'deferred' }, summarized: true },
    {
      name: 'deferred reference',
      options: { delivery: 'deferred', capture: 'ref' },
      summarized: false,
    },
    { name: 'inline', options: { delivery: 'inline' }, summarized: false },
  ] satisfies {
    name: string;
    options: AttachRecorderOptions;
    summarized: boolean;
  }[];

  it.each(modes)(
    'delivers the fatal after the last emit in $name',
    async ({ options, summarized }) => {
      const cause = { callback: () => 'foreign value' };
      const tokenType = 'agentfootprint.stream.token';
      const fatalType = 'agentfootprint.error.fatal';
      const token = { content: 'before failure', tokenIndex: 0, iteration: 1 };
      const chart = flowChart(
        'Emit and fail',
        (scope) => {
          scope.$emit(tokenType, token);
          throw cause;
        },
        'emit-and-fail',
      ).build();

      const executor = new FlowChartExecutor(chart);
      const dispatcher = new EventDispatcher();
      const events: AgentfootprintEvent[] = [];
      dispatcher.on('*', (event) => events.push(event));
      const getRunContext = () => ({ runId: 'fatal-test', runStartMs: 0, compositionPath: [] });
      const fatal = errorBridge({ dispatcher, getRunContext });
      const rawFailures: FlowRunFailedEvent[] = [];
      const deliveredFailures: FlowRunFailedEvent[] = [];
      executor.attachFlowRecorder({
        id: 'raw-failure-witness',
        onRunFailed: (event) => rawFailures.push(event),
      });
      if (summarized) executor.attachCombinedRecorder(fatal.preserveFailureForDeferredCapture());
      executor.attachCombinedRecorder(
        new EmitBridge({ dispatcher, getRunContext, id: 'tokens', prefix: tokenType }),
        options,
      );
      executor.attachCombinedRecorder(fatal, options);
      executor.attachFlowRecorder(
        {
          id: 'delivered-failure-witness',
          onRunFailed: (event) => deliveredFailures.push(event),
        },
        options,
      );

      const run = executor.run().catch((error: unknown) => {
        expect(events.map(({ type }) => type)).toEqual([tokenType, fatalType]);
        throw error;
      });
      await expect(run).rejects.toBe(cause);

      expect(rawFailures).toHaveLength(1);
      expect(rawFailures[0]?.structuredError.raw).toBe(cause);
      expect(deliveredFailures).toHaveLength(1);
      const delivered = deliveredFailures[0]!;
      if (summarized) {
        expect(delivered).toHaveProperty('__payloadSummary', true);
        expect(delivered).not.toHaveProperty('structuredError');
      } else {
        expect(delivered.structuredError.raw).toBe(cause);
      }
      expect(events[0]?.payload).toEqual(token);
      expect(events[1]).toMatchObject({
        payload: {
          error: 'The AI call failed: [object Object]',
          stage: rawFailures[0]?.traversalContext?.stageName,
          scope: 'run',
        },
        meta: {
          runtimeStageId: rawFailures[0]?.traversalContext?.runtimeStageId,
          subflowPath: [],
        },
      });
    },
  );

  it('discards an undelivered failure before reusing the executor', async () => {
    const first = new Error('earlier failure', { cause: () => 'first callback' });
    const unobserved = new Error('failure without an origin recorder', {
      cause: () => 'second callback',
    });
    const last = new Error('current failure', { cause: () => 'third callback' });
    let cause = first;
    const executor = new FlowChartExecutor(
      flowChart(
        'Reject at origin',
        () => {
          throw cause;
        },
        'reject-at-origin',
      ).build(),
    );

    const dispatcher = new EventDispatcher();
    const events: AgentfootprintEvent[] = [];
    dispatcher.on('agentfootprint.error.fatal', (event) => events.push(event));
    const fatal = errorBridge({
      dispatcher,
      fallback: 'run',
      getRunContext: () => ({ runId: cause.message, runStartMs: 0, compositionPath: [] }),
    });
    const source = fatal.preserveFailureForDeferredCapture();
    const nativeSummaries: FlowRunFailedEvent[] = [];
    const deferred = { delivery: 'deferred' } satisfies AttachRecorderOptions;
    executor.attachCombinedRecorder(source);
    executor.attachCombinedRecorder(fatal, deferred);
    executor.attachFlowRecorder({
      id: 'remove-failure-listener',
      onRunFailed: () => {
        if (cause === first) executor.detachFlowRecorder(fatal.id);
      },
    });
    executor.attachFlowRecorder(
      {
        id: 'deferred-failure-summaries',
        onRunFailed: (event) => nativeSummaries.push(event),
      },
      deferred,
    );

    await expect(executor.run()).rejects.toBe(first);
    expect(events).toEqual([]);

    // Reuse the bridge, but deliver one native summary without an origin witness.
    // It has no evidence to publish, even though the earlier witness was never used.
    executor.detachCombinedRecorder(source.id);
    executor.attachCombinedRecorder(fatal, deferred);
    cause = unobserved;
    await expect(executor.run()).rejects.toBe(unobserved);
    expect(events).toEqual([]);

    executor.attachCombinedRecorder(source);
    cause = last;
    await expect(executor.run()).rejects.toBe(last);
    expect(nativeSummaries).toEqual(
      Array.from({ length: 3 }, () => expect.objectContaining({ __payloadSummary: true })),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      payload: { error: 'The run failed: current failure', scope: 'run' },
      meta: { runId: 'current failure' },
    });
  });
});
