/**
 * Per-model forced choices narrow the existing boolean wire capability.
 * Unit, boundary and integration tests use injected transports only: no SDK
 * installation, credentials, network, or model call is needed.
 */
import { describe, expect, it, vi } from 'vitest';

import { Agent } from '../../../src/index.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../../src/adapters/types.js';
import {
  anthropic,
  type AnthropicProviderOptions,
} from '../../../src/adapters/llm/AnthropicProvider.js';
import { browserAnthropic } from '../../../src/adapters/llm/BrowserAnthropicProvider.js';
import { invokeModelGateway } from '../../../src/adapters/llm/InvokeModelGatewayProvider.js';
import { forcedToolChoiceFor, UnsupportedToolChoiceError } from '../../../src/providers.js';
import { withRetry } from '../../../src/resilience/withRetry.js';
import { withCircuitBreaker } from '../../../src/resilience/withCircuitBreaker.js';
import { withFallback } from '../../../src/resilience/withFallback.js';
import { constrainedEnumPick } from '../../../src/lib/injection-engine/constrainedEnumPick.js';

const ALLOWED = 'claude-haiku-5-5';
const BLOCKED = 'claude-opus-5-5';
const RESPONSE: LLMResponse = {
  content: 'billing',
  toolCalls: [],
  usage: { input: 1, output: 1 },
  stopReason: 'stop',
};
const TEXT_REPLY = {
  id: 'msg-1',
  model: 'fixture',
  role: 'assistant' as const,
  content: [{ type: 'text' as const, text: 'billing' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
};
const request = (model: string): LLMRequest => ({
  model,
  messages: [{ role: 'user', content: 'answer' }],
  tools: [{ name: 'respond', description: 'Answer.', inputSchema: { type: 'object' } }],
  toolChoice: { type: 'tool', name: 'respond' },
});

function declared(overrides: Partial<LLMProvider> = {}): LLMProvider {
  return {
    name: 'declared-wire',
    carriesForcedToolChoice: true,
    complete: async () => RESPONSE,
    ...overrides,
  };
}

function sdk(defaultModel = ALLOWED) {
  const sent: unknown[] = [];
  const client: NonNullable<AnthropicProviderOptions['_client']> = {
    messages: {
      async create(params) {
        sent.push(structuredClone(params));
        return TEXT_REPLY;
      },
      stream(params) {
        sent.push(structuredClone(params));
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'billing' } };
          },
          finalMessage: async () => TEXT_REPLY,
        };
      },
    },
  };
  return { sent, provider: anthropic({ _client: client, defaultModel }) };
}

function fetchTransport(kind: 'browser' | 'gateway', defaultModel = ALLOWED) {
  const sent: unknown[] = [];
  const key = vi.fn(() => 'test-key');
  const fetcher: typeof fetch = async (url, init) => {
    const body: unknown = JSON.parse(String(init?.body));
    sent.push(body);
    const streaming =
      String(url).endsWith('/invoke-with-response-stream') ||
      (typeof body === 'object' && body !== null && 'stream' in body && body.stream === true);
    if (!streaming) return Response.json(TEXT_REPLY);
    const events = [
      { type: 'message_start', message: TEXT_REPLY },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'billing' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ];
    return new Response(
      events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
      {
        headers: { 'content-type': 'text/event-stream' },
      },
    );
  };
  const provider =
    kind === 'browser'
      ? browserAnthropic({ apiKey: 'test-key', defaultModel, _fetch: fetcher })
      : invokeModelGateway({
          baseUrl: 'https://gateway.invalid',
          apiKeyHeader: 'api-key',
          apiKey: key,
          model: defaultModel,
          fetch: fetcher,
        });
  return { sent, provider, key };
}

async function call(provider: LLMProvider, mode: 'complete' | 'stream', req: LLMRequest) {
  if (mode === 'complete') return provider.complete(req);
  if (provider.stream === undefined) throw new Error('Fixture provider must support streaming.');
  const chunks = [];
  for await (const chunk of provider.stream(req)) chunks.push(chunk);
  return chunks;
}

