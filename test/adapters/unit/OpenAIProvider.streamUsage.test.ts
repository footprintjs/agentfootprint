/**
 * `streamUsage` — the option that stops a local model reporting zero tokens.
 *
 * The default is unchanged and that is half the point: a custom endpoint is
 * left out of `stream_options` because some reject the field, and this file
 * pins BOTH halves — the caution that ships by default, and the opt-in that
 * gives a local deployment its numbers back.
 */

import { describe, expect, it } from 'vitest';

import { openai } from '../../../src/adapters/llm/OpenAIProvider.js';

/** Captures the params the adapter hands the SDK, and answers a usage-bearing stream. */
function captor(): { client: never; sent: Record<string, unknown>[] } {
  const sent: Record<string, unknown>[] = [];
  const client = {
    chat: {
      completions: {
        create: (params: Record<string, unknown>) => {
          sent.push(params);
          async function* chunks(): AsyncGenerator<unknown> {
            yield { choices: [{ delta: { content: 'hi' } }] };
            // The final usage-only chunk a server sends when asked.
            yield { choices: [], usage: { prompt_tokens: 11, completion_tokens: 4 } };
          }
          return chunks();
        },
      },
    },
  };
  return { client: client as never, sent };
}

const REQ = { model: 'local-model', messages: [{ role: 'user' as const, content: 'hi' }] };

describe('streaming usage on a custom endpoint', () => {
  it('is NOT requested by default — some compatible servers reject the field', async () => {
    const { client, sent } = captor();
    const provider = openai({ baseURL: 'http://127.0.0.1:5272/v1', apiKey: 'k', _client: client });
    const stream = provider.stream!(REQ);
    for await (const _ of stream) void _;
    expect(sent[0]?.stream).toBe(true);
    expect(sent[0]?.stream_options).toBeUndefined();
  });

  it('is requested when the deployment opts in', async () => {
    const { client, sent } = captor();
    const provider = openai({
      baseURL: 'http://127.0.0.1:5272/v1',
      apiKey: 'k',
      streamUsage: true,
      _client: client,
    });
    const stream = provider.stream!(REQ);
    for await (const _ of stream) void _;
    expect(sent[0]?.stream_options).toEqual({ include_usage: true });
  });

  it('still asks on OpenAI/Azure, where it always did', async () => {
    const { client, sent } = captor();
    const provider = openai({ apiKey: 'k', _client: client });
    const stream = provider.stream!(REQ);
    for await (const _ of stream) void _;
    expect(sent[0]?.stream_options).toEqual({ include_usage: true });
  });
});
