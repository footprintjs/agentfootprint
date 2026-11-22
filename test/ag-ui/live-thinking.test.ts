import { describe, expect, it, vi } from 'vitest';

import {
  Agent,
  defineTool,
  type LLMChunk,
  type LLMProvider,
  type LLMResponse,
} from '../../src/index.js';
import { agUiSerializer } from '../../src/ag-ui/serializer.js';
import { recordRun } from '../../src/doors/observe.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { mockThinkingHandler } from '../../src/thinking/index.js';
import { runAsAgUi } from './helpers.js';

function gate() {
  let open!: () => void;
  const waiting = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, waiting };
}

function finish(
  tokenIndex: number,
  content: string,
  thinking?: string,
): LLMChunk & { response: LLMResponse } {
  return {
    tokenIndex,
    content: '',
    done: true,
    response: {
      content,
      toolCalls: [],
      usage: { input: 1, output: 1 },
      stopReason: 'end_turn',
      ...(thinking !== undefined && {
        rawThinking: { kind: 'openai', summarySteps: [thinking] },
      }),
    },
  };
}

function eventsOfType<Event extends { type: string }, Type extends Event['type']>(
  events: readonly Event[],
  type: Type,
) {
  return events.filter((event): event is Extract<Event, { type: Type }> => event.type === type);
}

function thinkingDeltas(events: readonly AgentfootprintEvent[]) {
  return eventsOfType(events, 'agentfootprint.stream.thinking_delta').map(({ payload }) => payload);
}

function reasoningEvents<T extends { type: string }>(events: readonly T[]): T[] {
  return events.filter((event) => event.type.startsWith('REASONING_'));
}

