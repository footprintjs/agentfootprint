import { describe, it, expect } from 'vitest';
import { anthropic, openai, ollama, bedrock, lookupPricing } from '../../src';

describe('Model providers', () => {
  it('anthropic returns correct config', () => {
    const config = anthropic('claude-sonnet-4-20250514');
    expect(config.provider).toBe('anthropic');
    expect(config.modelId).toBe('claude-sonnet-4-20250514');
  });

  it('anthropic accepts apiKey', () => {
    const config = anthropic('claude-sonnet-4-20250514', { apiKey: 'sk-test' });
    expect(config.apiKey).toBe('sk-test');
  });

  it('openai returns correct config', () => {
    const config = openai('gpt-4o');
    expect(config.provider).toBe('openai');
    expect(config.modelId).toBe('gpt-4o');
  });

  it('openai accepts baseUrl', () => {
    const config = openai('gpt-4o', { baseUrl: 'http://localhost:8080' });
    expect(config.baseUrl).toBe('http://localhost:8080');
  });

  it('ollama defaults to localhost', () => {
    const config = ollama('llama3');
    expect(config.provider).toBe('ollama');
    expect(config.baseUrl).toBe('http://localhost:11434');
  });

  it('ollama accepts custom baseUrl', () => {
    const config = ollama('llama3', { baseUrl: 'http://remote:11434' });
    expect(config.baseUrl).toBe('http://remote:11434');
  });

  it('bedrock returns correct config', () => {
    const config = bedrock('anthropic.claude-3-sonnet');
    expect(config.provider).toBe('bedrock');
    expect(config.modelId).toBe('anthropic.claude-3-sonnet');
  });
});

describe('Pricing lookup', () => {
  it('returns pricing for known model', () => {
    const pricing = lookupPricing('gpt-4o');
    expect(pricing).toBeDefined();
    expect(pricing!.input).toBe(2.5);
  });

  it('returns undefined for unknown model', () => {
    expect(lookupPricing('unknown-model-xyz')).toBeUndefined();
  });
});
