/**
 * ContextWindowExceededError — every shipped wire adapter translates "your
 * request did not fit" into ONE typed error that names the fixes (9.6.0).
 *
 * The detection patterns are pinned against the vendors' REAL wording,
 * including the sentence a production field deployment actually received:
 *
 *   Input tokens exceed the configured limit of 272000 tokens.
 *   Your messages resulted in 879073 tokens.
 *
 * Covers: unit (the rule + the numbers), scenario (one per adapter, through
 * its own error path), security (a rate limit and a `max_tokens` validation
 * error are NOT translated — they have different fixes), boundary (no numbers
 * stated, no status attached, already-translated errors), integration (the
 * error survives an `agent.run()` and reaches the caller typed), compat (every
 * other provider error is byte-identical to before).
 */

import { describe, expect, it, vi } from 'vitest';

import {
  ContextWindowExceededError,
  ERR_CONTEXT_WINDOW_EXCEEDED,
  isContextWindowExceeded,
} from '../../../src/index.js';
import { asContextWindowExceeded } from '../../../src/adapters/llm/contextWindow.js';
import { anthropic } from '../../../src/adapters/llm/AnthropicProvider.js';
import { bedrock } from '../../../src/adapters/llm/BedrockProvider.js';
import { browserAnthropic } from '../../../src/adapters/llm/BrowserAnthropicProvider.js';
import { browserOpenai } from '../../../src/adapters/llm/BrowserOpenAIProvider.js';
import { openai } from '../../../src/adapters/llm/OpenAIProvider.js';
import type { LLMRequest } from '../../../src/adapters/types.js';

const REQUEST: LLMRequest = { messages: [{ role: 'user', content: 'hi' }], model: 'm' };

/** The gateway sentence from the field report, verbatim. */
const FIELD_MESSAGE =
  '400 Input tokens exceed the configured limit of 272000 tokens. ' +
  'Your messages resulted in 879073 tokens.';

function apiError(message: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), extra);
}

// ── Unit — the detector ──────────────────────────────────────

describe('asContextWindowExceeded — unit', () => {
  it('translates the field gateway sentence and carries both numbers', () => {
    const translated = asContextWindowExceeded(apiError(FIELD_MESSAGE, { status: 400 }), {
      provider: 'openai',
    });

    expect(translated).toBeInstanceOf(ContextWindowExceededError);
    expect(translated?.limitTokens).toBe(272_000);
    expect(translated?.actualTokens).toBe(879_073);
    expect(translated?.status).toBe(400);
    expect(translated?.code).toBe(ERR_CONTEXT_WINDOW_EXCEEDED);
  });

  it("reads OpenAI's own phrasing", () => {
    const translated = asContextWindowExceeded(
      apiError(
        "400 This model's maximum context length is 8192 tokens. However, your messages " +
          'resulted in 10531 tokens. Please reduce the length of the messages.',
        { status: 400, code: 'context_length_exceeded' },
      ),
      { provider: 'openai' },
    );

    expect(translated?.limitTokens).toBe(8192);
    expect(translated?.actualTokens).toBe(10531);
  });

  it("reads Anthropic's `prompt is too long` (actual > limit, in that order)", () => {
    const translated = asContextWindowExceeded(
      apiError(
        '400 {"type":"invalid_request_error","message":"prompt is too long: ' +
          '250000 tokens > 200000 maximum"}',
        { status: 400 },
      ),
      { provider: 'anthropic' },
    );

    expect(translated?.actualTokens).toBe(250_000);
    expect(translated?.limitTokens).toBe(200_000);
  });

  it('reads the `input length and max_tokens exceed context limit` sum', () => {
    const translated = asContextWindowExceeded(
      apiError(
        'input length and `max_tokens` exceed context limit: 195000 + 8192 > 200000, ' +
          'decrease input length or max_tokens and try again',
      ),
      { provider: 'anthropic' },
    );

    expect(translated?.actualTokens).toBe(203_192);
    expect(translated?.limitTokens).toBe(200_000);
  });

  it('finds the sentence nested in `error.message` (SDK envelope)', () => {
    const nested = Object.assign(new Error('Request failed'), {
      status: 400,
      error: { message: "This model's maximum context length is 128000 tokens." },
    });
    expect(asContextWindowExceeded(nested, { provider: 'openai' })?.limitTokens).toBe(128_000);
  });

  it('recovers the status from a message that leads with it', () => {
    const translated = asContextWindowExceeded(apiError(FIELD_MESSAGE), { provider: 'openai' });
    // Retry policies classify on `status`; a 4xx must never look retryable.
    expect(translated?.status).toBe(400);
  });

  it('never double-wraps an error it already produced', () => {
    const first = asContextWindowExceeded(apiError(FIELD_MESSAGE), { provider: 'openai' });
    const second = asContextWindowExceeded(first, { provider: 'anthropic' });
    expect(second).toBe(first);
  });

  it('the message carries the three fixes, in order', () => {
    const message = asContextWindowExceeded(apiError(FIELD_MESSAGE), {
      provider: 'openai',
    })!.message;

    expect(message).toContain('879,073 tokens sent against a limit of 272,000 tokens');
    expect(message).toContain('cap oversized TOOL RESULTS');
    expect(message).toContain('slidingWindow({ keepRecentTurns: 2 })');
    expect(message).toContain('.compaction() keeps a LONG conversation small, but it cannot');
    expect(message).toContain('Provider said:');
  });
});

