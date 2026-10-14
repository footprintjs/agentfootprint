/** Public provider replay of sanitized, genuinely recorded content-block shapes. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { anthropic } from '../../../src/doors/providers.js';
import type { LLMMessage, LLMRequest, LLMResponse } from '../../../src/index.js';
import type {
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicMessagesBody,
} from '../../../src/adapters/llm/anthropicMessagesWire.js';

const MODEL = 'claude-sonnet-4-5-20250929';

describe.each(['captured-direct-caller-with-text', 'captured-direct-caller'])(
  '%s sanitized capture',
  (name) => {
    it.each(['complete', 'stream'])(
      '%s preserves the captured metadata on the next request',
      async (mode) => {
        const content = JSON.parse(
          readFileSync(new URL(`../fixtures/anthropic/${name}.json`, import.meta.url), 'utf8'),
        ) as AnthropicContentBlock[];
        expect(content.at(-1)).toMatchObject({ type: 'tool_use', caller: { type: 'direct' } });
        const bodies: AnthropicMessagesBody[] = [];
        // The source retained content blocks, not HTTP envelopes or SSE events.
        // These wrappers are intentionally synthetic; no network client is constructed.
        const respond = (body: AnthropicMessagesBody): AnthropicMessage => {
          bodies.push(structuredClone(body));
          if (bodies.length > 2) throw new Error('Captured-fixture script exhausted');
          return {
            id: `synthetic-envelope-${bodies.length}`,
            role: 'assistant',
            model: MODEL,
            stop_reason: bodies.length === 1 ? 'tool_use' : 'end_turn',
            content:
              bodies.length === 1 ? structuredClone(content) : [{ type: 'text', text: 'Done.' }],
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        };
        const provider = anthropic({
          _client: {
            messages: {
              create: async (body) => respond(body),
              stream: (body) => {
                const response = respond(body);
                return {
                  async *[Symbol.asyncIterator]() {
                    yield { type: 'message_start', message: { ...response, content: [] } };
                    for (const [index, block] of response.content.entries()) {
                      yield {
                        type: 'content_block_start',
                        index,
                        content_block: block.type === 'tool_use' ? { ...block, input: {} } : block,
                      };
                      if (block.type === 'tool_use')
                        yield {
                          type: 'content_block_delta',
                          index,
                          delta: {
                            type: 'input_json_delta',
                            partial_json: JSON.stringify(block.input),
                          },
                        };
                      yield { type: 'content_block_stop', index };
                    }
                    yield { type: 'message_stop' };
                  },
                  finalMessage: async () => response,
                };
              },
            },
          },
        });
        const invoke = async (request: LLMRequest): Promise<LLMResponse> => {
          if (mode === 'complete') return provider.complete(request);
          let result: LLMResponse | undefined;
          for await (const chunk of provider.stream!(request))
            if (chunk.response) result = chunk.response;
          if (!result) throw new Error('Missing final fixture response');
          return result;
        };
        const initial: LLMRequest = {
          model: MODEL,
          thinking: { budget: 1500 },
          messages: [{ role: 'user', content: 'Read the synthetic item.' }],
        };
        const response = await invoke(initial);
        expect(response.replay?.lossy).toBeUndefined();
        const assistant: LLMMessage = JSON.parse(
          JSON.stringify({
            role: 'assistant',
            content: response.content,
            toolCalls: response.toolCalls,
            thinkingBlocks: provider.thinkingHandler!.normalize(response.rawThinking),
            replay: response.replay,
          }),
        );
        const next: LLMRequest = {
          ...initial,
          messages: [
            ...initial.messages,
            assistant,
            { role: 'tool', toolCallId: 'tool-call-1', content: 'Synthetic result.' },
          ],
        };
        const before = JSON.stringify(next);
        expect((await invoke(next)).content).toBe('Done.');
        expect(JSON.stringify(next)).toBe(before);
        expect(bodies).toHaveLength(2);
        expect(bodies[1].messages[1]).toEqual({ role: 'assistant', content });
      },
    );
  },
);
