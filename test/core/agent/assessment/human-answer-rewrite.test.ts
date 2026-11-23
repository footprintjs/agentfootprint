import { expect, it } from 'vitest';
import {
  absent,
  Agent,
  allow,
  defineTool,
  isInputPause,
  requestInput,
  slidingWindow,
} from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import { assessAnswer, callTraceTool, recordRun, traceToolpack } from '../../../../src/observe.js';
import { readCallOccurrenceKey } from '../../../../src/lib/callOccurrence.js';

const queried = { from: '2026-09-26T09:00:00Z', to: '2026-09-26T10:00:00Z' };
const held = { from: '2026-09-25T09:00:00Z', to: '2026-09-25T10:00:00Z' };

it.each(
  (['inline', 'deferred'] as const).flatMap((observerDelivery) =>
    [false, true].map((evicts) => ({ observerDelivery, evicts })),
  ),
)(
  'the paused call HUMAN ANSWER reaches its own after-tool rule ($observerDelivery, evicts=$evicts)',
  async ({ observerDelivery, evicts }) => {
    let executions = 0;
    const seen: { id: string; result: unknown }[] = [];
    const builder = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'paused-target', name: 'lookup', args: {} }] },
          ...(evicts ? [{ toolCalls: [{ id: 'finish', name: 'finish_fixture', args: {} }] }] : []),
          'Done.',
        ],
      }),
      model: 'mock',
      observerDelivery,
      ...(evicts && { keepLastToolResults: false as const }),
    })
      .tool(
        defineTool({
          name: 'lookup',
          description: 'Ask for the missing fixture input.',
          inputSchema: { type: 'object' },
          execute: () => {
            executions++;
            return requestInput({
              id: 'fixture-input',
              question: 'Continue?',
              fields: [{ id: 'count', type: 'number', required: true }],
              absence: absent({
                what: 'fixture entry',
                checked: ['fixture index'],
                notChecked: ['other scope'],
                period: { queried, held },
              }),
            });
          },
        }),
      )
      .toolMiddleware({
        name: 'human-summary-rule',
        onToolResult: (context) => {
          if (context.toolCallId !== 'paused-target') return allow();
          seen.push({ id: context.toolCallId, result: JSON.parse(JSON.stringify(context.result)) });
          return allow([{ public: 1 }], 'Serve a public summary of the human answer.');
        },
      })
      .resultsLayer()
      .answerLayer({ standingLine: true });
    if (evicts)
      builder
        .tool(
          defineTool({
            name: 'finish_fixture',
            description: 'Finish the fixture.',
            inputSchema: { type: 'object' },
            execute: () => 'Finished.',
          }),
        )
        .window(slidingWindow({ keepRecentTurns: 1 }));
    const agent = builder.build();
    const recorder = recordRun(agent);
    try {
      const paused = await agent.run('Read the fixture.');
      if (!isInputPause(paused)) throw new Error('Expected the target itself to pause.');
      expect(executions).toBe(1);
      expect(seen).toEqual([]);
      const before = paused.checkpoint.sharedState as Record<string, unknown>;
      const nativeRows = before.coverageDeclared as Record<string, unknown>[];
      expect(nativeRows).toHaveLength(1);
      expect(nativeRows[0]).toMatchObject({
        kind: 'absence',
        toolCallId: 'paused-target',
        period: { queried, held },
      });
      const key = readCallOccurrenceKey(nativeRows[0]!);
      expect(typeof key).toBe('string');
      const periodRowsBefore =
        (before.findingsLedger as Record<string, unknown>[] | undefined)?.filter(
          ({ kind }) => kind === 'period',
        ) ?? [];
      expect(periodRowsBefore).toEqual([]);
      const checkpoint = JSON.parse(JSON.stringify(paused.checkpoint));
      await agent.resume(checkpoint, {
        requestId: paused.awaitingInput.requestId,
        values: { count: 1 },
      });
      expect(executions).toBe(1);
      expect(seen).toEqual([
        {
          id: 'paused-target',
          result: expect.objectContaining({
            status: 'input_received',
            requestId: paused.awaitingInput.requestId,
            values: { count: 1 },
          }),
        },
      ]);
      const saved = JSON.parse(JSON.stringify(recorder.toRecording()));
      const state = saved.snapshot.sharedState as Record<string, unknown>;
      expect(state.coverageDeclared).toEqual(nativeRows);
      const periodsAfter =
        (state.findingsLedger as Record<string, unknown>[] | undefined)?.filter(
          ({ kind }) => kind === 'period',
        ) ?? [];
      expect(periodsAfter).toHaveLength(1);
      expect(periodsAfter).toMatchObject([
        {
          kind: 'period',
          verdict: 'not-held',
          toolCallId: 'paused-target',
          toolName: 'lookup',
          turn: 1,
          iteration: 1,
        },
      ]);
      expect(readCallOccurrenceKey(periodsAfter[0]!)).toBe(key);
      const decision = (state.middlewareDecisions as Record<string, unknown>[]).find(
        (row) => row.moment === 'after-tool' && row.toolCallId === 'paused-target',
      );
      expect(decision).toMatchObject({
        middleware: 'human-summary-rule',
        toolCallId: 'paused-target',
        outcome: 'allow',
        changed: true,
      });
      expect(readCallOccurrenceKey(decision!)).toBe(key);
      const history = state.history as Record<string, unknown>[];
      const message = history.find(
        (row) => row.role === 'tool' && row.toolCallId === 'paused-target',
      );
      if (evicts) {
        expect(message).toBeUndefined();
        expect(history).toContainEqual(
          expect.objectContaining({ role: 'tool', toolName: 'finish_fixture' }),
        );
      } else {
        expect(message).toMatchObject({
          toolResultDisposition: 'rewritten',
          toolResultExecution: 'returned',
        });
        expect(readCallOccurrenceKey(message!)).toBe(key);
      }
      const settlement = (state.settledToolCalls as Record<string, unknown>[]).find(
        (row) => readCallOccurrenceKey(row) === key,
      );
      expect(settlement).toMatchObject({ execution: 'returned', delivery: 'rewritten' });
      const assessment = assessAnswer(saved);
      expect(assessment).toEqual(await agent.assessment());
      expect(assessment.reasons.map(({ reason }) => reason)).toEqual([
        ...(evicts ? ['result-dropped-from-window'] : []),
        'coverage-gap',
        'declared-absent',
        'period-not-held',
      ]);
      const host = await callTraceTool(
        traceToolpack(saved, { showWithheldResults: true }),
        'inspect_tool_call',
        { toolCallId: 'paused-target' },
      );
      expect(host).toContain('rewritten by: "human-summary-rule"');
      if (evicts)
        expect(host).toContain(
          "no result for call 'paused-target' remains in the retained history",
        );
    } finally {
      recorder.stop();
      await agent.shutdown();
    }
  },
);
