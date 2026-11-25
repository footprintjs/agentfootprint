/**
 * Who says whether a model binds its reasoning to its context: the
 * Anthropic-wire adapters answer per model (`bound`, `unbound`, or `unknown`
 * for an id their table cannot place), the app can state an id through the
 * adapter's `thinkingBinding` option, every other provider is silent
 * (unbound), and every wrapper keeps the answer — a fallback pair taking the
 * stricter side.
 *
 * Test type: unit / contract.
 */
import { describe, expect, it } from 'vitest';
import { anthropic, AnthropicProvider } from '../../../src/adapters/llm/AnthropicProvider.js';
import {
  browserAnthropic,
  BrowserAnthropicProvider,
} from '../../../src/adapters/llm/BrowserAnthropicProvider.js';
import {
  invokeModelGateway,
  InvokeModelGatewayProvider,
} from '../../../src/adapters/llm/InvokeModelGatewayProvider.js';
import { openai } from '../../../src/adapters/llm/OpenAIProvider.js';
import { mock } from '../../../src/adapters/llm/MockProvider.js';
import { thinkingBindingOf } from '../../../src/providers.js';
import { withRetry } from '../../../src/resilience/withRetry.js';
import { withCircuitBreaker } from '../../../src/resilience/withCircuitBreaker.js';
import { withFallback } from '../../../src/resilience/withFallback.js';

const PROFILE = 'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc';
const gateway = {
  baseUrl: 'https://gateway.invalid',
  apiKeyHeader: 'x-api-key',
  apiKey: 'k',
  model: 'claude-haiku-5-5',
};
const adapters = (stated?: (id: string) => 'bound' | 'unbound' | undefined) => {
  const extra = stated === undefined ? {} : { thinkingBinding: stated };
  return [
    anthropic({ apiKey: 'k', ...extra }),
    new AnthropicProvider({ apiKey: 'k', ...extra }),
    browserAnthropic({ apiKey: 'k', ...extra }),
    new BrowserAnthropicProvider({ apiKey: 'k', ...extra }),
    invokeModelGateway({ ...gateway, ...extra }),
    new InvokeModelGatewayProvider({ ...gateway, ...extra }),
  ];
};

describe('the Anthropic-wire adapters answer per model', () => {
  it.each(adapters().map((p) => [p.name, p] as const))('%s', (_, provider) => {
    const of = (id: string) => thinkingBindingOf(provider, id);
    for (const id of [
      'claude-haiku-5-5',
      'claude-sonnet-5-5',
      'claude-opus-5-5',
      'claude-fable-5-1',
      'claude-fable-5-2',
      'claude-mythos-5-2',
      'us.anthropic.claude-opus-5-5-v1:0',
    ])
      expect(of(id), id).toMatchObject({ binding: 'bound', by: 'provider' });
    expect(of('us.anthropic.claude-opus-5-5-v1:0').family).toBe('claude-opus-5-5');
    for (const id of ['claude-haiku-4-5', 'claude-opus-4-8', 'claude-opus-5', 'claude-3-5-haiku'])
      expect(of(id), id).toMatchObject({ binding: 'unbound', by: 'provider' });
    // Mythos 5.1 is not checked by default on every platform: unknown, as are
    // the ids the table cannot place.
    expect(of('claude-mythos-5-1')).toEqual({
      binding: 'unknown',
      by: 'provider',
      family: 'claude-mythos-5-1',
    });
    for (const id of ['claude-opus-6', PROFILE, 'team-alias'])
      expect(of(id), id).toEqual({ binding: 'unknown', by: 'provider' });
  });

  it.each(
    adapters((id) => (id === PROFILE ? 'bound' : id === 'team-alias' ? 'unbound' : undefined)).map(
      (p) => [p.name, p] as const,
    ),
  )(
    '%s takes the app statement for an id the table cannot place, never over the table',
    (_, provider) => {
      expect(thinkingBindingOf(provider, PROFILE)).toEqual({ binding: 'bound', by: 'app' });
      expect(thinkingBindingOf(provider, 'team-alias')).toEqual({ binding: 'unbound', by: 'app' });
      expect(thinkingBindingOf(provider, 'claude-opus-6')).toEqual({
        binding: 'unknown',
        by: 'provider',
      });
      expect(thinkingBindingOf(provider, 'claude-haiku-5-5')).toMatchObject({
        binding: 'bound',
        by: 'provider',
      });
    },
  );

  it('a statement that throws does not fail anything: unknown, appStatement failed', () => {
    const provider = anthropic({
      apiKey: 'k',
      thinkingBinding: () => {
        throw new Error('app boom');
      },
    });
    expect(thinkingBindingOf(provider, PROFILE)).toEqual({
      binding: 'unknown',
      by: 'provider',
      appStatement: 'failed',
    });
    // A table id never asks the app.
    expect(thinkingBindingOf(provider, 'claude-haiku-4-5').binding).toBe('unbound');
  });
});

describe('every other provider is unbound', () => {
  it('openai and the mock declare nothing', () => {
    for (const provider of [openai({ apiKey: 'k' }), mock({ reply: 'x' })]) {
      expect(provider.thinkingBinding).toBeUndefined();
      expect(thinkingBindingOf(provider, 'claude-haiku-5-5')).toEqual({
        binding: 'unbound',
        by: 'provider',
      });
    }
  });

  it('a malformed answer is unknown: recorded, never refused', () => {
    const provider = {
      ...mock({ reply: 'x' }),
      thinkingBinding: () => ({ binding: 'yes' } as never),
    };
    expect(thinkingBindingOf(provider, 'm')).toEqual({ binding: 'unknown', by: 'provider' });
  });
});

describe('wrappers keep the answer', () => {
  const claude = anthropic({ apiKey: 'k' });
  const other = mock({ reply: 'x' });
  it('withRetry and withCircuitBreaker forward it', () => {
    for (const wrapped of [withRetry(claude), withCircuitBreaker(claude)]) {
      expect(thinkingBindingOf(wrapped, 'claude-haiku-5-5').binding).toBe('bound');
      expect(thinkingBindingOf(wrapped, 'claude-opus-6').binding).toBe('unknown');
      expect(thinkingBindingOf(wrapped, 'claude-haiku-4-5').binding).toBe('unbound');
    }
    expect(withRetry(other).thinkingBinding).toBeUndefined();
    expect(withCircuitBreaker(other).thinkingBinding).toBeUndefined();
  });
  it("withFallback forwards its primary's answer for the model asked, never a blend", () => {
    expect(thinkingBindingOf(withFallback(claude, other), 'claude-haiku-5-5').binding).toBe(
      'bound',
    );
    // The primary is silent (unbound): the pair is unbound, though the fallback binds.
    expect(withFallback(other, claude).thinkingBinding).toBeUndefined();
    expect(thinkingBindingOf(withFallback(other, claude), 'claude-haiku-5-5').binding).toBe(
      'unbound',
    );
    const statedUnbound = anthropic({ apiKey: 'k', thinkingBinding: () => 'unbound' });
    expect(thinkingBindingOf(withFallback(statedUnbound, claude), PROFILE)).toEqual({
      binding: 'unbound',
      by: 'app',
    });
    expect(withFallback(other, mock({ reply: 'y' })).thinkingBinding).toBeUndefined();
  });
});
