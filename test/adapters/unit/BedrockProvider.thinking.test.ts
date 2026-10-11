/** Converse does not implement signed thinking replay: refuse the request, never drop it. */
import { describe, expect, it, vi } from 'vitest';

import { Agent } from '../../../src/index.js';
import { bedrock, BedrockProvider } from '../../../src/adapters/llm/BedrockProvider.js';
import {
  forcedToolChoiceFor,
  UnsupportedToolChoiceError,
} from '../../../src/adapters/forcedToolChoice.js';
import type { LLMProvider, LLMRequest } from '../../../src/adapters/types.js';
import { UnsupportedThinkingError } from '../../../src/thinking/errors.js';

const tools = [{ name: 'answer', description: 'Answer.', inputSchema: { type: 'object' } }];
const request: LLMRequest = {
  model: 'bedrock',
  messages: [{ role: 'user', content: 'hello' }],
};
const reply = {
  output: { message: { role: 'assistant', content: [{ text: 'ok' }] } },
  stopReason: 'end_turn',
  usage: { inputTokens: 2, outputTokens: 1 },
};

function fixture(form: 'factory' | 'class', defaultModel?: string) {
  const inputs: unknown[] = [];
  class ConverseCommand {
    constructor(readonly input: unknown) {
      inputs.push(input);
    }
  }
  class ConverseStreamCommand extends ConverseCommand {}
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof ConverseStreamCommand) {
      return {
        stream: (async function* () {
          yield { contentBlockDelta: { delta: { text: 'ok' } } };
          yield { messageStop: { stopReason: 'end_turn' } };
          yield { metadata: { usage: { inputTokens: 2, outputTokens: 1 } } };
        })(),
      };
    }
    return reply;
  });
  const options = {
    defaultModel,
    _client: { send },
    _sdk: { ConverseCommand, ConverseStreamCommand },
  };
  const provider = form === 'factory' ? bedrock(options) : new BedrockProvider(options);
  return { provider, inputs, send };
}

async function call(provider: LLMProvider, path: 'complete' | 'stream', req: LLMRequest) {
  if (path === 'complete') return provider.complete(req);
  if (!provider.stream) throw new Error('Expected ConverseStream support');
  for await (const chunk of provider.stream(req)) {
    if (chunk.done) return chunk.response;
  }
  throw new Error('Expected a terminal chunk');
}

