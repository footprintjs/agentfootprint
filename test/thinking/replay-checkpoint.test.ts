/** Core owns durable transport of replay evidence, not its wire-specific judgement. */
import { describe, expect, it, vi } from 'vitest';
import { Agent, defineTool, isPaused, RunCheckpointError } from '../../src/index.js';
import { defineSkill } from '../../src/injection-engine.js';
import { askHuman } from '../../src/core/pause.js';
import type { LLMMessage, LLMProvider, LLMRequest, LLMResponse } from '../../src/adapters/types.js';
import { allow, deny } from '../../src/core/agent/middleware/outcomes.js';
import { conversationRedaction } from '../../src/doors/security.js';
import { mockAnthropicRaw, mockThinkingHandler } from '../../src/thinking/MockThinkingHandler.js';
import { UnsafeThinkingReplayError, type MessageReplay } from '../../src/thinking/replay.js';
import { replayMessageFingerprint } from '../../src/thinking/replayHistory.js';
import { withRetry } from '../../src/resilience/withRetry.js';
import { withFallback } from '../../src/resilience/withFallback.js';
import { withCircuitBreaker } from '../../src/resilience/withCircuitBreaker.js';

const MODES = ['classic', 'dynamic', 'dynamic-grouped'] as const;
const BLOCK = {
  type: 'thinking' as const,
  content: 'private-reasoning',
  signature: 'exact-signature',
};
const RAW = mockAnthropicRaw([BLOCK]);
const lookup = defineTool({
  name: 'lookup',
  description: 'Read one item.',
  inputSchema: { type: 'object', properties: {} },
  execute: () => 'private-result',
});

// Deliberately opaque: the fake provider asserts evidence, and core must carry
// it without inventing another digest or interpreting the adapter's binding.
const proof = (id: string, thinking = true): MessageReplay => ({
  version: 1,
  protocol: 'anthropic-messages',
  id,
  layout: [
    ...(thinking ? [{ type: 'thinking' as const, index: 0 }] : []),
    { type: 'text', length: 6 },
  ],
  stopReason: 'end_turn',
  contentDigest: `opaque-${id}`,
});
const response = (content: string, extra: Partial<LLMResponse> = {}): LLMResponse => ({
  content,
  toolCalls: [],
  usage: { input: 1, output: 1 },
  stopReason: 'end_turn',
  ...extra,
});

function scripted(replies: readonly (LLMResponse | Error)[], stream = false) {
  const messages: (readonly LLMMessage[])[] = [];
  const complete = vi.fn(async (req: LLMRequest): Promise<LLMResponse> => {
    messages.push(JSON.parse(JSON.stringify(req.messages)));
    const next = replies[messages.length - 1];
    if (next === undefined) throw new Error('Fixture exhausted');
    if (next instanceof Error) throw next;
    return next;
  });
  const provider: LLMProvider = {
    name: 'replay-fixture',
    thinkingHandler: mockThinkingHandler,
    complete,
    ...(stream && {
      async *stream(req: LLMRequest) {
        const result = await complete(req);
        yield { tokenIndex: 0, content: '', done: true, response: result };
      },
    }),
  };
  return { provider, complete, messages };
}

