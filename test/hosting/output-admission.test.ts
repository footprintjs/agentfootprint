/**
 * Output admission owns terminal delivery, not merely the return value.
 * A real streaming provider used to expose the draft through hosted tokens
 * and llm_end before Route refused or rewrote it. Final capture also ran on
 * refusal, so turn_end and episodic memory claimed an accepted answer.
 * These tests observe the public answer channels and actual persistence;
 * they do not claim that arbitrary diagnostic events are a privacy filter.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  Agent,
  allow,
  askHuman,
  checkInApproved,
  defineTool,
  deny,
  type MessageMiddleware,
} from '../../src/index.js';
import type { LLMProvider } from '../../src/adapters/types.js';
import type { LLMEndPayload } from '../../src/events/payloads.js';
import { memorySessions, standingAgent } from '../../src/hosting/index.js';
import type {
  CheckpointEnvelope,
  DurabilityMode,
  RecentSpend,
  SessionLifecycle,
} from '../../src/hosting/index.js';
import {
  defineMemory,
  InMemoryStore,
  MEMORY_STRATEGIES,
  MEMORY_TYPES,
} from '../../src/memory/index.js';
import { toSSE } from '../../src/stream.js';
import { inProcessHost } from './testHost.js';

const RAW = 'Draft canary: account 4729';
const SAFE = 'The account details were withheld.';
const PARTS = [RAW.slice(0, 12), RAW.slice(12)];
const CASES = (['exit', 'async', 'sync'] as const).flatMap((durability) =>
  (['shared', 'pool'] as const).map((shape) => ({ durability, shape })),
);

function streaming(afterChunk: (index: number) => void = () => {}) {
  const yielded: string[] = [];
  const provider: LLMProvider = {
    name: 'output-admission-stream',
    complete: async () => {
      throw new Error('This test must exercise real streaming');
    },
    stream: async function* () {
      for (const [tokenIndex, content] of PARTS.entries()) {
        yielded.push(content);
        yield { tokenIndex, content, done: false };
        afterChunk(tokenIndex);
      }
      yield {
        tokenIndex: PARTS.length,
        content: '',
        done: true,
        response: {
          content: RAW,
          toolCalls: [],
          usage: { input: 2, output: 3 },
          stopReason: 'stop',
        },
      };
    },
  };
  return { provider, yielded };
}

function recordingSessions(): SessionLifecycle & { writes: CheckpointEnvelope[] } {
  const inner = memorySessions();
  const writes: CheckpointEnvelope[] = [];
  return {
    writes,
    hydrate: (id) => inner.hydrate(id),
    async persist(id, envelope) {
      writes.push(structuredClone(envelope));
      await inner.persist(id, envelope);
    },
  };
}

async function subject(
  mode: 'deny' | 'rewrite' | 'allow',
  durability: DurabilityMode,
  shape: 'shared' | 'pool',
) {
  const source = streaming();
  const tokens: string[] = [];
  const ends: string[] = [];
  const llmEnds: LLMEndPayload[] = [];
  const order: string[] = [];
  const store = new InMemoryStore();
  const puts = vi.spyOn(store, 'putMany');
  const rule: MessageMiddleware = {
    name: 'terminal-answer-rule',
    onMessage: (message) => {
      expect(message.phase).toBe('output');
      order.push('judged');
      return mode === 'deny'
        ? deny('This answer is not admitted.')
        : mode === 'rewrite'
        ? allow(SAFE, 'Removed account details.')
        : allow();
    },
  };
  const buildAgent = () => {
    const agent = Agent.create({ provider: source.provider, model: 'test-model' })
      .act({ output: [rule] })
      .memory(
        defineMemory({
          id: 'answer-memory',
          type: MEMORY_TYPES.EPISODIC,
          strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
          store,
        }),
      )
      .build();
    agent.on('agentfootprint.stream.token', ({ payload }) => {
      tokens.push(payload.content);
      order.push('token');
    });
    agent.on('agentfootprint.agent.turn_end', ({ payload }) => {
      ends.push(payload.finalContent);
      order.push('turn_end');
    });
    agent.on('agentfootprint.stream.llm_end', ({ payload }) => llmEnds.push(payload));
    return agent;
  };
  const sessions = recordingSessions();
  const host = inProcessHost({ streaming: true });
  const handle = await standingAgent({
    ...(shape === 'shared' ? { agent: buildAgent() } : { agentFactory: buildAgent }),
    sessions,
    host,
    durability,
  });
  return { source, tokens, ends, llmEnds, order, puts, sessions, host, handle };
}

describe.each(CASES)('output admission / $durability / $shape', ({ durability, shape }) => {
  it.each(['deny', 'rewrite', 'allow'] as const)(
    '%s governs hosted delivery and persistence while preserving LLM accounting',
    async (mode) => {
      const s = await subject(mode, durability, shape);
      try {
        const reply = await s.host.deliver({ input: 'Read my account.', sessionId: 'account' });
        expect(s.source.yielded).toEqual(PARTS);
        expect(s.llmEnds).toHaveLength(1);
        expect.soft(s.llmEnds[0]).toMatchObject({
          content: '',
          contentWithheld: true,
          usage: { input: 2, output: 3 },
          toolCallCount: 0,
          stopReason: 'stop',
          durationMs: expect.any(Number),
          iteration: expect.any(Number),
        });
        if (mode === 'deny') {
          expect(reply.code).toBe('ERR_MESSAGE_DENIED');
          expect(reply.output).toBeUndefined();
          expect.soft(reply.chunks).toEqual([]);
          expect.soft(s.tokens).toEqual([]);
          expect.soft(s.ends).toEqual([]);
          expect.soft(s.puts).not.toHaveBeenCalled();
          expect.soft(JSON.stringify(s.sessions.writes)).not.toContain(RAW);
          expect.soft(s.order).toEqual(['judged']);
        } else {
          const accepted = mode === 'rewrite' ? SAFE : RAW;
          expect(reply.error).toBeUndefined();
          expect(reply.output).toBe(accepted);
          expect.soft(reply.chunks).toEqual([accepted]);
          expect.soft(s.tokens).toEqual([accepted]);
          expect(s.ends).toEqual([accepted]);
          expect.soft(s.order).toEqual(['judged', 'token', 'turn_end']);
          expect(s.puts).toHaveBeenCalled();
          expect(JSON.stringify(s.puts.mock.calls)).toContain(accepted);
          const envelope = await s.sessions.hydrate('account');
          expect(envelope?.format).toBe('conversation-v1');
          if (envelope?.format !== 'conversation-v1') throw new Error('Expected conversation');
          expect(envelope.data.history.at(-1)?.content).toBe(accepted);
          if (mode === 'rewrite') {
            expect.soft(JSON.stringify(s.puts.mock.calls)).not.toContain(RAW);
            expect.soft(JSON.stringify(s.sessions.writes)).not.toContain(RAW);
          }
        }
      } finally {
        await s.handle.close();
        s.puts.mockRestore();
      }
    },
  );
});

describe('public answer streams', () => {
  it.each(['resume', 'answer-validation'] as const)(
    '%s output denial terminates SSE once, without a successful answer event',
    async (path) => {
      const source = streaming();
      let calls = 0;
      const provider: LLMProvider = {
        ...source.provider,
        stream: async function* (request, hooks) {
          if (path === 'resume' && calls++ === 0) {
            yield {
              tokenIndex: 0,
              content: '',
              done: true,
              response: {
                content: '',
                toolCalls: [{ id: 'confirm-1', name: 'confirm_account', args: {} }],
                usage: { input: 1, output: 1 },
                stopReason: 'tool_calls',
              },
            };
            return;
          }
          if (!source.provider.stream) throw new Error('Expected streaming fixture');
          yield* source.provider.stream(request, hooks);
        },
      };
      const validate = vi.fn(() => ({
        checks: [{ id: 'should-not-run', disposition: 'checked-pass' as const }],
      }));
      const builder = Agent.create({ provider, model: 'test-model' }).act({
        output: [{ name: 'terminal-rule', onMessage: () => deny('Not admitted.') }],
      });
      if (path === 'resume') {
        builder.tool(
          defineTool({
            name: 'confirm_account',
            description: 'Ask before opening the account.',
            inputSchema: { type: 'object', properties: {} },
            execute: () => askHuman({ question: 'Open the account?' }),
          }),
        );
      } else {
        builder.outputSchema({ parse: (value: unknown) => value }).answerValidation({
          id: 'account-check',
          version: '1',
          validate,
        });
      }
      const agent = builder.build();
      const host = inProcessHost({ streaming: true });
      const handle = await standingAgent({ agent, host, sessions: memorySessions() });
      try {
        if (path === 'resume') {
          const paused = await host.deliver({ input: 'Read my account.', sessionId: 'terminal' });
          expect(paused.error).toBeUndefined();
          expect(paused.awaiting?.question).toBe('Open the account?');
          expect(paused.chunks).toEqual([]);
        }
        const frames: string[] = [];
        const drain = (async () => {
          for await (const frame of toSSE(agent)) frames.push(frame);
        })();
        const reply = await host.deliver({
          input: path === 'resume' ? '' : 'Read my account.',
          sessionId: 'terminal',
          ...(path === 'resume' && { decision: checkInApproved({ by: 'account-owner' }) }),
        });
        await drain;
        expect(reply.code).toBe('ERR_MESSAGE_DENIED');
        expect(reply.output).toBeUndefined();
        expect(reply.chunks).toEqual([]);
        expect(validate).not.toHaveBeenCalled();
        const fatal = frames.filter((frame) =>
          frame.startsWith('event: agentfootprint.error.fatal\n'),
        );
        expect(fatal).toHaveLength(1);
        expect(fatal[0]).toContain('"sessionId":"terminal"');
        expect(
          frames.some((frame) => frame.startsWith('event: agentfootprint.agent.turn_end\n')),
        ).toBe(false);
        expect(
          frames.some((frame) => frame.startsWith('event: agentfootprint.stream.token\n')),
        ).toBe(false);
        expect(
          frames.filter((frame) => frame.startsWith('event: agentfootprint.stream.llm_end\n')),
        ).toHaveLength(1);
      } finally {
        await handle.close();
      }
    },
  );

  it.each(['deny', 'rewrite', 'allow'] as const)(
    '%s still charges the reported usage to the hosted admission ledger',
    async (mode) => {
      const source = streaming();
      const agent = Agent.create({ provider: source.provider, model: 'test-model' })
        .act({
          output: [
            {
              name: 'accounting-rule',
              onMessage: () =>
                mode === 'deny'
                  ? deny('Not admitted.')
                  : mode === 'rewrite'
                  ? allow(SAFE, 'Removed account details.')
                  : allow(),
            },
          ],
        })
        .build();
      const spend: RecentSpend[] = [];
      const host = inProcessHost({ streaming: true });
      const handle = await standingAgent({
        agent,
        host,
        sessions: memorySessions(),
        admission: {
          decide({ recentSpend }) {
            spend.push({ ...recentSpend });
            return 'allow';
          },
        },
      });
      try {
        for (let i = 0; i < 2; i++) {
          const reply = await host.deliver({ input: 'Read my account.', sessionId: `spend-${i}` });
          expect(reply.code).toBe(mode === 'deny' ? 'ERR_MESSAGE_DENIED' : undefined);
        }
        expect(spend).toHaveLength(2);
        expect(spend[0]).toMatchObject({ turns: 0, inputTokens: 0, outputTokens: 0 });
        expect(spend[1]).toMatchObject({ turns: 1, inputTokens: 2, outputTokens: 3 });
        expect(spend[1]?.usd).toBeUndefined();
      } finally {
        await handle.close();
      }
    },
  );

  it.each(['none', 'input'] as const)(
    '%s-only admission preserves immediate provider chunks',
    async (mode) => {
      const tokens: string[] = [];
      const source = streaming((index) => expect(tokens).toEqual(PARTS.slice(0, index + 1)));
      const builder = Agent.create({ provider: source.provider, model: 'test-model' });
      if (mode === 'input')
        builder.act({ input: [{ name: 'input-only', onMessage: () => allow() }] });
      const agent = builder.build();
      const llmEnds: LLMEndPayload[] = [];
      agent.on('agentfootprint.stream.token', ({ payload }) => tokens.push(payload.content));
      agent.on('agentfootprint.stream.llm_end', ({ payload }) => llmEnds.push(payload));
      const host = inProcessHost({ streaming: true });
      const handle = await standingAgent({ agent, host, sessions: memorySessions() });
      try {
        const reply = await host.deliver({ input: 'Read my account.', sessionId: 'plain' });
        expect(reply.error).toBeUndefined();
        expect(reply.output).toBe(RAW);
        expect(reply.chunks).toEqual(PARTS);
        expect(tokens).toEqual(PARTS);
        expect(llmEnds).toHaveLength(1);
        expect(llmEnds[0]?.content).toBe(RAW);
        expect(llmEnds[0]).not.toHaveProperty('contentWithheld');
      } finally {
        await handle.close();
      }
    },
  );

  it.each(['deny', 'rewrite'] as const)(
    'toSSE full and text carry only admitted answers on %s',
    async (mode) => {
      const source = streaming();
      const agent = Agent.create({ provider: source.provider, model: 'test-model' })
        .act({
          output: [
            {
              name: 'output-rule',
              onMessage: () =>
                mode === 'deny' ? deny('Not admitted.') : allow(SAFE, 'Removed account details.'),
            },
          ],
        })
        .build();
      const full: string[] = [];
      const text: string[] = [];
      const drainFull = (async () => {
        for await (const frame of toSSE(agent)) full.push(frame);
      })();
      const drainText = (async () => {
        for await (const chunk of toSSE(agent, { format: 'text' })) text.push(chunk);
      })();
      const host = inProcessHost({ streaming: true });
      const handle = await standingAgent({ agent, host, sessions: memorySessions() });
      try {
        const reply = await host.deliver({ input: 'Read my account.', sessionId: 'sse' });
        await Promise.all([drainFull, drainText]);
        expect(reply.code).toBe(mode === 'deny' ? 'ERR_MESSAGE_DENIED' : undefined);
        expect.soft(text).toEqual(mode === 'deny' ? [] : [SAFE]);
        const answers = full.filter((frame) =>
          /^event: agentfootprint\.(stream\.(token|llm_end)|agent\.turn_end)\n/.test(frame),
        );
        expect.soft(answers.join('')).not.toContain(RAW);
        expect(
          full.some((frame) => frame.startsWith('event: agentfootprint.stream.llm_end\n')),
        ).toBe(true);
        expect(
          full.some((frame) => frame.startsWith('event: agentfootprint.agent.turn_end\n')),
        ).toBe(mode !== 'deny');
        if (mode === 'deny')
          expect(
            full.some((frame) => frame.startsWith('event: agentfootprint.error.fatal\n')),
          ).toBe(true);
      } finally {
        await handle.close();
      }
    },
  );
});
