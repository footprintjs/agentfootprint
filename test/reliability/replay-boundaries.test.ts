/** Real Agent boundaries: reliability cannot turn a wrong request into an outage. */
import { describe, expect, it, vi } from 'vitest';
import { Agent } from '../../src/core/Agent.js';
import type {
  LLMCallHooks,
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from '../../src/provider-contract/types.js';
import { UnsupportedToolChoiceError } from '../../src/provider-contract/forcedToolChoice.js';
import { UnsupportedThinkingError } from '../../src/thinking/errors.js';
import { UnsafeThinkingReplayError, type MessageReplay } from '../../src/thinking/replay.js';
import { mockAnthropicRaw, mockThinkingHandler } from '../../src/thinking/MockThinkingHandler.js';
import { replayMessageFingerprint } from '../../src/thinking/replayHistory.js';
import type { ReliabilityRule } from '../../src/reliability/types.js';
import type { ThinkingHandler } from '../../src/thinking/types.js';

const modes = ['classic', 'dynamic', 'dynamic-grouped'] as const;
type Mode = (typeof modes)[number];
const block = { type: 'thinking' as const, content: 'prior private thought', signature: 'signed' };
const replay: MessageReplay = {
  version: 1,
  protocol: 'anthropic-messages',
  id: 'prior-answer',
  layout: [
    { type: 'thinking', index: 0 },
    { type: 'text', length: 5 },
  ],
  stopReason: 'end_turn',
  contentDigest: 'fixture-proof',
};
const answer = (content = 'done'): LLMResponse => ({
  content,
  toolCalls: [],
  usage: { input: 1, output: 1 },
  stopReason: 'end_turn',
});
const retryRule: ReliabilityRule = {
  when: (s) => s.error !== undefined && s.attempt < 2,
  then: 'retry',
  kind: 'retry-once',
  feedbackForLLM: 'Keep the deliberate repair instruction.',
};

function leaf(
  name: string,
  run: (request: LLMRequest, hooks?: LLMCallHooks) => LLMResponse,
  stream: boolean,
): LLMProvider {
  return {
    name,
    complete: async (req, hooks) => run(req, hooks),
    ...(stream && {
      async *stream(req: LLMRequest, hooks?: LLMCallHooks) {
        yield { tokenIndex: 0, content: '', done: true, response: run(req, hooks) };
      },
    }),
  };
}

async function prior(reactMode: Mode) {
  const agent = Agent.create({
    provider: {
      name: 'prior',
      thinkingHandler: mockThinkingHandler,
      complete: async () => ({
        ...answer('first'),
        rawThinking: mockAnthropicRaw([block]),
        replay,
      }),
    },
    model: 'prior-model',
    reactMode,
  }).build();
  await agent.run({ message: 'first question' });
  return JSON.parse(JSON.stringify(agent.checkpoint()!));
}

function omit(req: LLMRequest, hooks?: LLMCallHooks) {
  const index = req.messages.findIndex((message) => message.replay?.id === replay.id);
  expect(index).toBeGreaterThanOrEqual(0);
  const original = req.messages[index]!;
  const omissions = original.thinkingBlocks?.length
    ? [
        {
          messageIndex: index,
          blockIndex: 0,
          reason: 'prefix-changed' as const,
          replayId: replay.id,
          messageFingerprint: replayMessageFingerprint(original),
        },
      ]
    : [];
  const request = omissions.length
    ? {
        ...req,
        messages: req.messages.map((message, i) =>
          i === index
            ? {
                ...message,
                thinkingBlocks: [],
                replay: { ...replay, thinkingRetired: true as const },
              }
            : message,
        ),
      }
    : req;
  hooks?.onReplayPrepared?.({ provider: 'fixture-leaf', model: req.model, request, omissions });
}

function expectRetired(req: LLMRequest) {
  expect(req.messages.find((message) => message.replay?.id === replay.id)).toMatchObject({
    content: 'first',
    thinkingBlocks: [],
    replay: { thinkingRetired: true },
  });
}

describe.each(modes)('reliability replay boundary (%s)', (reactMode) => {
  it('judges forced-choice support on the first listed transport, not the unused default', async () => {
    const unused = vi.fn(() => answer('unused'));
    const selected = vi.fn((req: LLMRequest) => {
      if (req.toolChoice === undefined) throw new Error('Fixture expected a forced schema tool');
      return {
        ...answer(''),
        toolCalls: [{ id: 'out', name: req.toolChoice.name, args: { answer: 'selected' } }],
      };
    });
    const provider = {
      ...leaf('selected', selected, false),
      carriesForcedToolChoice: true,
      supportsForcedToolChoice: (model: string) => model === 'selected-model',
    };
    const agent = Agent.create({
      provider: leaf('unused', unused, false),
      model: 'unused-model',
      reactMode,
    })
      .reliability({ providers: [{ name: 'selected', provider, model: 'selected-model' }] })
      .outputSchema(
        { parse: (value: unknown) => value },
        { strategy: 'tool-forced', jsonSchema: { type: 'object' } },
      )
      .build();
    expect(await agent.runTyped({ message: 'go' })).toEqual({ answer: 'selected' });
    expect(selected).toHaveBeenCalledTimes(1);
    expect(selected.mock.calls[0]![0].model).toBe('selected-model');
    expect(unused).not.toHaveBeenCalled();
  });

  it('refuses a selected alternate model before its unsupported forced tool is sent', async () => {
    const first = {
      ...leaf(
        'first',
        () => {
          throw new Error('first down');
        },
        false,
      ),
      carriesForcedToolChoice: true,
    };
    const alternateCall = vi.fn(() => answer('must not send'));
    const alternate = {
      ...leaf('alternate', alternateCall, false),
      carriesForcedToolChoice: true,
      supportsForcedToolChoice: () => false,
    };
    const agent = Agent.create({ provider: first, model: 'first-model', reactMode })
      .reliability({
        providers: [
          { name: 'first', provider: first, model: 'first-model' },
          { name: 'alternate', provider: alternate, model: 'blocked-model' },
        ],
        postDecide: [{ ...retryRule, then: 'retry-other' }],
      })
      .outputSchema(
        { parse: (value: unknown) => value },
        { strategy: 'tool-forced', jsonSchema: { type: 'object' } },
      )
      .build();
    await expect(agent.run({ message: 'go' })).rejects.toMatchObject({
      name: 'UnsupportedToolChoiceError',
      provider: 'alternate',
      model: 'blocked-model',
    });
    expect(alternateCall).not.toHaveBeenCalled();
  });
  for (const intent of ['declared', 'override', 'disabled'] as const) {
    it(`normalizes the selected provider's thinking with ${intent} handler intent`, async () => {
      const wrongHandler: ThinkingHandler = {
        id: 'first-shape',
        normalize: () => {
          throw new Error('wrong handler');
        },
      };
      const selectedRaw = { secondShape: 'selected private thought' };
      const normalize = vi.fn((raw: unknown) => {
        expect(raw).toEqual(selectedRaw);
        return [
          {
            type: 'thinking' as const,
            content: 'selected private thought',
            signature: 'second-signature',
          },
        ];
      });
      const secondHandler: ThinkingHandler = { id: 'second-shape', normalize };
      const override: ThinkingHandler = {
        id: 'override',
        normalize: vi.fn((raw: unknown) => {
          expect(raw).toEqual(selectedRaw);
          return [
            {
              type: 'thinking' as const,
              content: 'override thought',
              signature: 'override-signature',
            },
          ];
        }),
      };
      const first = {
        ...leaf(
          'first',
          () => {
            throw new Error('first down');
          },
          false,
        ),
        thinkingHandler: wrongHandler,
      };
      const second = {
        ...leaf(
          'second',
          () => ({
            ...answer('second answer'),
            rawThinking: selectedRaw,
            replay: { ...replay, id: 'second-answer' },
          }),
          false,
        ),
        thinkingHandler: secondHandler,
      };
      const builder = Agent.create({
        provider: first,
        model: 'first-model',
        reactMode,
      }).reliability({
        providers: [
          { name: 'first', provider: first, model: 'first-model' },
          { name: 'second', provider: second, model: 'second-model' },
        ],
        postDecide: [{ ...retryRule, then: 'retry-other' }],
      });
      if (intent === 'override') builder.thinkingHandler(override);
      if (intent === 'disabled') builder.thinkingHandler(null);
      const agent = builder.build();
      expect(await agent.run({ message: 'go' })).toBe('second answer');
      const final = agent.checkpoint()!.history.at(-1)!;
      if (intent === 'disabled') {
        expect(final.thinkingBlocks).toBeUndefined();
        expect(normalize).not.toHaveBeenCalled();
      } else {
        expect(final.thinkingBlocks).toEqual([
          {
            type: 'thinking' as const,
            content: intent === 'override' ? 'override thought' : 'selected private thought',
            signature: intent === 'override' ? 'override-signature' : 'second-signature',
          },
        ]);
        expect(intent === 'override' ? override.normalize : normalize).toHaveBeenCalledTimes(1);
      }
      expect(final.replay?.id).toBe('second-answer');
      expect(JSON.stringify(agent.getLastSnapshot())).not.toContain('function normalize');
    });
  }
  for (const stream of [false, true]) {
    for (const error of [
      new UnsafeThinkingReplayError('fixture', 'm', 0, 'prefix-changed'),
      new UnsupportedThinkingError({
        provider: 'fixture',
        model: 'm',
        reason: 'no-thinking',
        detail: 'unsupported',
      }),
      new UnsupportedToolChoiceError({ provider: 'fixture', model: 'm' }),
    ]) {
      it(`preserves ${error.name} before rules/breaker accounting (stream=${stream})`, async () => {
        const call = vi.fn(() => {
          throw error;
        });
        const rule = vi.fn(() => true);
        const shouldCount = vi.fn(() => true);
        const fallback = vi.fn(async () => answer('must not repair refusal'));
        const events = vi.fn();
        const agent = Agent.create({
          provider: leaf('fixture', call, stream),
          model: 'm',
          reactMode,
        })
          .reliability({
            postDecide: [{ when: rule, then: 'retry', kind: 'always-retry' }],
            circuitBreaker: { failureThreshold: 1, shouldCount },
            fallback,
          })
          .build();
        agent.on('agentfootprint.reliability.*', events);
        await expect(agent.run({ message: 'go' })).rejects.toBe(error);
        expect(call).toHaveBeenCalledTimes(1);
        expect(rule).not.toHaveBeenCalled();
        expect(shouldCount).not.toHaveBeenCalled();
        expect(fallback).not.toHaveBeenCalled();
        expect(events).not.toHaveBeenCalled();
      });
    }

    it(`retains approved omissions across retry without losing feedback (stream=${stream})`, async () => {
      const checkpoint = await prior(reactMode);
      const before = JSON.stringify(checkpoint);
      const requests: LLMRequest[] = [];
      const omitted = vi.fn();
      const provider = leaf(
        'fixture',
        (req, hooks) => {
          requests.push(req);
          omit(req, hooks);
          if (requests.length === 1) throw new Error('transport failed');
          return answer();
        },
        stream,
      );
      const agent = Agent.create({
        provider,
        model: 'selected-model',
        reactMode,
        maxTokens: 222,
        temperature: 0.3,
      })
        .system('preserve this system')
        .reliability({ postDecide: [retryRule] })
        .build();
      agent.on('agentfootprint.agent.thinking_omitted', omitted);
      expect(await agent.run({ message: 'next', continueFrom: checkpoint })).toBe('done');
      expect(requests).toHaveLength(2);
      expectRetired(requests[1]!);
      expect(requests[1]!.messages.at(-1)).toEqual({
        role: 'user',
        content: 'Keep the deliberate repair instruction.',
        ephemeral: true,
      });
      expect(requests[1]!.model).toBe('selected-model');
      expect(requests[1]!.systemPrompt).toBe(requests[0]!.systemPrompt);
      expect(requests[1]!.maxTokens).toBe(222);
      expect(requests[1]!.temperature).toBe(0.3);
      expect(omitted).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(checkpoint)).toBe(before);
      expect(
        agent
          .checkpoint()!
          .history.some((m) => m.content === 'Keep the deliberate repair instruction.'),
      ).toBe(false);
    });

    it(`uses the selected alternate provider/model with retired history (stream=${stream})`, async () => {
      const requests: { side: string; request: LLMRequest }[] = [];
      const pricePerToken = vi.fn((model: string) => (model === 'second-model' ? 0.01 : 1));
      const cost = vi.fn();
      const defaultCall = vi.fn(() => answer('wrong-default'));
      const first = leaf(
        'first',
        (req, hooks) => {
          requests.push({ side: 'first', request: req });
          omit(req, hooks);
          throw new Error('first transport failed');
        },
        stream,
      );
      const second = leaf(
        'second',
        (req) => {
          requests.push({ side: 'second', request: req });
          return answer('from-second');
        },
        stream,
      );
      const agent = Agent.create({
        provider: leaf('default', defaultCall, stream),
        model: 'default-model',
        reactMode,
        pricingTable: { name: 'fixture-pricing', pricePerToken },
      })
        .reliability({
          providers: [
            { name: 'first', provider: first, model: 'first-model' },
            { name: 'second', provider: second, model: 'second-model' },
          ],
          postDecide: [{ ...retryRule, then: 'retry-other' }],
        })
        .build();
      agent.on('agentfootprint.cost.tick', cost);
      expect(await agent.run({ message: 'next', continueFrom: await prior(reactMode) })).toBe(
        'from-second',
      );
      expect(defaultCall).not.toHaveBeenCalled();
      expect(requests.map(({ side, request }) => [side, request.model])).toEqual([
        ['first', 'first-model'],
        ['second', 'second-model'],
      ]);
      expectRetired(requests[1]!.request);
      expect(requests[1]!.request.messages.at(-1)?.content).toBe(
        'Keep the deliberate repair instruction.',
      );
      expect(pricePerToken.mock.calls.map(([model]) => model)).toEqual([
        'second-model',
        'second-model',
      ]);
      expect(cost).toHaveBeenCalledTimes(1);
      expect(cost.mock.calls[0]![0].payload).toMatchObject({
        provider: 'second',
        model: 'second-model',
        estimatedUsd: 0.02,
        tokensInput: 1,
        tokensOutput: 1,
      });
    });
  }

  it('retains an approved omission through stream-to-complete fallback', async () => {
    const requests: LLMRequest[] = [];
    const provider: LLMProvider = {
      name: 'fixture',
      async *stream(req, hooks) {
        requests.push(req);
        omit(req, hooks);
        yield { tokenIndex: 0, content: '', done: true };
      },
      async complete(req) {
        requests.push(req);
        return answer();
      },
    };
    const agent = Agent.create({ provider, model: 'm', reactMode }).build();
    expect(await agent.run({ message: 'next', continueFrom: await prior(reactMode) })).toBe('done');
    expect(requests).toHaveLength(2);
    expectRetired(requests[1]!);
  });

  it('hands retired history to an explicit response-repair fallback', async () => {
    const repaired: LLMRequest[] = [];
    const provider = leaf(
      'fixture',
      (req, hooks) => {
        omit(req, hooks);
        throw new Error('transport failed');
      },
      false,
    );
    const agent = Agent.create({ provider, model: 'm', reactMode })
      .reliability({
        postDecide: [{ when: (s) => s.error !== undefined, then: 'fallback', kind: 'repair' }],
        fallback: async (req) => {
          repaired.push(req);
          return answer('repaired');
        },
      })
      .build();
    expect(await agent.run({ message: 'next', continueFrom: await prior(reactMode) })).toBe(
      'repaired',
    );
    expect(repaired).toHaveLength(1);
    expectRetired(repaired[0]!);
  });

  it('does not classify a terminal request refusal thrown by response repair', async () => {
    const refusal = new UnsafeThinkingReplayError('fixture', 'm', 0, 'prefix-changed');
    const call = vi.fn(() => {
      throw new Error('transport failed');
    });
    const repair = vi.fn(async () => {
      throw refusal;
    });
    const agent = Agent.create({ provider: leaf('fixture', call, false), model: 'm', reactMode })
      .reliability({
        postDecide: [{ when: () => true, then: 'fallback', kind: 'repair' }],
        fallback: repair,
      })
      .build();
    await expect(agent.run({ message: 'go' })).rejects.toBe(refusal);
    expect(call).toHaveBeenCalledTimes(1);
    expect(repair).toHaveBeenCalledTimes(1);
  });
});