describe.each(MODES)('durable replay in %s', (reactMode) => {
  it.each([false, true])(
    'keeps final thinking and replay through JSON restart (stream=%s)',
    async (stream) => {
      const first = scripted(
        [response('answer', { rawThinking: RAW, replay: proof('final') })],
        stream,
      );
      const agent = Agent.create({ provider: first.provider, model: 'fixture', reactMode }).build();
      await agent.run({ message: 'private-question' });
      const saved = agent.checkpoint()!;
      expect(saved.history.at(-1)).toEqual({
        role: 'assistant',
        content: 'answer',
        thinkingBlocks: [BLOCK],
        replay: proof('final'),
      });
      const restored = JSON.parse(JSON.stringify(saved));
      const second = scripted([response('next')]);
      await Agent.create({ provider: second.provider, model: 'fixture', reactMode })
        .build()
        .run({ message: 'continue', continueFrom: restored });
      expect(second.messages[0]).toContainEqual(saved.history.at(-1));
      // A consumer editing its copy cannot rewrite the live proof or signature.
      Object.assign(saved.history.at(-1)!.thinkingBlocks![0]!, { signature: 'changed' });
      expect(agent.checkpoint()!.history.at(-1)?.thinkingBlocks).toEqual([BLOCK]);
    },
  );

  it('keeps a terminal proof even when the final reply has no thinking or text', async () => {
    const toolProof = {
      ...proof('tool'),
      binding: {
        model: 'fixture',
        salt: 'salt',
        system: 'system',
        tools: 'tools',
        messages: 'messages',
        priorThinking: ['earlier'],
      },
    };
    const fixture = scripted([
      response('', {
        rawThinking: RAW,
        replay: toolProof,
        toolCalls: [{ id: 't1', name: 'lookup', args: {} }],
      }),
      response('', { replay: proof('terminal', false) }),
      response('next'),
    ]);
    const agent = Agent.create({ provider: fixture.provider, model: 'fixture', reactMode })
      .tool(lookup)
      .build();
    await agent.run({ message: 'look up' });
    const history = agent.checkpoint()!.history;
    expect(history[1]).toMatchObject({ thinkingBlocks: [BLOCK], replay: toolProof });
    expect(history.at(-1)).toEqual({
      role: 'assistant',
      content: '',
      replay: proof('terminal', false),
    });
    await agent.followUp('continue');
    expect(fixture.messages[2]).toContainEqual(history.at(-1));
  });

  it('clears old thinking and replay when a later reply supplies neither', async () => {
    const fixture = scripted([
      response('', {
        rawThinking: RAW,
        replay: proof('tool'),
        toolCalls: [{ id: 't1', name: 'lookup', args: {} }],
      }),
      response('answer'),
    ]);
    const agent = Agent.create({ provider: fixture.provider, model: 'fixture', reactMode })
      .tool(lookup)
      .build();
    await agent.run({ message: 'look up' });
    expect(agent.checkpoint()!.history[1]?.replay).toEqual(proof('tool'));
    expect(agent.checkpoint()!.history.at(-1)).toEqual({ role: 'assistant', content: 'answer' });
    const state = agent.getLastSnapshot()!.sharedState as Record<string, unknown>;
    expect(state.thinkingBlocks).toEqual([]);
    expect(state.llmLatestReplay).toBeUndefined();
  });

  it('preserves reported retirement through the grouped boundary and the next checkpoint', async () => {
    const fixture = scripted([
      response('first', { rawThinking: RAW, replay: proof('first') }),
      response('', {
        replay: proof('tool', false),
        toolCalls: [{ id: 't1', name: 'lookup', args: {} }],
      }),
      response('answer', { replay: proof('final', false) }),
      response('next'),
    ]);
    const provider: LLMProvider = {
      ...fixture.provider,
      async complete(req, hooks) {
        const index = req.messages.findIndex(
          (m) => m.replay?.id === 'first' && m.thinkingBlocks?.length,
        );
        if (index === -1) return fixture.provider.complete(req, hooks);
        const message = req.messages[index]!;
        const request = {
          ...req,
          messages: req.messages.map((m, i) =>
            i === index
              ? {
                  ...m,
                  thinkingBlocks: [],
                  replay: { ...m.replay!, thinkingRetired: true as const },
                }
              : m,
          ),
        };
        if (hooks?.onReplayPrepared === undefined) throw new Error('Missing retirement hook');
        hooks.onReplayPrepared({
          provider: 'replay-fixture',
          model: req.model,
          request,
          omissions: [
            {
              messageIndex: index,
              blockIndex: 0,
              reason: 'prefix-changed',
              replayId: 'first',
              messageFingerprint: replayMessageFingerprint(message),
            },
          ],
        });
        return fixture.provider.complete(request, hooks);
      },
    };
    const agent = Agent.create({ provider, model: 'fixture', reactMode }).tool(lookup).build();
    await agent.run({ message: 'first question' });
    await agent.followUp('look up');
    const retired = {
      role: 'assistant',
      content: 'first',
      thinkingBlocks: [],
      replay: { ...proof('first'), thinkingRetired: true },
    };
    expect(fixture.messages[2]).toContainEqual(retired);
    expect(agent.checkpoint()!.history).toContainEqual(retired);
    await agent.followUp('continue');
    expect(fixture.messages[3]).toContainEqual(retired);
  });

  it.each([false, true])(
    'does not resurrect retired thinking in a crash checkpoint (stream=%s)',
    async (stream) => {
      const fixture = scripted([
        response('first', { rawThinking: RAW, replay: proof('first') }),
        response('', { toolCalls: [{ id: 't1', name: 'lookup', args: {} }] }),
      ]);
      let calls = 0;
      const transport: LLMProvider['complete'] = async (req, hooks) => {
        if (++calls < 3) return fixture.provider.complete(req, hooks);
        const index = req.messages.findIndex((m) => m.replay?.id === 'first');
        const held = req.messages[index]!;
        hooks!.onReplayPrepared!({
          provider: 'replay-fixture',
          model: req.model,
          request: {
            ...req,
            messages: req.messages.map((m, i) =>
              i === index
                ? { ...m, thinkingBlocks: [], replay: { ...m.replay!, thinkingRetired: true } }
                : m,
            ),
          },
          omissions: [
            {
              messageIndex: index,
              blockIndex: 0,
              reason: 'prefix-changed',
              replayId: 'first',
              messageFingerprint: replayMessageFingerprint(held),
            },
          ],
        });
        throw new Error('fixture network failure after preparation');
      };
      const provider: LLMProvider = {
        ...fixture.provider,
        complete: transport,
        ...(stream && {
          async *stream(req: LLMRequest, hooks: Parameters<LLMProvider['complete']>[1]) {
            const result = await transport(req, hooks);
            yield { content: '', tokenIndex: 0, done: true, response: result };
          },
        }),
      };
      const agent = Agent.create({ provider, model: 'fixture', reactMode }).tool(lookup).build();
      await agent.run('first question');
      const failure = await agent.followUp('look up').catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(RunCheckpointError);
      if (!(failure instanceof RunCheckpointError)) throw new Error('Expected crash checkpoint');
      const expected = {
        role: 'assistant',
        content: 'first',
        thinkingBlocks: [],
        replay: { ...proof('first'), thinkingRetired: true },
      };
      expect(failure.checkpoint.history).toContainEqual(expected);
      expect(agent.checkpoint()!.history).toContainEqual(expected);
      expect(failure.checkpoint.history.at(-1)).toMatchObject({ role: 'tool', toolCallId: 't1' });
      const restored = scripted([response('recovered')]);
      await Agent.create({ provider: restored.provider, model: 'fixture', reactMode })
        .tool(lookup)
        .build()
        .resumeOnError(JSON.parse(JSON.stringify(failure.checkpoint)));
      expect(restored.messages[0]).toContainEqual(expected);
      expect(restored.messages[0]?.filter((m) => m.toolCallId === 't1')).toHaveLength(1);
    },
  );

  it('carries replay on a failed-schema assistant turn before asking again', async () => {
    const fixture = scripted([
      response('not json', { rawThinking: RAW, replay: proof('failed') }),
      response('{"ok":true}', { replay: proof('accepted', false) }),
    ]);
    const agent = Agent.create({ provider: fixture.provider, model: 'fixture', reactMode })
      .outputSchema({ parse: (value: unknown) => value }, { retries: 1 })
      .build();
    await agent.run({ message: 'answer as json' });
    expect(fixture.messages[1]).toContainEqual({
      role: 'assistant',
      content: 'not json',
      thinkingBlocks: [BLOCK],
      replay: proof('failed'),
    });
  });

  // Classic deliberately rejects stepped skills at build time.
  if (reactMode !== 'classic')
    it('carries a premature assistant turn through the unfinished-steps nudge', async () => {
      const fixture = scripted([
        response('', {
          toolCalls: [{ id: 's1', name: 'read_skill', args: { id: 'lookup-flow' } }],
        }),
        response('not finished', { rawThinking: RAW, replay: proof('premature') }),
        response('stopping here'),
      ]);
      const flow = defineSkill({
        id: 'lookup-flow',
        description: 'Look up one item.',
        body: 'Read the item.',
        tools: [lookup],
        steps: [{ tool: 'lookup', note: 'Read the item' }],
      });
      const agent = Agent.create({ provider: fixture.provider, model: 'fixture', reactMode })
        .injection(flow)
        .build();
      await agent.run({ message: 'look up' });
      expect(fixture.messages[2]).toContainEqual({
        role: 'assistant',
        content: 'not finished',
        thinkingBlocks: [BLOCK],
        replay: proof('premature'),
      });
    });

  it('keeps replay in a paused tool turn without inventing a terminal answer', async () => {
    const question = defineTool({
      name: 'ask_first',
      description: 'Ask for consent.',
      inputSchema: { type: 'object', properties: {} },
      execute: () => askHuman({ question: 'Continue?' }),
    });
    const fixture = scripted([
      response('', {
        rawThinking: RAW,
        replay: proof('paused'),
        toolCalls: [{ id: 't1', name: 'ask_first', args: {} }],
      }),
      response('approved', { replay: proof('done', false) }),
    ]);
    const agent = Agent.create({ provider: fixture.provider, model: 'fixture', reactMode })
      .tool(question)
      .build();
    const paused = await agent.run({ message: 'go' });
    expect(isPaused(paused)).toBe(true);
    if (!isPaused(paused)) throw new Error('Expected the tool to pause');
    const saved = agent.checkpoint()!;
    expect(saved.history).toHaveLength(2);
    expect(saved.history[1]).toMatchObject({
      thinkingBlocks: [BLOCK],
      replay: proof('paused'),
      toolCalls: [{ id: 't1' }],
    });
    expect(await agent.resume(JSON.parse(JSON.stringify(paused.checkpoint)), 'yes')).toBe(
      'approved',
    );
    expect(fixture.messages[1]).toContainEqual(saved.history[1]);
    expect(agent.checkpoint()!.history.at(-1)).toEqual({
      role: 'assistant',
      content: 'approved',
      replay: proof('done', false),
    });
  });

  it('keeps the delivered rewrite and live metadata, never the redacted record value', async () => {
    const fixture = scripted([
      response('private-draft', { rawThinking: RAW, replay: proof('rewrite') }),
    ]);
    const agent = Agent.create({
      provider: fixture.provider,
      model: 'fixture',
      reactMode,
      redact: conversationRedaction(),
    })
      .act({
        output: [
          { name: 'rewrite', onMessage: () => allow('approved-answer', 'approved rewrite') },
        ],
      })
      .build();
    expect(await agent.run({ message: 'private-question' })).toBe('approved-answer');
    const saved = agent.checkpoint()!;
    expect(saved.history.at(-1)).toEqual({
      role: 'assistant',
      content: 'approved-answer',
      thinkingBlocks: [BLOCK],
      replay: proof('rewrite'),
    });
    expect(JSON.stringify(agent.getLastSnapshot())).not.toContain('private-reasoning');
    expect(saved.history[0]?.content).toBe('private-question');
  });

  it('does not append a denied terminal reply or its replay metadata', async () => {
    const fixture = scripted([
      response('private-draft', { rawThinking: RAW, replay: proof('denied') }),
    ]);
    const agent = Agent.create({ provider: fixture.provider, model: 'fixture', reactMode })
      .act({ output: [{ name: 'deny', onMessage: () => deny('not allowed') }] })
      .build();
    await expect(agent.run({ message: 'question' })).rejects.toThrow();
    expect(agent.checkpoint()!.history).toEqual([{ role: 'user', content: 'question' }]);
  });

  it('preserves the ordinary checkpoint shape without replay', async () => {
    const fixture = scripted([response('answer')]);
    const agent = Agent.create({ provider: fixture.provider, model: 'fixture', reactMode }).build();
    await agent.run({ message: 'question' });
    expect(agent.checkpoint()!.history).toEqual([
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'answer' },
    ]);
    expect(JSON.stringify(agent.getLastSnapshot())).not.toContain('llmLatestReplay');
  });

  it('surfaces an unsafe replay refusal after a completed tool iteration without a retry checkpoint', async () => {
    const refused = new UnsafeThinkingReplayError('fixture', 'fixture', 1, 'prefix-changed');
    const fixture = scripted([
      response('', { toolCalls: [{ id: 't1', name: 'lookup', args: {} }] }),
      refused,
    ]);
    const agent = Agent.create({ provider: fixture.provider, model: 'fixture', reactMode })
      .tool(lookup)
      .build();
    await expect(agent.run({ message: 'look up' })).rejects.toBe(refused);
    expect(fixture.complete).toHaveBeenCalledTimes(2);
  });
});

