import { describe, expect, it } from 'vitest';
import {
  Agent,
  allow,
  ask,
  deny,
  MessageDeniedError,
  type LLMProvider,
  type MessageMiddleware,
  type MessageOutcome,
} from '../../src/index.js';

const draft = 'private-output-canary';
const accepted = 'public answer';
const refusals: readonly (readonly [string, () => MessageOutcome])[] = [
  ['deny', () => deny('not for delivery')],
  [
    'throw',
    () => {
      throw new Error('checker unavailable');
    },
  ],
  ['ask', () => ask({ question: 'approve?' }) as never],
  ['non-text', () => allow({ invalid: true } as never, 'invalid rewrite')],
];

function provider(onChunk?: () => void, streaming = true): LLMProvider {
  const response = {
    content: draft,
    toolCalls: [],
    usage: { input: 3, output: 7 },
    stopReason: 'end_turn',
  };
  return {
    name: 'output-admission-test',
    complete: async () => response,
    ...(streaming && {
      async *stream() {
        yield { content: draft, tokenIndex: 0, done: false };
        onChunk?.();
        yield { content: '', tokenIndex: 1, done: true, response };
      },
    }),
  };
}

function observe(agent: Agent) {
  const tokens: string[] = [];
  const ends: unknown[] = [];
  const turns: string[] = [];
  const order: string[] = [];
  agent.on('agentfootprint.stream.token', (e) => {
    tokens.push(e.payload.content);
    order.push('token');
  });
  agent.on('agentfootprint.stream.llm_end', (e) => ends.push(e.payload));
  agent.on('agentfootprint.agent.turn_end', (e) => {
    turns.push(e.payload.finalContent);
    order.push('turn-end');
  });
  return { tokens, ends, turns, order };
}

for (const mode of ['classic', 'dynamic', 'dynamic-grouped'] as const) {
  describe(`output admission (${mode})`, () => {
    for (const [label, refusal] of refusals) {
      it(`${label}: a refused output never becomes a delivered answer`, async () => {
        const agent = Agent.create({ provider: provider(), model: 'mock', reactMode: mode })
          .act({ output: [{ name: 'output-rule', onMessage: refusal }] })
          .build();
        const seen = observe(agent);
        await expect(agent.run('hello')).rejects.toBeInstanceOf(MessageDeniedError);
        expect(seen.tokens).toEqual([]);
        expect(seen.turns).toEqual([]);
        expect(seen.ends).toEqual([
          expect.objectContaining({
            content: '',
            contentWithheld: true,
            toolCallCount: 0,
            usage: { input: 3, output: 7 },
            stopReason: 'end_turn',
          }),
        ]);
        const state = agent.getLastSnapshot()!.sharedState;
        expect(state).toMatchObject({
          messageDeniedPhase: 'output',
          messageDeniedBy: 'output-rule',
        });
        expect(state).not.toHaveProperty('answerValidationCommitted');
        // The diagnostic record is intentionally not erased; it is not delivery.
        expect(JSON.stringify(agent.getLastSnapshot())).toContain(draft);
        const checkpoint = agent.checkpoint();
        expect(
          checkpoint?.history.some((m) => m.role === 'assistant' && m.content === draft),
        ).not.toBe(true);
      });
    }

    for (const streaming of [false, true]) {
      it(`releases a rewritten answer once, after the chain (${
        streaming ? 'stream' : 'complete'
      })`, async () => {
        const tokensAtPolicy: string[][] = [];
        const rule: MessageMiddleware = {
          name: 'rewrite',
          async onMessage() {
            tokensAtPolicy.push([...seen.tokens]);
            await Promise.resolve();
            seen.order.push('policy');
            return allow(accepted, 'safe replacement');
          },
        };
        const agent = Agent.create({
          provider: provider(undefined, streaming),
          model: 'mock',
          reactMode: mode,
        })
          .act({ output: [rule] })
          .build();
        const seen = observe(agent);
        expect(await agent.run('hello')).toBe(accepted);
        expect(tokensAtPolicy).toEqual([[]]);
        expect(seen.tokens).toEqual([accepted]);
        expect(seen.turns).toEqual([accepted]);
        expect(seen.order).toEqual(['policy', 'token', 'turn-end']);
        expect(seen.ends).toHaveLength(1);
        expect(seen.ends[0]).toMatchObject({ content: '', contentWithheld: true });
        expect(agent.getLastSnapshot()!.sharedState).not.toHaveProperty(
          'answerValidationCommitted',
        );
        expect(agent.checkpoint()?.history.at(-1)).toMatchObject({
          role: 'assistant',
          content: accepted,
        });
      });
    }

    it('holds a generic message chain even when its callback chooses to allow output', async () => {
      const agent = Agent.create({ provider: provider(), model: 'mock', reactMode: mode })
        .messageMiddleware({ name: 'both-phases', onMessage: () => allow() })
        .build();
      const seen = observe(agent);
      await agent.run('hello');
      expect(seen.tokens).toEqual([draft]);
      expect(seen.ends[0]).toMatchObject({ content: '', contentWithheld: true });
    });

    for (const inputOnly of [false, true]) {
      it(`${
        inputOnly ? 'declared input-only' : 'no message policy'
      } keeps immediate provider streaming`, async () => {
        const builder = Agent.create({
          provider: provider(() => expect(seen.tokens).toEqual([draft])),
          model: 'mock',
          reactMode: mode,
        });
        if (inputOnly) builder.act({ input: [{ name: 'input-only', onMessage: () => allow() }] });
        const agent = builder.build();
        const seen = observe(agent);
        expect(await agent.run('hello')).toBe(draft);
        expect(seen.tokens).toEqual([draft]);
        expect(seen.ends[0]).toMatchObject({ content: draft });
        expect(seen.ends[0]).not.toHaveProperty('contentWithheld');
      });
    }
  });
}