describe('forcedToolChoiceFor: additive capability contract', () => {
  it('keeps the old boolean declaration and absence behavior', () => {
    expect(forcedToolChoiceFor({}, ALLOWED)).toBe(false);
    expect(forcedToolChoiceFor({ carriesForcedToolChoice: false }, ALLOWED)).toBe(false);
    expect(forcedToolChoiceFor({ carriesForcedToolChoice: true }, ALLOWED)).toBe(true);
  });

  it('a model predicate can restrict the wire declaration, never grant it', () => {
    const supports = vi.fn(() => true);
    expect(forcedToolChoiceFor({ supportsForcedToolChoice: supports }, ALLOWED)).toBe(false);
    expect(
      forcedToolChoiceFor(
        { carriesForcedToolChoice: false, supportsForcedToolChoice: supports },
        ALLOWED,
      ),
    ).toBe(false);
    expect(supports).not.toHaveBeenCalled();
    const provider = declared({ supportsForcedToolChoice: (model) => model === ALLOWED });
    expect(provider.carriesForcedToolChoice).toBe(true);
    expect(forcedToolChoiceFor(provider, ALLOWED)).toBe(true);
    expect(forcedToolChoiceFor(provider, BLOCKED)).toBe(false);
  });

  for (const wrap of [withRetry, withCircuitBreaker]) {
    it(`${wrap.name} forwards the per-model restriction and leaves absence absent`, () => {
      const supports = vi.fn((model: string) => model === ALLOWED);
      const wrapped = wrap(declared({ supportsForcedToolChoice: supports }));
      expect(wrapped.carriesForcedToolChoice).toBe(true);
      expect(wrapped.supportsForcedToolChoice).toBe(supports);
      expect(forcedToolChoiceFor(wrapped, ALLOWED)).toBe(true);
      expect(forcedToolChoiceFor(wrapped, BLOCKED)).toBe(false);
      const legacy = wrap(declared());
      expect(legacy.supportsForcedToolChoice).toBeUndefined();
      expect(forcedToolChoiceFor(legacy, ALLOWED)).toBe(true);
    });
  }

  it('fallback intersects each model on both sides, not predicate truthiness', () => {
    const a = declared({ supportsForcedToolChoice: (model) => model !== 'a-only-no' });
    const b = declared({ supportsForcedToolChoice: (model) => model !== 'b-only-no' });
    for (const pair of [withFallback(a, b), withFallback(b, a)]) {
      expect(pair.carriesForcedToolChoice).toBe(true);
      expect(forcedToolChoiceFor(pair, ALLOWED)).toBe(true);
      expect(forcedToolChoiceFor(pair, 'a-only-no')).toBe(false);
      expect(forcedToolChoiceFor(pair, 'b-only-no')).toBe(false);
    }
  });

  it('fallback retains legacy true/true and an undeclared side still clamps the pair', () => {
    const legacy = withFallback(declared(), declared());
    expect(legacy.carriesForcedToolChoice).toBe(true);
    expect(legacy.supportsForcedToolChoice).toBeUndefined();
    expect(forcedToolChoiceFor(legacy, ALLOWED)).toBe(true);
    const absent: LLMProvider = { name: 'silent', complete: async () => RESPONSE };
    const restricted = declared({ supportsForcedToolChoice: () => true });
    for (const pair of [withFallback(absent, restricted), withFallback(restricted, absent)]) {
      expect(pair.carriesForcedToolChoice).toBe(false);
      expect(forcedToolChoiceFor(pair, ALLOWED)).toBe(false);
    }
  });
});