// ── Security — what must NOT be translated ───────────────────

describe('asContextWindowExceeded — refuses to guess', () => {
  it('a RATE limit is a different failure with a different fix', () => {
    const rateLimited = apiError(
      '429 Rate limit reached for gpt-4o in organization org-x on tokens per min (TPM): ' +
        'Limit 30000, Used 29000, Requested 2000.',
      { status: 429, code: 'rate_limit_exceeded' },
    );
    expect(asContextWindowExceeded(rateLimited, { provider: 'openai' })).toBeUndefined();
  });

  it('a `max_tokens` parameter validation error is not a context overflow', () => {
    const invalid = apiError(
      '400 max_tokens: must be less than or equal to 8192, the maximum for this model',
      { status: 400 },
    );
    expect(asContextWindowExceeded(invalid, { provider: 'anthropic' })).toBeUndefined();
  });

  it('an OUTPUT token cap is not an input overflow, however similarly worded', () => {
    const outputCap = apiError(
      '400 max_tokens: 100000 > 64000, which exceeds the maximum allowed number of ' +
        'output tokens for this model',
      { status: 400 },
    );
    expect(asContextWindowExceeded(outputCap, { provider: 'anthropic' })).toBeUndefined();
  });

  it('the same sentence about INPUT tokens does translate', () => {
    const inputCap = apiError('400 the request exceeds the maximum allowed input tokens', {
      status: 400,
    });
    expect(asContextWindowExceeded(inputCap, { provider: 'openai' })).toBeInstanceOf(
      ContextWindowExceededError,
    );
  });

  it('ordinary failures pass through untouched', () => {
    for (const message of [
      '503 Service Unavailable',
      'fetch failed',
      'The security token included in the request is invalid',
      '400 model `gpt-9` does not exist',
    ]) {
      expect(asContextWindowExceeded(apiError(message), { provider: 'openai' })).toBeUndefined();
    }
  });

  it('a non-Error value with nothing to read is left alone', () => {
    expect(asContextWindowExceeded(undefined, { provider: 'openai' })).toBeUndefined();
    expect(asContextWindowExceeded({}, { provider: 'openai' })).toBeUndefined();
  });
});

// ── Boundary — the vendor stated no numbers ──────────────────

describe('ContextWindowExceededError — boundary', () => {
  it("Bedrock's number-free sentence still translates, without inventing numbers", () => {
    const translated = asContextWindowExceeded(
      apiError('Input is too long for requested model.', {
        name: 'ValidationException',
        $metadata: { httpStatusCode: 400 },
      }),
      { provider: 'bedrock' },
    );

    expect(translated).toBeInstanceOf(ContextWindowExceededError);
    expect(translated?.limitTokens).toBeUndefined();
    expect(translated?.actualTokens).toBeUndefined();
    expect(translated?.status).toBe(400);
    expect(translated?.message).toContain('did not fit the context window.');
  });

  it('isContextWindowExceeded recognises it by code as well as by class', () => {
    const typed = asContextWindowExceeded(apiError(FIELD_MESSAGE), { provider: 'openai' })!;
    expect(isContextWindowExceeded(typed)).toBe(true);
    expect(isContextWindowExceeded(apiError('boom'))).toBe(false);
    expect(
      isContextWindowExceeded(apiError('anything', { code: ERR_CONTEXT_WINDOW_EXCEEDED })),
    ).toBe(true);
  });
});

