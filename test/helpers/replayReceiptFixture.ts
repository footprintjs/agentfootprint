/** A real Agent receipt and retirement hook, with a scripted leaf transport. */
import { Agent } from '../../src/index.js';
import type { LLMMessage, LLMProvider, LLMRequest } from '../../src/provider-contract/types.js';
import { mockAnthropicRaw, mockThinkingHandler } from '../../src/thinking/MockThinkingHandler.js';
import type { MessageReplay } from '../../src/thinking/replay.js';
import { replayMessageFingerprint } from '../../src/thinking/replayHistory.js';

export async function replayReceiptFixture(
  reactMode: 'dynamic' | 'dynamic-grouped',
  options: { readonly recordReceipt?: boolean; readonly failAfterPreparation?: boolean } = {},
) {
  const thinking = [
    { type: 'thinking' as const, content: 'private prior reasoning', signature: 'signed-prior' },
  ];
  const replay: MessageReplay = {
    version: 1,
    protocol: 'anthropic-messages',
    id: 'prior-answer',
    layout: [
      { type: 'thinking', index: 0 },
      { type: 'text', length: 5 },
    ],
    stopReason: 'end_turn',
    contentDigest: 'fixture-owned-opaque-proof',
  };
  const port: LLMRequest[] = [];
  const prepared: LLMRequest[] = [];
  const failure = new Error('Fixture transport rejected after preparation');
  const provider: LLMProvider = {
    name: 'replay-receipt-fixture',
    thinkingHandler: mockThinkingHandler,
    async complete(request, hooks) {
      port.push(JSON.parse(JSON.stringify(request)));
      if (port.length === 1)
        return {
          content: 'first',
          toolCalls: [],
          usage: { input: 0, output: 0 },
          stopReason: 'end_turn',
          rawThinking: mockAnthropicRaw(thinking),
          replay,
        };
      const index = request.messages.findIndex((m) => m.replay?.id === replay.id);
      if (index < 0) throw new Error('Fixture expected the completed assistant turn');
      const original = request.messages[index]!;
      const replacement: LLMMessage = {
        ...original,
        thinkingBlocks: [],
        replay: { ...replay, thinkingRetired: true },
      };
      const next = {
        ...request,
        messages: request.messages.map((m, i) => (i === index ? replacement : m)),
      };
      if (hooks?.onReplayPrepared === undefined) throw new Error('Missing real replay hook');
      hooks.onReplayPrepared({
        provider: 'replay-receipt-fixture',
        model: request.model,
        request: next,
        omissions: [
          {
            messageIndex: index,
            blockIndex: 0,
            reason: 'prefix-changed',
            replayId: replay.id,
            messageFingerprint: replayMessageFingerprint(original),
          },
        ],
      });
      prepared.push(JSON.parse(JSON.stringify(next)));
      if (options.failAfterPreparation) throw failure;
      return {
        content: 'next',
        toolCalls: [],
        usage: { input: 0, output: 0 },
        stopReason: 'end_turn',
      };
    },
  };
  const agent = Agent.create({
    provider,
    model: 'fixture',
    reactMode,
    recordReceipt: options.recordReceipt,
  })
    .system('fixture system')
    .build();
  await agent.run({ message: 'first question' });
  let caught: unknown;
  try {
    await agent.followUp('continue');
  } catch (error) {
    caught = error;
  }
  if (options.failAfterPreparation ? caught !== failure : caught !== undefined)
    throw caught ?? new Error('Expected transport rejection');
  return {
    snapshot: agent.getLastSnapshot()!,
    port: port[1]!,
    prepared: prepared[0]!,
    ...(caught !== undefined && { failure: caught }),
  };
}
