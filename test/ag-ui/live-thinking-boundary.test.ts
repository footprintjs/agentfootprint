import { expect, it } from 'vitest';
import { Agent, type LLMProvider } from '../../src/index.js';
import { runAsAgUi } from './helpers.js';

it('honors cancellation in a thinking listener before the visible part of a combined chunk', async () => {
  const cancellation = new AbortController();
  const provider: LLMProvider = {
    name: 'synthetic-combined-chunk',
    async complete() {
      throw new Error('The cancelled stream cannot fall back to complete.');
    },
    async *stream() {
      yield {
        tokenIndex: 0,
        content: 'Visible text after cancellation.',
        done: false,
        thinkingDelta: 'Summary before cancellation.',
        thinkingKind: 'provider-summary',
      };
      yield {
        tokenIndex: 1,
        content: '',
        done: true,
        response: {
          content: 'An answer.',
          toolCalls: [],
          usage: { input: 1, output: 1 },
          stopReason: 'end_turn',
        },
      };
    },
  };
  const agent = Agent.create({ provider, model: 'fixture' }).build();
  let observed = 0;
  agent.on('agentfootprint.stream.thinking_delta', () => {
    observed++;
    cancellation.abort(new Error('The reader cancelled in the first thinking callback.'));
  });
  try {
    const result = await runAsAgUi(agent, 'Synthetic task.', {
      runOptions: { env: { signal: cancellation.signal } },
      serializer: { reasoning: true },
    });
    expect(observed).toBe(1);
    expect(result.error).toBeInstanceOf(Error);
    expect(
      result.served
        .filter((e) => e.type === 'agentfootprint.stream.token')
        .map((e) => e.payload.content),
    ).toEqual([]);
    expect(result.events.some((event) => event.type === 'TEXT_MESSAGE_CONTENT')).toBe(false);
  } finally {
    await agent.shutdown();
  }
});

it('does not read optional thinking classification from a plain visible text chunk', async () => {
  const provider: LLMProvider = {
    name: 'synthetic-text-only-chunk',
    async complete() {
      throw new Error('The scripted stream should complete.');
    },
    async *stream() {
      yield {
        tokenIndex: 0,
        content: 'Visible text.',
        done: false,
        get thinkingKind(): never {
          throw new Error('A text-only chunk has no thinking kind.');
        },
      };
      yield {
        tokenIndex: 1,
        content: '',
        done: true,
        response: {
          content: 'Visible text.',
          toolCalls: [],
          usage: { input: 1, output: 1 },
          stopReason: 'end_turn',
        },
      };
    },
  };
  const agent = Agent.create({ provider, model: 'fixture' }).build();
  try {
    await expect(agent.run('Synthetic task.')).resolves.toBe('Visible text.');
  } finally {
    await agent.shutdown();
  }
});

it('does not fall back to completion after the buffered final token cancels the run', async () => {
  const cancellation = new AbortController();
  let completeCalls = 0;
  const provider: LLMProvider = {
    name: 'synthetic-buffered-suffix',
    async complete() {
      completeCalls++;
      throw new Error('A cancelled run cannot fall back to complete.');
    },
    async *stream() {
      yield { tokenIndex: 0, content: 'Answer.\n', done: false };
      yield { tokenIndex: 1, content: '', done: true };
    },
  };
  const agent = Agent.create({ provider, model: 'fixture' }).findings().build();
  agent.on('agentfootprint.stream.token', (event) => {
    if (event.payload.content === '\n')
      cancellation.abort(new Error('The reader closed the stream.'));
  });
  try {
    const result = await runAsAgUi(agent, 'Synthetic task.', {
      runOptions: { env: { signal: cancellation.signal } },
    });
    expect(cancellation.signal.aborted).toBe(true);
    expect(result.error).toBeInstanceOf(Error);
    expect(completeCalls).toBe(0);
  } finally {
    await agent.shutdown();
  }
});
