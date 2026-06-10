/**
 * humanizeLLMError — unit tests for the plain-language error mapper.
 *
 * agentfootprint targets non-developer builders, so a raw
 * "[browser-anthropic] Failed to fetch" must become an actionable
 * sentence. Each case asserts the friendly message + that the raw error
 * is preserved on `.cause` (for developers / "Copy for LLM").
 */

import { describe, it, expect } from 'vitest';
import { humanizeLLMError, wrapLLMError } from '../../src/core/humanizeLLMError.js';

describe('humanizeLLMError — friendly mapping', () => {
  it('network / Failed to fetch → reachability + key hint', () => {
    const msg = humanizeLLMError(new Error('[browser-anthropic] Failed to fetch'));
    expect(msg).toMatch(/couldn't reach the ai model/i);
    expect(msg).toMatch(/connection|api key/i);
  });

  it('node network codes → reachability', () => {
    expect(humanizeLLMError(new Error('connect ECONNREFUSED'))).toMatch(/reach the ai model/i);
    expect(humanizeLLMError(new Error('getaddrinfo EAI_AGAIN api.x.com'))).toMatch(
      /reach the ai model/i,
    );
  });

  it('401/403 + auth phrases → API key hint', () => {
    expect(humanizeLLMError({ status: 401, message: 'Unauthorized' })).toMatch(/api key/i);
    expect(humanizeLLMError(new Error('invalid x-api-key'))).toMatch(/api key/i);
  });

  it('429 / rate limit → wait & retry', () => {
    expect(humanizeLLMError({ status: 429, message: 'Too Many Requests' })).toMatch(
      /rate limit|busy/i,
    );
    expect(humanizeLLMError(new Error('rate limit exceeded'))).toMatch(/rate limit|busy/i);
  });

  it('timeout → took too long', () => {
    expect(humanizeLLMError(new Error('Request timed out'))).toMatch(/too long/i);
    expect(humanizeLLMError(new Error('ETIMEDOUT'))).toMatch(/too long/i);
  });

  it('5xx → temporary provider problem', () => {
    expect(humanizeLLMError({ status: 503, message: 'Service Unavailable' })).toMatch(
      /temporary problem/i,
    );
  });

  it('400 / bad model → check the model', () => {
    expect(humanizeLLMError({ status: 400, message: 'no such model: gpt-9' })).toMatch(/model/i);
  });

  it('unknown error → framed, not a raw crash, raw text retained', () => {
    const msg = humanizeLLMError(new Error('weird internal thing'));
    expect(msg).toMatch(/the ai call failed/i);
    expect(msg).toContain('weird internal thing');
  });

  it('non-Error throw (string) → never crashes', () => {
    expect(typeof humanizeLLMError('boom')).toBe('string');
    expect(typeof humanizeLLMError(undefined)).toBe('string');
  });
});

describe('wrapLLMError — preserves the raw error on cause', () => {
  it('message is friendly, cause is the original Error', () => {
    const raw = new Error('[browser-anthropic] Failed to fetch');
    const wrapped = wrapLLMError(raw);
    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toMatch(/couldn't reach the ai model/i);
    expect((wrapped as { cause?: unknown }).cause).toBe(raw);
  });

  it('non-Error input → no cause, still friendly message', () => {
    const wrapped = wrapLLMError('plain string boom');
    expect(wrapped.message).toContain('plain string boom');
    expect((wrapped as { cause?: unknown }).cause).toBeUndefined();
  });
});

/**
 * B14 — per-provider-SDK fallthrough pinning.
 *
 * The mapper is string/shape matching over whatever the provider SDK throws,
 * which makes it SDK-format-fragile: an SDK major that rewords its error
 * messages silently degrades every mapping to the generic fallback. These
 * suites pin the REAL error shapes each supported SDK major produces today
 * (field names + message formats observed from the SDKs the adapters wrap),
 * so a format drift shows up as a test diff — not as a silent UX regression.
 *
 * Fixtures are plain objects/Errors mimicking the SDK shapes — the SDKs are
 * NOT imported (optional peer deps; shapes are the contract under test).
 * Deliberate generic fallthroughs are pinned too: the fallback must preserve
 * the raw text (that IS the behavior, not a bug).
 */

/** Stainless-style APIError fixture (@anthropic-ai/sdk + openai share the skeleton). */
const stainlessError = (name: string, status: number | undefined, message: string) =>
  Object.assign(new Error(message), { name, ...(status !== undefined && { status }) });

/** AWS SDK v3 exception fixture — status lives ONLY under $metadata (never read). */
const awsError = (name: string, httpStatusCode: number, message: string) =>
  Object.assign(new Error(message), { name, $metadata: { httpStatusCode } });

describe('B14 — @anthropic-ai/sdk (Stainless) error formats', () => {
  it('AuthenticationError (401 + JSON body message) → API key', () => {
    const err = stainlessError(
      'AuthenticationError',
      401,
      '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    );
    expect(humanizeLLMError(err)).toMatch(/api key/i);
  });

  it('RateLimitError (429) → busy / rate limit', () => {
    const err = stainlessError(
      'RateLimitError',
      429,
      '429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}',
    );
    expect(humanizeLLMError(err)).toMatch(/rate limit|busy/i);
  });

  it('APIConnectionError ("Connection error.", NO status) → network bucket', () => {
    const err = stainlessError('APIConnectionError', undefined, 'Connection error.');
    expect(humanizeLLMError(err)).toMatch(/reach the ai model/i);
  });

  it('APIConnectionTimeoutError ("Request timed out.") → timeout bucket', () => {
    const err = stainlessError('APIConnectionTimeoutError', undefined, 'Request timed out.');
    expect(humanizeLLMError(err)).toMatch(/too long/i);
  });

  it('InternalServerError (529 overloaded) → temporary provider problem', () => {
    const err = stainlessError(
      'InternalServerError',
      529,
      '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
    );
    expect(humanizeLLMError(err)).toMatch(/temporary problem/i);
  });

  it('APIUserAbortError ("Request was aborted.") → generic fallthrough, raw preserved', () => {
    const err = stainlessError('APIUserAbortError', undefined, 'Request was aborted.');
    const msg = humanizeLLMError(err);
    expect(msg).toMatch(/the ai call failed/i);
    expect(msg).toContain('Request was aborted.');
  });
});

describe('B14 — openai v4/v5 (Stainless) error formats', () => {
  it('AuthenticationError ("401 Incorrect API key provided: ...") → API key', () => {
    const err = stainlessError(
      'AuthenticationError',
      401,
      '401 Incorrect API key provided: sk-proj-***. You can find your API key at https://platform.openai.com/account/api-keys.',
    );
    expect(humanizeLLMError(err)).toMatch(/api key/i);
    // message alone carries the signal (the ErrorBridge path strips status)
    expect(humanizeLLMError({ message: 'Incorrect API key provided' })).toMatch(/api key/i);
  });

  it('RateLimitError ("429 Rate limit reached ...") → busy / rate limit', () => {
    const err = stainlessError(
      'RateLimitError',
      429,
      '429 Rate limit reached for gpt-4o in organization org-x on tokens per min (TPM).',
    );
    expect(humanizeLLMError(err)).toMatch(/rate limit|busy/i);
  });

  it('NotFoundError ("404 The model `x` does not exist...") → model bucket via model.*not', () => {
    const err = stainlessError(
      'NotFoundError',
      404,
      '404 The model `gpt-9` does not exist or you do not have access to it.',
    );
    expect(humanizeLLMError(err)).toMatch(/model/i);
  });

  it('APIConnectionError ("Connection error.") → network bucket', () => {
    const err = stainlessError('APIConnectionError', undefined, 'Connection error.');
    expect(humanizeLLMError(err)).toMatch(/reach the ai model/i);
  });
});

describe('B14 — @aws-sdk/client-bedrock-runtime v3 error formats', () => {
  it('ThrottlingException → busy / rate limit (matched on message, not $metadata)', () => {
    const err = awsError(
      'ThrottlingException',
      429,
      'Too many requests, please wait before trying again.',
    );
    expect(humanizeLLMError(err)).toMatch(/rate limit|busy/i);
  });

  it('AccessDeniedException ("You don\'t have access to the model...") → auth bucket', () => {
    const err = awsError(
      'AccessDeniedException',
      403,
      "You don't have access to the model with the specified model ID.",
    );
    expect(humanizeLLMError(err)).toMatch(/api key|rejected/i);
  });

  it('ModelTimeoutException → timeout bucket', () => {
    const err = awsError(
      'ModelTimeoutException',
      408,
      'The request to the model timed out. Try your request again.',
    );
    expect(humanizeLLMError(err)).toMatch(/too long/i);
  });

  it('ValidationException ("model identifier is invalid") → generic fallthrough, raw preserved', () => {
    // PINNED fallthrough: top-level status is absent ($metadata only) and the
    // message matches no bucket regex. The fallback must keep the raw text.
    const err = awsError('ValidationException', 400, 'The provided model identifier is invalid.');
    const msg = humanizeLLMError(err);
    expect(msg).toMatch(/the ai call failed/i);
    expect(msg).toContain('The provided model identifier is invalid.');
  });

  it('ServiceUnavailableException → generic fallthrough (no top-level 5xx status to read)', () => {
    const err = awsError('ServiceUnavailableException', 503, 'The service is unavailable.');
    const msg = humanizeLLMError(err);
    expect(msg).toMatch(/the ai call failed/i);
    expect(msg).toContain('The service is unavailable.');
  });
});

describe('B14 — in-repo browser adapter format (wrapStatus shape)', () => {
  it('BrowserAnthropicProviderError carries top-level status → status buckets engage', () => {
    // src/adapters/llm/BrowserAnthropicProvider.ts wrapStatus():
    // Object.assign(new Error(`[browser-anthropic] ${status} ${statusText} — ${body}`), { status })
    const fiveHundred = Object.assign(
      new Error('[browser-anthropic] 500 Internal Server Error — {"type":"error"}'),
      { name: 'BrowserAnthropicProviderError', status: 500 },
    );
    expect(humanizeLLMError(fiveHundred)).toMatch(/temporary problem/i);

    const unauthorized = Object.assign(
      new Error('[browser-anthropic] 401 Unauthorized — {"type":"error"}'),
      { name: 'BrowserAnthropicProviderError', status: 401 },
    );
    expect(humanizeLLMError(unauthorized)).toMatch(/api key/i);
  });
});
