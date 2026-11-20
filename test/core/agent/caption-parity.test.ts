import { describe, expect, it } from 'vitest';
import { argumentViewOf, SHOWN_ARGS } from '../../../src/core/toolShownArgs.js';
import { conversationRedaction } from '../../../src/doors/security.js';
import { Agent, defineTool, isPaused, pauseHere } from '../../../src/index.js';
import { recordRun } from '../../../src/observe.js';
import { mock } from '../../../src/providers.js';
import { checkerOf, composing, target } from './fixtures/innerCalls.js';

const caption = 'public-caption';
const distinctLabel = 'example-violet';

describe('the argument view of a model call and an inner call', () => {
  it.each([
    ['matches the caption', caption],
    ['differs from the caption', distinctLabel],
  ])('records the same caption when the bound label %s', async (_case, label) => {
    const args = { label };
    const received: string[] = [];
    const sample = {
      ...defineTool<{ label: string }, string>({
        name: 'caption_sample',
        description: 'classifies an example label',
        inputSchema: {
          type: 'object',
          properties: { label: { type: 'string' } },
          required: ['label'],
        },
        askOrAssume: { label: { assume: 'ordinary-example' } },
        execute: (input) => {
          received.push(input.label);
          return 'example classified';
        },
      }),
      [SHOWN_ARGS]: (input: Readonly<Record<string, unknown>>) => ({ ...input, label: caption }),
    };
    const compose = composing(async (call) => call('caption_sample', args));
    const marker = target('marker', {
      execute: () => pauseHere({ question: 'Finish this example?' }),
    });
    const checker = checkerOf(() => ({ result: 'allow' }));
    const agent = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'direct-1', name: 'caption_sample', args }] },
          { toolCalls: [{ id: 'compose-1', name: 'compose', args: {} }] },
          { toolCalls: [{ id: 'marker-1', name: 'marker', args: {} }] },
          { content: 'done' },
        ],
      }),
      model: 'fixture',
      permissionChecker: checker,
      redact: conversationRedaction({ keys: ['label'] }),
    })
      .tools([sample, compose.tool, marker.tool])
      .build();
    const recorder = recordRun(agent);
    try {
      const paused = await agent.run({ message: 'Classify this example.' });
      if (!isPaused(paused)) throw new Error('expected the ordinary marker pause');
      expect(paused.checkpoint.sharedState.innerToolCalls).toMatchObject([
        {
          toolCallId: 'compose-1#inner-1',
          outerToolCallId: 'compose-1',
          entered: true,
          ended: 'returned',
          args: { label: caption },
        },
      ]);
      expect(await agent.resume(paused.checkpoint, 'Finish.')).toBe(
        'done\n\n---\n\nNot sure — a value a call ran with came from the model, with no source on the record.',
      );
      expect(received).toEqual([label, label]);
      expect(
        checker.requests
          .filter(
            (request) => request.capability === 'tool_call' && request.target === 'caption_sample',
          )
          .map((request) => request.context),
      ).toMatchObject([{ label }, { label }]);
      const markerRequest = checker.requests.find((request) => request.target === 'marker');
      expect(markerRequest?.sequence?.find((call) => call.inner === true)).toMatchObject({
        name: 'caption_sample',
        args: { label },
      });

      // These are the written audit projections. The caller's operational
      // checkpoint also retains the original provider proposal for replay.
      const checkpoint = agent.checkpoint();
      expect(checkpoint).toBeDefined();
      const direct = checkpoint?.findingsLedger?.find(
        (row) =>
          row.kind === 'argument' && row.toolCallId === 'direct-1' && row.argument === 'label',
      );
      const nested = checkpoint?.history.find(
        (message) => message.role === 'tool' && message.toolCallId === 'compose-1',
      )?.calls;
      expect(direct).toMatchObject({ value: caption });
      expect(nested).toMatchObject([
        {
          toolCallId: 'compose-1#inner-1',
          toolName: 'caption_sample',
          args: { label: caption },
          policyArgsRef: label === caption ? null : expect.any(String),
        },
      ]);
      expect(argumentViewOf(sample, args)).toMatchObject({
        shown: { label: label === caption ? 'REDACTED' : caption },
        hiddenArgs: ['label'],
      });

      const snapshot = agent.getLastSnapshot();
      const recording = recorder.toRecording();
      expect(snapshot).toBeDefined();
      expect(recording.events.length).toBeGreaterThan(0);
      for (const surface of [
        snapshot?.sharedState.history,
        recording.events,
        snapshot,
        recording.snapshot,
      ]) {
        expect(JSON.stringify(surface ?? null)).not.toContain(distinctLabel);
      }
    } finally {
      recorder.stop();
      await agent.shutdown();
    }
  });
});