describe.each(['complete', 'stream'] as const)('unsafe replay resilience: %s', (mode) => {
  async function call(provider: LLMProvider) {
    const req: LLMRequest = { model: 'fixture', messages: [{ role: 'user', content: 'continue' }] };
    if (mode === 'complete') return provider.complete(req);
    for await (const _chunk of provider.stream!(req)) {
      /* consume the real wrapper */
    }
  }

  it('does not retry or fail over a known unsafe replay', async () => {
    const refusal = new UnsafeThinkingReplayError('fixture', 'fixture', 1, 'prefix-changed');
    const primary = scripted([refusal], true);
    const secondary = scripted([response('must not answer')], true);
    const provider = withRetry(withFallback(primary.provider, secondary.provider), {
      initialDelayMs: 0,
      maxAttempts: 3,
    });
    await expect(call(provider)).rejects.toBe(refusal);
    expect(primary.complete).toHaveBeenCalledTimes(1);
    expect(secondary.complete).not.toHaveBeenCalled();
  });

  it('does not open the breaker and block a later valid request', async () => {
    const refusal = new UnsafeThinkingReplayError('fixture', 'fixture', 1, 'prefix-changed');
    const fixture = scripted([refusal, response('answer')], true);
    const provider = withCircuitBreaker(fixture.provider, { failureThreshold: 1 });
    await expect(call(provider)).rejects.toBe(refusal);
    await call(provider);
    expect(fixture.complete).toHaveBeenCalledTimes(2);
  });
});
