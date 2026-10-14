/**
 * `LLMRequest.outputFormat` — the provider's own structured output on the
 * Anthropic wire (`output_config.format`), and the capability that says
 * which adapters and models take it.
 *
 * Test types: Contract (the bytes each Anthropic adapter sends, per supported
 * family; the manifest read back from them) · Refusal (an unlisted family, an
 * adapter that does not carry the format — by name, before any I/O) ·
 * Byte law (no format asked → no `output_config` key) · Capability (which
 * providers declare; the wrappers forward; `withFallback` ANDs) · Streaming
 * (the SSE text accumulates into the one JSON answer; a refusal stop passes
 * through as data).
 *
 * Facts: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
 * (fetched 2026-10-14).
 */

import { describe, expect, it, vi } from 'vitest';

import { anthropic } from '../../../src/adapters/llm/AnthropicProvider.js';
import { browserAnthropic } from '../../../src/adapters/llm/BrowserAnthropicProvider.js';
import { bedrock } from '../../../src/adapters/llm/BedrockProvider.js';
import { openai } from '../../../src/adapters/llm/OpenAIProvider.js';
import { mock } from '../../../src/adapters/llm/MockProvider.js';
import { buildMessagesBody } from '../../../src/adapters/llm/anthropicMessagesWire.js';
import { anthropicTakesNativeOutputSchema } from '../../../src/adapters/llm/anthropicModels.js';
import { withRetry } from '../../../src/resilience/withRetry.js';
import { withFallback } from '../../../src/resilience/withFallback.js';
import { withCircuitBreaker } from '../../../src/resilience/withCircuitBreaker.js';
import { isRequestRefusal } from '../../../src/adapters/requestRefusal.js';
import { nativeOutputSchemaFor, UnsupportedNativeOutputError } from '../../../src/providers.js';
import type { LLMChunk, LLMRequest } from '../../../src/adapters/types.js';

const SCHEMA = {
  type: 'object',
  properties: { status: { type: 'string', enum: ['ok', 'err'] } },
  required: ['status'],
  additionalProperties: false,
} as const;

const NATIVE: LLMRequest = {
  messages: [{ role: 'user', content: 'status?' }],
  model: 'claude-haiku-4-5-20251001',
  outputFormat: { type: 'json_schema', schema: SCHEMA },
};

/** The models the structured-outputs page lists, verbatim. */
const LISTED = [
  'claude-fable-5-1',
  'claude-mythos-5-1',
  'claude-fable-5',
  'claude-mythos-5',
  'claude-mythos-preview',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-5-5',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-opus-4-5-20251101',
  'claude-haiku-5-5',
  'claude-haiku-4-5-20251001',
];

/** Families the table knows and the page does not list. */
const UNLISTED = [
  'claude-opus-4-1',
  'claude-opus-4',
  'claude-sonnet-4',
  'claude-3-7-sonnet',
  'claude-3-5-haiku',
];

