/** Native provider replay metadata must survive the frozen callback history boundary. */
import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../src/index.js';
import { allow } from '../../src/core/agent/middleware/outcomes.js';
import { assistantReplayFields } from '../../src/core/agent/assistantReplay.js';
import { frozenTurnOf } from '../../src/core/agent/stages/toolCalls/access/bindings.js';
import { readCallOccurrenceKey } from '../../src/lib/callOccurrence.js';
import { mockAnthropicRaw, mockThinkingHandler } from '../../src/thinking/MockThinkingHandler.js';
import { conversationRedaction } from '../../src/doors/security.js';
import type { LLMMessage, LLMRequest, LLMResponse } from '../../src/provider-contract/types.js';
import type { MessageReplay } from '../../src/thinking/replay.js';

const block = {
  type: 'thinking' as const,
  content: 'PRIVATE-REPLAY-REASONING',
  signature: 'PRIVATE-EXACT-SIGNATURE',
};
const proof = (): MessageReplay => ({
  version: 1,
  protocol: 'anthropic-messages',
  id: 'provider-response',
  layout: [{ type: 'tool', index: 0, caller: { type: 'direct' } }],
  stopReason: 'tool_use',
  contentDigest: 'opaque-proof',
  binding: {
    model: 'fixture',
    salt: 'salt',
    system: 'system',
    tools: 'tools',
    messages: 'messages',
    priorThinking: [],
  },
});
const response = (extra: Partial<LLMResponse>): LLMResponse => ({
  content: '',
  toolCalls: [],
  usage: { input: 0, output: 0 },
  stopReason: 'stop',
  ...extra,
});
const expectedToolCall = {
  id: 'actual-tool-call',
  name: 'read_fixture',
  args: { q: 'complete-identifier' },
};

describe('provider replay at native middleware history', () => {
  for (const reactMode of ['classic', 'dynamic', 'dynamic-grouped'] as const) {
    it.each(['without-replay', 'replay-only', 'replay-and-thinking'] as const)(
      `${reactMode} keeps its actual assistant proposal with %s`,
      async (mode) => {
        const replay = proof();
        const requests: LLMRequest[] = [];
        let executed = 0,
          observed = 0;
        const agent = Agent.create({
          model: 'fixture',
          reactMode,
          redact: conversationRedaction(),
          provider: {
            name: 'provider-replay-native-fixture',
            thinkingHandler: mockThinkingHandler,
            async complete(request) {
              requests.push(request);
              return requests.length === 1
                ? response({
                    toolCalls: [
                      {
                        id: 'actual-tool-call',
                        name: 'read_fixture',
                        args: { q: 'complete-identifier' },
                      },
                    ],
                    ...(mode !== 'without-replay' && { replay }),
                    ...(mode === 'replay-and-thinking' && {
                      rawThinking: mockAnthropicRaw([block]),
                    }),
                  })
                : response({ content: 'Done.' });
            },
          },
        })
          .tool(
            defineTool({
              name: 'read_fixture',
              description: 'Read a synthetic fixture.',
              inputSchema: {
                type: 'object',
                properties: { q: { type: 'string' } },
                required: ['q'],
              },
              execute(args: { q: string }) {
                expect(args.q).toBe('complete-identifier');
                executed++;
                return 'Read.';
              },
            }),
          )
          .toolMiddleware({
            name: 'inspect-native-proposal',
            onToolCall(call) {
              observed++;
              const proposal = call.history.find(
                (message) =>
                  message.role === 'assistant' &&
                  message.toolCalls?.some((tool) => tool.id === call.toolCallId),
              );
              expect(proposal?.toolCalls).toHaveLength(1);
              const recordedCall = proposal!.toolCalls![0]!;
              expect(readCallOccurrenceKey(recordedCall)).toEqual(expect.any(String));
              const { callOccurrenceKey, ...providerFields } = recordedCall;
              expect(callOccurrenceKey?.[4]).toBe(0);
              expect(providerFields).toEqual(expectedToolCall);
              expect(() => structuredClone(proposal)).not.toThrow();
              expect(Object.isFrozen(proposal)).toBe(true);
              if (mode !== 'without-replay') {
                expect(proposal?.replay).toEqual(replay);
                expect(Object.isFrozen(proposal?.replay?.layout)).toBe(true);
                expect(() => {
                  (proposal!.replay!.binding as { model: string }).model = 'changed';
                }).toThrow();
              } else expect(proposal).not.toHaveProperty('replay');
              if (mode === 'replay-and-thinking') {
                expect(proposal?.thinkingBlocks).toEqual([block]);
                expect(() => {
                  (proposal!.thinkingBlocks![0] as { signature: string }).signature = 'changed';
                }).toThrow();
              }
              return allow();
            },
          })
          .build();
        try {
          expect(await agent.run({ message: 'Read the fixture.' })).toBe('Done.');
          expect([requests.length, observed, executed]).toEqual([2, 1, 1]);
          const sent = requests[1]!.messages;
          expect(sent.find(({ role }) => role === 'assistant')?.toolCalls).toEqual([
            expectedToolCall,
          ]);
          expect(sent.find(({ role }) => role === 'tool')).not.toHaveProperty('callOccurrenceKey');
          expect(replay).toEqual(proof());
          expect(block.signature).toBe('PRIVATE-EXACT-SIGNATURE');
          expect(JSON.stringify(agent.getLastSnapshot())).not.toContain('PRIVATE-');
        } finally {
          await agent.shutdown();
        }
      },
    );
  }

  it('detaches owned replay and thinking fields for plain checkpoint callers too', () => {
    const replay = proof(),
      thinking = { ...block };
    const fields = assistantReplayFields({ llmLatestReplay: [replay], thinkingBlocks: [thinking] });
    expect(fields).toEqual({ replay, thinkingBlocks: [thinking] });
    expect(fields.replay).not.toBe(replay);
    expect(fields.thinkingBlocks![0]).not.toBe(thinking);
    (fields.replay!.binding as { model: string }).model = 'changed';
    (fields.thinkingBlocks![0] as { signature: string }).signature = 'changed';
    expect(replay).toEqual(proof());
    expect(thinking).toEqual(block);
  });

  it('preserves the unsafe whole-turn clone guard instead of accepting arbitrary proxies', () => {
    const turn: LLMMessage = {
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: 'unsafe', name: 'read_fixture', args: new Proxy({ q: 'uncloneable' }, {}) },
      ],
    };
    const guarded = frozenTurnOf(turn);
    expect(guarded).toEqual({ role: 'assistant', content: '' });
    expect(Object.isFrozen(guarded)).toBe(true);
  });
});
