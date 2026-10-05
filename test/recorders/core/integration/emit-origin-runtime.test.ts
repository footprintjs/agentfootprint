import { afterEach, describe, expect, it, vi } from 'vitest';
import { flowChart, FlowChartExecutor, type EmitEvent } from 'footprintjs';
import { EventDispatcher } from '../../../../src/events/dispatcher.js';
import type { AgentfootprintEvent } from '../../../../src/events/registry.js';
import { EmitBridge } from '../../../../src/recorders/core/EmitBridge.js';
import { typedEmit } from '../../../../src/recorders/core/typedEmit.js';

afterEach(() => vi.restoreAllMocks());

describe.each(['full', 'delta'] as const)('runtime emit origin (%s)', (commitValues) => {
  it.each(['inline', 'deferred'] as const)(
    'preserves emission time through a real queue (%s)',
    async (delivery) => {
      let clock = 1_000;
      vi.spyOn(Date, 'now').mockImplementation(() => clock);
      const raw: EmitEvent[] = [];
      const typed: AgentfootprintEvent[] = [];
      const deliveredAt: number[] = [];
      const dispatcher = new EventDispatcher();
      dispatcher.on('agentfootprint.stream.token', (event) => {
        typed.push(event);
        deliveredAt.push(clock);
      });
      const chart = flowChart<{ value?: number }>(
        'Burst',
        (scope) => {
          clock = 2_000;
          for (let n = 0; n < 100; n++) {
            typedEmit(scope, 'agentfootprint.stream.token', {
              content: String(n),
              tokenIndex: n,
              iteration: 1,
            });
          }
          scope.value = 1;
        },
        'burst',
      )
        .addFunction(
          'Tail',
          (scope) => {
            clock = 3_000;
            scope.value = 2;
          },
          'tail',
        )
        .build();
      const executor = new FlowChartExecutor(chart, { commitValues });
      executor.attachEmitRecorder({ id: 'raw-origin-witness', onEmit: (event) => raw.push(event) });
      executor.attachCombinedRecorder(
        new EmitBridge({
          id: 'typed-origin',
          dispatcher,
          prefix: 'agentfootprint.stream.',
          getRunContext: () => ({ runId: 'agent-run', runStartMs: 1_000, compositionPath: [] }),
        }),
        { delivery, flushBudgetMs: Number.MIN_VALUE },
      );

      await executor.run();

      expect(raw).toHaveLength(100);
      expect(typed).toHaveLength(100);
      expect(executor.getSnapshot().sharedState).toEqual({ value: 2 });
      if (delivery === 'deferred') expect(deliveredAt.some((at) => at > 2_000)).toBe(true);
      for (let index = 0; index < raw.length; index++) {
        expect(typed[index].payload).toEqual(raw[index].payload);
        expect(typed[index].meta.wallClockMs).toBe(raw[index].timestamp);
        expect(typed[index].meta.runOffsetMs).toBe(1_000);
        expect(typed[index].meta.runtimeStageId).toBe(raw[index].runtimeStageId);
        expect(typed[index].meta.runId).toBe('agent-run');
        expect(typed[index].meta.runId).not.toBe(executor.getSnapshot().runId);
      }
    },
  );

  it.each(['inline', 'deferred'] as const)(
    'keeps root and nested emissions in order without changing their payloads (%s)',
    async (delivery) => {
      let clock = 1_000;
      vi.spyOn(Date, 'now').mockImplementation(() => clock);
      const raw: EmitEvent[] = [];
      const typed: AgentfootprintEvent[] = [];
      const dispatcher = new EventDispatcher();
      dispatcher.on('*', (event) => typed.push(event));
      const inner = flowChart<{ seed?: number; out?: number }>(
        'Inner',
        (scope) => {
          clock = 4_000;
          typedEmit(scope, 'agentfootprint.stream.token', {
            content: 'inner',
            tokenIndex: 0,
            iteration: 1,
          });
          scope.out = (scope.seed ?? 0) + 1;
        },
        'inner',
      ).build();
      const chart = flowChart<{ value?: number }>(
        'Root',
        (scope) => {
          clock = 2_000;
          scope.value = 1;
          typedEmit(scope, 'agentfootprint.stream.token', {
            content: 'root',
            tokenIndex: 0,
            iteration: 1,
          });
        },
        'root',
      )
        .addSubFlowChartNext('mount', inner, 'Mount', {
          inputMapper: (parent: { value?: number }) => ({ seed: parent.value }),
          outputMapper: (child: { out?: number }) => ({ value: child.out }),
        })
        .build();
      const executor = new FlowChartExecutor(chart, { commitValues });
      executor.attachEmitRecorder({ id: 'raw-nested-witness', onEmit: (event) => raw.push(event) });
      executor.attachCombinedRecorder(
        new EmitBridge({
          id: 'typed-nested',
          dispatcher,
          prefix: 'agentfootprint.stream.',
          getRunContext: () => ({ runId: 'agent-run', runStartMs: 1_000, compositionPath: [] }),
        }),
        { delivery },
      );
      await executor.run();

      expect(typed).toHaveLength(2);
      expect(typed.map((event) => event.payload)).toEqual(raw.map((event) => event.payload));
      expect(typed.map((event) => event.meta.wallClockMs)).toEqual([2_000, 4_000]);
      expect(typed.map((event) => event.meta.runOffsetMs)).toEqual([1_000, 3_000]);
      expect(typed.map((event) => event.meta.subflowPath)).toEqual(
        raw.map((event) => event.subflowPath),
      );
      expect(executor.getSnapshot().sharedState).toEqual({ value: 2 });
    },
  );
});