function fakeClient(recorder: { params: Record<string, unknown>[] }) {
  return {
    messages: {
      create: vi.fn(async (params: Record<string, unknown>) => {
        recorder.params.push(params);
        return {
          id: 'm1',
          model: String(params.model),
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: '{"status":"ok"}' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      }),
    },
  };
}

describe('anthropic() — output_config.format on the wire', () => {
  it.each(LISTED)('%s: sends output_config.format and states it in the manifest', async (model) => {
    const recorder = { params: [] as Record<string, unknown>[] };
    const provider = anthropic({ _client: fakeClient(recorder) as never });
    expect(nativeOutputSchemaFor(provider, model)).toBe(true);
    const response = await provider.complete({ ...NATIVE, model });
    expect(recorder.params[0].output_config).toEqual({
      format: { type: 'json_schema', schema: SCHEMA },
    });
    // Never the deprecated beta parameter.
    expect('output_format' in recorder.params[0]).toBe(false);
    expect(response.wireManifest).toEqual({ toolNames: [], outputFormat: 'json_schema' });
    expect(response.content).toBe('{"status":"ok"}');
  });

  it.each(UNLISTED)('%s: refused by name before anything is sent', async (model) => {
    const recorder = { params: [] as Record<string, unknown>[] };
    const provider = anthropic({ _client: fakeClient(recorder) as never });
    expect(nativeOutputSchemaFor(provider, model)).toBe(false);
    const err = await provider.complete({ ...NATIVE, model }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnsupportedNativeOutputError);
    expect(err).toMatchObject({ provider: 'anthropic', model, retryable: false });
    expect(recorder.params).toHaveLength(0);
    expect(isRequestRefusal(err)).toBe(true);
  });

  it('no format asked: the body has no output_config key and the manifest none', async () => {
    const recorder = { params: [] as Record<string, unknown>[] };
    const provider = anthropic({ _client: fakeClient(recorder) as never });
    const { outputFormat: _omit, ...plain } = NATIVE;
    const response = await provider.complete(plain);
    expect('output_config' in recorder.params[0]).toBe(false);
    expect(response.wireManifest).toEqual({ toolNames: [] });
  });

  it('tools ride beside the format (the model may call one first)', async () => {
    const recorder = { params: [] as Record<string, unknown>[] };
    const provider = anthropic({ _client: fakeClient(recorder) as never });
    const response = await provider.complete({
      ...NATIVE,
      tools: [{ name: 'lookup', description: 'look up', inputSchema: { type: 'object' } }],
    });
    expect((recorder.params[0].tools as { name: string }[]).map((t) => t.name)).toEqual(['lookup']);
    expect(recorder.params[0].output_config).toBeDefined();
    expect('tool_choice' in recorder.params[0]).toBe(false);
    expect(response.wireManifest).toEqual({ toolNames: ['lookup'], outputFormat: 'json_schema' });
  });
});

describe('the unknown-id policy (the thinking table precedent)', () => {
  it('an id the table does not know is read as the newest generation: it takes the format', () => {
    expect(anthropicTakesNativeOutputSchema('claude-opus-6')).toBe(true);
    expect(anthropicTakesNativeOutputSchema('claude-opus-4-1')).toBe(false);
  });
});

describe('an adapter that does not carry the format', () => {
  it('buildMessagesBody without the declaration refuses by name (the gateway path)', () => {
    expect(() =>
      buildMessagesBody(NATIVE, {
        model: NATIVE.model,
        thinkingMode: () => 'budget',
        provider: 'invoke-model-gateway',
        maxTokensDefault: 1024,
      }),
    ).toThrow(UnsupportedNativeOutputError);
  });

  it('Bedrock and OpenAI do not declare it; anthropic, browserAnthropic and the mock do', () => {
    const bedrockProvider = bedrock({ _client: {} as never, _commands: {} as never });
    expect(nativeOutputSchemaFor(bedrockProvider, 'anthropic.claude-haiku-4-5-20251001-v1:0')).toBe(
      false,
    );
    expect(nativeOutputSchemaFor(openai({ _client: {} as never }), 'gpt-5')).toBe(false);
    expect(nativeOutputSchemaFor(mock({ reply: '{}' }), 'mock')).toBe(true);
    expect(
      nativeOutputSchemaFor(browserAnthropic({ apiKey: 'k' }), 'claude-sonnet-4-5-20250929'),
    ).toBe(true);
  });
});

describe('wrappers forward the capability', () => {
  const inner = anthropic({ _client: fakeClient({ params: [] }) as never });
  it('withRetry and withCircuitBreaker carry it per model', () => {
    for (const wrapped of [withRetry(inner), withCircuitBreaker(inner)]) {
      expect(nativeOutputSchemaFor(wrapped, 'claude-haiku-4-5')).toBe(true);
      expect(nativeOutputSchemaFor(wrapped, 'claude-opus-4-1')).toBe(false);
    }
  });
  it('withFallback publishes the AND of its pair', () => {
    expect(nativeOutputSchemaFor(withFallback(inner, inner), 'claude-haiku-4-5')).toBe(true);
    const silent = { name: 'silent', complete: inner.complete };
    expect(nativeOutputSchemaFor(withFallback(inner, silent), 'claude-haiku-4-5')).toBe(false);
  });
});

// ─── browserAnthropic: request body and SSE assembly ────────────────

function sse(events: readonly (readonly [string, unknown])[]): string {
  return events
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('');
}

function textStream(parts: readonly string[], stopReason: string): string {
  return sse([
    [
      'message_start',
      {
        type: 'message_start',
        message: { id: 'm1', model: 'claude-haiku-4-5', usage: { input_tokens: 3 } },
      },
    ],
    [
      'content_block_start',
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ],
    ...parts.map(
      (text) =>
        [
          'content_block_delta',
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
        ] as const,
    ),
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    [
      'message_delta',
      { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 5 } },
    ],
    ['message_stop', { type: 'message_stop' }],
  ]);
}

describe('browserAnthropic() — body and stream', () => {
  function recordingFetch(body: string, sent: unknown[]): typeof fetch {
    return (async (_url: unknown, init?: { body?: unknown }) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch;
  }

  it('streams the JSON answer in pieces and assembles it whole, with the format on the body', async () => {
    const sent: Record<string, unknown>[] = [];
    const provider = browserAnthropic({
      apiKey: 'k',
      _fetch: recordingFetch(textStream(['{"sta', 'tus":', '"ok"}'], 'end_turn'), sent),
    });
    const chunks: LLMChunk[] = [];
    for await (const chunk of provider.stream!(NATIVE)) chunks.push(chunk);
    expect(sent[0].output_config).toEqual({ format: { type: 'json_schema', schema: SCHEMA } });
    const done = chunks.at(-1)!;
    expect(done.done).toBe(true);
    expect(done.response?.content).toBe('{"status":"ok"}');
    expect(JSON.parse(done.response!.content)).toEqual({ status: 'ok' });
    expect(done.response?.wireManifest).toEqual({ toolNames: [], outputFormat: 'json_schema' });
  });

  it("a refusal stop arrives as stopReason 'refusal' — data, not a crash", async () => {
    const sent: Record<string, unknown>[] = [];
    const provider = browserAnthropic({
      apiKey: 'k',
      _fetch: recordingFetch(textStream(['I cannot help with that.'], 'refusal'), sent),
    });
    const chunks: LLMChunk[] = [];
    for await (const chunk of provider.stream!(NATIVE)) chunks.push(chunk);
    expect(chunks.at(-1)?.response?.stopReason).toBe('refusal');
  });

  it('an unlisted family is refused before fetch', async () => {
    const sent: unknown[] = [];
    const provider = browserAnthropic({ apiKey: 'k', _fetch: recordingFetch('', sent) });
    await expect(provider.complete({ ...NATIVE, model: 'claude-sonnet-4' })).rejects.toBeInstanceOf(
      UnsupportedNativeOutputError,
    );
    expect(sent).toHaveLength(0);
  });
});