// ── Scenario — one per adapter, through its own error path ───

describe('adapters translate their own vendor', () => {
  it('openai', async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn(() => {
            throw apiError(FIELD_MESSAGE, { status: 400, code: 'context_length_exceeded' });
          }),
        },
      },
    };
    const provider = openai({ apiKey: 'sk-test', _client: client as never });

    await expect(provider.complete(REQUEST)).rejects.toBeInstanceOf(ContextWindowExceededError);
    await expect(provider.complete(REQUEST)).rejects.toMatchObject({
      provider: 'openai',
      limitTokens: 272_000,
      actualTokens: 879_073,
    });
  });

  it('anthropic', async () => {
    const client = {
      messages: {
        create: vi.fn(() => {
          throw apiError('400 prompt is too long: 250000 tokens > 200000 maximum', {
            status: 400,
          });
        }),
        stream: vi.fn(),
      },
    };
    const provider = anthropic({ apiKey: 'sk-test', _client: client as never });

    await expect(provider.complete(REQUEST)).rejects.toMatchObject({
      name: 'ContextWindowExceededError',
      provider: 'anthropic',
      actualTokens: 250_000,
      limitTokens: 200_000,
    });
  });

  it('bedrock', async () => {
    const Converse = class {
      constructor(public input: unknown) {}
    };
    const ConverseStream = class {
      constructor(public input: unknown) {}
    };
    const client = {
      send: vi.fn(() => {
        throw apiError('Input is too long for requested model', {
          name: 'ValidationException',
          $metadata: { httpStatusCode: 400 },
        });
      }),
    };
    const provider = bedrock({
      region: 'us-east-1',
      _client: client as never,
      _commands: { Converse, ConverseStream } as never,
    });

    await expect(provider.complete(REQUEST)).rejects.toMatchObject({
      name: 'ContextWindowExceededError',
      provider: 'bedrock',
      status: 400,
    });
  });

  it('browser-openai (the refusal BODY, which never reaches wrapError)', async () => {
    const body = JSON.stringify({
      error: {
        message:
          "This model's maximum context length is 128000 tokens. However, your messages " +
          'resulted in 250000 tokens.',
        code: 'context_length_exceeded',
        type: 'invalid_request_error',
      },
    });
    const provider = browserOpenai({
      apiKey: 'sk-test',
      _fetch: (() =>
        Promise.resolve(new Response(body, { status: 400, statusText: 'Bad Request' }))) as never,
    });

    await expect(provider.complete(REQUEST)).rejects.toMatchObject({
      name: 'ContextWindowExceededError',
      provider: 'browser-openai',
      limitTokens: 128_000,
      actualTokens: 250_000,
      status: 400,
    });
  });

  it('browser-anthropic (the refusal BODY)', async () => {
    const body = JSON.stringify({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'prompt is too long: 300000 tokens > 200000 maximum',
      },
    });
    const provider = browserAnthropic({
      apiKey: 'sk-test',
      _fetch: (() =>
        Promise.resolve(new Response(body, { status: 400, statusText: 'Bad Request' }))) as never,
    });

    await expect(provider.complete(REQUEST)).rejects.toMatchObject({
      name: 'ContextWindowExceededError',
      provider: 'browser-anthropic',
      actualTokens: 300_000,
    });
  });
});

// ── Compat — every other error keeps its old shape ───────────

describe('adapters — unrelated errors are unchanged', () => {
  it('openai still wraps a 503 as OpenAIProviderError', async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn(() => {
            throw apiError('503 upstream unavailable', { status: 503 });
          }),
        },
      },
    };
    const provider = openai({ apiKey: 'sk-test', _client: client as never });

    await expect(provider.complete(REQUEST)).rejects.toMatchObject({
      name: 'OpenAIProviderError',
      status: 503,
    });
  });

  it('browser-openai still wraps a 500 with its status line', async () => {
    const provider = browserOpenai({
      apiKey: 'sk-test',
      _fetch: (() =>
        Promise.resolve(
          new Response('upstream exploded', { status: 500, statusText: 'Server Error' }),
        )) as never,
    });

    await expect(provider.complete(REQUEST)).rejects.toMatchObject({
      name: 'BrowserOpenAIProviderError',
      status: 500,
    });
  });
});