for (const form of ['factory', 'class'] as const) {
  describe(`Bedrock thinking honesty (${form})`, () => {
    it('declares unsupported thinking and refuses Agent.build without sending', () => {
      const { provider, inputs, send } = fixture(form);
      expect(provider.thinkingMode?.('bedrock')).toBe('none');
      expect(provider.thinkingMode?.('anthropic.claude-opus-5-5')).toBe('none');
      expect(() =>
        Agent.create({ provider, model: 'bedrock' }).thinking({ budget: 2048 }).build(),
      ).toThrow(UnsupportedThinkingError);
      expect(inputs).toEqual([]);
      expect(send).not.toHaveBeenCalled();
    });

    for (const path of ['complete', 'stream'] as const) {
      it.each(['bedrock', 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'amazon.nova-pro-v1:0'])(
        `${path} refuses thinking for %s before constructing or sending a command`,
        async (model) => {
          const { provider, inputs, send } = fixture(form, 'anthropic.claude-haiku-4-5');
          const error = await call(provider, path, {
            ...request,
            model,
            thinking: { budget: 2048 },
          }).catch((e: unknown) => e);
          expect(error).toBeInstanceOf(UnsupportedThinkingError);
          expect(error).toMatchObject({
            provider: 'bedrock',
            model: model === 'bedrock' ? 'anthropic.claude-haiku-4-5' : model,
            reason: 'no-thinking',
            retryable: false,
          });
          expect(error).toHaveProperty('message', expect.stringMatching(/Converse.*replay/));
          expect(error).toHaveProperty('message', expect.stringContaining('invokeModelGateway'));
          expect(inputs).toEqual([]);
          expect(send).not.toHaveBeenCalled();
        },
      );

      it(`${path} keeps an ordinary request and response unchanged`, async () => {
        const { provider, inputs } = fixture(form, 'amazon.nova-pro-v1:0');
        const result = await call(provider, path, {
          ...request,
          systemPrompt: 'Be concise.',
          tools,
          toolChoice: { type: 'tool', name: 'answer' },
          maxTokens: 127,
          temperature: 0.25,
          stop: ['END'],
        });
        expect(inputs).toEqual([
          {
            modelId: 'amazon.nova-pro-v1:0',
            messages: [{ role: 'user', content: [{ text: 'hello' }] }],
            system: [{ text: 'Be concise.' }],
            toolConfig: {
              tools: [
                {
                  toolSpec: {
                    name: 'answer',
                    description: 'Answer.',
                    inputSchema: { json: { type: 'object' } },
                  },
                },
              ],
              toolChoice: { tool: { name: 'answer' } },
            },
            inferenceConfig: { maxTokens: 127, temperature: 0.25, stopSequences: ['END'] },
          },
        ]);
        expect(result).toMatchObject({
          content: 'ok',
          toolCalls: [],
          usage: { input: 2, output: 1 },
          stopReason: 'stop',
        });
      });

      it.each([
        'anthropic.claude-opus-5-5',
        'us.anthropic.claude-sonnet-5-5',
        'anthropic.claude-fable-5-1',
        'anthropic.claude-mythos-5-1',
      ])(
        `${path} refuses the known unsupported forced model %s with its resolved id`,
        async (model) => {
          const { provider, inputs, send } = fixture(form, model);
          expect(provider.carriesForcedToolChoice).toBe(true);
          expect(forcedToolChoiceFor(provider, 'bedrock')).toBe(false);
          expect(forcedToolChoiceFor(provider, model)).toBe(false);
          const error = await call(provider, path, {
            ...request,
            tools,
            toolChoice: { type: 'tool', name: 'answer' },
          }).catch((e: unknown) => e);
          expect(error).toBeInstanceOf(UnsupportedToolChoiceError);
          expect(error).toMatchObject({ provider: 'bedrock', model, retryable: false });
          expect(inputs).toEqual([]);
          expect(send).not.toHaveBeenCalled();
        },
      );

      it(`${path} does not refuse a toolChoice that cannot reach the wire without tools`, async () => {
        const { provider, inputs } = fixture(form, 'anthropic.claude-opus-5-5');
        await call(provider, path, {
          ...request,
          tools: [],
          toolChoice: { type: 'tool', name: 'answer' },
        });
        expect(inputs).toHaveLength(1);
        expect(inputs[0]).not.toHaveProperty('toolConfig');
      });

      it(`${path} resolves request model before capability checks, not only defaultModel`, async () => {
        const { provider, inputs } = fixture(form, 'anthropic.claude-opus-5-5');
        expect(forcedToolChoiceFor(provider, 'anthropic.claude-haiku-5-5')).toBe(true);
        await call(provider, path, {
          ...request,
          model: 'anthropic.claude-haiku-5-5',
          tools,
          toolChoice: { type: 'tool', name: 'answer' },
        });
        expect(inputs[0]).toHaveProperty('toolConfig.toolChoice.tool.name', 'answer');
      });

      it(`${path} refuses an explicit unsupported model even when the default allows it`, async () => {
        const { provider, inputs, send } = fixture(form, 'anthropic.claude-haiku-5-5');
        expect(forcedToolChoiceFor(provider, 'bedrock')).toBe(true);
        const pending = call(provider, path, {
          ...request,
          model: 'eu.anthropic.claude-opus-5-5',
          tools,
          toolChoice: { type: 'tool', name: 'answer' },
        });
        await expect(pending).rejects.toMatchObject({
          name: 'UnsupportedToolChoiceError',
          model: 'eu.anthropic.claude-opus-5-5',
          retryable: false,
        });
        expect(inputs).toEqual([]);
        expect(send).not.toHaveBeenCalled();
      });
    }
  });
}
