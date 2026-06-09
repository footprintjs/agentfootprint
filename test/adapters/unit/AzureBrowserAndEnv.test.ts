/**
 * browserAzureOpenai() (fetch, no SDK) + providerFromEnv() (env-driven resolver).
 *
 * - browserAzureOpenai: a fake `_fetch` records the URL + headers + body, so we
 *   assert the deployment-scoped Azure URL, the `api-key` header, and that the
 *   model routes to the deployment — no SDK, no network.
 * - providerFromEnv: the vendor factories lazy-load their SDKs eagerly, so each
 *   detected branch surfaces a distinctive error (proving WHICH branch was
 *   chosen) without the peer SDKs installed; mock + the no-creds error are exact.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { browserAzureOpenai } from '../../../src/adapters/llm/BrowserOpenAIProvider.js';
import { providerFromEnv } from '../../../src/adapters/llm/createProvider.js';
import type { LLMRequest } from '../../../src/adapters/types.js';

function recordingFetch(recorder: { url?: string; init?: RequestInit }): typeof fetch {
  return ((url: RequestInfo | URL, init?: RequestInit) => {
    recorder.url = String(url);
    recorder.init = init;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'az1',
          model: 'gpt-4o-128k',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
  }) as typeof fetch;
}

const req = (model: string): LLMRequest => ({ model, messages: [{ role: 'user', content: 'q' }] });

describe('browserAzureOpenai()', () => {
  const opts = {
    endpoint: 'https://my-co.openai.azure.com',
    apiKey: 'sek-ret',
    apiVersion: '2024-12-01-preview',
    deployment: 'gpt-4o-128k',
  };

  it('builds the deployment-scoped Azure URL with the api-version', async () => {
    const rec: { url?: string; init?: RequestInit } = {};
    await browserAzureOpenai({ ...opts, _fetch: recordingFetch(rec) }).complete(req('azure'));
    expect(rec.url).toBe(
      'https://my-co.openai.azure.com/openai/deployments/gpt-4o-128k/chat/completions?api-version=2024-12-01-preview',
    );
  });

  it('authenticates with the `api-key` header (not Authorization: Bearer)', async () => {
    const rec: { url?: string; init?: RequestInit } = {};
    await browserAzureOpenai({ ...opts, _fetch: recordingFetch(rec) }).complete(req('azure'));
    const headers = rec.init!.headers as Record<string, string>;
    expect(headers['api-key']).toBe('sek-ret');
    expect(headers['authorization']).toBeUndefined();
  });

  it("routes the 'azure' shorthand model to the deployment in the body", async () => {
    const rec: { url?: string; init?: RequestInit } = {};
    await browserAzureOpenai({ ...opts, _fetch: recordingFetch(rec) }).complete(req('azure'));
    const body = JSON.parse(String(rec.init!.body));
    expect(body.model).toBe('gpt-4o-128k');
  });

  it('names itself browser-azure-openai and validates required options', () => {
    expect(browserAzureOpenai({ ...opts, _fetch: recordingFetch({}) }).name).toBe(
      'browser-azure-openai',
    );
    expect(() => browserAzureOpenai({ ...opts, endpoint: '' })).toThrow(/endpoint/i);
    expect(() => browserAzureOpenai({ ...opts, apiVersion: '' })).toThrow(/apiVersion/i);
    expect(() => browserAzureOpenai({ ...opts, deployment: '' })).toThrow(/deployment/i);
  });
});

describe('providerFromEnv()', () => {
  const VARS = [
    'AZURE_OPENAI_API_KEY',
    'AZURE_OPENAI_ENDPOINT',
    'OPENAI_BASE_URL',
    'AZURE_OPENAI_API_VERSION',
    'AZURE_OPENAI_DEPLOYMENT',
    'MODEL_NAME',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'LLM_MODEL',
  ];
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = {};
    for (const v of VARS) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
  });
  afterEach(() => {
    for (const v of VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  });

  it('detects Azure first (Azure env → the azure branch)', () => {
    process.env.OPENAI_BASE_URL = 'https://x.openai.azure.com';
    process.env.AZURE_OPENAI_API_KEY = 'k';
    process.env.AZURE_OPENAI_API_VERSION = '2024-12-01-preview';
    process.env.MODEL_NAME = 'gpt-4o-128k';
    // azureOpenai() eagerly builds the AzureOpenAI client → needs the `openai`
    // SDK (not installed here). The error proves the azure branch was selected.
    expect(() => providerFromEnv()).toThrow(/openai package|AzureOpenAI/i);
  });

  it('falls to Anthropic when only ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    expect(() => providerFromEnv()).toThrow(/@anthropic-ai\/sdk|anthropic/i);
  });

  it('falls to OpenAI when only OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'k';
    expect(() => providerFromEnv()).toThrow(/requires the .?openai.? package/i);
  });

  it('returns the mock with { fallbackToMock } when no creds are set', () => {
    const r = providerFromEnv({ fallbackToMock: true });
    expect(r.kind).toBe('mock');
    expect(r.model).toBe('mock');
    expect(r.provider.name).toBe('mock');
  });

  it('throws a helpful error when no creds and no fallback', () => {
    expect(() => providerFromEnv()).toThrow(/no provider credentials/i);
  });
});