describe('live thinking through the Agent recorder and AG-UI', () => {
  it('records deltas in arrival order before completion and keeps tool iterations distinct', async () => {
    const readingNext = gate();
    const releaseRead = gate();
    const complete = vi.fn(async () => {
      throw new Error('the scripted stream should complete the call');
    });
    let providerCalls = 0;
    const execute = vi.fn(() => 'Fixture result');
    const provider: LLMProvider = {
      name: 'scripted-thinking',
      thinkingHandler: mockThinkingHandler,
      complete,
      async *stream(request) {
        providerCalls += 1;
        if (providerCalls === 1) {
          yield {
            tokenIndex: 0,
            content: '',
            done: false,
            thinkingDelta: 'Check the ',
            thinkingKind: 'provider-summary',
          };
          readingNext.open();
          await releaseRead.waiting;
          yield { tokenIndex: 1, content: 'One ', done: false };
          yield {
            tokenIndex: 2,
            content: 'moment.',
            done: false,
            thinkingDelta: 'source.',
            thinkingKind: 'provider-summary',
          };
          yield { tokenIndex: 3, content: '', done: false, thinkingDelta: '' };
          const terminal = finish(4, 'One moment.', 'Check the source.');
          yield {
            ...terminal,
            response: {
              ...terminal.response,
              toolCalls: [{ id: 'call-1', name: 'lookup', args: {} }],
              stopReason: 'tool_use',
            },
          };
          return;
        }

        expect(request.messages).toContainEqual(
          expect.objectContaining({ role: 'tool', content: 'Fixture result' }),
        );
        yield {
          tokenIndex: 0,
          content: '',
          done: false,
          thinkingDelta: 'Check the source.',
        };
        yield { tokenIndex: 1, content: 'Final answer.', done: false };
        yield finish(2, 'Final answer.', 'Check the source.');
      },
    };
    const lookup = defineTool({
      name: 'lookup',
      description: 'Read the fixture.',
      inputSchema: { type: 'object' },
      execute,
    });
    const agent = Agent.create({ provider, model: 'fixture' }).tool(lookup).build();
    const recorder = recordRun(agent);
    const run = runAsAgUi(agent, 'Read the fixture.', { serializer: { reasoning: true } });
    try {
      await readingNext.waiting;
      expect(thinkingDeltas(recorder.toRecording().events)).toEqual([
        { iteration: 1, tokenIndex: 0, content: 'Check the ', kind: 'provider-summary' },
      ]);
      expect(execute).not.toHaveBeenCalled();
      releaseRead.open();

      const result = await run;
      expect(result.error).toBeUndefined();
      expect(result.out).toBe('Final answer.');
      expect(providerCalls).toBe(2);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(complete).not.toHaveBeenCalled();

      const { events } = recorder.toRecording();
      expect(
        events.flatMap((event) => {
          switch (event.type) {
            case 'agentfootprint.stream.thinking_delta':
            case 'agentfootprint.stream.token':
              return [[event.type, event.payload.iteration, event.payload.tokenIndex]];
            case 'agentfootprint.stream.thinking_end':
              return [[event.type, event.payload.iteration, event.payload.blocks?.[0]?.content]];
            case 'agentfootprint.stream.tool_start':
            case 'agentfootprint.stream.tool_end':
              return [[event.type, event.payload.toolCallId]];
            default:
              return [];
          }
        }),
      ).toEqual([
        ['agentfootprint.stream.thinking_delta', 1, 0],
        ['agentfootprint.stream.token', 1, 1],
        ['agentfootprint.stream.thinking_delta', 1, 2],
        ['agentfootprint.stream.token', 1, 2],
        ['agentfootprint.stream.thinking_end', 1, 'Check the source.'],
        ['agentfootprint.stream.tool_start', 'call-1'],
        ['agentfootprint.stream.tool_end', 'call-1'],
        ['agentfootprint.stream.thinking_delta', 2, 0],
        ['agentfootprint.stream.token', 2, 1],
        ['agentfootprint.stream.thinking_end', 2, 'Check the source.'],
      ]);
      expect(thinkingDeltas(events).map(({ content, kind }) => [content, kind])).toEqual([
        ['Check the ', 'provider-summary'],
        ['source.', 'provider-summary'],
        ['Check the source.', 'unclassified'],
      ]);

      const withoutReasoning = agUiSerializer({ threadId: 'thread-1', runId: 'run-1' });
      expect(reasoningEvents(events.flatMap((event) => withoutReasoning.event(event)))).toEqual([]);
      const frames = reasoningEvents(result.events);
      const reasoningStarts = eventsOfType(frames, 'REASONING_START');
      const reasoningEnds = eventsOfType(frames, 'REASONING_END');
      expect(reasoningStarts).toHaveLength(2);
      expect(reasoningEnds.map((event) => event.messageId)).toEqual(
        reasoningStarts.map((event) => event.messageId),
      );
      const contents = eventsOfType(frames, 'REASONING_MESSAGE_CONTENT');
      expect(contents.map((event) => [event.messageId, event.delta])).toEqual([
        [reasoningStarts[0]?.messageId, 'Check the '],
        [reasoningStarts[0]?.messageId, 'source.'],
        [reasoningStarts[1]?.messageId, 'Check the source.'],
      ]);
    } finally {
      releaseRead.open();
      await run;
      recorder.stop();
    }
  });

  it('stops observing a cancelled stream even if the pending read later yields a delta', async () => {
    const readingNext = gate();
    const releaseLateRead = gate();
    const iteratorReturn = vi.fn(async () => ({ done: true as const, value: undefined }));
    const complete = vi.fn(async () => {
      throw new Error('a cancelled stream must not fall back to complete');
    });
    let providerCalls = 0;
    let seenSignal: AbortSignal | undefined;
    const provider: LLMProvider = {
      name: 'late-stream',
      complete,
      stream(request) {
        providerCalls += 1;
        if (providerCalls > 1) {
          return (async function* () {
            yield finish(0, 'Next answer.');
          })();
        }
        seenSignal = request.signal;
        return {
          [Symbol.asyncIterator]() {
            let index = 0;
            return {
              async next() {
                const tokenIndex = index++;
                if (tokenIndex > 1) return { done: true, value: undefined };
                if (tokenIndex === 1) {
                  readingNext.open();
                  await releaseLateRead.waiting;
                }
                return {
                  done: false,
                  value: {
                    tokenIndex,
                    done: false,
                    content: '',
                    thinkingDelta: tokenIndex === 0 ? 'Before cancellation.' : 'Late reasoning.',
                  },
                };
              },
              return: iteratorReturn,
            };
          },
        };
      },
    };
    const cancellation = new AbortController();
    const agent = Agent.create({ provider, model: 'fixture' }).build();
    const recorder = recordRun(agent);
    const run = runAsAgUi(agent, 'Hold the stream.', {
      runOptions: { env: { signal: cancellation.signal } },
      serializer: { reasoning: true },
    });
    try {
      await readingNext.waiting;
      expect(thinkingDeltas(recorder.toRecording().events)).toEqual([
        { iteration: 1, tokenIndex: 0, content: 'Before cancellation.', kind: 'unclassified' },
      ]);

      cancellation.abort(new Error('The caller ended the stream.'));
      const result = await run;
      expect(result.error).toBeInstanceOf(Error);
      expect(seenSignal?.aborted).toBe(true);
      expect(iteratorReturn).toHaveBeenCalledTimes(1);
      expect(
        result.served.some((event) => event.type === 'agentfootprint.stream.thinking_end'),
      ).toBe(false);
      expect(result.events.at(-1)?.type).toBe('RUN_ERROR');
      expect(
        eventsOfType(result.events, 'REASONING_MESSAGE_CONTENT').map(({ delta }) => delta),
      ).toEqual(['Before cancellation.']);
      const cancelled = agUiSerializer({ threadId: 'thread-1', runId: 'run-1', reasoning: true });
      for (const event of result.served) cancelled.event(event);
      const cancelledFrames = cancelled.settle({ kind: 'cancelled' });
      expect(reasoningEvents(cancelledFrames).map(({ type }) => type)).toEqual([
        'REASONING_MESSAGE_END',
        'REASONING_END',
      ]);
      expect(cancelledFrames.at(-1)).toMatchObject({
        type: 'RUN_FINISHED',
        outcome: { type: 'cancelled' },
      });

      await expect(agent.run('New turn.')).resolves.toBe('Next answer.');
      releaseLateRead.open();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(thinkingDeltas(recorder.toRecording().events).map(({ content }) => content)).toEqual([
        'Before cancellation.',
      ]);
      expect(complete).not.toHaveBeenCalled();
    } finally {
      cancellation.abort();
      releaseLateRead.open();
      await run;
      recorder.stop();
    }
  });

  it('serves the same masked thinking content to the recorder and AG-UI', async () => {
    async function capture(secret: string) {
      const provider: LLMProvider = {
        name: 'redacted-stream',
        complete: async () => {
          throw new Error('the scripted stream should complete the call');
        },
        async *stream() {
          yield {
            tokenIndex: 0,
            done: false,
            content: '',
            thinkingDelta: secret,
            thinkingKind: 'provider-summary',
          };
          yield finish(1, 'Final answer.');
        },
      };
      const agent = Agent.create({ provider, model: 'fixture' }).build();
      const recorder = recordRun(agent);
      try {
        const result = await runAsAgUi(agent, 'Start the protected turn.', {
          runOptions: { redact: { keys: ['content'] } },
          serializer: { reasoning: true },
        });
        expect(result.error).toBeUndefined();
        const recorded = recorder.toRecording().events;
        expect(JSON.stringify({ recorded, frames: result.events })).not.toContain(secret);
        expect(thinkingDeltas(recorded)).toEqual(thinkingDeltas(result.served));
        return {
          deltas: thinkingDeltas(recorded),
          frames: eventsOfType(result.events, 'REASONING_MESSAGE_CONTENT').map(
            ({ delta }) => delta,
          ),
        };
      } finally {
        recorder.stop();
      }
    }

    const masked = {
      deltas: [{ iteration: 1, tokenIndex: 0, content: '[REDACTED]', kind: 'provider-summary' }],
      frames: ['[REDACTED]'],
    };
    expect(await capture('Private source A')).toEqual(masked);
    expect(await capture('Another private source B')).toEqual(masked);
  });

  it('numbers a buffered findings text tail after a later thinking chunk', async () => {
    const provider: LLMProvider = {
      name: 'buffered-text',
      complete: async () => {
        throw new Error('the scripted stream should complete the call');
      },
      async *stream() {
        yield { tokenIndex: 0, content: 'Answer.\n', done: false };
        yield { tokenIndex: 1, content: '', thinkingDelta: 'Later thought.', done: false };
        yield finish(2, 'Answer.\n');
      },
    };
    const agent = Agent.create({ provider, model: 'fixture' }).findings().build();
    const result = await runAsAgUi(agent, 'Read the fixture.');
    expect(result.error).toBeUndefined();
    const chunks = result.served.flatMap((event) =>
      event.type === 'agentfootprint.stream.token' ||
      event.type === 'agentfootprint.stream.thinking_delta'
        ? [[event.payload.tokenIndex, event.payload.content]]
        : [],
    );
    expect(chunks).toEqual([
      [0, 'Answer.'],
      [1, 'Later thought.'],
      [2, '\n'],
    ]);
  });

  it.each([false, true])(
    'arbitrates retry after a thinking-only chunk (draft hidden: %s)',
    async (draftHidden) => {
      let calls = 0;
      const thought = 'Partial thought before a transient failure.';
      const answer = JSON.stringify({ answer: 'Recovered answer.' });
      const provider: LLMProvider = {
        name: 'stream-fails-once',
        complete: async () => {
          throw new Error('the scripted stream should complete the call');
        },
        async *stream() {
          calls += 1;
          if (calls === 1) {
            yield {
              tokenIndex: 0,
              content: '',
              done: false,
              thinkingDelta: thought,
              // A third-party JavaScript adapter can send a value outside the type.
              thinkingKind: 'unknown-kind' as never,
            };
            throw Object.assign(new Error('Service Unavailable'), { status: 503 });
          }
          yield finish(0, answer);
        },
      };
      const builder = Agent.create({ provider, model: 'fixture' }).reliability({
        postDecide: [
          {
            when: (state) => state.errorKind === '5xx-transient',
            then: 'retry',
            kind: 'transient',
          },
        ],
      });
      if (draftHidden) {
        builder.outputSchema({ parse: (candidate: unknown) => candidate }).answerValidation({
          id: 'accept-recovery',
          version: '1',
          mode: 'enforce',
          validate: () => ({ checks: [{ id: 'fixture-check', disposition: 'checked-pass' }] }),
        });
      }
      const result = await runAsAgUi(builder.build(), 'Run the fixture.', {
        serializer: { reasoning: true },
      });
      if (draftHidden) {
        expect(result.error).toBeUndefined();
        expect(result.out).toBe(answer);
        expect(calls).toBe(2);
        expect(thinkingDeltas(result.served)).toEqual([]);
        expect(reasoningEvents(result.events)).toEqual([]);
      } else {
        expect(result.error).toMatchObject({
          message: expect.stringMatching(/mid-stream failure not retryable/),
        });
        expect(calls).toBe(1);
        expect(thinkingDeltas(result.served)).toEqual([
          { iteration: 1, tokenIndex: 0, content: thought, kind: 'unclassified' },
        ]);
      }
    },
  );
});
