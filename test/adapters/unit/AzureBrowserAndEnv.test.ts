/**
 * browserAzureOpenai() (fetch, no SDK) + providerFromEnv() (env-driven resolver).
 *
 * - browserAzureOpenai: a fake `_fetch` records the URL + headers + body, so we
 *   assert the deployment-scoped Azure URL, the `api-key` header, and that the
 *   model routes to the deployment — no SDK, no network.
 * - providerFromEnv: branches whose SDK is installed (`openai`) are asserted
 *   directly — kind, provider name, model. Branches whose SDK is NOT installed
 *   (`@anthropic-ai/sdk`) still announce themselves by the distinctive
 *   peer-missing error, which proves WHICH branch was chosen; mock and the
 *   no-creds error are exact either way.
 *
 *   The Azure arm was once in the second group, and that is exactly how a
 *   configuration our own docs advertise shipped unable to boot: asserting a
 *   peer-missing throw proves the branch was ENTERED, never that its client can
 *   be built. The wire-level proof lives in
 *   test/adapters/integration/azure-openai-wire.test.ts.
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

  it('reaches that same URL from a trailing slash or an endpoint already ending in /openai', async () => {
    // The two Azure doors share ./azureUrl.ts precisely so one endpoint value
    // works in both. A second `/openai` would 404 every call.
    const expected =
      'https://my-co.openai.azure.com/openai/deployments/gpt-4o-128k/chat/completions?api-version=2024-12-01-preview';
    for (const endpoint of [
      'https://my-co.openai.azure.com/',
      'https://my-co.openai.azure.com//',
      'https://my-co.openai.azure.com/openai',
      'https://my-co.openai.azure.com/openai/',
    ]) {
      const rec: { url?: string; init?: RequestInit } = {};
      await browserAzureOpenai({ ...opts, endpoint, _fetch: recordingFetch(rec) }).complete(
        req('azure'),
      );
      expect(rec.url).toBe(expected);
    }
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
    'OLLAMA_MODEL',
    'OLLAMA_HOST',
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

  it('OLLAMA_MODEL selects the local provider', () => {
    process.env.OLLAMA_MODEL = 'qwen3';
    const r = providerFromEnv();
    expect(r.kind).toBe('ollama');
    expect(r.model).toBe('qwen3');
    expect(r.provider.name).toBe('ollama');
  });

  it('OLLAMA_MODEL wins over a cloud key — a named model is a declaration', () => {
    // Every other arm triggers on a CREDENTIAL, and credentials linger in a
    // shell. `OLLAMA_MODEL=qwen3` is something a person chose and typed for
    // this run; honoring the leftover key instead would ignore them and
    // charge them for it.
    process.env.ANTHROPIC_API_KEY = 'k';
    process.env.OPENAI_API_KEY = 'k';
    process.env.OLLAMA_MODEL = 'qwen3';
    expect(providerFromEnv().kind).toBe('ollama');
  });

  it('OLLAMA_HOST alone does NOT hijack an app that never asked for a local model', () => {
    // People export OLLAMA_HOST just to run Ollama. It configures the address;
    // it does not declare intent.
    process.env.OLLAMA_HOST = 'http://localhost:11434';
    process.env.ANTHROPIC_API_KEY = 'k';
    expect(() => providerFromEnv()).toThrow(/@anthropic-ai\/sdk|anthropic/i);
  });

  it('reads no socket — resolution is env-only and instant', () => {
    // No daemon is running in this test process. If the function probed, this
    // would either hang or fail; it must simply hand back the provider and let
    // the eventual CALL be the thing that refuses.
    process.env.OLLAMA_MODEL = 'qwen3';
    process.env.OLLAMA_HOST = 'http://127.0.0.1:1';
    const started = Date.now();
    expect(providerFromEnv().kind).toBe('ollama');
    expect(Date.now() - started).toBeLessThan(100);
  });

  it('detects Azure first among the credential arms (Azure env → the azure branch)', () => {
    process.env.OPENAI_BASE_URL = 'https://x.openai.azure.com';
    process.env.AZURE_OPENAI_API_KEY = 'k';
    process.env.AZURE_OPENAI_API_VERSION = '2024-12-01-preview';
    process.env.MODEL_NAME = 'gpt-4o-128k';
    // This used to assert a THROW: the `openai` SDK was not installed here, so
    // the azure branch announced itself by failing to load its peer. That is
    // the assertion that let "OPENAI_BASE_URL cannot boot" ship — the branch
    // was never actually built. The SDK is now a devDependency and the branch
    // is asserted directly.
    const r = providerFromEnv();
    expect(r.kind).toBe('azure-openai');
    expect(r.provider.name).toBe('azure-openai');
    // The deployment travels as the model, never the kind label 'azure'.
    expect(r.model).toBe('gpt-4o-128k');
  });

  it('refuses by name when Azure creds arrive with no deployment', () => {
    process.env.AZURE_OPENAI_ENDPOINT = 'https://x.openai.azure.com';
    // A DISTINCTIVE credential on purpose: the one-letter key this test used to
    // set makes the secrecy assertion below unfalsifiable, since ordinary prose
    // contains that letter.
    process.env.AZURE_OPENAI_API_KEY = 'sk-azure-DO-NOT-LEAK-9f3c';
    process.env.AZURE_OPENAI_API_VERSION = '2024-12-01-preview';
    // Asserted against THIS refusal, not against any error that happens to
    // mention a variable name: the previous pattern (`A.*B|B`) would have been
    // satisfied by an unrelated throw quoting MODEL_NAME, which is the vacuous
    // shape that let the unbootable config ship in the first place.
    let thrown: unknown;
    try {
      providerFromEnv();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    // It is the deployment refusal ...
    expect(message).toContain(
      'providerFromEnv: Azure credentials are set, but no deployment is named.',
    );
    // ... it teaches BOTH spellings of the fix ...
    expect(message).toContain('AZURE_OPENAI_DEPLOYMENT');
    expect(message).toContain('MODEL_NAME');
    // ... and it never echoes the credential it was handed.
    expect(message).not.toContain('sk-azure-DO-NOT-LEAK-9f3c');
  });

  it('falls to Anthropic when only ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    expect(() => providerFromEnv()).toThrow(/@anthropic-ai\/sdk|anthropic/i);
  });

  it('falls to OpenAI when only OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'k';
    // Also once a peer-missing throw; now the branch itself. Zero delta in what
    // this arm RETURNS: the shorthand `'openai'` is what the adapter resolves to
    // its declared `defaultModel`, and nothing about the Azure fix touched it.
    const r = providerFromEnv();
    expect(r.kind).toBe('openai');
    expect(r.provider.name).toBe('openai');
    expect(r.model).toBe('openai');
  });

  it('LLM_MODEL, when set, is the model on the OpenAI arm', () => {
    process.env.OPENAI_API_KEY = 'k';
    process.env.LLM_MODEL = 'gpt-4o';
    expect(providerFromEnv().model).toBe('gpt-4o');
  });

  it('returns the mock with { fallbackToMock } when no creds are set', () => {
    const r = providerFromEnv({ fallbackToMock: true });
    expect(r.kind).toBe('mock');
    expect(r.model).toBe('mock');
    expect(r.provider.name).toBe('mock');
  });

  it('throws a helpful error when no creds and no fallback', () => {
    expect(() => providerFromEnv()).toThrow(/no provider declared/i);
    // The cheapest fix goes first, because it is the cheapest fix.
    expect(() => providerFromEnv()).toThrow(/OLLAMA_MODEL/);
  });
});