describe('Anthropic transports: per-model refusal happens before I/O', () => {
  for (const transport of ['sdk', 'browser', 'gateway'] as const) {
    for (const mode of ['complete', 'stream'] as const) {
      for (const model of [BLOCKED, 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-mythos-5-1']) {
        it(`${transport} ${mode}: ${model} refuses without sending`, async () => {
          const fixture = transport === 'sdk' ? sdk() : fetchTransport(transport);
          expect(fixture.provider.carriesForcedToolChoice).toBe(true);
          expect(forcedToolChoiceFor(fixture.provider, model)).toBe(false);
          await expect(call(fixture.provider, mode, request(model))).rejects.toMatchObject({
            name: 'UnsupportedToolChoiceError',
            model,
            retryable: false,
          });
          expect(fixture.sent).toEqual([]);
          if ('key' in fixture) expect(fixture.key).not.toHaveBeenCalled();
        });
      }

      it(`${transport} ${mode}: supported Haiku still sends the forced choice`, async () => {
        const fixture = transport === 'sdk' ? sdk() : fetchTransport(transport);
        expect(forcedToolChoiceFor(fixture.provider, ALLOWED)).toBe(true);
        await call(fixture.provider, mode, request(ALLOWED));
        expect(fixture.sent).toHaveLength(1);
        expect(fixture.sent[0]).toMatchObject({ tool_choice: { type: 'tool', name: 'respond' } });
      });
    }

    it(`${transport}: shorthand is checked against its resolved default model`, async () => {
      const fixture = transport === 'sdk' ? sdk(BLOCKED) : fetchTransport(transport, BLOCKED);
      const shorthand =
        transport === 'sdk'
          ? 'anthropic'
          : transport === 'browser'
          ? 'browser-anthropic'
          : 'invoke-model-gateway';
      expect(forcedToolChoiceFor(fixture.provider, shorthand)).toBe(false);
      await expect(fixture.provider.complete(request(shorthand))).rejects.toMatchObject({
        model: BLOCKED,
      });
      expect(fixture.sent).toEqual([]);
    });
  }
});

describe('framework consumers use the same per-model capability', () => {
  const pick = (provider: LLMProvider, model: string) =>
    constrainedEnumPick({
      provider,
      model,
      systemPrompt: 'Choose the relevant category.',
      messages: [{ role: 'user', content: 'my invoice' }],
      allowed: ['billing', 'none'],
      fallback: 'none',
      pickTool: { name: 'pick', description: 'Pick.', argName: 'id', argDescription: 'Category.' },
    });

  it('constrained picks use the strict text path only for unsupported models', async () => {
    const complete = vi.fn(
      async (req: LLMRequest): Promise<LLMResponse> => ({
        ...RESPONSE,
        toolCalls:
          req.toolChoice === undefined
            ? []
            : [{ id: 'pick-1', name: 'pick', args: { id: 'billing' } }],
      }),
    );
    const provider = declared({ complete, supportsForcedToolChoice: (model) => model === ALLOWED });
    expect(await pick(provider, BLOCKED)).toBe('billing');
    expect(complete.mock.calls[0]?.[0].toolChoice).toBeUndefined();
    expect(complete.mock.calls[0]?.[0].tools).toBeUndefined();
    expect(await pick(provider, ALLOWED)).toBe('billing');
    expect(complete.mock.calls[1]?.[0].toolChoice).toEqual({ type: 'tool', name: 'pick' });
  });

  it('unsupported-model text picks retain the bounded re-ask and caller fallback', async () => {
    const complete = vi.fn(
      async (): Promise<LLMResponse> => ({ ...RESPONSE, content: 'not-a-category' }),
    );
    const provider = declared({ complete, supportsForcedToolChoice: () => false });
    expect(await pick(provider, BLOCKED)).toBe('none');
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('Agent names the unsupported model and sends no request', async () => {
    const { provider, sent } = sdk();
    const agent = Agent.create({ provider, model: BLOCKED })
      .outputSchema(
        { parse: (value: unknown) => value },
        { strategy: 'tool-forced', jsonSchema: { type: 'object' } },
      )
      .build();
    await expect(agent.run({ message: 'answer' })).rejects.toMatchObject({
      name: 'UnsupportedToolChoiceError',
      model: BLOCKED,
      retryable: false,
    });
    expect(sent).toEqual([]);
  });

  it('Agent still admits a supported predicate and sends the requested schema tool', async () => {
    const complete = vi.fn(async (req: LLMRequest): Promise<LLMResponse> => {
      if (req.toolChoice === undefined) throw new Error('Expected the forced schema tool.');
      return {
        ...RESPONSE,
        content: '',
        toolCalls: [{ id: 'answer-1', name: req.toolChoice.name, args: { answer: 'ok' } }],
      };
    });
    const provider = declared({ complete, supportsForcedToolChoice: (model) => model === ALLOWED });
    const agent = Agent.create({ provider, model: ALLOWED })
      .outputSchema(
        { parse: (value: unknown) => value },
        { strategy: 'tool-forced', jsonSchema: { type: 'object' } },
      )
      .build();
    expect(await agent.run({ message: 'answer' })).toBe('{"answer":"ok"}');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0].toolChoice?.type).toBe('tool');
  });

  for (const mode of ['complete', 'stream'] as const) {
    it(`${mode}: an unsupported choice is neither retried nor sent to a fallback`, async () => {
      const { provider, sent } = sdk();
      const attempt = vi.spyOn(provider, mode);
      const fallbackCall = vi.fn(async () => RESPONSE);
      const resilient = withRetry(withFallback(provider, declared({ complete: fallbackCall })), {
        initialDelayMs: 0,
        maxAttempts: 3,
      });
      await expect(call(resilient, mode, request(BLOCKED))).rejects.toBeInstanceOf(
        UnsupportedToolChoiceError,
      );
      expect(attempt).toHaveBeenCalledTimes(1);
      expect(fallbackCall).not.toHaveBeenCalled();
      expect(sent).toEqual([]);
    });

    it(`${mode}: a refused choice does not open the circuit for a later valid request`, async () => {
      const { provider, sent } = sdk();
      const breaker = withCircuitBreaker(provider, { failureThreshold: 1 });
      await expect(call(breaker, mode, request(BLOCKED))).rejects.toBeInstanceOf(
        UnsupportedToolChoiceError,
      );
      await call(breaker, mode, request(ALLOWED));
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        model: ALLOWED,
        tool_choice: { type: 'tool', name: 'respond' },
      });
    });
  }
});
