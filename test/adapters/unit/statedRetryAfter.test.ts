/**
 * The adapters DECLARE the wait a response stated (`retryAfterMs`) — the
 * resilience layer never reads headers or prose.
 *
 * `retryAfterMsFromHeaders` / `retryAfterMsFromError` (adapters/llm/retryAfter.ts)
 * are the one reader of `retry-after-ms` and `retry-after`; `anthropic()`,
 * `openai()` and `bedrock()` put the answer on the error they raise, and add
 * NOTHING when the response stated nothing (the error shape is unchanged).
 *
 * Test types (Convention 3): unit (the header reader) · contract (each adapter's
 * error carries the field, and only when stated).
 */
import { describe, it, expect } from 'vitest';
import {
  retryAfterMsFromError,
  retryAfterMsFromHeaders,
} from '../../../src/adapters/llm/retryAfter.js';
import { anthropic } from '../../../src/adapters/llm/AnthropicProvider.js';
import { openai } from '../../../src/adapters/llm/OpenAIProvider.js';
import { bedrock } from '../../../src/adapters/llm/BedrockProvider.js';
import type { LLMProvider, LLMRequest } from '../../../src/adapters/types.js';

describe('retryAfterMsFromHeaders', () => {
  it('reads retry-after-ms first, then retry-after (seconds)', () => {
    expect(retryAfterMsFromHeaders(new Headers({ 'retry-after-ms': '1500' }))).toBe(1500);
    expect(retryAfterMsFromHeaders(new Headers({ 'retry-after': '4' }))).toBe(4000);
    expect(
      retryAfterMsFromHeaders(new Headers({ 'retry-after-ms': '250', 'retry-after': '9' })),
    ).toBe(250);
  });

  it('reads an HTTP-date retry-after as the time until it', () => {
    const at = new Date(Date.now() + 30_000).toUTCString();
    const ms = retryAfterMsFromHeaders({ 'Retry-After': at });
    expect(ms).toBeGreaterThan(25_000);
    expect(ms).toBeLessThanOrEqual(30_000);
  });

  it('reads a plain record case-insensitively', () => {
    expect(retryAfterMsFromHeaders({ 'Retry-After': '2' })).toBe(2000);
  });

  it('treats absent or garbled values as absent', () => {
    expect(retryAfterMsFromHeaders(undefined)).toBeUndefined();
    expect(retryAfterMsFromHeaders(new Headers())).toBeUndefined();
    expect(retryAfterMsFromHeaders({ 'retry-after': 'soon' })).toBeUndefined();
    expect(retryAfterMsFromHeaders({ 'retry-after-ms': '-5' })).toBeUndefined();
    expect(retryAfterMsFromHeaders({ 'retry-after-ms': '' })).toBeUndefined();
  });

  it('retryAfterMsFromError reads err.headers or err.$response.headers', () => {
    expect(retryAfterMsFromError({ headers: { 'retry-after': '1' } })).toBe(1000);
    expect(retryAfterMsFromError({ $response: { headers: { 'retry-after': '2' } } })).toBe(2000);
    expect(retryAfterMsFromError(new Error('x'))).toBeUndefined();
    expect(retryAfterMsFromError(null)).toBeUndefined();
  });
});

// ─── Each adapter declares it ───────────────────────────────────────

const REQ: LLMRequest = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };

function sdkError(headers?: Record<string, string>): Error {
  return Object.assign(new Error('429 rate limited'), {
    status: 429,
    ...(headers && { headers: new Headers(headers) }),
  });
}

async function caught(provider: LLMProvider): Promise<Record<string, unknown>> {
  try {
    await provider.complete(REQ);
  } catch (err) {
    return err as Record<string, unknown>;
  }
  throw new Error('expected a failure');
}

const failingAnthropic = (err: Error) =>
  anthropic({
    _client: {
      messages: {
        create: async () => {
          throw err;
        },
        stream: () => {
          throw err;
        },
      },
    } as never,
  });

const failingOpenAI = (err: Error) =>
  openai({
    _client: {
      chat: {
        completions: {
          create: async () => {
            throw err;
          },
        },
      },
    } as never,
  });

class Cmd {
  constructor(readonly input: unknown) {}
}
const failingBedrock = (err: Error) =>
  bedrock({
    _client: {
      send: async () => {
        throw err;
      },
    } as never,
    _commands: { Converse: Cmd, ConverseStream: Cmd } as never,
  });

describe('the adapters declare retryAfterMs on the errors they raise', () => {
  it('anthropic(): from the SDK error headers', async () => {
    const err = await caught(failingAnthropic(sdkError({ 'retry-after': '3' })));
    expect(err['status']).toBe(429);
    expect(err['retryAfterMs']).toBe(3000);
  });

  it('openai(): from the SDK error headers (retry-after-ms wins)', async () => {
    const err = await caught(
      failingOpenAI(sdkError({ 'retry-after-ms': '700', 'retry-after': '3' })),
    );
    expect(err['retryAfterMs']).toBe(700);
  });

  it('bedrock(): from the raw response headers', async () => {
    const aws = Object.assign(new Error('ThrottlingException'), {
      $metadata: { httpStatusCode: 429 },
      $response: { headers: { 'retry-after': '5' } },
    });
    const err = await caught(failingBedrock(aws));
    expect(err['status']).toBe(429);
    expect(err['retryAfterMs']).toBe(5000);
  });

  it('nothing stated: the field is ABSENT (not undefined) on every adapter', async () => {
    for (const provider of [
      failingAnthropic(sdkError()),
      failingOpenAI(sdkError()),
      failingBedrock(sdkError()),
    ]) {
      const err = await caught(provider);
      expect(Object.prototype.hasOwnProperty.call(err, 'retryAfterMs')).toBe(false);
    }
  });
});
