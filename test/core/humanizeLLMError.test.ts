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
    expect(humanizeLLMError(new Error('getaddrinfo EAI_AGAIN api.x.com'))).toMatch(/reach the ai model/i);
  });

  it('401/403 + auth phrases → API key hint', () => {
    expect(humanizeLLMError({ status: 401, message: 'Unauthorized' })).toMatch(/api key/i);
    expect(humanizeLLMError(new Error('invalid x-api-key'))).toMatch(/api key/i);
  });

  it('429 / rate limit → wait & retry', () => {
    expect(humanizeLLMError({ status: 429, message: 'Too Many Requests' })).toMatch(/rate limit|busy/i);
    expect(humanizeLLMError(new Error('rate limit exceeded'))).toMatch(/rate limit|busy/i);
  });

  it('timeout → took too long', () => {
    expect(humanizeLLMError(new Error('Request timed out'))).toMatch(/too long/i);
    expect(humanizeLLMError(new Error('ETIMEDOUT'))).toMatch(/too long/i);
  });

  it('5xx → temporary provider problem', () => {
    expect(humanizeLLMError({ status: 503, message: 'Service Unavailable' })).toMatch(/temporary problem/i);
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
