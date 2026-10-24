/** Auto opts in only for declared known models; explicit native remains forward compatible. */
import { describe, expect, it, vi } from 'vitest';
import { Agent } from '../../src/index.js';
import { anthropic, AnthropicProvider } from '../../src/adapters/llm/AnthropicProvider.js';
import {
  browserAnthropic,
  BrowserAnthropicProvider,
} from '../../src/adapters/llm/BrowserAnthropicProvider.js';
import { withRetry } from '../../src/resilience/withRetry.js';
import { withCircuitBreaker } from '../../src/resilience/withCircuitBreaker.js';
import { withFallback } from '../../src/resilience/withFallback.js';
import { nativeOutputSchemaFor } from '../../src/provider-contract/nativeOutputSchema.js';
import type { LLMProvider } from '../../src/provider-contract/types.js';

const parser = { parse: (value: unknown) => value };
const jsonSchema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
const response = {
  id: 'answer',
  model: 'fixture',
  role: 'assistant',
  content: [{ type: 'text', text: '{"ok":true}' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
};
function transport(kind: 'sdk' | 'browser', defaultModel?: string) {
  const sent: Record<string, unknown>[] = [];
  const create = vi.fn(async (body: Record<string, unknown>) => {
    sent.push(body);
    return response;
  });
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  const options = { ...(defaultModel && { defaultModel }) };
  const inner =
    kind === 'sdk'
      ? anthropic({ ...options, _client: { messages: { create } } as never })
      : browserAnthropic({ ...options, apiKey: 'synthetic', _fetch: fetcher as typeof fetch });
  // Exercise the adapter's actual body/response contract through complete().
  const { stream: _stream, ...provider } = inner;
  void _stream;
  return { provider, sent, create, fetcher };
}
const guarantee = (agent: Agent) => agent.getSnapshot()?.sharedState?.answerGuarantee;
const MODELS = [
  ['claude-haiku-4-5-20251001', true],
  ['claude-sonnet-4-6', true],
  ['claude-opus-5-5', true],
  ['claude-opus-4-1', false],
  ['claude-3-5-sonnet-latest', false],
  ['claude-opus-6', false],
  ['proxy/claude-sonnet-4-5', false],
  ['claude-sonnet-4-5.custom', false],
  ['private-deployment', false],
] as const;
for (const kind of ['sdk', 'browser'] as const) {
  describe(`${kind} actual adapter auto policy`, () => {
    it.each(MODELS)('%s selects native=%s', async (model, expected) => {
      const f = transport(kind);
      const agent = Agent.create({ provider: f.provider, model })
        .outputSchema(parser, { jsonSchema })
        .build();
      await expect(agent.runTyped('answer')).resolves.toEqual({ ok: true });
      expect(f.sent).toHaveLength(1);
      expect(f.sent[0].output_config !== undefined).toBe(expected);
      expect(guarantee(agent)).toBe(expected ? 'native' : 'checked');
    });
    it.each(['claude-opus-6', 'private-deployment'])(
      'explicit native retains forward compatibility for %s',
      async (model) => {
        const f = transport(kind);
        expect(nativeOutputSchemaFor(f.provider, model)).toBe(true);
        const agent = Agent.create({ provider: f.provider, model })
          .outputSchema(parser, { strategy: 'native', jsonSchema })
          .build();
        await agent.runTyped('answer');
        expect(f.sent[0].output_config).toBeDefined();
        expect(guarantee(agent)).toBe('native');
      },
    );
    it.each([
      ['claude-sonnet-4-6', true],
      ['private-deployment', false],
    ] as const)('resolves shorthand through defaultModel=%s', async (defaultModel, expected) => {
      const f = transport(kind, defaultModel);
      const agent = Agent.create({ provider: f.provider, model: 'anthropic' })
        .outputSchema(parser, { jsonSchema })
        .build();
      await agent.runTyped('answer');
      expect(f.sent[0].model).toBe(defaultModel);
      expect(f.sent[0].output_config !== undefined).toBe(expected);
    });
    it('explicit instruct is the opt-out even for a known supported model', async () => {
      const f = transport(kind);
      const agent = Agent.create({ provider: f.provider, model: 'claude-haiku-4-5' })
        .outputSchema(parser, { strategy: 'instruct', jsonSchema })
        .build();
      await agent.runTyped('answer');
      expect(f.sent[0].output_config).toBeUndefined();
      expect(guarantee(agent)).toBe('checked');
    });
  });
}

it.each(['retry', 'circuit', 'fallback'] as const)(
  'the %s wrapper preserves the conservative declaration',
  async (wrapper) => {
    const f = transport('sdk');
    const provider =
      wrapper === 'retry'
        ? withRetry(f.provider)
        : wrapper === 'circuit'
        ? withCircuitBreaker(f.provider)
        : withFallback(f.provider, f.provider);
    const agent = Agent.create({ provider, model: 'unused' })
      .configure(({ message }) => ({
        model: message === 'known' ? 'claude-haiku-4-5' : 'private-deployment',
      }))
      .outputSchema(parser, { jsonSchema })
      .build();
    await agent.runTyped('known');
    expect(f.sent[0].output_config).toBeDefined();
    await agent.runTyped('unknown');
    expect(f.sent[1].output_config).toBeUndefined();
    expect(guarantee(agent)).toBe('checked');
  },
);

it('generic custom native capability is insufficient for auto', async () => {
  const sent: unknown[] = [];
  const provider: LLMProvider = {
    name: 'custom',
    carriesNativeOutputSchema: true,
    supportsNativeOutputSchema: () => true,
    complete: async (request) => {
      sent.push(request.outputFormat);
      return { content: '{"ok":true}', toolCalls: [], usage: { input: 0, output: 0 } };
    },
  };
  await Agent.create({ provider, model: 'opaque' })
    .outputSchema(parser, { jsonSchema })
    .build()
    .runTyped('answer');
  expect(sent).toEqual([undefined]);
  await Agent.create({ provider, model: 'opaque' })
    .outputSchema(parser, { strategy: 'native', jsonSchema })
    .build()
    .runTyped('answer');
  expect(sent[1]).toBeDefined();
});

it('a fallback pair cannot upgrade a generic native declaration to known support', async () => {
  const f = transport('sdk');
  const generic: LLMProvider = {
    name: 'generic',
    carriesNativeOutputSchema: true,
    supportsNativeOutputSchema: () => true,
    complete: f.provider.complete,
  };
  const agent = Agent.create({
    provider: withFallback(f.provider, generic),
    model: 'claude-haiku-4-5',
  })
    .outputSchema(parser, { jsonSchema })
    .build();
  await agent.runTyped('answer');
  expect(f.sent[0].output_config).toBeUndefined();
});

it('reliability reselects known support for the actual fallback model', async () => {
  const first = transport('sdk');
  first.create.mockRejectedValueOnce(Object.assign(new Error('busy'), { status: 503 }));
  const second = transport('sdk');
  const agent = Agent.create({ provider: first.provider, model: 'claude-haiku-4-5' })
    .reliability({
      providers: [
        { provider: first.provider, model: 'claude-haiku-4-5' },
        { provider: second.provider, model: 'private-deployment' },
      ],
      postDecide: [{ when: (s) => s.error !== undefined, then: 'retry-other', kind: 'try-next' }],
    })
    .outputSchema(parser, { jsonSchema })
    .build();
  await agent.runTyped('answer');
  expect(second.sent[0].output_config).toBeUndefined();
  expect(guarantee(agent)).toBe('checked');
});

it('does not retry a native HTTP 400 without its format', async () => {
  const f = transport('sdk');
  f.create.mockRejectedValueOnce(
    Object.assign(new Error('output_config not supported'), { status: 400 }),
  );
  const agent = Agent.create({ provider: f.provider, model: 'claude-haiku-4-5' })
    .outputSchema(parser, { jsonSchema })
    .build();
  await expect(agent.runTyped('answer')).rejects.toThrow('output_config not supported');
  expect(f.create).toHaveBeenCalledTimes(1);
  expect(f.create.mock.calls[0][0]).toHaveProperty('output_config');
});

it('class providers preserve the same model knowledge as factory providers', () => {
  const sdk = new AnthropicProvider({ _client: {} as never });
  const browser = new BrowserAnthropicProvider({ apiKey: 'synthetic' });
  for (const provider of [sdk, browser]) {
    expect(provider.supportsAutoNativeOutputSchema?.('claude-haiku-4-5')).toBe(true);
    expect(provider.supportsAutoNativeOutputSchema?.('private-deployment')).toBe(false);
    expect(provider.supportsNativeOutputSchema('private-deployment')).toBe(true);
  }
});
